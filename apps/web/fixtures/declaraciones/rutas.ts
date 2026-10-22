import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { hoyGuatemala } from '~/utils/cobro'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { ncreSinCertificar } from '../fel/rutas'
import { calculosDinamicos, verificarYExigir } from '../libro/checks'
import { bancosLibro } from '../libro/datos'
import { calcularTotales, finDeMes, hashDatos, parametrosDe, type Declaracion, type Remanentes } from './datos'

/**
 * Rutas de las declaraciones (A3, fase 7 PR B; `start/routes/declaraciones.ts` y las acciones
 * `declaraciones.calcular`, `.revisar`, `.presentar` y `.pagar`), con sus reglas y en su orden:
 * versiones de solo inserción (la anterior pasa a `sustituida`), sustitutiva obligatoria tras revisar,
 * `datos_hash` contra los datos de hoy (409 `declaracion_desactualizada`), NCRE sin certificar y
 * `iva_cuadrado` antes de liquidar, bloqueo `impuestos` en el último día del mes, mora y multa del pago
 * tardío. Los asientos (liquidación y pago) no se guardan: solo su número. Los libros del fixture
 * empiezan en julio de 2026 (antes: 422 `antes_de_inicio_libros`).
 */

type Errores = NonNullable<Problem['errors']>
type Impuesto = 'iva_mensual' | 'pc_mensual'

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const IMPUESTOS: readonly Impuesto[] = ['iva_mensual', 'pc_mensual']
const ESTADOS: readonly Declaracion['estado'][] = ['borrador', 'revisada', 'presentada', 'sustituida']
const INICIO_LIBROS = '2026-07'
/** `mora_tributaria` (por ciento diario) y `multa_declaracion_tardia` del paquete. */
const MORA_DIARIA = '0.05'
const MULTA = { por_dia: '50.00', maximo: '1000.00' }

const esImpuesto = (valor: unknown): valor is Impuesto => typeof valor === 'string' && (IMPUESTOS as readonly string[]).includes(valor)

function mesAnterior(periodo: string): string {
    const [anio = 0, mes = 0] = periodo.split('-').map(Number)
    return new Date(Date.UTC(anio, mes - 2, 1)).toISOString().slice(0, 7)
}

function versiones(empresaId: number, impuesto: string, periodo: string): Declaracion[] {
    return bd.declaraciones.filter(d => d.empresa_id === empresaId && d.impuesto === impuesto && d.periodo_desde === `${periodo}-01`).sort((a, b) => a.version - b.version)
}

function ultima(empresaId: number, impuesto: string, periodo: string): Declaracion | null {
    return versiones(empresaId, impuesto, periodo).at(-1) ?? null
}

/** `remanentesAnteriores`: la última versión revisada del mes anterior. */
function remanentes(empresaId: number, impuesto: Impuesto, periodo: string): Remanentes {
    const fila = versiones(empresaId, impuesto, mesAnterior(periodo)).filter(d => d.revisada_en !== null).at(-1)
    return fila
        ? { credito: new Decimal(fila.totales.remanente_credito ?? '0'), retenciones: new Decimal(fila.totales.remanente_retenciones ?? '0'), id: fila.id }
        : { credito: new Decimal(0), retenciones: new Decimal(0), id: null }
}

/** Libros de ventas y compras emitidos con folio que cubren el mes. */
function librosDelMes(empresaId: number, periodo: string): Schema<'LibroEnlazado'>[] {
    const desde = `${periodo}-01`
    const hasta = finDeMes(periodo)
    return bd.librosEmisiones
        .filter(e => e.empresa_id === empresaId && (e.libro === 'ventas' || e.libro === 'compras') && e.desde <= desde && e.hasta >= hasta)
        .map(e => ({
            emision_id: e.id,
            libro: e.libro === 'compras' ? 'compras' : 'ventas',
            desde: e.desde,
            hasta: e.hasta,
            folio_inicial: e.folio_inicial,
            folio_final: e.folio_final,
            sha256: e.sha256,
            iva: typeof e.totales.iva === 'string' ? e.totales.iva : null,
            mismo_periodo: e.desde === desde && e.hasta === hasta,
        }))
}

/** `calcularDatos` con los datos de hoy del mes. */
export function calcularDatos(empresaId: number, impuesto: Impuesto, periodo: string) {
    const renglones = bd.datosDeclaraciones.find(d => d.empresa_id === empresaId && d.periodo === periodo)?.renglones ?? []
    const anterior = remanentes(empresaId, impuesto, periodo)
    const parametros = parametrosDe(impuesto)
    const totales = calcularTotales(impuesto, renglones, anterior)
    return {
        parametros,
        detalle: { renglones: structuredClone(renglones), libros: librosDelMes(empresaId, periodo), anterior_id: anterior.id },
        totales,
        datos_hash: hashDatos(renglones, totales, parametros, anterior.id),
    }
}

function desactualizada(d: Declaracion): boolean {
    return calcularDatos(d.empresa_id, d.impuesto === 'pc_mensual' ? 'pc_mensual' : 'iva_mensual', d.periodo_desde.slice(0, 7)).datos_hash !== d.datos_hash
}

/** Obligación de IVA o de pequeño contribuyente del mes que aplica a la empresa, o `null`. */
function impuestoDelMes(empresaId: number, periodo: string): Impuesto | null {
    const o = bd.obligacionesFiscales.find(x => x.empresa_id === empresaId && x.periodo_desde === `${periodo}-01` && esImpuesto(x.impuesto) && x.estado !== 'no_aplica')
    return o && esImpuesto(o.impuesto) ? o.impuesto : null
}

const resumen = (pares: [string, string][]) => pares.map(([k, v]) => `${k} ${v}`).join(' · ')

// Checks de impuestos (`CALCULOS.iva_cuadrado` e `iva_liquidado` de `#ledger/checks`).
calculosDinamicos.iva_cuadrado = (empresaId, periodoDesde) => {
    const periodo = periodoDesde.slice(0, 7)
    const impuesto = impuestoDelMes(empresaId, periodo)
    if (!impuesto) {
        return null
    }
    const { totales: t, datos_hash: hash } = calcularDatos(empresaId, impuesto, periodo)
    const esperado = impuesto === 'iva_mensual'
        ? resumen([['V_IVA', t.debito ?? '0.00'], ['C_IVA', t.credito ?? '0.00'], ['RET_IVA_REC', t.retenciones ?? '0.00']])
        : resumen([['ventas', t.ventas ?? '0.00'], ['RET_IVA_REC', t.retenciones ?? '0.00']])
    const borrador = ultima(empresaId, impuesto, periodo)
    const alDia = borrador !== null && borrador.datos_hash === hash
    return {
        esperado,
        obtenido: alDia ? esperado : `${esperado} · ${borrador ? 'borrador desactualizado' : 'sin borrador'}`,
        resultado: alDia ? 'ok' : 'anomalia',
        detalle: { impuesto, declaracion_id: borrador?.id ?? null, version: borrador?.version ?? null, borrador_al_dia: alDia, v_iva_sin_etiqueta: '0.00', libros_distintos: [] },
    }
}

calculosDinamicos.iva_liquidado = (empresaId, periodoDesde) => {
    const periodo = periodoDesde.slice(0, 7)
    const impuesto = impuestoDelMes(empresaId, periodo)
    if (!impuesto) {
        return null
    }
    const revisada = versiones(empresaId, impuesto, periodo).filter(d => d.revisada_en !== null).at(-1)
    if (!revisada) {
        return { esperado: 'liquidada', obtenido: 'sin liquidar', resultado: 'anomalia', detalle: { impuesto } }
    }
    const t = revisada.totales
    const esperado = impuesto === 'iva_mensual'
        ? resumen([['2.1.02', '0.00'], ['1.1.04', new Decimal(t.remanente_credito ?? '0').minus(t.remanente_credito_anterior ?? '0').toFixed(2)]])
        : resumen([['2.1.09', new Decimal(t.a_pagar ?? '0').negated().toFixed(2)]])
    return { esperado, obtenido: esperado, resultado: 'ok', detalle: { impuesto, declaracion_id: revisada.id, version: revisada.version } }
}

function usuario(solicitud: SolicitudFixture) {
    return solicitud.token ? usuariosPorToken[solicitud.token] : undefined
}

/** `exigirAccesoEmpresa`: con una empresa activa (o sin alcance), solo las suyas. */
function declaracionDe(solicitud: SolicitudFixture): Declaracion | RespuestaFixture {
    const d = bd.declaraciones.find(x => x.id === idDe(solicitud))
    if (!d) {
        return noEncontrado('la declaración')
    }
    if (!deLaEmpresa([d], solicitud).length) {
        return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `La declaración ${d.id} es de otra empresa`)
    }
    return d
}

const conflicto = (codigo: string, titulo: string, detalle: string) => problemaTipado(409, codigo, titulo, detalle)
const regla = (codigo: string, detalle: string, errores?: Errores) => problemaTipado(422, codigo, 'Regla de negocio', detalle, errores)

function desactualizadaProblema(d: Declaracion): RespuestaFixture {
    return conflicto('declaracion_desactualizada', 'Declaración desactualizada', `Los libros o las constancias de ${d.periodo_desde.slice(0, 7)} cambiaron desde que se calculó la versión ${d.version}: calcule otra versión`)
}

/** La versión es la última del periodo (409 `declaracion_sustituida`). */
function exigirUltima(d: Declaracion): RespuestaFixture | null {
    const u = ultima(d.empresa_id, d.impuesto, d.periodo_desde.slice(0, 7))
    return u && u.id !== d.id ? conflicto('declaracion_sustituida', 'Declaración sustituida', `La versión ${d.version} fue sustituida`) : null
}

function actualizarObligacion(d: Declaracion, cambios: { estado?: 'borrador' | 'presentada' }) {
    const o = bd.obligacionesFiscales.find(x => x.id === d.obligacion_id)
    if (!o) {
        return
    }
    const nuevo = cambios.estado && o.estado !== cambios.estado ? cambios.estado : o.estado
    if (o.declaracion_id !== d.id || nuevo !== o.estado) {
        Object.assign(o, { declaracion_id: d.id, estado: nuevo, motivo_estado: nuevo === o.estado ? o.motivo_estado : null, version: o.version + 1, updated_at: ahora() })
    }
}

function vista(d: Declaracion): Schema<'DeclaracionDetalle'> {
    return { ...d, desactualizada: desactualizada(d) }
}

function dias(desde: string, hasta: string): number {
    return Math.max(0, Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000))
}

/** Datos de prueba: los libros del mes cambian después de calcular (la versión queda desactualizada). */
export function cambiarDatosDeclaracionFixture(empresaId: number, periodo: string): void {
    const mes = bd.datosDeclaraciones.find(d => d.empresa_id === empresaId && d.periodo === periodo)
    const renglon: Schema<'RenglonDeclaracion'> = { seccion: 'ventas', origen: 'dte', documento: 'FACT A-1199', fecha: `${periodo}-28`, tipo: 'FACT', nit: 'CF', base: '250.00', iva: '30.00', total: '280.00', estado: 'certificado' }
    if (mes) {
        mes.renglones.push(renglon)
    }
    else {
        bd.datosDeclaraciones.push({ empresa_id: empresaId, periodo, renglones: [renglon] })
    }
}

export const rutasDeclaraciones: RutasFixture = {
    'GET /api/v1/declaraciones': conPermiso('declaraciones.ver', (solicitud) => {
        const errores: Errores = []
        const impuestos = solicitud.query.getAll('impuesto').filter(Boolean)
        const estados = solicitud.query.getAll('estado').filter(Boolean)
        for (const i of impuestos) {
            if (!esImpuesto(i)) {
                errores.push({ field: 'impuesto', message: `Valor no permitido: ${i}`, rule: 'enum' })
            }
        }
        for (const e of estados) {
            if (!(ESTADOS as readonly string[]).includes(e)) {
                errores.push({ field: 'estado', message: `Valor no permitido: ${e}`, rule: 'enum' })
            }
        }
        const periodo = solicitud.query.get('periodo') || null
        if (periodo !== null && !PERIODO.test(periodo)) {
            errores.push({ field: 'periodo', message: 'El periodo es AAAA-MM', rule: 'regex' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const filas = deLaEmpresa(bd.declaraciones, solicitud)
            .filter(d => (!impuestos.length || impuestos.includes(d.impuesto))
                && (!estados.length || estados.includes(d.estado))
                && (periodo === null || d.periodo_desde === `${periodo}-01`))
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/declaraciones/:id': conPermiso('declaraciones.ver', (solicitud) => {
        const d = declaracionDe(solicitud)
        return 'status' in d ? d : { status: 200, cuerpo: vista(d) }
    }),

    'POST /api/v1/declaraciones/calcular': conPermiso('declaraciones.calcular', conIdempotencia((solicitud): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        if (!esImpuesto(cuerpo.impuesto)) {
            errores.push({ field: 'impuesto', message: 'Una de: iva_mensual, pc_mensual', rule: 'enum' })
        }
        const periodo = typeof cuerpo.periodo === 'string' && PERIODO.test(cuerpo.periodo) ? cuerpo.periodo : null
        if (periodo === null) {
            errores.push({ field: 'periodo', message: 'El periodo es AAAA-MM', rule: 'periodo' })
        }
        else if (`${periodo}-01` > hoyGuatemala()) {
            errores.push({ field: 'periodo', message: 'El periodo no puede ser futuro', rule: 'futuro' })
        }
        if (errores.length || periodo === null || !esImpuesto(cuerpo.impuesto)) {
            return datosInvalidos(errores)
        }
        const impuesto = cuerpo.impuesto
        const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : empresaActivaDe(solicitud)
        if (empresaId === null) {
            return problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'Elige la empresa con la que trabajas (cabecera X-Empresa-Id) o indica empresa_id')
        }
        if (periodo < INICIO_LIBROS) {
            return regla('antes_de_inicio_libros', `El periodo ${periodo} es anterior a inicio_libros (${INICIO_LIBROS}-01): sus libros y declaraciones salieron del sistema anterior`, [{ field: 'periodo', message: `Desde ${INICIO_LIBROS}`, rule: 'antes_de_inicio_libros' }])
        }
        const obligacion = bd.obligacionesFiscales.find(o => o.empresa_id === empresaId && o.impuesto === impuesto && o.periodo_desde === `${periodo}-01`)
        if (!obligacion || obligacion.estado === 'no_aplica') {
            return regla('obligacion_no_aplica', `La empresa no tiene la obligación ${impuesto} de ${periodo}${obligacion?.motivo_estado ? ` (${obligacion.motivo_estado})` : ''}: revise el régimen y las banderas del periodo`, [{ field: 'impuesto', message: obligacion?.motivo_estado ?? 'sin obligación', rule: 'obligacion_no_aplica' }])
        }
        const previa = ultima(empresaId, impuesto, periodo)
        if (previa && (previa.estado === 'revisada' || previa.estado === 'presentada') && cuerpo.sustitutiva !== true) {
            const presentada = previa.estado === 'presentada'
            return conflicto(presentada ? 'declaracion_presentada' : 'declaracion_revisada', presentada ? 'Declaración presentada' : 'Declaración revisada', `La versión ${previa.version} de ${impuesto} ${periodo} está ${previa.estado}: para corregirla calcule una sustitutiva (sustitutiva: true)`)
        }
        const calculado = calcularDatos(empresaId, impuesto, periodo)
        const momento = ahora()
        const nueva: Declaracion = {
            id: siguienteId(bd.declaraciones),
            empresa_id: empresaId,
            impuesto,
            periodo_desde: `${periodo}-01`,
            periodo_hasta: finDeMes(periodo),
            version: (previa?.version ?? 0) + 1,
            sustitutiva: previa?.revisada_en !== null && previa?.revisada_en !== undefined,
            sustituye_a: previa?.id ?? null,
            obligacion_id: obligacion.id,
            formulario: obligacion.formulario,
            vence_en: obligacion.vence_en,
            ...calculado,
            calculada_por: usuario(solicitud)?.id ?? null,
            calculada_en: momento,
            estado: 'borrador',
            revisada_por: null,
            revisada_en: null,
            asiento_id: null,
            numero_formulario: null,
            fecha_presentacion: null,
            boleta: null,
            presentada_por: null,
            presentada_en: null,
            pago: null,
            created_at: momento,
            updated_at: momento,
        }
        bd.declaraciones.push(nueva)
        if (previa && previa.estado !== 'sustituida') {
            Object.assign(previa, { estado: 'sustituida', updated_at: momento })
        }
        actualizarObligacion(nueva, { estado: 'borrador' })
        registrarAccion(solicitud, 'declaraciones.calcular', { tipo: 'declaracion', id: nueva.id }, { impuesto, periodo, sustitutiva: cuerpo.sustitutiva === true })
        return { status: 201, cuerpo: nueva }
    })),

    'POST /api/v1/declaraciones/:id/revisar': conPermiso('declaraciones.revisar', conIdempotencia((solicitud): RespuestaFixture => {
        const d = declaracionDe(solicitud)
        if ('status' in d) {
            return d
        }
        const sustituida = exigirUltima(d)
        if (sustituida) {
            return sustituida
        }
        if (d.estado !== 'borrador') {
            return conflicto(d.estado === 'presentada' ? 'declaracion_presentada' : 'declaracion_revisada', 'Declaración revisada', `La versión ${d.version} ya está ${d.estado}`)
        }
        const periodo = d.periodo_desde.slice(0, 7)
        if (d.periodo_hasta >= hoyGuatemala()) {
            return regla('periodo_en_curso', `El mes ${periodo} no ha terminado: se revisa y liquida después de su último día`)
        }
        if (desactualizada(d)) {
            return desactualizadaProblema(d)
        }
        const ncre = ncreSinCertificar(d.empresa_id, periodo)
        if (ncre.length) {
            const respuesta = conflicto('ncre_sin_certificar', 'NCRE sin certificar', `Hay ${ncre.length} notas de crédito con su NCRE sin certificar (${ncre.slice(0, 20).map(x => `nota ${x.nota_id}: ${x.estado}`).join(', ')}): certifícalas o anula las rechazadas antes de liquidar el IVA`)
            return { ...respuesta, cuerpo: { ...(respuesta.cuerpo as Problem), errors: ncre.map(x => ({ field: 'nota_id', message: x.estado, rule: String(x.dte_id), ...x })) } }
        }
        const cuadrado = verificarYExigir(solicitud, d.empresa_id, [['impuestos', d.periodo_desde]], ['iva_cuadrado'])
        if (cuadrado) {
            return cuadrado
        }
        // Liquidación: la diferencia con lo ya liquidado del periodo (sin diferencia, sin asiento).
        const previa = versiones(d.empresa_id, d.impuesto, periodo).filter(x => x.id !== d.id && x.revisada_en !== null).at(-1)
        const igual = previa !== undefined && JSON.stringify(previa.totales) === JSON.stringify(d.totales)
        const momento = ahora()
        const quien = usuario(solicitud)
        Object.assign(d, {
            estado: 'revisada',
            revisada_por: quien?.id ?? null,
            revisada_en: momento,
            asiento_id: igual ? null : 900 + d.id,
            updated_at: momento,
        })
        // Bloqueo `impuestos` en el último día del mes, si no estaba más adelante.
        const vigente = bd.bloqueosLibro.filter(b => b.empresa_id === d.empresa_id && b.tipo === 'impuestos').sort((a, b) => b.id - a.id)[0]?.hasta ?? null
        if (vigente === null || vigente < d.periodo_hasta) {
            bd.bloqueosLibro.push({ id: siguienteId(bd.bloqueosLibro), empresa_id: d.empresa_id, tipo: 'impuestos', hasta: d.periodo_hasta, anterior: vigente, motivo: `Liquidación de ${d.impuesto} ${periodo} (declaración ${d.id})`, creado_por: quien?.id ?? null, creado_por_nombre: quien?.nombre ?? null, created_at: momento })
        }
        verificarYExigir(solicitud, d.empresa_id, [['impuestos', d.periodo_desde]])
        registrarAccion(solicitud, 'declaraciones.revisar', { tipo: 'declaracion', id: d.id }, { declaracion_id: d.id })
        return { status: 200, cuerpo: d }
    })),

    'POST /api/v1/declaraciones/:id/marcar-presentada': conPermiso('declaraciones.presentar', conIdempotencia((solicitud): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        const numero = typeof cuerpo.numero_formulario === 'string' ? cuerpo.numero_formulario.trim() : ''
        if (numero.length < 3 || numero.length > 60) {
            errores.push({ field: 'numero_formulario', message: 'Número del formulario presentado', rule: 'required' })
        }
        const fecha = typeof cuerpo.fecha_presentacion === 'string' && FECHA.test(cuerpo.fecha_presentacion) ? cuerpo.fecha_presentacion : null
        if (fecha === null) {
            errores.push({ field: 'fecha_presentacion', message: 'Fecha YYYY-MM-DD', rule: 'date' })
        }
        else if (fecha > hoyGuatemala()) {
            errores.push({ field: 'fecha_presentacion', message: 'No puede ser futura', rule: 'futuro' })
        }
        const boleta = typeof cuerpo.boleta === 'string' ? cuerpo.boleta.trim() : ''
        if (boleta.length > 60) {
            errores.push({ field: 'boleta', message: 'Hasta 60 caracteres', rule: 'maxLength' })
        }
        if (errores.length || fecha === null) {
            return datosInvalidos(errores)
        }
        const d = declaracionDe(solicitud)
        if ('status' in d) {
            return d
        }
        const sustituida = exigirUltima(d)
        if (sustituida) {
            return sustituida
        }
        if (d.estado !== 'revisada') {
            return d.estado === 'presentada'
                ? conflicto('declaracion_presentada', 'Declaración no presentable', `La declaración ${d.id} ya está presentada`)
                : conflicto('declaracion_no_revisada', 'Declaración no presentable', `La declaración ${d.id} está en ${d.estado}: revísela (genera la liquidación) antes de marcarla presentada`)
        }
        if (desactualizada(d)) {
            return desactualizadaProblema(d)
        }
        const momento = ahora()
        Object.assign(d, { estado: 'presentada', numero_formulario: numero, fecha_presentacion: fecha, boleta: boleta || null, presentada_por: usuario(solicitud)?.id ?? null, presentada_en: momento, updated_at: momento })
        actualizarObligacion(d, { estado: 'presentada' })
        registrarAccion(solicitud, 'declaraciones.presentar', { tipo: 'declaracion', id: d.id }, cuerpo)
        return { status: 200, cuerpo: d }
    })),

    'POST /api/v1/declaraciones/:id/registrar-pago': conPermiso('declaraciones.pagar', conIdempotencia((solicitud): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        const metodo = cuerpo.metodo === 'caja' || cuerpo.metodo === 'banco' || cuerpo.metodo === 'cuenta_bancaria' ? cuerpo.metodo : null
        if (metodo === null) {
            errores.push({ field: 'metodo', message: 'Una de: caja, banco, cuenta_bancaria', rule: 'enum' })
        }
        const hoy = hoyGuatemala()
        const fecha = typeof cuerpo.fecha === 'string' && cuerpo.fecha ? cuerpo.fecha : hoy
        if (!FECHA.test(fecha)) {
            errores.push({ field: 'fecha', message: 'Fecha YYYY-MM-DD', rule: 'date' })
        }
        else if (fecha > hoy) {
            errores.push({ field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' })
        }
        if (errores.length || metodo === null) {
            return datosInvalidos(errores)
        }
        const d = declaracionDe(solicitud)
        if ('status' in d) {
            return d
        }
        const sustituida = exigirUltima(d)
        if (sustituida) {
            return sustituida
        }
        if (d.estado !== 'revisada' && d.estado !== 'presentada') {
            return conflicto('declaracion_no_revisada', 'Declaración no revisada', `La declaración ${d.id} está en ${d.estado}: se paga después de revisarla`)
        }
        if (d.pago) {
            return conflicto('declaracion_pagada', 'Declaración pagada', `La declaración ${d.id} ya tiene su pago (${d.pago.id})`)
        }
        const pagado = versiones(d.empresa_id, d.impuesto, d.periodo_desde.slice(0, 7)).reduce((s, x) => s.plus(x.pago?.impuesto ?? '0'), new Decimal(0))
        const monto = new Decimal(d.totales.a_pagar ?? '0').minus(pagado)
        if (monto.lte(0)) {
            return regla('sin_monto_a_pagar', `No hay impuesto por pagar en ${d.impuesto} ${d.periodo_desde.slice(0, 7)} (a pagar ${d.totales.a_pagar ?? '0.00'}, ya pagado ${pagado.toFixed(2)})`)
        }
        // Origen (`resolverOrigenEgreso`): caja activa, banco del libro (sin id: el principal) o cuenta bancaria; de la misma empresa.
        const campo = metodo === 'caja' ? 'caja_id' : metodo === 'banco' ? 'banco_id' : 'cuenta_bancaria_id'
        const origen = metodo === 'caja'
            ? bd.cajas.find(c => c.id === cuerpo.caja_id && c.activa)
            : metodo === 'banco'
                ? bancosLibro.find(b => b.id === (cuerpo.banco_id ?? 1))
                : bd.cuentasBancarias.find(c => c.id === cuerpo.cuenta_bancaria_id)
        if (!origen) {
            return datosInvalidos([{ field: campo, message: metodo === 'caja' ? `La caja ${String(cuerpo.caja_id ?? '')} no existe o está inactiva` : 'No existe', rule: metodo }])
        }
        if ((origen.empresa_id ?? 1) !== d.empresa_id) {
            return datosInvalidos([{ field: campo, message: `El pago sale de la empresa ${origen.empresa_id ?? 1} y la declaración es de la empresa ${d.empresa_id}`, rule: 'cuenta_de_otra_empresa' }])
        }
        const atraso = dias(d.vence_en, fecha)
        const mora = monto.times(MORA_DIARIA).dividedBy(100).times(atraso).toDecimalPlaces(2)
        let multa = new Decimal(0)
        if (d.fecha_presentacion && d.fecha_presentacion > d.vence_en) {
            const bruto = new Decimal(MULTA.por_dia).times(dias(d.vence_en, d.fecha_presentacion))
            multa = Decimal.min(bruto, MULTA.maximo).toDecimalPlaces(2)
        }
        const momento = ahora()
        d.pago = {
            id: bd.declaraciones.reduce((m, x) => Math.max(m, x.pago?.id ?? 0), 0) + 1,
            fecha,
            impuesto: monto.toFixed(2),
            mora: mora.toFixed(2),
            multa: multa.toFixed(2),
            total: monto.plus(mora).plus(multa).toFixed(2),
            dias_atraso: atraso,
            boleta: typeof cuerpo.boleta === 'string' && cuerpo.boleta.trim() ? cuerpo.boleta.trim() : null,
            asiento_id: 950 + d.id,
            registrado_por: usuario(solicitud)?.id ?? null,
            created_at: momento,
        }
        d.updated_at = momento
        registrarAccion(solicitud, 'declaraciones.pagar', { tipo: 'declaracion', id: d.id }, cuerpo)
        return { status: 201, cuerpo: d }
    })),
}
