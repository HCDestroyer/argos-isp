/**
 * Rutas de sorteos (A3, `start/routes/lealtad.ts`, `contratos/lealtad.md` §7 y §15.3) y del catálogo
 * de premios de lealtad (solo lectura). Mismos pasos, permisos y errores que la API: 409
 * `estado_sorteo`, 422 `bases_incompletas`, `requisito_pendiente`, `corte_no_vencido` y
 * `sin_participantes`. Los hashes y el resultado salen de `argos-sorteo-v1` (`~/utils/sorteoV1`).
 */
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bytesDeHex, hashListaSorteo, jsonCanonicoSorteo, semillaFinalSorteo, sha256SorteoHex, sortearV1 } from '~/utils/sorteoV1'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, versionCambiada } from '../comun'
import { bancosLibro } from '../libro/datos'
import { errorArchivoSorteo, tipoArchivoSorteo } from '~/utils/archivosSorteo'
import { errorImagenPremio, leerImagenPremio } from '~/utils/imagenPremio'
import { IMAGEN_DE_ARCHIVO, type ParticipanteSorteo, type SorteoPrivado } from './datos'
import { bytesBase64, IMAGENES_SEMILLA } from './imagenes'

type Sorteo = Schema<'SorteoDetalle'>
type Premio = Sorteo['premios'][number]
type Ganador = Sorteo['ganadores'][number]
type Requisito = Schema<'RequisitoSorteo'>
type Errores = NonNullable<Problem['errors']>

const ESTADOS: readonly Sorteo['estado'][] = ['borrador', 'bases_publicadas', 'participacion_abierta', 'corte_cerrado', 'ejecutado', 'premios_entregados', 'cancelado']
const CLAVES: readonly Requisito['clave'][] = ['bases_diaco', 'autorizacion_gobernacion', 'fianza', 'isr_premios', 'timbre_fiscal', 'delegado_o_notario', 'publicacion_resultados', 'lista_a_gobernacion']
const PARA_ABRIR: readonly Requisito['clave'][] = ['bases_diaco']
// Decisión del PM (19 oct): Gobernación y fianza se marcan, pero no bloquean la ejecución.
const PARA_EJECUTAR: readonly Requisito['clave'][] = ['bases_diaco', 'isr_premios', 'timbre_fiscal', 'delegado_o_notario']
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const PORCENTAJE = /^\d{1,3}(\.\d{1,2})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/
/** Ids de los egresos de premios en efectivo de los fixtures (fuera de `bd.egresos`: la categoría `premios` aún no está en el contrato). */
const EGRESOS_PREMIO = 880000
const ASIENTOS_PREMIO = 890000

const invalido = (errores: Errores): RespuestaFixture => problemaTipado(422, 'validacion', 'Datos inválidos', 'Los datos enviados no son válidos', errores)

/** Como `EstadoSorteoInvalido` de la API. */
function estadoInvalido(sorteo: Sorteo, accion: string): RespuestaFixture {
    return problemaTipado(409, 'estado_sorteo', 'Estado del sorteo', `El sorteo ${sorteo.id} está ${sorteo.estado}: no admite ${accion}`)
}

/** Como `ReglaNegocio`: 422 con su código. */
function regla(codigo: string, detalle: string): RespuestaFixture {
    return problemaTipado(422, codigo, 'Regla de negocio', detalle)
}

function privadoDe(sorteoId: number): SorteoPrivado {
    let privado = bd.sorteosPrivados.find(p => p.sorteo_id === sorteoId)
    if (!privado) {
        privado = { sorteo_id: sorteoId, semilla: null, participantes: [], asistentes: [], ejecutarCon: null }
        bd.sorteosPrivados.push(privado)
    }
    return privado
}

/** Como `documentoBases` de la API: lo que se congela y cuyo SHA-256 es `bases_hash`. */
function documentoBases(s: Sorteo): Record<string, unknown> {
    return {
        algoritmo: s.algoritmo,
        bases: s.bases,
        corte_en: s.corte_en ? new Date(s.corte_en).toISOString() : null,
        criterios: s.criterios,
        descripcion: s.descripcion,
        empresa_id: s.empresa_id,
        fecha_sorteo: s.fecha_sorteo ? new Date(s.fecha_sorteo).toISOString() : null,
        inscripcion_desde: s.inscripcion_desde,
        lugar: s.lugar,
        nombre: s.nombre,
        premios: s.premios.map(p => ({ cantidad: p.cantidad, imagen_url: p.imagen_url, isr_pct: p.isr_pct, nombre: p.nombre, posicion: p.posicion, retiene_isr: p.retiene_isr, tipo: p.tipo, valor: p.valor })),
        sorteo_id: s.id,
        suplentes: s.suplentes,
    }
}

/** Publica: `bases_hash` y una semilla nueva con su compromiso (`publicar_bases`). */
async function congelarBases(s: Sorteo, semilla: Uint8Array<ArrayBuffer>): Promise<void> {
    s.bases_hash = await sha256SorteoHex(jsonCanonicoSorteo(documentoBases(s)))
    s.compromiso = await sha256SorteoHex(semilla)
    privadoDe(s.id).semilla = [...semilla].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sellarLista(s: Sorteo, participantes: ParticipanteSorteo[]): Promise<void> {
    s.lista_hash = await hashListaSorteo(participantes)
    s.participantes = participantes.length
    s.boletos = participantes.reduce((suma, p) => suma + p.boletos, 0)
}

/** Como `EjecutarSorteo`: titulares (Σ cantidad, en orden de premio) y luego suplentes. */
async function sortearFixture(s: Sorteo, valorPublico: string, evidencia: string, momento: string): Promise<void> {
    const privado = privadoDe(s.id)
    const semilla = bytesDeHex(privado.semilla ?? '')
    const lista = privado.participantes
    const titulares = s.premios.reduce((suma, p) => suma + p.cantidad, 0)
    const elegidos = await sortearV1(semilla, s.lista_hash ?? '', s.bases_hash ?? '', valorPublico, lista, titulares + s.suplentes)
    const premiosPorPuesto = s.premios.flatMap(p => Array.from({ length: p.cantidad }, () => p.posicion))
    let siguiente = bd.sorteos.flatMap(x => x.ganadores).reduce((maximo, g) => Math.max(maximo, g.id), 0)
    s.ganadores = elegidos.map((codigo, i): Ganador => {
        const p = lista.find(x => x.codigo === codigo)
        const tipo = i < titulares ? 'titular' : 'suplente'
        siguiente += 1
        return {
            id: siguiente,
            posicion: i + 1,
            tipo,
            participante_id: p?.id ?? 0,
            cliente_id: p?.cliente_id ?? 0,
            codigo_publico: codigo,
            premio_posicion: tipo === 'titular' ? premiosPorPuesto[i] ?? null : null,
            estado: 'por_notificar',
            retencion_isr: null,
            contrapartida: null,
            asiento_id: null,
            egreso_id: null,
            canje_id: null,
            entregado_en: null,
            compra_linea_id: null,
            premio: tipo === 'titular' ? premiosPorPuesto[i] ?? null : null,
            premio_sustitucion: null,
            sustituye_a: null,
            notificado_en: null,
            reclamar_antes: null,
            no_reclamado_en: null,
            constancia_archivo_id: null,
            compra_unidades: null,
            compra_base: null,
            version: 1,
        }
    })
    s.semilla = privado.semilla
    s.valor_publico = valorPublico
    s.valor_publico_evidencia = evidencia
    s.resultado = {
        algoritmo: s.algoritmo,
        semilla: privado.semilla,
        semilla_final: await semillaFinalSorteo(semilla, s.lista_hash ?? '', s.bases_hash ?? '', valorPublico),
        valor_publico: valorPublico,
        lista_hash: s.lista_hash,
        bases_hash: s.bases_hash,
        titulares,
        suplentes: s.suplentes,
        elegidos,
    }
    s.estado = 'ejecutado'
    s.ejecutado_en = momento
}

/**
 * Los sorteos sembrados ya publicados, cerrados o ejecutados reciben aquí sus hashes y su resultado,
 * calculados como lo haría la API en cada paso (la semilla sale del id: es una simulación).
 */
let preparando: { sorteos: Sorteo[], promesa: Promise<void> } | null = null

function prepararSorteos(): Promise<void> {
    if (preparando?.sorteos === bd.sorteos) {
        return preparando.promesa
    }
    const promesa = (async () => {
        for (const s of bd.sorteos) {
            if (s.publicado_en && !s.bases_hash) {
                await congelarBases(s, bytesDeHex(await sha256SorteoHex(`semilla de los fixtures ${s.id}`)))
            }
            const privado = bd.sorteosPrivados.find(p => p.sorteo_id === s.id)
            if (privado && s.corte_cerrado_en && !s.lista_hash) {
                await sellarLista(s, privado.participantes)
            }
            if (privado?.ejecutarCon && !s.resultado) {
                await sortearFixture(s, privado.ejecutarCon.valor_publico, privado.ejecutarCon.valor_publico_evidencia, privado.ejecutarCon.ejecutado_en)
                for (const n of privado.ejecutarCon.notificados ?? []) {
                    const g = s.ganadores.find(x => x.posicion === n.posicion)
                    if (g) {
                        Object.assign(g, { estado: 'notificado', notificado_en: n.notificado_en, reclamar_antes: n.reclamar_antes })
                    }
                }
            }
        }
    })()
    preparando = { sorteos: bd.sorteos, promesa }
    return promesa
}

function resumen(s: Sorteo): Schema<'SorteoLealtad'> {
    const { requisitos: _r, participantes: _p, boletos: _b, ganadores: _g, ...lista } = s
    return lista
}

function avanzar(s: Sorteo, cambios: Partial<Sorteo>): Sorteo {
    Object.assign(s, cambios, { version: s.version + 1, updated_at: ahora() })
    return s
}

/** Como `exigirAccesoEmpresa`: 403 si el sorteo es de otra empresa que la activa. */
function sorteoDe(solicitud: SolicitudFixture): Sorteo | RespuestaFixture {
    const s = bd.sorteos.find(x => x.id === idDe(solicitud))
    if (!s) {
        return noEncontrado('el sorteo')
    }
    const activa = empresaActivaDe(solicitud)
    if (activa !== null && s.empresa_id !== activa) {
        return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `El sorteo ${s.id} es de otra empresa`)
    }
    return s
}

function esSorteo(valor: Sorteo | RespuestaFixture): valor is Sorteo {
    return 'premios' in valor
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

function fechaHora(valor: unknown): string | null | undefined | false {
    if (valor === undefined) {
        return undefined
    }
    if (valor === null || valor === '') {
        return null
    }
    if (typeof valor !== 'string') {
        return false
    }
    const fecha = new Date(valor)
    return Number.isNaN(fecha.getTime()) ? false : fecha.toISOString()
}

/** Como `filasPremios` de la API: valor > 0; servicio con un descuento o mes gratis del catálogo de la empresa. */
function premiosDe(cuerpo: unknown, empresaId: number, errores: Errores): Premio[] {
    if (!Array.isArray(cuerpo)) {
        errores.push({ field: 'premios', message: 'Lista de premios inválida', rule: 'array' })
        return []
    }
    let id = bd.sorteos.flatMap(s => s.premios).reduce((maximo, p) => Math.max(maximo, p.id), 0)
    return cuerpo.map((entrada: unknown, i): Premio => {
        const p = typeof entrada === 'object' && entrada !== null ? entrada as Record<string, unknown> : {}
        const nombre = texto(p.nombre)
        if (!nombre || nombre.length > 200) {
            errores.push({ field: `premios.${i}.nombre`, message: 'El nombre es obligatorio', rule: 'required' })
        }
        const valor = typeof p.valor === 'string' ? p.valor.trim() : ''
        if (!MONTO.test(valor) || !new Decimal(valor).gt(0)) {
            errores.push({ field: `premios.${i}.valor`, message: 'El valor debe ser mayor que 0', rule: 'valor' })
        }
        const tipo = p.tipo === 'efectivo' || p.tipo === 'bien' || p.tipo === 'servicio' ? p.tipo : null
        if (!tipo) {
            errores.push({ field: `premios.${i}.tipo`, message: 'Tipo inválido', rule: 'enum' })
        }
        const premioId = typeof p.premio_id === 'number' ? p.premio_id : null
        if (tipo === 'servicio') {
            const catalogo = bd.premiosLealtad.find(x => x.id === premioId)
            if (!catalogo || catalogo.empresa_id !== empresaId || !['descuento_factura', 'mes_gratis'].includes(catalogo.tipo)) {
                errores.push({ field: `premios.${i}.premio_id`, message: 'Un premio de servicio usa un descuento o mes gratis del catálogo de lealtad de la empresa', rule: 'premio' })
            }
        }
        else if (premioId) {
            errores.push({ field: `premios.${i}.premio_id`, message: 'Solo un premio de servicio usa el catálogo', rule: 'premio' })
        }
        const cantidad = typeof p.cantidad === 'number' ? p.cantidad : 1
        if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100) {
            errores.push({ field: `premios.${i}.cantidad`, message: 'Cantidad de 1 a 100', rule: 'range' })
        }
        if (texto(p.imagen_url)) {
            errores.push({ field: `premios.${i}.imagen_url`, message: 'La imagen del premio se sube (POST /lealtad/sorteos/:id/premios/:posicion/imagen): el portal no carga URLs externas', rule: 'imagen_externa' })
        }
        const isr = typeof p.isr_pct === 'string' && p.isr_pct.trim() ? p.isr_pct.trim() : '10.00'
        if (!PORCENTAJE.test(isr)) {
            errores.push({ field: `premios.${i}.isr_pct`, message: 'Porcentaje inválido', rule: 'regex' })
        }
        id += 1
        return {
            id,
            posicion: i + 1,
            nombre: nombre ?? '',
            cantidad,
            imagen_url: null,
            imagen_archivo_id: null,
            valor: MONTO.test(valor) ? new Decimal(valor).toFixed(2) : '0.00',
            tipo: tipo ?? 'efectivo',
            premio_id: tipo === 'servicio' ? premioId : null,
            retiene_isr: p.retiene_isr === true,
            isr_pct: PORCENTAJE.test(isr) ? new Decimal(isr).toFixed(2) : '10.00',
        }
    })
}

/** Campos comunes de crear y editar (`camposSorteo` del validador). */
function camposDe(cuerpo: Record<string, unknown>, previo: Sorteo | null, empresaId: number, errores: Errores): Partial<Sorteo> {
    const campos: Partial<Sorteo> = {}
    if (cuerpo.nombre !== undefined || !previo) {
        const nombre = texto(cuerpo.nombre)
        if (!nombre || nombre.length > 200) {
            errores.push({ field: 'nombre', message: 'El nombre es obligatorio', rule: 'required' })
        }
        campos.nombre = nombre ?? ''
    }
    if (cuerpo.descripcion !== undefined) {
        campos.descripcion = texto(cuerpo.descripcion)
    }
    if (typeof cuerpo.aviso_portal === 'boolean') {
        campos.aviso_portal = cuerpo.aviso_portal
    }
    if (cuerpo.bases !== undefined) {
        campos.bases = typeof cuerpo.bases === 'object' && cuerpo.bases !== null ? { ...cuerpo.bases as Record<string, unknown> } : {}
    }
    if (cuerpo.criterios !== undefined || !previo) {
        const c = typeof cuerpo.criterios === 'object' && cuerpo.criterios !== null ? cuerpo.criterios as Record<string, unknown> : {}
        const boletos = typeof c.boletos_por_servicio === 'number' ? c.boletos_por_servicio : previo?.criterios.boletos_por_servicio ?? 1
        if (!Number.isInteger(boletos) || boletos < 0 || boletos > 100) {
            errores.push({ field: 'criterios.boletos_por_servicio', message: 'De 0 a 100', rule: 'range' })
        }
        campos.criterios = { boletos_por_servicio: boletos, admite_canje: typeof c.admite_canje === 'boolean' ? c.admite_canje : previo?.criterios.admite_canje ?? false }
    }
    if (cuerpo.inscripcion_desde !== undefined) {
        const valor = cuerpo.inscripcion_desde
        if (valor !== null && (typeof valor !== 'string' || !FECHA.test(valor))) {
            errores.push({ field: 'inscripcion_desde', message: 'Fecha inválida', rule: 'date' })
        }
        campos.inscripcion_desde = typeof valor === 'string' && FECHA.test(valor) ? valor : null
    }
    for (const campo of ['corte_en', 'fecha_sorteo'] as const) {
        const valor = fechaHora(cuerpo[campo])
        if (valor === false) {
            errores.push({ field: campo, message: 'Fecha y hora inválidas', rule: 'date' })
        }
        else if (valor !== undefined) {
            campos[campo] = valor
        }
    }
    if (cuerpo.lugar !== undefined) {
        campos.lugar = texto(cuerpo.lugar)
    }
    if (cuerpo.suplentes !== undefined) {
        const suplentes = cuerpo.suplentes
        if (typeof suplentes !== 'number' || !Number.isInteger(suplentes) || suplentes < 0 || suplentes > 20) {
            errores.push({ field: 'suplentes', message: 'De 0 a 20', rule: 'range' })
        }
        else {
            campos.suplentes = suplentes
        }
    }
    if (cuerpo.premios !== undefined) {
        campos.premios = premiosDe(cuerpo.premios, empresaId, errores)
    }
    return campos
}

/** Como `exigirBasesCompletas` (§7.2): 422 `bases_incompletas` con el primer campo que falta. */
function basesIncompletas(s: Sorteo): RespuestaFixture | null {
    const b = s.bases
    const lleno = (v: unknown) => typeof v === 'string' && v.trim().length > 0
    const falta = (campo: string, detalle: string) => problemaTipado(422, 'bases_incompletas', 'Bases incompletas', detalle, [{ field: campo, message: detalle, rule: 'bases_incompletas' }])
    if (!lleno(b.mecanica)) {
        return falta('bases.mecanica', 'Falta la mecánica y forma del sorteo')
    }
    if (!lleno(b.regla_participacion)) {
        return falta('bases.regla_participacion', 'Falta la regla de participación (cómo se ganan boletos)')
    }
    if (!s.inscripcion_desde || !s.corte_en) {
        return falta('corte_en', 'Falta el periodo de participación con fecha de fin explícita')
    }
    if (s.premios.length === 0) {
        return falta('premios', 'Faltan los premios, en qué consisten y su valor')
    }
    if (!s.fecha_sorteo || !lleno(s.lugar)) {
        return falta('fecha_sorteo', 'Faltan la fecha, la hora y el lugar del sorteo')
    }
    if (new Date(s.fecha_sorteo).getTime() < new Date(s.corte_en).getTime()) {
        return falta('fecha_sorteo', 'El sorteo no puede ser antes del corte')
    }
    if (!(Number(b.plazo_reclamo_dias) > 0) || !lleno(b.no_reclamados)) {
        return falta('bases.plazo_reclamo_dias', 'Faltan el plazo para reclamar y qué pasa con los premios no reclamados')
    }
    if (!lleno(b.publicacion_resultados)) {
        return falta('bases.publicacion_resultados', 'Falta la forma y el medio de publicar los resultados')
    }
    if (!lleno(b.fuente_valor_publico)) {
        return falta('bases.fuente_valor_publico', 'Falta la fuente pública del valor que se usará en el acto (p. ej. un resultado de la Lotería Santa Lucía)')
    }
    return null
}

/**
 * H25 (`cuentaParaBienDePremio` de la API): la contrapartida `cuenta` de un bien es un activo imputable
 * de la empresa o global, sin contracuenta ni auxiliar de clientes y fuera de las cuentas control.
 */
const CONTROL_NO_PERMITIDAS = ['1.1.01', '1.1.02', '1.1.03', '1.1.04', '1.1.05', '1.1.06', '1.1.07', '1.1.08', '1.1.09', '1.1.10', '1.1.11', '1.1.12', '1.1.13', '1.2']

function cuentaPermitida(codigo: unknown, empresaId: number): boolean {
    const c = bd.cuentas.find(x => x.codigo === codigo)
    if (!c || c.tipo !== 'activo' || !c.imputable || c.contracuenta || c.auxiliar_cliente) {
        return false
    }
    if ((c.empresa_id ?? null) !== null && c.empresa_id !== empresaId) {
        return false
    }
    return !CONTROL_NO_PERMITIDAS.some(p => c.codigo === p || c.codigo.startsWith(`${p}.`))
}

/**
 * Como `contabilizarBien` de `EntregarPremioSorteo`: `compra` (una línea de bien de una compra vigente,
 * no NCRE, de la empresa y no entregada antes) o `cuenta` (lista blanca); `proveedor` ya no (422
 * `contrapartida_proveedor`: un bien a crédito se registra primero como compra).
 */
function contabilizarBien(s: Sorteo, ganador: Ganador, cuerpo: Record<string, unknown>): Partial<Ganador> | RespuestaFixture {
    const contrapartida = cuerpo.contrapartida
    if (contrapartida === 'proveedor') {
        return regla('contrapartida_proveedor', 'Un bien comprado a crédito se registra primero como compra (POST /compras) y se entrega con contrapartida compra (compra_linea_id)')
    }
    if (contrapartida === 'compra') {
        const compra = bd.compras.find(c => c.lineas.some(l => l.id === cuerpo.compra_linea_id))
        const linea = compra?.lineas.find(l => l.id === cuerpo.compra_linea_id)
        if (!compra || !linea || compra.estado !== 'vigente' || compra.empresa_id !== s.empresa_id || linea.tipo !== 'bien' || compra.tipo_documento === 'NCRE') {
            return invalido([{ field: 'compra_linea_id', message: 'La línea debe ser un bien de una compra registrada (no anulada, no nota de crédito) de la empresa', rule: 'compra' }])
        }
        if (['1.2.01', '1.2.02'].some(c => linea.cuenta_codigo === c || linea.cuenta_codigo.startsWith(`${c}.`))) {
            return regla('linea_activo_fijo', `La línea ${linea.id} de la compra ${compra.id} fue a la cuenta de activo fijo ${linea.cuenta_codigo}: no se entrega como premio`)
        }
        // Cada entrega consume sus unidades de la línea, prorrateadas (la última lleva el resto).
        const unidades = typeof cuerpo.unidades === 'number' ? cuerpo.unidades : 1
        if (!Number.isInteger(unidades) || unidades < 1) {
            return invalido([{ field: 'unidades', message: 'Al menos 1 unidad', rule: 'min' }])
        }
        const cantidad = linea.cantidad ?? 1
        const previas = bd.sorteos.flatMap(x => x.ganadores).filter(g => g.compra_linea_id === linea.id && g.estado === 'entregado')
        const usadas = previas.reduce((suma, g) => suma + (g.compra_unidades ?? 1), 0)
        if (usadas + unidades > cantidad) {
            return regla('compra_ya_entregada', `La línea ${linea.id} de la compra ${compra.id} tiene ${cantidad} unidad(es) y ya se entregaron ${usadas}: quedan ${cantidad - usadas}`)
        }
        const baseTomada = previas.reduce((suma, g) => suma.plus(g.compra_base ?? '0'), new Decimal(0))
        const parte = new Decimal(linea.base).times(usadas + unidades).div(cantidad).toDecimalPlaces(2).minus(baseTomada)
        return { contrapartida: `compra ${compra.id}`, compra_linea_id: linea.id, compra_unidades: unidades, compra_base: parte.toFixed(2) }
    }
    if (contrapartida === 'cuenta') {
        if (!cuentaPermitida(cuerpo.cuenta_codigo, s.empresa_id)) {
            return invalido([{ field: 'cuenta_codigo', message: 'La cuenta debe ser un activo imputable de la empresa fuera de las cuentas control (caja, bancos, CxC, impuestos, cobros por liquidar, fondos en tránsito, estimación, gastos anticipados y propiedad, planta y equipo con su depreciación): p. ej. un inventario de premios', rule: 'cuenta' }])
        }
        return { contrapartida: `cuenta ${String(cuerpo.cuenta_codigo)}` }
    }
    return invalido([{ field: 'contrapartida', message: 'compra (compra_linea_id) o cuenta (cuenta_codigo)', rule: 'required' }])
}

/** Premio que le toca al ganador: el de su puesto o, un suplente que tomó uno no reclamado, `premio_sustitucion`. */
function premioDe(g: Ganador): number | null {
    return g.premio ?? g.premio_posicion ?? g.premio_sustitucion ?? null
}

/** Con el acta cerrada y ningún premio por resolver, `acta_cerrada → premios_entregados` (`cerrarSiTodoResuelto`). */
function cerrarSiTodoResuelto(s: Sorteo): Partial<Sorteo> {
    const pendientes = s.ganadores.filter(g => premioDe(g) !== null && (g.estado === 'por_notificar' || g.estado === 'notificado'))
    return s.estado === 'acta_cerrada' && pendientes.length === 0 ? { estado: 'premios_entregados' } : {}
}

/** Como `notificarGanador`: notificado con su plazo de reclamo (`bases.plazo_reclamo_dias`, 30 por defecto). */
function notificarGanador(s: Sorteo, g: Ganador, momento: string): void {
    if (g.estado !== 'por_notificar') {
        return
    }
    const dias = Number(s.bases.plazo_reclamo_dias ?? 30)
    Object.assign(g, { estado: 'notificado', notificado_en: momento, reclamar_antes: new Date(new Date(momento).getTime() + dias * 86_400_000).toISOString(), version: g.version + 1 })
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const huella = await crypto.subtle.digest('SHA-256', bytes.slice())
    return [...new Uint8Array(huella)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Registra un archivo del sorteo (solo inserción) y guarda sus bytes. */
async function registrarArchivoSorteo(s: Sorteo, uso: Schema<'ArchivoSorteo'>['uso'], nombre: string, bytes: Uint8Array): Promise<Schema<'ArchivoSorteo'>> {
    const id = Math.max(9700, ...bd.sorteos.flatMap(x => (x.archivos ?? []).map(a => a.id))) + 1
    const tipo = tipoArchivoSorteo(bytes) ?? 'application/pdf'
    const archivo: Schema<'ArchivoSorteo'> = { id, sorteo_id: s.id, empresa_id: s.empresa_id, uso, nombre: nombre.trim().slice(0, 200) || `${uso}.pdf`, tipo, tamano: bytes.length, sha256: await sha256Hex(bytes), ancho: null, alto: null, created_at: ahora() }
    s.archivos = [...(s.archivos ?? []), archivo]
    bd.archivosSorteos[id] = bytes
    return archivo
}

/** Un PDF mínimo del acta (la API lo arma con todos los datos; aquí basta con que sea un PDF). */
function pdfActa(s: Sorteo, constancia: string): Uint8Array {
    const lineas = [`Acta del sorteo ${s.id}: ${s.nombre}`, `Valor publico: ${s.valor_publico ?? ''}`, `Constancia: ${constancia}`]
    return new TextEncoder().encode(`%PDF-1.4\n% ${lineas.join(' | ')}\n%%EOF\n`)
}

const COLUMNAS_PARTICIPANTES: Schema<'ColumnaReporte'>[] = [
    { clave: 'orden', titulo: 'Orden', tipo: 'entero' },
    { clave: 'codigo_publico', titulo: 'Código público', tipo: 'texto' },
    { clave: 'boletos', titulo: 'Boletos', tipo: 'entero' },
    { clave: 'cliente_id', titulo: 'Cliente (id)', tipo: 'id' },
    { clave: 'cliente', titulo: 'Cliente', tipo: 'texto' },
    { clave: 'servicio_id', titulo: 'Servicio (id)', tipo: 'id' },
]

/** Como `exigirRequisitos`: 422 `requisito_pendiente` con la primera clave que falta. */
function requisitoPendiente(s: Sorteo, claves: readonly Requisito['clave'][], paso: string): RespuestaFixture | null {
    const clave = claves.find(c => (s.requisitos.find(r => r.clave === c)?.estado ?? 'pendiente') === 'pendiente')
    return clave
        ? problemaTipado(422, 'requisito_pendiente', 'Requisito legal pendiente', `Para ${paso} falta marcar el requisito ${clave} (cumplido o no aplica, con su evidencia)`, [{ field: 'requisitos', message: clave, rule: 'requisito_pendiente' }])
        : null
}

/** `asistentes[]` del cuerpo de ejecutar: los que traen nombre. */
function asistentesDe(valor: unknown): SorteoPrivado['asistentes'] {
    if (!Array.isArray(valor)) {
        return []
    }
    return valor.flatMap((a: unknown) => {
        const fila = typeof a === 'object' && a !== null ? a as Record<string, unknown> : {}
        const nombre = texto(fila.nombre)
        return nombre ? [{ nombre, rol: texto(fila.rol) }] : []
    })
}

/** Seudónimo como `cerrar_corte_sorteo`: `S` + 10 hexadecimales en mayúscula, sin repetir. */
function codigoPublico(usados: Set<string>): string {
    let codigo: string
    do {
        codigo = `S${[...crypto.getRandomValues(new Uint8Array(5))].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`
    } while (usados.has(codigo))
    usados.add(codigo)
    return codigo
}

export const rutasSorteos: RutasFixture = {
    'GET /api/v1/lealtad/premios': conPermiso('lealtad.ver', (solicitud) => {
        const tipo = solicitud.query.get('tipo')
        const activo = solicitud.query.get('activo')
        const filas = deLaEmpresa(bd.premiosLealtad, solicitud)
            .filter(p => !tipo || p.tipo === tipo)
            .filter(p => activo === null || String(p.activo) === activo)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/lealtad/sorteos': conPermiso('sorteos.ver', async (solicitud) => {
        await prepararSorteos()
        const estado = solicitud.query.get('estado')
        if (estado && !(ESTADOS as readonly string[]).includes(estado)) {
            return invalido([{ field: 'estado', message: 'Estado inválido', rule: 'enum' }])
        }
        const filas = deLaEmpresa(bd.sorteos, solicitud)
            .filter(s => !estado || s.estado === estado)
            .sort((a, b) => b.id - a.id)
            .map(resumen)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/lealtad/sorteos/:id': conPermiso('sorteos.ver', async (solicitud) => {
        await prepararSorteos()
        const s = sorteoDe(solicitud)
        return esSorteo(s) ? { status: 200, cuerpo: s } : s
    }),

    'POST /api/v1/lealtad/sorteos': conPermiso('sorteos.gestionar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : empresaActivaDe(solicitud) ?? 1
        const errores: Errores = []
        const campos = camposDe(cuerpo, null, empresaId, errores)
        if (errores.length) {
            return invalido(errores)
        }
        const momento = ahora()
        const sorteo: Sorteo = {
            id: siguienteId(bd.sorteos),
            empresa_id: empresaId,
            programa_id: bd.programasLealtad.filter(p => p.empresa_id === empresaId).sort((a, b) => b.id - a.id)[0]?.id ?? null,
            nombre: '',
            descripcion: null,
            estado: 'borrador',
            bases: {},
            criterios: { boletos_por_servicio: 1, admite_canje: false },
            bases_hash: null,
            inscripcion_desde: null,
            corte_en: null,
            fecha_sorteo: null,
            lugar: null,
            suplentes: 0,
            algoritmo: 'argos-sorteo-v1',
            compromiso: null,
            semilla: null,
            valor_publico: null,
            lista_hash: null,
            resultado: null,
            motivo_cancelacion: null,
            publicado_en: null,
            corte_cerrado_en: null,
            ejecutado_en: null,
            cancelado_en: null,
            aviso_portal: false,
            acta_hash: null,
            acta_archivo_id: null,
            acta_constancia: null,
            acta_cerrada_en: null,
            premios: [],
            version: 1,
            created_at: momento,
            updated_at: momento,
            requisitos: CLAVES.map(clave => ({ clave, estado: 'pendiente', valor: null, evidencia: null, nota: null, marcado_en: null })),
            participantes: 0,
            boletos: 0,
            ganadores: [],
            archivos: [],
            ...campos,
        }
        bd.sorteos.push(sorteo)
        registrarAccion(solicitud, 'sorteos.crear', { tipo: 'sorteo', id: sorteo.id }, cuerpo)
        return { status: 201, cuerpo: sorteo }
    })),

    'PUT /api/v1/lealtad/sorteos/:id': conPermiso('sorteos.gestionar', (solicitud) => {
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== s.version) {
            return versionCambiada()
        }
        if (s.estado !== 'borrador') {
            return estadoInvalido(s, 'edición')
        }
        const errores: Errores = []
        const campos = camposDe(cuerpo, s, s.empresa_id, errores)
        if (errores.length) {
            return invalido(errores)
        }
        if (campos.premios) {
            campos.premios = campos.premios.map((p) => {
                const previa = s.premios.find(x => x.posicion === p.posicion)
                return previa?.imagen_archivo_id ? { ...p, imagen_url: previa.imagen_url, imagen_archivo_id: previa.imagen_archivo_id } : p
            })
        }
        avanzar(s, campos)
        registrarAccion(solicitud, 'sorteos.editar', { tipo: 'sorteo', id: s.id }, cuerpo)
        return { status: 200, cuerpo: s }
    }),

    'POST /api/v1/lealtad/sorteos/:id/publicar-bases': conPermiso('sorteos.publicar', conIdempotencia(async (solicitud) => {
        await prepararSorteos()
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        if (s.estado !== 'borrador') {
            return estadoInvalido(s, 'publicar las bases')
        }
        const incompletas = basesIncompletas(s)
        if (incompletas) {
            return incompletas
        }
        await congelarBases(s, crypto.getRandomValues(new Uint8Array(32)))
        avanzar(s, { estado: 'bases_publicadas', publicado_en: ahora() })
        registrarAccion(solicitud, 'sorteos.publicar_bases', { tipo: 'sorteo', id: s.id }, {})
        return { status: 200, cuerpo: s }
    })),

    'POST /api/v1/lealtad/sorteos/:id/abrir': conPermiso('sorteos.publicar', conIdempotencia(async (solicitud) => {
        await prepararSorteos()
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        if (s.estado !== 'bases_publicadas') {
            return estadoInvalido(s, 'abrir la participación')
        }
        const pendiente = requisitoPendiente(s, PARA_ABRIR, 'abrir la participación')
        if (pendiente) {
            return pendiente
        }
        avanzar(s, { estado: 'participacion_abierta' })
        registrarAccion(solicitud, 'sorteos.abrir', { tipo: 'sorteo', id: s.id }, {})
        return { status: 200, cuerpo: s }
    })),

    'POST /api/v1/lealtad/sorteos/:id/cerrar-corte': conPermiso('sorteos.publicar', conIdempotencia(async (solicitud) => {
        await prepararSorteos()
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        if (s.estado !== 'participacion_abierta') {
            return estadoInvalido(s, 'cerrar el corte')
        }
        if (s.corte_en && new Date(s.corte_en).getTime() > Date.now()) {
            return regla('corte_no_vencido', `El corte del sorteo ${s.id} es el ${new Date(s.corte_en).toISOString()}`)
        }
        // Boletos por criterio: servicios activos sin facturas vencidas, en la empresa del sorteo.
        const vencidos = new Set(bd.facturas.filter(f => f.estado === 'vencida').map(f => f.servicio_id))
        const porCliente = new Map<number, { servicio: number, boletos: number }>()
        for (const servicio of bd.servicios.filter(x => x.empresa_id === s.empresa_id && x.estado === 'activo' && !vencidos.has(x.id)).sort((a, b) => a.id - b.id)) {
            const previo = porCliente.get(servicio.cliente_id)
            porCliente.set(servicio.cliente_id, { servicio: previo?.servicio ?? servicio.id, boletos: (previo?.boletos ?? 0) + s.criterios.boletos_por_servicio })
        }
        const usados = new Set<string>()
        let id = bd.sorteosPrivados.flatMap(p => p.participantes).reduce((maximo, p) => Math.max(maximo, p.id), 0)
        const lista: ParticipanteSorteo[] = [...porCliente.entries()]
            .filter(([, v]) => v.boletos > 0)
            .map(([cliente_id, v]) => ({ id: 0, cliente_id, servicio_id: v.servicio, codigo: codigoPublico(usados), boletos: v.boletos }))
            .sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
            .map(p => ({ ...p, id: ++id }))
        privadoDe(s.id).participantes = lista
        await sellarLista(s, lista)
        avanzar(s, { estado: 'corte_cerrado', corte_cerrado_en: ahora() })
        registrarAccion(solicitud, 'sorteos.cerrar_corte', { tipo: 'sorteo', id: s.id }, {})
        return { status: 200, cuerpo: s }
    })),

    'POST /api/v1/lealtad/sorteos/:id/cancelar': conPermiso('sorteos.publicar', conIdempotencia(async (solicitud) => {
        await prepararSorteos()
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        const motivo = texto(cuerpoObjeto(solicitud).motivo)
        if (!motivo || motivo.length < 3) {
            return invalido([{ field: 'motivo', message: 'El motivo es obligatorio', rule: 'motivo' }])
        }
        if (!['borrador', 'bases_publicadas', 'participacion_abierta', 'corte_cerrado'].includes(s.estado)) {
            return estadoInvalido(s, 'cancelación')
        }
        avanzar(s, { estado: 'cancelado', motivo_cancelacion: motivo, cancelado_en: ahora() })
        registrarAccion(solicitud, 'sorteos.cancelar', { tipo: 'sorteo', id: s.id }, { motivo })
        return { status: 200, cuerpo: s }
    })),

    'POST /api/v1/lealtad/sorteos/:id/requisitos/:clave': conPermiso('sorteos.marcar_requisito', conIdempotencia(async (solicitud) => {
        await prepararSorteos()
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        const clave = CLAVES.find(c => c === solicitud.params.clave)
        if (!clave) {
            return noEncontrado('el requisito')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const estado = cuerpo.estado === 'cumplido' || cuerpo.estado === 'no_aplica' || cuerpo.estado === 'pendiente' ? cuerpo.estado : null
        if (!estado) {
            return invalido([{ field: 'estado', message: 'Estado inválido', rule: 'enum' }])
        }
        let evidencia = texto(cuerpo.evidencia)
        const archivoId = typeof cuerpo.archivo_id === 'number' ? cuerpo.archivo_id : null
        if (archivoId !== null) {
            const archivo = (s.archivos ?? []).find(a => a.id === archivoId)
            if (!archivo || archivo.uso !== 'evidencia') {
                return invalido([{ field: 'archivo_id', message: 'El archivo debe ser una evidencia subida a este sorteo', rule: 'archivo' }])
            }
            evidencia ??= `Archivo ${archivo.id}: ${archivo.nombre} (SHA-256 ${archivo.sha256})`
        }
        if (estado !== 'pendiente' && !evidencia) {
            return invalido([{ field: 'evidencia', message: 'Un requisito cumplido o que no aplica lleva su evidencia (número, referencia o texto)', rule: 'required' }])
        }
        if (s.estado === 'cancelado') {
            return invalido([{ field: 'sorteo_id', message: 'El sorteo está cancelado', rule: 'estado' }])
        }
        const marca: Requisito = { clave, estado, valor: texto(cuerpo.valor), evidencia, archivo_id: archivoId, nota: texto(cuerpo.nota), marcado_en: ahora() }
        s.requisitos = s.requisitos.map(r => (r.clave === clave ? marca : r))
        registrarAccion(solicitud, 'sorteos.marcar_requisito', { tipo: 'sorteo', id: s.id }, { clave, ...cuerpo })
        return { status: 200, cuerpo: s.requisitos }
    })),

    'POST /api/v1/lealtad/sorteos/:id/ejecutar': conPermiso('sorteos.ejecutar', conIdempotencia(async (solicitud) => {
        await prepararSorteos()
        const cuerpo = cuerpoObjeto(solicitud)
        const valorPublico = texto(cuerpo.valor_publico)
        const evidencia = texto(cuerpo.valor_publico_evidencia)
        const faltan = [
            ...(valorPublico ? [] : [{ field: 'valor_publico', message: 'El valor público del acto es obligatorio', rule: 'required' }]),
            ...(evidencia ? [] : [{ field: 'valor_publico_evidencia', message: 'Cómo se obtuvo en el acto el valor de la fuente de las bases', rule: 'required' }]),
        ]
        if (!valorPublico || !evidencia) {
            return invalido(faltan)
        }
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        if (s.estado !== 'corte_cerrado') {
            return estadoInvalido(s, 'ejecutar')
        }
        const pendiente = requisitoPendiente(s, PARA_EJECUTAR, 'ejecutar el sorteo')
        if (pendiente) {
            return pendiente
        }
        const privado = privadoDe(s.id)
        if (privado.participantes.length === 0) {
            return regla('sin_participantes', 'El sorteo no tiene participantes')
        }
        privado.asistentes = asistentesDe(cuerpo.asistentes)
        await sortearFixture(s, valorPublico, evidencia, ahora())
        avanzar(s, {})
        registrarAccion(solicitud, 'sorteos.ejecutar', { tipo: 'sorteo', id: s.id }, cuerpo)
        return { status: 200, cuerpo: s }
    })),

    'POST /api/v1/lealtad/sorteos/:id/ganadores/:ganadorId/entregar': conPermiso('sorteos.entregar', conIdempotencia(async (solicitud) => {
        await prepararSorteos()
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        if (s.estado !== 'ejecutado' && s.estado !== 'acta_cerrada') {
            return estadoInvalido(s, 'entregar premios')
        }
        const ganador = s.ganadores.find(g => g.id === idDe(solicitud, 'ganadorId'))
        if (!ganador) {
            return noEncontrado('el ganador')
        }
        if (premioDe(ganador) === null) {
            return regla('sin_premio', 'Solo se entrega el premio de un titular o de un suplente que tomó el de un ganador que no lo reclamó')
        }
        if (!['por_notificar', 'notificado'].includes(ganador.estado)) {
            return regla('premio_entregado', `El premio del ganador ${ganador.id} está ${ganador.estado}`)
        }
        const premio = s.premios.find(p => p.posicion === premioDe(ganador))
        if (!premio) {
            return noEncontrado('el premio')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const constanciaId = typeof cuerpo.constancia_archivo_id === 'number' ? cuerpo.constancia_archivo_id : null
        if (constanciaId !== null && !(s.archivos ?? []).some(a => a.id === constanciaId && a.uso === 'constancia')) {
            return invalido([{ field: 'constancia_archivo_id', message: 'La constancia debe ser un archivo de uso constancia subido a este sorteo', rule: 'archivo' }])
        }
        const isr = premio.retiene_isr ? new Decimal(premio.valor).times(premio.isr_pct).div(100).toDecimalPlaces(2) : new Decimal(0)
        const cambios: Partial<Ganador> = { asiento_id: isr.gt(0) || premio.tipo === 'bien' ? ASIENTOS_PREMIO + ganador.id : null }
        if (premio.tipo === 'efectivo') {
            const metodo = cuerpo.metodo
            if (metodo !== 'caja' && metodo !== 'banco' && metodo !== 'cuenta_bancaria') {
                return invalido([{ field: 'metodo', message: 'Indica de dónde sale el efectivo: caja, banco o cuenta_bancaria', rule: 'required' }])
            }
            // Como `RegistrarEgreso`: la caja, el banco del libro o la cuenta bancaria, de la empresa del sorteo.
            const origen = metodo === 'caja'
                ? bd.cajas.find(c => c.id === cuerpo.caja_id)
                : metodo === 'banco'
                    ? bancosLibro.find(b => b.id === (cuerpo.banco_id ?? 1))
                    : bd.cuentasBancarias.find(c => c.id === cuerpo.cuenta_bancaria_id)
            const campo = metodo === 'caja' ? 'caja_id' : metodo === 'banco' ? 'banco_id' : 'cuenta_bancaria_id'
            if (!origen) {
                return invalido([{ field: campo, message: 'No existe', rule: 'exists' }])
            }
            if (origen.empresa_id !== s.empresa_id) {
                return invalido([{ field: metodo, message: 'La caja o la cuenta es de otra empresa', rule: 'empresa' }])
            }
            Object.assign(cambios, { egreso_id: EGRESOS_PREMIO + ganador.id, contrapartida: metodo })
        }
        else if (premio.tipo === 'bien') {
            const resultado = contabilizarBien(s, ganador, cuerpo)
            if ('status' in resultado) {
                return resultado
            }
            Object.assign(cambios, resultado)
        }
        else {
            const participante = privadoDe(s.id).participantes.find(p => p.id === ganador.participante_id)
            const servicio = bd.servicios.find(x => x.id === participante?.servicio_id && x.estado !== 'retirado')
            if (!servicio) {
                return regla('servicio_no_valido', 'El ganador no tiene un servicio vigente en la empresa')
            }
            Object.assign(cambios, { canje_id: 770000 + ganador.id, contrapartida: 'canje' })
        }
        Object.assign(ganador, cambios, { estado: 'entregado', retencion_isr: isr.toFixed(2), constancia_archivo_id: constanciaId, entregado_en: ahora(), version: ganador.version + 1 })
        avanzar(s, cerrarSiTodoResuelto(s))
        registrarAccion(solicitud, 'sorteos.entregar', { tipo: 'sorteo', id: s.id }, { ganador_id: ganador.id, ...cuerpo })
        return { status: 200, cuerpo: s }
    })),

    /** Pedido del PM: `aviso_portal` (falso por defecto), hasta antes de ejecutar, con `version`. */
    'PUT /api/v1/lealtad/sorteos/:id/aviso-portal': conPermiso('sorteos.gestionar', (solicitud) => {
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (typeof cuerpo.aviso_portal !== 'boolean' || typeof cuerpo.version !== 'number') {
            return invalido([{ field: typeof cuerpo.version !== 'number' ? 'version' : 'aviso_portal', message: 'Obligatorio', rule: 'required' }])
        }
        if (cuerpo.version !== s.version) {
            return versionCambiada()
        }
        if (!['borrador', 'bases_publicadas', 'participacion_abierta', 'corte_cerrado'].includes(s.estado)) {
            return estadoInvalido(s, 'cambiar el aviso en el portal')
        }
        if (s.aviso_portal !== cuerpo.aviso_portal) {
            avanzar(s, { aviso_portal: cuerpo.aviso_portal })
        }
        registrarAccion(solicitud, 'sorteos.cambiar_aviso_portal', { tipo: 'sorteo', id: s.id }, cuerpo)
        return { status: 200, cuerpo: s }
    }),

    /** Imagen de un premio (multipart `imagen`), solo en borrador: PNG, JPEG o WebP por su contenido. */
    'POST /api/v1/lealtad/sorteos/:id/premios/:posicion/imagen': conPermiso('sorteos.gestionar', async (solicitud) => {
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        if (s.estado !== 'borrador') {
            return estadoInvalido(s, 'cambiar la imagen de un premio')
        }
        const premio = s.premios.find(p => p.posicion === idDe(solicitud, 'posicion'))
        if (!premio) {
            return noEncontrado('el premio')
        }
        const archivo = cuerpoObjeto(solicitud).imagen
        const bytes = archivo instanceof Blob ? new Uint8Array(await archivo.arrayBuffer()) : new Uint8Array()
        const error = errorImagenPremio(bytes)
        if (error) {
            return invalido([{ field: 'imagen', message: error, rule: bytes.length === 0 ? 'required' : error.startsWith('La imagen pesa') ? 'tamano' : error.startsWith('La imagen mide') ? 'dimensiones' : 'tipo' }])
        }
        const archivoId = Math.max(9500, ...Object.keys(bd.imagenesSorteos).map(Number), ...s.premios.map(p => p.imagen_archivo_id ?? 0)) + 1
        bd.imagenesSorteos[archivoId] = { bytes, tipo: leerImagenPremio(bytes)?.tipo ?? 'image/png' }
        Object.assign(premio, { imagen_archivo_id: archivoId, imagen_url: `/api/v1/lealtad/sorteos/${s.id}/premios/${premio.posicion}/imagen` })
        s.updated_at = ahora()
        registrarAccion(solicitud, 'sorteos.subir_imagen_premio', { tipo: 'sorteo', id: s.id }, { posicion: premio.posicion, archivo: archivoId })
        return { status: 200, cuerpo: s }
    }),

    'GET /api/v1/lealtad/sorteos/:id/premios/:posicion/imagen': conPermiso('sorteos.ver', (solicitud) => {
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        const archivoId = s.premios.find(p => p.posicion === idDe(solicitud, 'posicion'))?.imagen_archivo_id
        const subida = archivoId ? bd.imagenesSorteos[archivoId] : undefined
        const semilla = archivoId ? IMAGEN_DE_ARCHIVO[archivoId] : undefined
        if (subida) {
            return { status: 200, cuerpo: subida.bytes, contentType: subida.tipo }
        }
        return semilla ? { status: 200, cuerpo: bytesBase64(IMAGENES_SEMILLA[semilla]), contentType: 'image/webp' } : noEncontrado('la imagen del premio')
    }),

    /** Evidencia del checklist o constancia de entrega (multipart `uso` + `archivo`): PDF, JPEG, PNG o WebP, hasta 5 MB. */
    'POST /api/v1/lealtad/sorteos/:id/archivos': conPermiso('sorteos.marcar_requisito', async (solicitud) => {
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.uso !== 'evidencia' && cuerpo.uso !== 'constancia') {
            return invalido([{ field: 'uso', message: 'evidencia o constancia', rule: 'enum' }])
        }
        const archivo = cuerpo.archivo
        const bytes = archivo instanceof Blob ? new Uint8Array(await archivo.arrayBuffer()) : new Uint8Array()
        const error = errorArchivoSorteo(bytes)
        if (error) {
            return invalido([{ field: 'archivo', message: error, rule: bytes.length === 0 ? 'required' : error.startsWith('El archivo pesa') ? 'tamano' : 'tipo' }])
        }
        const nombre = archivo instanceof File ? archivo.name : ''
        const registrado = await registrarArchivoSorteo(s, cuerpo.uso, nombre, bytes)
        registrarAccion(solicitud, 'sorteos.subir_archivo', { tipo: 'sorteo', id: s.id }, { uso: cuerpo.uso, nombre: registrado.nombre, sha256: registrado.sha256 })
        return { status: 201, cuerpo: registrado }
    }),

    'GET /api/v1/lealtad/sorteos/:id/archivos/:archivoId': conPermiso('sorteos.ver', (solicitud) => {
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        const archivo = (s.archivos ?? []).find(a => a.id === idDe(solicitud, 'archivoId'))
        const bytes = archivo ? bd.archivosSorteos[archivo.id] : undefined
        return archivo && bytes ? { status: 200, cuerpo: bytes, contentType: archivo.tipo } : noEncontrado('el archivo')
    }),

    /** `ejecutado → acta_cerrada` con la constancia; exige `publicacion_resultados`. Sin pendientes, premios_entregados. */
    'POST /api/v1/lealtad/sorteos/:id/cerrar-acta': conPermiso('sorteos.ejecutar', conIdempotencia(async (solicitud) => {
        await prepararSorteos()
        const constancia = texto(cuerpoObjeto(solicitud).constancia)
        if (!constancia || constancia.length < 3) {
            return invalido([{ field: 'constancia', message: 'Registra la firma o constancia del notario o del delegado', rule: 'required' }])
        }
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        if (s.estado !== 'ejecutado') {
            return estadoInvalido(s, 'cerrar el acta')
        }
        const pendiente = requisitoPendiente(s, ['publicacion_resultados'], 'cerrar el acta')
        if (pendiente) {
            return pendiente
        }
        const acta = await registrarArchivoSorteo(s, 'acta', `acta-sorteo-${s.id}.pdf`, pdfActa(s, constancia))
        const momento = ahora()
        Object.assign(s, { estado: 'acta_cerrada', acta_archivo_id: acta.id, acta_hash: acta.sha256, acta_constancia: constancia, acta_cerrada_en: momento })
        avanzar(s, cerrarSiTodoResuelto(s))
        registrarAccion(solicitud, 'sorteos.cerrar_acta', { tipo: 'sorteo', id: s.id }, { constancia })
        return { status: 200, cuerpo: s }
    })),

    'GET /api/v1/lealtad/sorteos/:id/acta': conPermiso('sorteos.ver', (solicitud) => {
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        const bytes = s.acta_archivo_id ? bd.archivosSorteos[s.acta_archivo_id] : undefined
        return bytes ? { status: 200, cuerpo: bytes, contentType: 'application/pdf', headers: { ETag: `"${s.acta_hash ?? ''}"` } } : noEncontrado('el acta del sorteo')
    }),

    /** Notifica a los ganadores con premio que siguen por notificar, con su plazo de reclamo. Idempotente. */
    'POST /api/v1/lealtad/sorteos/:id/notificar-ganadores': conPermiso('sorteos.entregar', conIdempotencia(async (solicitud) => {
        await prepararSorteos()
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        if (s.estado !== 'ejecutado' && s.estado !== 'acta_cerrada') {
            return estadoInvalido(s, 'notificar a los ganadores')
        }
        const momento = ahora()
        const avisados = s.ganadores.filter(g => premioDe(g) !== null && g.estado === 'por_notificar')
        avisados.forEach(g => notificarGanador(s, g, momento))
        if (avisados.length) {
            avanzar(s, {})
        }
        registrarAccion(solicitud, 'sorteos.notificar_ganadores', { tipo: 'sorteo', id: s.id }, { ganadores: avisados.map(g => g.id) })
        return { status: 200, cuerpo: s }
    })),

    /** Vencido el plazo, el premio pasa al siguiente suplente en espera (que se notifica); sin suplentes, no reclamado. */
    'POST /api/v1/lealtad/sorteos/:id/ganadores/:ganadorId/no-reclamado': conPermiso('sorteos.entregar', conIdempotencia(async (solicitud) => {
        await prepararSorteos()
        const motivo = texto(cuerpoObjeto(solicitud).motivo)
        if (!motivo || motivo.length < 3) {
            return invalido([{ field: 'motivo', message: 'El motivo es obligatorio (mínimo 3 caracteres)', rule: 'motivo' }])
        }
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        if (s.estado !== 'ejecutado' && s.estado !== 'acta_cerrada') {
            return estadoInvalido(s, 'dar un premio por no reclamado')
        }
        const ganador = s.ganadores.find(g => g.id === idDe(solicitud, 'ganadorId'))
        if (!ganador) {
            return noEncontrado('el ganador')
        }
        const premio = premioDe(ganador)
        if (premio === null || ganador.estado !== 'notificado' || !ganador.reclamar_antes) {
            return regla('ganador_no_notificado', `El ganador ${ganador.id} está ${ganador.estado}: solo un ganador notificado con premio puede quedar sin reclamar`)
        }
        if (new Date(ganador.reclamar_antes).getTime() > Date.now()) {
            return regla('plazo_reclamo_vigente', `El plazo para reclamar vence ${new Date(ganador.reclamar_antes).toISOString()}`)
        }
        const momento = ahora()
        const suplente = s.ganadores
            .filter(g => g.tipo === 'suplente' && premioDe(g) === null && g.estado === 'por_notificar')
            .sort((a, b) => a.posicion - b.posicion)[0]
        Object.assign(ganador, { estado: suplente ? 'sustituido' : 'no_reclamado', no_reclamado_en: momento, version: ganador.version + 1 })
        if (suplente) {
            Object.assign(suplente, { sustituye_a: ganador.id, premio_sustitucion: premio, premio })
            notificarGanador(s, suplente, momento)
        }
        avanzar(s, cerrarSiTodoResuelto(s))
        registrarAccion(solicitud, 'sorteos.marcar_no_reclamado', { tipo: 'sorteo', id: s.id }, { ganador_id: ganador.id, suplente_id: suplente?.id ?? null, motivo })
        return { status: 200, cuerpo: s }
    })),

    /** Participantes desde el corte, en orden canónico, con `lista_hash` al pie; `formato=csv|xlsx` da el archivo. */
    'GET /api/v1/lealtad/sorteos/:id/participantes': conPermiso('sorteos.exportar', async (solicitud) => {
        await prepararSorteos()
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        if (!s.lista_hash) {
            return estadoInvalido(s, 'exportar participantes')
        }
        const filas = privadoDe(s.id).participantes.map((p, i) => ({
            orden: i + 1,
            codigo_publico: p.codigo,
            boletos: p.boletos,
            cliente_id: p.cliente_id,
            cliente: bd.clientes.find(c => c.id === p.cliente_id)?.nombre ?? `Cliente ${p.cliente_id}`,
            servicio_id: p.servicio_id,
        }))
        const totales = { orden: null, codigo_publico: `lista_hash ${s.lista_hash}`, boletos: filas.reduce((suma, f) => suma + f.boletos, 0), cliente_id: null, cliente: null, servicio_id: null }
        const formato = solicitud.query.get('formato')
        if (formato === 'csv') {
            const linea = (v: (string | number | null)[]) => v.map(x => (x === null ? '' : /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x))).join(',')
            const texto = [linea(COLUMNAS_PARTICIPANTES.map(c => c.titulo)), ...filas.map(f => linea([f.orden, f.codigo_publico, f.boletos, f.cliente_id, f.cliente, f.servicio_id])), linea([null, totales.codigo_publico, totales.boletos, null, null, null])].join('\n')
            return { status: 200, cuerpo: new TextEncoder().encode(`\uFEFF${texto}\n`), contentType: 'text/csv; charset=utf-8' }
        }
        if (formato === 'xlsx') {
            return { status: 200, cuerpo: new Uint8Array([0x50, 0x4B, 0x03, 0x04]), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        }
        // Como la API: el pie lleva `lista_hash …` en la columna del código (`totales.codigo_publico`).
        const reporte: Schema<'ReporteParticipantesSorteo'> = {
            reporte: `participantes-sorteo-${s.id}`,
            titulo: `Participantes del sorteo ${s.nombre}`,
            filtros: { sorteo_id: s.id },
            columnas: COLUMNAS_PARTICIPANTES,
            filas,
            totales,
            generado_en: ahora(),
        }
        return { status: 200, cuerpo: reporte }
    }),

    /** H22 (`sorteos.anular_entrega`, permiso `sorteos.entregar`): deshace la entrega toda junta. */
    'POST /api/v1/lealtad/sorteos/:id/ganadores/:ganadorId/anular-entrega': conPermiso('sorteos.entregar', conIdempotencia(async (solicitud) => {
        await prepararSorteos()
        const motivo = texto(cuerpoObjeto(solicitud).motivo)
        if (!motivo || motivo.length < 3) {
            return invalido([{ field: 'motivo', message: 'El motivo es obligatorio (mínimo 3 caracteres)', rule: 'motivo' }])
        }
        const s = sorteoDe(solicitud)
        if (!esSorteo(s)) {
            return s
        }
        if (s.estado !== 'ejecutado' && s.estado !== 'acta_cerrada' && s.estado !== 'premios_entregados') {
            return estadoInvalido(s, 'anular la entrega de un premio')
        }
        const ganador = s.ganadores.find(g => g.id === idDe(solicitud, 'ganadorId'))
        if (!ganador) {
            return noEncontrado('el ganador')
        }
        if (ganador.estado !== 'entregado') {
            return regla('premio_no_entregado', `El premio del ganador ${ganador.id} no está entregado`)
        }
        Object.assign(ganador, { estado: 'por_notificar', retencion_isr: null, contrapartida: null, asiento_id: null, egreso_id: null, canje_id: null, compra_linea_id: null, compra_unidades: null, compra_base: null, constancia_archivo_id: null, entregado_en: null, version: ganador.version + 1 })
        // Reabre al estado del que venía: con el acta cerrada, acta_cerrada.
        avanzar(s, s.estado === 'premios_entregados' ? { estado: s.acta_hash ? 'acta_cerrada' : 'ejecutado' } : {})
        registrarAccion(solicitud, 'sorteos.anular_entrega', { tipo: 'sorteo', id: s.id }, { ganador_id: ganador.id, motivo })
        return { status: 200, cuerpo: s }
    })),

    /** Pública (sin sesión) después de ejecutar; 404 antes. */
    'GET /api/v1/lealtad/sorteos/:id/verificacion': async (solicitud) => {
        await prepararSorteos()
        const s = bd.sorteos.find(x => x.id === idDe(solicitud))
        if (!s || !['ejecutado', 'acta_cerrada', 'premios_entregados'].includes(s.estado)) {
            return noEncontrado('la verificación del sorteo')
        }
        const verificacion: Schema<'VerificacionSorteo'> = {
            sorteo_id: s.id,
            algoritmo: s.algoritmo,
            bases_hash: s.bases_hash ?? '',
            bases: documentoBases(s),
            compromiso: s.compromiso ?? '',
            semilla: s.semilla ?? '',
            valor_publico: s.valor_publico ?? '',
            fuente_valor_publico: typeof s.bases.fuente_valor_publico === 'string' ? s.bases.fuente_valor_publico : null,
            valor_publico_evidencia: s.valor_publico_evidencia ?? null,
            acta_hash: s.acta_hash ?? null,
            lista_hash: s.lista_hash ?? '',
            lista: privadoDe(s.id).participantes.map(p => ({ codigo: p.codigo, boletos: p.boletos })),
            titulares: s.premios.reduce((suma, p) => suma + p.cantidad, 0),
            suplentes: s.suplentes,
            ganadores: s.ganadores.map(g => ({ posicion: g.posicion, tipo: g.tipo, codigo: g.codigo_publico, premio_posicion: g.premio_posicion })),
        }
        return { status: 200, cuerpo: verificacion }
    },
}
