import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, diferir, siguienteId } from '../bd'
import {
    ahora,
    conIdempotencia,
    conPermiso,
    cuerpoObjeto,
    datosInvalidos,
    empresaActivaDe,
    empresasDeLista,
    idDe,
    noEncontrado,
    numeroQuery,
    paginar,
    problemaTipado,
    registrarAccion,
    usuariosPorToken,
} from '../comun'
import { aplicarNotaCredito } from '../facturacion/aplicarNotaCredito'
import { dinero, estadoFactura } from '../facturacion/datos'
import { asientoFactura, asientoReverso, fechaGuatemala } from '../libro/datos'
import { certificarDte, hexDe, nuevoDte, proveedoresFel, receptorDe, reflejarEnFactura, registrarIntento } from './datos'

/**
 * Rutas de la FEL (A3, fase 3; README de `apps/api/app/fiscal`, contrato §8, §10.9 y §17). El
 * worker se simula con `diferir`: un DTE pendiente se certifica a los `DEMORA_WORKER_MS` y una
 * anulación pendiente se confirma igual. Con contingencia activa nada se transmite.
 */

type Dte = Schema<'Dte'>
type Factura = Schema<'Factura'>
type ConfiguracionFel = Schema<'ConfiguracionFel'>
type Errores = NonNullable<Problem['errors']>

/** Lo que tarda el worker simulado en enviar un DTE o una anulación. */
export const DEMORA_WORKER_MS = 1500

/** Clave de `localStorage` para Playwright: `{"1": "hash_distinto"}` rompe la cadena de esa empresa. */
export const CLAVE_CADENA_ROTA = 'argos_fixtures_cadena_rota'

const ESTADOS_DTE: readonly Dte['estado'][] = ['pendiente', 'enviando', 'certificado', 'error_temporal', 'rechazado', 'contingencia', 'anulacion_pendiente', 'anulado']
const DOCUMENTOS: readonly Dte['documento_tipo'][] = ['factura', 'nota_credito', 'nota_debito']
const EN_PROCESO: readonly Dte['estado'][] = ['pendiente', 'enviando', 'error_temporal', 'contingencia', 'anulacion_pendiente']

const ESTADO_EN_PROCESO: Record<string, string> = {
    enviando: 'se está enviando al certificador; intenta de nuevo en un momento',
    pendiente: 'está pendiente de certificar (en cola)',
    error_temporal: 'está en cola por un error temporal del certificador',
    contingencia: 'está en contingencia, esperando transmitirse',
    anulacion_pendiente: 'tiene la anulación pendiente de confirmar con el certificador',
}

function conflicto(codigo: string, titulo: string, detalle: string, errors?: Errores): RespuestaFixture {
    return problemaTipado(409, codigo, titulo, detalle, errors)
}

/** `DteEnProceso` de la API: el mensaje dice el estado real. */
export function dteEnProceso(dte: Dte): RespuestaFixture {
    return conflicto('dte_en_proceso', 'DTE en proceso', `El DTE ${dte.id} ${ESTADO_EN_PROCESO[dte.estado] ?? `está ${dte.estado}`}`, [{ field: 'dte_id', message: dte.estado, rule: 'dte_en_proceso' }])
}

function motivoDe(solicitud: SolicitudFixture): string | Errores {
    const { motivo } = cuerpoObjeto(solicitud)
    const texto = typeof motivo === 'string' ? motivo.trim() : ''
    return texto.length >= 3 && texto.length <= 500 ? texto : [{ field: 'motivo', message: 'El campo motivo debe tener al menos 3 caracteres', rule: 'minLength' }]
}

/** Empresa de la operación: `empresa_id` (query o cuerpo) o la activa; 422 `empresa_requerida`. */
function empresaDe(solicitud: SolicitudFixture, cuerpo?: Record<string, unknown>): number | RespuestaFixture {
    const pedida = typeof cuerpo?.empresa_id === 'number' ? cuerpo.empresa_id : numeroQuery(solicitud, 'empresa_id')
    const id = pedida ?? empresaActivaDe(solicitud)
    if (!id) {
        return problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'Elige la empresa con la que trabajas (cabecera X-Empresa-Id) o indica empresa_id')
    }
    return bd.empresas.some(e => e.id === id) ? id : noEncontrado('la empresa')
}

/** Configuración FEL de la empresa (sin fila: desactivada con `version` 0). */
export function configuracionFel(empresaId: number): ConfiguracionFel {
    const guardada = bd.fel.configuraciones[empresaId] ?? {
        empresa_id: empresaId,
        proveedor: null,
        ambiente: 'pruebas',
        modo: 'desactivada',
        contingencia_activa: false,
        contingencia_motivo: null,
        contingencia_desde: null,
        version: 0,
        updated_at: null,
    }
    return {
        ...guardada,
        credenciales: bd.fel.credenciales.filter(c => c.vista.empresa_id === empresaId).map(c => structuredClone(c.vista)),
    }
}

/** La nota como la ve la API: con su NCRE (`dte_id`, `fel_*`), o `null` en una nota interna. */
export function vistaNota(nota: Schema<'NotaCredito'>): Schema<'NotaCredito'> {
    const ncre = dteDe('nota_credito', nota.id)
    return {
        ...nota,
        dte_id: ncre?.id ?? null,
        fel_estado: ncre?.estado ?? null,
        fel_uuid: ncre?.autorizacion ?? null,
        fel_serie: ncre?.serie ?? null,
        fel_numero: ncre?.numero ?? null,
        fel_error: ncre?.ultimo_error ?? null,
    }
}

/** El DTE más reciente de un documento, o `null`. */
export function dteDe(tipo: Dte['documento_tipo'], documentoId: number): Dte | null {
    return bd.fel.dte.filter(d => d.documento_tipo === tipo && d.documento_id === documentoId).sort((a, b) => b.id - a.id)[0] ?? null
}

function usuarioDe(solicitud: SolicitudFixture) {
    return solicitud.token ? usuariosPorToken[solicitud.token] : undefined
}

/** Efectos de certificar en el documento: la factura `por_certificar` se emite (con su asiento). */
function alCertificar(dte: Dte, momento: string): void {
    if (dte.documento_tipo !== 'factura') {
        return
    }
    const factura = bd.facturas.find(f => f.id === dte.documento_id)
    if (!factura) {
        return
    }
    if (factura.estado === 'por_certificar') {
        factura.estado = estadoFactura(new Decimal(factura.pagado), new Decimal(factura.total), factura.vence_en)
        bd.asientos.push(asientoFactura(siguienteId(bd.asientos), { ...factura, emitida_en: momento }))
    }
    factura.version += 1
    factura.updated_at = momento
    reflejarEnFactura(factura, dte)
}

/** El worker simulado: envía el DTE si sigue pendiente y la empresa no está en contingencia. */
export function programarEnvio(dte: Dte): void {
    diferir(DEMORA_WORKER_MS, () => {
        if (dte.estado !== 'pendiente' || bd.fel.configuraciones[dte.empresa_id]?.contingencia_activa) {
            return
        }
        const momento = ahora()
        certificarDte(bd.fel, dte, momento)
        alCertificar(dte, momento)
    })
}

/** Crea el DTE de una factura (FACT, o NDEB para la mora) y lo pone en cola. */
function solicitarDteFactura(factura: Factura, solicitud: Dte['solicitud']): Dte {
    const momento = ahora()
    const contingencia = bd.fel.configuraciones[factura.empresa_id ?? 1]?.contingencia_activa === true
    const origen = factura.factura_origen_id ? dteDe('factura', factura.factura_origen_id) : null
    const dte = nuevoDte({
        id: siguienteId(bd.fel.dte),
        empresa_id: factura.empresa_id ?? 1,
        documento_tipo: factura.tipo === 'mora' ? 'nota_debito' : 'factura',
        documento_id: factura.id,
        tipo_dte: factura.tipo === 'mora' ? 'NDEB' : 'FACT',
        receptor: receptorDe(bd.clientes.find(c => c.id === factura.cliente_id)),
        referencia: factura.tipo === 'mora' && origen?.autorizacion
            ? { autorizacion: origen.autorizacion, serie: origen.serie, numero: origen.numero, fecha: fechaGuatemala(factura.emitida_en), motivo: 'Recargo por mora' }
            : null,
        total: dinero(new Decimal(factura.total).minus(factura.acreditado ?? '0')),
        iva: factura.iva,
        momento,
        solicitud,
        contingencia,
    })
    bd.fel.dte.push(dte)
    reflejarEnFactura(factura, dte)
    if (!contingencia) {
        programarEnvio(dte)
    }
    return dte
}

/** NCRE de una nota sobre una factura certificada; en cola como en contingencia (§17). */
export function solicitarNcre(nota: Schema<'NotaCredito'>, dteFactura: Dte): Dte {
    const ncre = nuevoDte({
        id: siguienteId(bd.fel.dte),
        empresa_id: dteFactura.empresa_id,
        documento_tipo: 'nota_credito',
        documento_id: nota.id,
        tipo_dte: 'NCRE',
        receptor: dteFactura.receptor,
        referencia: { autorizacion: dteFactura.autorizacion ?? '', serie: dteFactura.serie, numero: dteFactura.numero, fecha: nota.fecha, motivo: nota.motivo },
        total: nota.monto,
        iva: nota.iva,
        momento: nota.created_at,
        solicitud: 'automatico',
        contingencia: bd.fel.configuraciones[dteFactura.empresa_id]?.contingencia_activa === true,
    })
    bd.fel.dte.push(ncre)
    if (!ncre.contingencia) {
        programarEnvio(ncre)
    }
    return ncre
}

/**
 * Reglas de la FEL para una nota de crédito sobre una factura (§17): 409 `dte_en_proceso` con el
 * DTE sin estado final; 409 `nota_requiere_ncre` sobre un documento certificado con la FEL
 * desactivada. Devuelve el DTE certificado (la nota sale como NCRE) o `null` (nota interna).
 */
export function reglasNotaFel(factura: Factura): { ncreDe: Dte | null } | RespuestaFixture {
    const dte = factura.dte_id ? bd.fel.dte.find(d => d.id === factura.dte_id) ?? null : null
    if (!dte || dte.estado === 'rechazado' || dte.estado === 'anulado') {
        return { ncreDe: null }
    }
    if ((EN_PROCESO as readonly string[]).includes(dte.estado)) {
        return dteEnProceso(dte)
    }
    if (configuracionFel(dte.empresa_id).modo === 'desactivada') {
        return conflicto('nota_requiere_ncre', 'Nota requiere NCRE', `La factura ${factura.id} tiene DTE certificado: la nota solo puede salir como NCRE y la FEL de la empresa está desactivada`)
    }
    return { ncreDe: dte }
}

/** Facturas «aviso de cobro» vivas sin DTE certificado (H8). */
function avisosVivos(empresaId: number): number {
    return bd.facturas.filter(f => (f.empresa_id ?? 1) === empresaId && f.aviso_cobro && f.estado !== 'anulada' && f.estado !== 'pagada' && f.fel_estado !== 'certificado').length
}

/** NCRE de la empresa del mes o anteriores sin certificar, de notas no anuladas (cierre del mes). */
export function ncreSinCertificar(empresaId: number, periodo: string): { nota_id: number, factura_id: number, dte_id: number, estado: string }[] {
    const [anio = 0, mes = 0] = periodo.split('-').map(Number)
    const limite = `${mes === 12 ? anio + 1 : anio}-${String(mes === 12 ? 1 : mes + 1).padStart(2, '0')}-01`
    return bd.notasCredito
        .filter(n => (n.empresa_id ?? 1) === empresaId && n.fecha < limite && !n.anulada_en)
        .flatMap((nota) => {
            const ncre = dteDe('nota_credito', nota.id)
            return ncre && ncre.estado !== 'certificado' ? [{ nota_id: nota.id, factura_id: nota.factura_id, dte_id: ncre.id, estado: ncre.estado }] : []
        })
}

function rupturasGuardadas(): Record<string, string> {
    try {
        const valor: unknown = JSON.parse(globalThis.localStorage?.getItem(CLAVE_CADENA_ROTA) ?? 'null')
        return typeof valor === 'object' && valor !== null ? Object.fromEntries(Object.entries(valor).filter((par): par is [string, string] => typeof par[1] === 'string')) : {}
    }
    catch {
        return {}
    }
}

/** Ruptura de la cadena de la empresa: la de `romperCadenaFixture` o la de `localStorage`. */
export function rupturaDe(empresaId: number): NonNullable<Schema<'IntegridadLibro'>['ruptura']> | null {
    const propia = bd.fel.rupturas[empresaId]
    if (propia) {
        return propia
    }
    const motivo = rupturasGuardadas()[String(empresaId)]
    if (!motivo) {
        return null
    }
    const asiento = bd.asientos.filter(a => (a.empresa_id ?? 1) === empresaId).sort((a, b) => a.id - b.id)[4]
    return {
        sello: 5,
        asiento_id: asiento?.id ?? null,
        motivo: motivo as NonNullable<Schema<'IntegridadLibro'>['ruptura']>['motivo'],
        esperado: hexDe(`guardado:${asiento?.id ?? 0}`),
        obtenido: hexDe(`recalculado:${asiento?.id ?? 0}`),
    }
}

/** Cadena de hash de una empresa como `verificarCadena` (A3): sellos en orden de id; lo de hace menos de un minuto, sin sellar. */
function integridadDe(empresaId: number, solicitud: SolicitudFixture): Schema<'IntegridadLibro'> {
    const desde = solicitud.query.get('desde') ?? ''
    const hasta = solicitud.query.get('hasta') ?? ''
    const desdeSello = numeroQuery(solicitud, 'desde_sello')
    const hastaSello = numeroQuery(solicitud, 'hasta_sello')
    const limiteSellado = Date.now() - 60_000
    const asientos = bd.asientos.filter(a => (a.empresa_id ?? 1) === empresaId).sort((a, b) => a.id - b.id)
    const sellados = asientos.filter(a => new Date(a.created_at).getTime() <= limiteSellado)
    const enRango = (a: { fecha: string }) => (!desde || a.fecha >= desde) && (!hasta || a.fecha <= hasta)
    let anterior = '0'.repeat(64)
    const cadena = sellados.map((asiento, indice) => {
        anterior = hexDe(`${anterior}:${asiento.id}:${asiento.fecha}:${asiento.movimientos.map(m => `${m.cuenta_codigo}${m.debe}${m.haber}`).join('|')}`)
        return { sello: indice + 1, asiento, hash: anterior }
    })
    const rango = cadena.filter(e => enRango(e.asiento) && (desdeSello === undefined || e.sello >= desdeSello) && (hastaSello === undefined || e.sello <= hastaSello))
    const ruptura = rupturaDe(empresaId)
    return {
        empresa_id: empresaId,
        version: 'v1',
        verificado: ruptura === null,
        sellos: cadena.length,
        verificados: ruptura ? rango.filter(e => e.sello < ruptura.sello).length : rango.length,
        sin_sellar: asientos.filter(a => !sellados.includes(a) && enRango(a)).length,
        primer_sello: rango[0]?.sello ?? null,
        ultimo_sello: rango.at(-1)?.sello ?? null,
        primer_hash: rango[0]?.hash ?? null,
        ultimo_hash: rango.at(-1)?.hash ?? null,
        ruptura,
    }
}

const PROVEEDORES: Record<string, { obligatorios: string[], visibles: string[] }> = {
    infile: { obligatorios: ['usuario_firma', 'llave_firma', 'usuario_api', 'llave_api'], visibles: ['usuario_firma', 'usuario_api', 'correo_copia'] },
    falso: { obligatorios: ['usuario', 'llave'], visibles: ['usuario'] },
}

function esAmbiente(valor: unknown): valor is ConfiguracionFel['ambiente'] {
    return valor === 'pruebas' || valor === 'produccion'
}

export function rutasFel(detalle: (factura: Factura) => Schema<'FacturaDetalle'>): RutasFixture {
    return {
        'GET /api/v1/fel/proveedores': conPermiso('fel.ver', () => ({ status: 200, cuerpo: structuredClone(proveedoresFel) })),

        'GET /api/v1/dte/:id/intentos': conPermiso('fel.ver', (solicitud) => {
            const id = idDe(solicitud)
            if (!bd.fel.dte.some(d => d.id === id)) {
                return noEncontrado('el DTE')
            }
            return { status: 200, cuerpo: bd.fel.intentos.filter(i => i.dte_id === id).sort((a, b) => a.id - b.id).map(i => structuredClone(i)) }
        }),

        'GET /api/v1/fel/configuracion': conPermiso('fel.ver', (solicitud) => {
            const empresa = empresaDe(solicitud)
            return typeof empresa === 'number' ? { status: 200, cuerpo: configuracionFel(empresa) } : empresa
        }),

        /** Como `ConfigurarFel`: versión, falso solo en pruebas, `certificar_al_incompatible` y `avisos_por_certificar`. */
        'PUT /api/v1/fel/configuracion': conPermiso('fel.configurar', conIdempotencia((solicitud) => {
            const cuerpo = cuerpoObjeto(solicitud)
            const empresa = empresaDe(solicitud, cuerpo)
            if (typeof empresa !== 'number') {
                return empresa
            }
            const errores: Errores = []
            const { proveedor, ambiente, modo, version } = cuerpo
            if (proveedor !== null && proveedor !== undefined && proveedor !== 'infile' && proveedor !== 'falso') {
                errores.push({ field: 'proveedor', message: 'El valor de proveedor no es válido', rule: 'enum' })
            }
            if (!esAmbiente(ambiente)) {
                errores.push({ field: 'ambiente', message: 'El valor de ambiente no es válido', rule: 'enum' })
            }
            if (modo !== 'obligatoria' && modo !== 'opcional' && modo !== 'desactivada') {
                errores.push({ field: 'modo', message: 'El valor de modo no es válido', rule: 'enum' })
            }
            if (typeof version !== 'number') {
                errores.push({ field: 'version', message: 'El campo version es obligatorio', rule: 'required' })
            }
            if (errores.length) {
                return datosInvalidos(errores)
            }
            const actual = configuracionFel(empresa)
            if (version !== actual.version) {
                return conflicto('conflicto_version', 'Conflicto de versión', `La configuración FEL de la empresa ${empresa} fue modificado por otra sesión; recarga y vuelve a intentar`)
            }
            if (modo !== 'desactivada' && !proveedor) {
                return datosInvalidos([{ field: 'proveedor', message: 'Elige el certificador', rule: 'required' }])
            }
            if (proveedor === 'falso' && ambiente === 'produccion') {
                return datosInvalidos([{ field: 'proveedor', message: 'El proveedor falso es solo para pruebas y laboratorio', rule: 'proveedor_solo_pruebas' }])
            }
            if (modo === 'obligatoria' && bd.plantillas.some(p => p.certificar_al === 'nunca')) {
                const servicios = bd.servicios.filter(s => (s.empresa_id ?? 1) === empresa && bd.plantillas.find(p => p.id === s.plantilla_facturacion_id)?.certificar_al === 'nunca').map(s => s.id)
                if (servicios.length) {
                    const detalleError = `Con FEL obligatoria ningún servicio puede tener certificar_al = nunca (servicios ${servicios.slice(0, 20).join(', ')})`
                    return problemaTipado(422, 'certificar_al_incompatible', 'certificar_al incompatible', detalleError, [{ field: 'modo', message: detalleError, rule: 'certificar_al_incompatible' }])
                }
            }
            if (modo === 'desactivada' && actual.modo !== 'desactivada') {
                const avisos = avisosVivos(empresa)
                if (avisos > 0) {
                    return problemaTipado(422, 'avisos_por_certificar', 'Avisos por certificar', `La empresa tiene ${avisos} avisos de cobro sin DTE certificado: su IVA está en 2.1.11 y quedaría sin declarar. Certifícalos o anúlalos antes de desactivar la FEL (la reclasificación masiva la decide el contador)`, [{ field: 'modo', message: `${avisos} avisos por certificar`, rule: 'avisos_por_certificar' }])
                }
            }
            const momento = ahora()
            bd.fel.configuraciones[empresa] = {
                empresa_id: empresa,
                proveedor: proveedor === 'infile' || proveedor === 'falso' ? proveedor : null,
                ambiente: esAmbiente(ambiente) ? ambiente : 'pruebas',
                modo: modo as ConfiguracionFel['modo'],
                contingencia_activa: actual.contingencia_activa,
                contingencia_motivo: actual.contingencia_motivo,
                contingencia_desde: actual.contingencia_desde,
                version: actual.version + 1,
                updated_at: momento,
            }
            registrarAccion(solicitud, 'fel.configurar', { tipo: 'empresa', id: empresa }, { proveedor, ambiente, modo })
            return { status: 200, cuerpo: configuracionFel(empresa) }
        })),

        /** Credenciales cifradas: la respuesta y la bitácora nunca traen las llaves (`***`). */
        'PUT /api/v1/fel/credenciales/:ambiente': conPermiso('fel.configurar', conIdempotencia((solicitud) => {
            const ambiente = solicitud.params.ambiente
            if (!esAmbiente(ambiente)) {
                return noEncontrado('el ambiente')
            }
            const cuerpo = cuerpoObjeto(solicitud)
            const empresa = empresaDe(solicitud, cuerpo)
            if (typeof empresa !== 'number') {
                return empresa
            }
            const proveedor = typeof cuerpo.proveedor === 'string' ? cuerpo.proveedor : (configuracionFel(empresa).proveedor ?? '')
            const campos = PROVEEDORES[proveedor]
            if (!campos) {
                return problemaTipado(422, 'fel_no_configurada', 'FEL no configurada', 'La empresa no tiene certificador FEL configurado', [{ field: 'proveedor', message: 'Elige el certificador', rule: 'fel_no_configurada' }])
            }
            const credenciales = typeof cuerpo.credenciales === 'object' && cuerpo.credenciales !== null ? cuerpo.credenciales as Record<string, unknown> : {}
            const faltan = campos.obligatorios.filter(c => typeof credenciales[c] !== 'string' || !String(credenciales[c]).trim())
            if (faltan.length) {
                return datosInvalidos(faltan.map(c => ({ field: `credenciales.${c}`, message: 'Obligatorio', rule: 'required' })))
            }
            const momento = ahora()
            const visibles = Object.fromEntries(campos.visibles.filter(c => typeof credenciales[c] === 'string' && String(credenciales[c]).trim()).map(c => [c, String(credenciales[c]).trim()]))
            const existente = bd.fel.credenciales.find(c => c.vista.empresa_id === empresa && c.vista.ambiente === ambiente)
            const vista: Schema<'CredencialesFel'> = {
                id: existente?.vista.id ?? bd.fel.credenciales.reduce((m, c) => Math.max(m, c.vista.id), 0) + 1,
                empresa_id: empresa,
                proveedor,
                ambiente,
                campos_visibles: visibles,
                probada_en: null,
                resultado_prueba: null,
                version: (existente?.vista.version ?? 0) + 1,
                updated_at: momento,
            }
            const rechaza = credenciales.llave === 'invalida' || credenciales.llave_api === 'invalida'
            if (existente) {
                Object.assign(existente, { vista, rechaza })
            }
            else {
                bd.fel.credenciales.push({ vista, rechaza })
            }
            registrarAccion(solicitud, 'fel.guardar_credenciales', { tipo: 'empresa', id: empresa }, { ambiente, proveedor, credenciales: '***' })
            return { status: 200, cuerpo: structuredClone(vista) }
        })),

        'POST /api/v1/fel/credenciales/:ambiente/probar': conPermiso('fel.configurar', (solicitud) => {
            const ambiente = solicitud.params.ambiente
            const empresa = empresaDe(solicitud)
            if (typeof empresa !== 'number') {
                return empresa
            }
            const configuracion = configuracionFel(empresa)
            const guardada = bd.fel.credenciales.find(c => c.vista.empresa_id === empresa && c.vista.ambiente === ambiente)
            if (!configuracion.proveedor || !guardada) {
                return problemaTipado(422, 'fel_no_configurada', 'FEL no configurada', configuracion.proveedor ? `No hay credenciales de ${String(ambiente)} guardadas` : 'La empresa no tiene certificador FEL configurado', [{ field: 'empresa_id', message: 'Sin certificador o credenciales', rule: 'fel_no_configurada' }])
            }
            const momento = ahora()
            guardada.vista.probada_en = momento
            guardada.vista.updated_at = momento
            guardada.vista.resultado_prueba = guardada.rechaza
                ? { ok: false, detalle: 'Credenciales rechazadas (simulado)' }
                : { ok: true, detalle: 'Credenciales válidas (proveedor falso)' }
            registrarAccion(solicitud, 'fel.probar_credenciales', { tipo: 'empresa', id: empresa }, { ambiente })
            return { status: 200, cuerpo: structuredClone(guardada.vista) }
        }),

        ...Object.fromEntries((['activar', 'desactivar'] as const).map(accion => [
            `POST /api/v1/fel/${accion}-contingencia`,
            conPermiso('fel.contingencia', conIdempotencia((solicitud) => {
                const cuerpo = cuerpoObjeto(solicitud)
                const empresa = empresaDe(solicitud, cuerpo)
                if (typeof empresa !== 'number') {
                    return empresa
                }
                const motivo = motivoDe(solicitud)
                if (Array.isArray(motivo)) {
                    return datosInvalidos(motivo)
                }
                const actual = configuracionFel(empresa)
                const activar = accion === 'activar'
                if (actual.contingencia_activa === activar) {
                    return conflicto('contingencia_sin_cambio', 'Contingencia sin cambio', activar ? 'La contingencia ya está activa' : 'La contingencia no está activa')
                }
                const momento = ahora()
                const { credenciales: _credenciales, ...base } = actual
                bd.fel.configuraciones[empresa] = {
                    ...base,
                    contingencia_activa: activar,
                    contingencia_motivo: motivo,
                    contingencia_desde: activar ? momento : null,
                    version: actual.version + 1,
                    updated_at: momento,
                }
                if (!activar) {
                    // Al levantarla, la cola transmite lo que quedó en contingencia.
                    for (const dte of bd.fel.dte.filter(d => d.empresa_id === empresa && d.estado === 'contingencia')) {
                        dte.estado = 'pendiente'
                        programarEnvio(dte)
                    }
                }
                registrarAccion(solicitud, 'fel.contingencia', { tipo: 'empresa', id: empresa }, { activa: activar, motivo })
                return { status: 200, cuerpo: configuracionFel(empresa) }
            })),
        ])),

        'GET /api/v1/dte': conPermiso('fel.ver', (solicitud) => {
            const estados = solicitud.query.getAll('estado').flatMap(e => e.split(',')).filter(Boolean)
            const tipo = solicitud.query.get('documento_tipo')
            const documento = numeroQuery(solicitud, 'documento_id')
            const desde = solicitud.query.get('desde') ?? ''
            const hasta = solicitud.query.get('hasta') ?? ''
            const errores: Errores = []
            if (estados.some(e => !(ESTADOS_DTE as readonly string[]).includes(e))) {
                errores.push({ field: 'estado', message: 'El valor de estado no es válido', rule: 'enum' })
            }
            if (tipo && !(DOCUMENTOS as readonly string[]).includes(tipo)) {
                errores.push({ field: 'documento_tipo', message: 'El valor de documento_tipo no es válido', rule: 'enum' })
            }
            if (errores.length) {
                return datosInvalidos(errores)
            }
            const empresas = empresasDeLista(solicitud)
            const filas = bd.fel.dte
                .filter(d => empresas === null || empresas.includes(d.empresa_id))
                .filter(d => !estados.length || estados.includes(d.estado))
                .filter(d => !desde || fechaGuatemala(d.fecha_emision) >= desde)
                .filter(d => !hasta || fechaGuatemala(d.fecha_emision) <= hasta)
                .filter(d => !tipo || d.documento_tipo === tipo)
                .filter(d => documento === undefined || d.documento_id === documento)
                .sort((a, b) => b.id - a.id)
                .map(d => structuredClone(d))
            return { status: 200, cuerpo: paginar(filas, solicitud) }
        }),

        'GET /api/v1/dte/:id': conPermiso('fel.ver', (solicitud) => {
            const dte = bd.fel.dte.find(d => d.id === idDe(solicitud))
            return dte ? { status: 200, cuerpo: structuredClone(dte) } : noEncontrado('el DTE')
        }),

        'GET /api/v1/dte/:id/xml': conPermiso('fel.ver', (solicitud) => {
            const id = idDe(solicitud) ?? 0
            const xml = bd.fel.xml[id]
            if (!xml) {
                return problemaTipado(404, 'no_encontrado', 'No encontrado', `El DTE ${id} aún no tiene XML certificado`)
            }
            return { status: 200, cuerpo: new TextEncoder().encode(xml), contentType: 'application/xml' }
        }),

        /** El certificador falso no devuelve PDF (`capacidades.pdf = false`). */
        'GET /api/v1/dte/:id/pdf': conPermiso('fel.ver', (solicitud) => {
            const id = idDe(solicitud) ?? 0
            return bd.fel.dte.some(d => d.id === id)
                ? problemaTipado(404, 'no_encontrado', 'No encontrado', `El certificador no devolvió PDF del DTE ${id}`)
                : noEncontrado('el DTE')
        }),

        /** Rechazado: DTE nuevo con el receptor releído; error temporal: vuelve a la cola ya. */
        'POST /api/v1/dte/:id/reintentar': conPermiso('fel.certificar', conIdempotencia((solicitud) => {
            const dte = bd.fel.dte.find(d => d.id === idDe(solicitud))
            if (!dte) {
                return noEncontrado('el DTE')
            }
            if (dte.estado === 'enviando') {
                return dteEnProceso(dte)
            }
            if (dte.estado !== 'rechazado' && dte.estado !== 'error_temporal') {
                return conflicto('dte_no_reintentable', 'DTE no reintentable', `El DTE ${dte.id} está ${dte.estado}: solo se reintenta uno rechazado o con error temporal`)
            }
            const factura = dte.documento_tipo === 'nota_credito' ? null : bd.facturas.find(f => f.id === dte.documento_id)
            if (factura?.estado === 'anulada') {
                return conflicto('factura_anulada', 'Factura anulada', `La factura ${factura.id} está anulada`)
            }
            registrarAccion(solicitud, 'fel.reintentar', { tipo: 'dte', id: dte.id }, {})
            if (dte.estado === 'error_temporal') {
                Object.assign(dte, { estado: 'pendiente', proximo_intento: ahora(), version: dte.version + 1, updated_at: ahora() })
                programarEnvio(dte)
                if (factura) {
                    reflejarEnFactura(factura, dte)
                }
                return { status: 200, cuerpo: structuredClone(dte) }
            }
            const momento = ahora()
            const cliente = factura ? bd.clientes.find(c => c.id === factura.cliente_id) : undefined
            const nuevo = nuevoDte({
                ...dte,
                id: siguienteId(bd.fel.dte),
                receptor: factura ? receptorDe(cliente) : dte.receptor,
                momento,
                solicitud: 'manual',
                contingencia: bd.fel.configuraciones[dte.empresa_id]?.contingencia_activa === true,
            })
            bd.fel.dte.push(nuevo)
            if (factura) {
                reflejarEnFactura(factura, nuevo)
            }
            if (!nuevo.contingencia) {
                programarEnvio(nuevo)
            }
            return { status: 200, cuerpo: structuredClone(nuevo) }
        })),

        'POST /api/v1/facturas/:id/certificar': conPermiso('fel.certificar', conIdempotencia((solicitud) => {
            const factura = bd.facturas.find(f => f.id === idDe(solicitud))
            if (!factura) {
                return noEncontrado('la factura')
            }
            if (factura.estado === 'anulada') {
                return conflicto('factura_anulada', 'Factura anulada', `La factura ${factura.id} está anulada`)
            }
            const configuracion = configuracionFel(factura.empresa_id ?? 1)
            if (configuracion.modo === 'desactivada' || !configuracion.proveedor) {
                return problemaTipado(422, 'fel_no_configurada', 'FEL no configurada', 'La empresa no tiene certificador FEL configurado', [{ field: 'empresa_id', message: 'La empresa no tiene certificador FEL configurado', rule: 'fel_no_configurada' }])
            }
            const vigente = factura.dte_id ? bd.fel.dte.find(d => d.id === factura.dte_id) : undefined
            if (vigente && vigente.estado !== 'rechazado' && vigente.estado !== 'anulado') {
                const respuesta: Schema<'SolicitudCertificacion'> = { factura_id: factura.id, dte: structuredClone(vigente), creado: false, motivo: `La factura ya tiene el DTE ${vigente.id} (${vigente.estado})` }
                return { status: 200, cuerpo: respuesta }
            }
            const dte = solicitarDteFactura(factura, 'manual')
            registrarAccion(solicitud, 'fel.certificar', { tipo: 'factura', id: factura.id }, {})
            const respuesta: Schema<'SolicitudCertificacion'> = { factura_id: factura.id, dte: structuredClone(dte), creado: true, motivo: null }
            return { status: 200, cuerpo: respuesta }
        })),

        /**
         * Como `CertificarLote` (A3): facturas de la empresa por lista o por rango de emisión
         * (Guatemala); las vigentes devuelven su DTE sin crear otro y las anuladas van en `errores`.
         */
        'POST /api/v1/fel/lotes': conPermiso('fel.certificar', conIdempotencia((solicitud) => {
            const cuerpo = cuerpoObjeto(solicitud)
            const empresa = empresaDe(solicitud, cuerpo)
            if (typeof empresa !== 'number') {
                return empresa
            }
            const ids = Array.isArray(cuerpo.facturas) ? cuerpo.facturas.filter((n): n is number => typeof n === 'number') : null
            const desde = typeof cuerpo.desde === 'string' ? cuerpo.desde : null
            const hasta = typeof cuerpo.hasta === 'string' ? cuerpo.hasta : null
            if (!ids?.length && (!desde || !hasta)) {
                return datosInvalidos([{ field: 'facturas', message: 'Indica las facturas o el rango desde/hasta', rule: 'required' }])
            }
            const configuracion = configuracionFel(empresa)
            if (configuracion.modo === 'desactivada' || !configuracion.proveedor) {
                return problemaTipado(422, 'fel_no_configurada', 'FEL no configurada', 'La empresa no tiene certificador FEL configurado')
            }
            const facturas = bd.facturas.filter(f => (f.empresa_id ?? 1) === empresa && (ids?.length ? ids.includes(f.id) : fechaGuatemala(f.emitida_en) >= (desde ?? '') && fechaGuatemala(f.emitida_en) <= (hasta ?? '')))
            const solicitadas: Schema<'SolicitudCertificacion'>[] = []
            const errores: { factura_id: number, tipo: string, detalle: string }[] = []
            for (const factura of facturas) {
                if (factura.estado === 'anulada') {
                    errores.push({ factura_id: factura.id, tipo: 'factura_anulada', detalle: `La factura ${factura.id} está anulada` })
                    continue
                }
                const vigente = factura.dte_id ? bd.fel.dte.find(d => d.id === factura.dte_id) : undefined
                if (vigente && vigente.estado !== 'rechazado' && vigente.estado !== 'anulado') {
                    solicitadas.push({ factura_id: factura.id, dte: structuredClone(vigente), creado: false, motivo: `La factura ya tiene el DTE ${vigente.id} (${vigente.estado})` })
                    continue
                }
                const dte = solicitarDteFactura(factura, 'manual')
                solicitadas.push({ factura_id: factura.id, dte: structuredClone(dte), creado: true, motivo: null })
            }
            registrarAccion(solicitud, 'fel.certificar_lote', { tipo: 'empresa', id: empresa }, cuerpo)
            return { status: 200, cuerpo: { solicitadas, errores } }
        })),

        /**
         * Como `SustituirFactura`: sin pagos ni mora; sin DTE certificado anula la original, con DTE
         * la acredita con una NCRE por su saldo; la nueva toma `clave_unica = <clave>#s<n>`.
         */
        'POST /api/v1/facturas/:id/sustituir': conPermiso('facturas.sustituir', conIdempotencia((solicitud) => {
            const original = bd.facturas.find(f => f.id === idDe(solicitud))
            if (!original) {
                return noEncontrado('la factura')
            }
            const motivo = motivoDe(solicitud)
            if (Array.isArray(motivo)) {
                return datosInvalidos(motivo)
            }
            if (original.estado === 'anulada') {
                return conflicto('factura_anulada', 'Factura anulada', `La factura ${original.id} está anulada`)
            }
            const pagos = new Decimal(original.pagado).minus(original.acreditado ?? '0')
            if (pagos.gt(0)) {
                return conflicto('sustitucion_no_permitida', 'Sustitución no permitida', `La factura ${original.id} tiene pagos aplicados (Q${dinero(pagos)}): anula primero el pago`)
            }
            if (original.tipo === 'mora' || bd.fel.sustituciones.some(s => s.original_id === original.id)) {
                return conflicto('sustitucion_no_permitida', 'Sustitución no permitida', original.tipo === 'mora' ? 'Una mora no se sustituye: se anula' : `La factura ${original.id} ya fue sustituida`)
            }
            const dte = original.dte_id ? bd.fel.dte.find(d => d.id === original.dte_id) : undefined
            if (dte && (EN_PROCESO as readonly string[]).includes(dte.estado)) {
                return dteEnProceso(dte)
            }
            const momento = ahora()
            const usuario = usuarioDe(solicitud)
            let tipo: 'anulacion' | 'nota_credito' = 'anulacion'
            let notaId: number | null = null
            if (dte?.estado === 'certificado') {
                tipo = 'nota_credito'
                const saldo = new Decimal(original.total).minus(original.pagado)
                const nota = aplicarNotaCredito(bd, original, saldo, `Sustitución: ${motivo}`, usuario, momento)
                solicitarNcre(nota, dte)
                notaId = nota.id
            }
            else {
                Object.assign(original, { estado: 'anulada', anulada_en: momento, motivo_anulacion: `Sustitución: ${motivo}`, version: original.version + 1, updated_at: momento })
                if (dte) {
                    Object.assign(dte, { estado: 'anulado', anulado_en: momento, motivo_anulacion: 'documento_anulado', version: dte.version + 1, updated_at: momento })
                    reflejarEnFactura(original, dte)
                }
                const asiento = bd.asientos.find(a => a.origen_tipo === 'factura' && a.origen_id === original.id && a.reversa_de === null)
                if (asiento) {
                    bd.asientos.push(asientoReverso(siguienteId(bd.asientos), asiento, `Anulación de la factura ${original.id} · sustitución`, momento, usuario?.id ?? null))
                }
            }
            const previas = bd.facturas.filter(f => f.clave_unica.startsWith(`${original.clave_unica.split('#')[0]}#s`)).length
            const nueva: Factura = {
                ...structuredClone(original),
                id: siguienteId(bd.facturas),
                clave_unica: `${original.clave_unica.split('#')[0]}#s${previas + 1}`,
                emitida_en: momento,
                estado: estadoFactura(new Decimal(0), new Decimal(original.total), original.vence_en),
                pagado: '0.00',
                acreditado: '0.00',
                vencida_en: null,
                anulada_en: null,
                motivo_anulacion: null,
                version: 1,
                created_at: momento,
                updated_at: momento,
            }
            reflejarEnFactura(nueva, null)
            nueva.sustituye_a = original.id
            nueva.sustituida_por = null
            original.sustituida_por = nueva.id
            bd.facturas.push(nueva)
            bd.asientos.push(asientoFactura(siguienteId(bd.asientos), nueva))
            bd.fel.sustituciones.push({ original_id: original.id, nueva_id: nueva.id, tipo, motivo })
            registrarAccion(solicitud, 'facturas.sustituir', { tipo: 'factura', id: original.id }, { motivo, cliente_fiscal: cuerpoObjeto(solicitud).cliente_fiscal ?? null })
            const respuesta: Schema<'SustitucionFactura'> = { original: detalle(original), nueva: detalle(nueva), tipo, nota_credito_id: notaId }
            return { status: 201, cuerpo: respuesta }
        })),

        /** Como `AnularNotaCredito` (§17): solo si su NCRE la rechazó la SAT en definitivo. */
        'POST /api/v1/notas-credito/:id/anular': conPermiso('facturas.anular_nota_credito', conIdempotencia((solicitud) => {
            const nota = bd.notasCredito.find(n => n.id === idDe(solicitud))
            if (!nota) {
                return noEncontrado('la nota de crédito')
            }
            const motivo = motivoDe(solicitud)
            if (Array.isArray(motivo)) {
                return datosInvalidos(motivo)
            }
            if (nota.anulada_en) {
                return conflicto('nota_anulada', 'Nota anulada', `La nota de crédito ${nota.id} ya está anulada`)
            }
            const ncre = dteDe('nota_credito', nota.id)
            if (!ncre || ncre.estado === 'anulado') {
                return conflicto('nota_sin_ncre_rechazada', 'Nota sin NCRE rechazada', `La nota de crédito ${nota.id} no tiene una NCRE rechazada por la SAT`)
            }
            if (ncre.estado === 'certificado' || ncre.estado === 'anulacion_pendiente') {
                return conflicto('ncre_certificada', 'NCRE certificada', `La NCRE de la nota ${nota.id} está certificada: se corrige con otro documento`)
            }
            if (ncre.estado !== 'rechazado' || !ncre.definitivo) {
                return dteEnProceso(ncre)
            }
            const momento = ahora()
            nota.anulada_en = momento
            const factura = bd.facturas.find(f => f.id === nota.factura_id)
            if (factura) {
                const pagado = Decimal.max(new Decimal(factura.pagado).minus(nota.monto), 0)
                Object.assign(factura, {
                    pagado: dinero(pagado),
                    acreditado: dinero(Decimal.max(new Decimal(factura.acreditado ?? '0').minus(nota.monto), 0)),
                    estado: estadoFactura(pagado, new Decimal(factura.total), factura.vence_en),
                    version: factura.version + 1,
                    updated_at: momento,
                })
            }
            const asiento = bd.asientos.find(a => a.id === nota.asiento_id)
            if (asiento) {
                bd.asientos.push(asientoReverso(siguienteId(bd.asientos), asiento, `Anulación de la nota de crédito ${nota.id} · ${motivo}`, momento, usuarioDe(solicitud)?.id ?? null))
            }
            registrarAccion(solicitud, 'facturas.anular_nota_credito', { tipo: 'nota_credito', id: nota.id }, { motivo })
            return { status: 200, cuerpo: vistaNota(nota) }
        })),

        'GET /api/v1/libro/integridad': conPermiso('libro.ver', (solicitud) => {
            const empresas = empresasDeLista(solicitud) ?? bd.empresas.map(e => e.id)
            return { status: 200, cuerpo: { data: empresas.map(id => integridadDe(id, solicitud)) } }
        }),
    }
}

/**
 * Anulación de una factura con DTE (`facturas.anular` + `fel.anular`, contrato §8.3): un DTE
 * certificado pasa a `anulacion_pendiente` y la factura se anula cuando el certificador confirma;
 * uno aún sin enviar se descarta. `null` = la factura no tiene DTE vivo (anulación de siempre).
 */
export function anularConFel(factura: Factura, motivo: string, solicitud: SolicitudFixture, revertir: () => void): RespuestaFixture | null {
    const dte = factura.dte_id ? bd.fel.dte.find(d => d.id === factura.dte_id) : undefined
    if (!dte || dte.estado === 'rechazado' || dte.estado === 'anulado') {
        return null
    }
    if (dte.estado === 'anulacion_pendiente') {
        return conflicto('anulacion_en_proceso', 'Anulación en proceso', `La anulación del DTE de la factura ${factura.id} ya se envió al certificador`)
    }
    if (dte.estado === 'enviando') {
        return dteEnProceso(dte)
    }
    const momento = ahora()
    if (dte.estado !== 'certificado') {
        // Aún sin enviar: se descarta y la factura se anula como siempre.
        Object.assign(dte, { estado: 'anulado', anulado_en: momento, motivo_anulacion: 'documento_anulado', version: dte.version + 1, updated_at: momento })
        reflejarEnFactura(factura, dte)
        return null
    }
    const usuario = usuarioDe(solicitud)
    if (!usuario?.permisos.includes('fel.anular')) {
        return problemaTipado(403, 'sin_permiso', 'Sin permiso', 'Falta el permiso fel.anular: la factura tiene DTE certificado')
    }
    Object.assign(dte, { estado: 'anulacion_pendiente', motivo_anulacion: motivo, version: dte.version + 1, updated_at: momento })
    reflejarEnFactura(factura, dte)
    registrarAccion(solicitud, 'facturas.anular', { tipo: 'factura', id: factura.id }, { motivo })
    diferir(DEMORA_WORKER_MS, () => {
        if (dte.estado !== 'anulacion_pendiente') {
            return
        }
        const confirmada = ahora()
        registrarIntento(bd.fel, dte, 'anular', 'anulado', confirmada, { resultado: true })
        Object.assign(dte, { estado: 'anulado', anulado_en: confirmada, version: dte.version + 1, updated_at: confirmada })
        Object.assign(factura, { estado: 'anulada', anulada_en: confirmada, motivo_anulacion: motivo, version: factura.version + 1, updated_at: confirmada })
        reflejarEnFactura(factura, dte)
        revertir()
    })
    return { status: 200, cuerpo: structuredClone(factura) }
}
