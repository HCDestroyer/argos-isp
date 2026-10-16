import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, numeroQuery, paginar, registrarAccion, usuariosPorToken } from '../comun'
import { procesarPago } from '../facturacion/rutas'
import { archivosComprobante } from './datos'

type Comprobante = Schema<'Comprobante'>

const ESTADOS: readonly Comprobante['estado'][] = ['pendiente', 'aprobado', 'rechazado']

/** Como `Conflicto` de la API: 409 con `type` `urn:argosisp:problema:<codigo>`. */
function conflicto(codigo: string, titulo: string, detalle: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: titulo, status: 409, detail: detalle }
    return { status: 409, cuerpo }
}

function revisado(comprobante: Comprobante): RespuestaFixture {
    return conflicto('comprobante_revisado', 'Comprobante ya revisado', `El comprobante ${comprobante.id} ya fue ${comprobante.estado}; solo se revisan los pendientes`)
}

function usuarioDe(solicitud: SolicitudFixture): number | null {
    return solicitud.token ? (usuariosPorToken[solicitud.token]?.id ?? null) : null
}

/** Como `pendientesDelServicio` de `AprobarComprobante`: facturas con saldo del servicio, la más antigua primero. */
function pendientesDelServicio(servicioId: number): number[] {
    return bd.facturas
        .filter(f => f.servicio_id === servicioId && f.estado !== 'pagada' && f.estado !== 'anulada')
        .sort((a, b) => a.vence_en.localeCompare(b.vence_en) || a.periodo.localeCompare(b.periodo) || a.id - b.id)
        .map(f => f.id)
}

/** Espejo de `aprobarComprobanteValidator`: `facturas[]` de ids y `nota` de hasta 400. */
function validarAprobar(cuerpo: Record<string, unknown>): NonNullable<Problem['errors']> {
    const errores: NonNullable<Problem['errors']> = []
    if (cuerpo.facturas !== undefined && (!Array.isArray(cuerpo.facturas) || !cuerpo.facturas.every(f => Number.isInteger(f) && Number(f) > 0))) {
        errores.push({ field: 'facturas', message: 'Debe ser una lista de ids de factura', rule: 'array' })
    }
    if (typeof cuerpo.nota === 'string' && cuerpo.nota.trim().length > 400) {
        errores.push({ field: 'nota', message: 'Máximo 400 caracteres', rule: 'maxLength' })
    }
    return errores
}

export const rutasComprobantes: RutasFixture = {
    'GET /api/v1/comprobantes': conPermiso('comprobantes.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        const cliente = numeroQuery(solicitud, 'cliente_id')
        if (estado && !(ESTADOS as readonly string[]).includes(estado)) {
            return datosInvalidos([{ field: 'estado', message: 'Estado inválido', rule: 'enum' }])
        }
        // Como `listarComprobantes`: por id descendente.
        const filas = bd.comprobantes
            .filter(c => !estado || c.estado === estado)
            .filter(c => cliente === undefined || c.cliente_id === cliente)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/comprobantes/:id': conPermiso('comprobantes.ver', (solicitud) => {
        const comprobante = bd.comprobantes.find(c => c.id === idDe(solicitud))
        return comprobante ? { status: 200, cuerpo: comprobante } : noEncontrado('el comprobante')
    }),

    'GET /api/v1/comprobantes/:id/archivo': conPermiso('comprobantes.ver', (solicitud) => {
        const comprobante = bd.comprobantes.find(c => c.id === idDe(solicitud))
        const archivo = comprobante ? archivosComprobante[comprobante.id] : undefined
        if (!comprobante || !archivo) {
            return noEncontrado('el archivo del comprobante')
        }
        return { status: 200, cuerpo: archivo, contentType: comprobante.archivo_tipo }
    }),

    'POST /api/v1/comprobantes/:id/aprobar': conPermiso('comprobantes.aprobar', conIdempotencia((solicitud) => {
        const comprobante = bd.comprobantes.find(c => c.id === idDe(solicitud))
        if (!comprobante) {
            return noEncontrado('el comprobante')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = validarAprobar(cuerpo)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (comprobante.estado !== 'pendiente') {
            return revisado(comprobante)
        }
        const pedidas = Array.isArray(cuerpo.facturas) ? cuerpo.facturas.map(Number) : []
        const facturas = pedidas.length
            ? pedidas
            : (comprobante.servicio_id ? pendientesDelServicio(comprobante.servicio_id) : undefined)
        const nota = [`Comprobante ${comprobante.id}`, (typeof cuerpo.nota === 'string' ? cuerpo.nota.trim() : '') || comprobante.nota]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 500)
        // `RegistrarPago` anidada con los datos del comprobante (misma transacción en la API).
        const respuesta = procesarPago({
            ...solicitud,
            cuerpo: {
                cliente_id: comprobante.cliente_id,
                metodo: comprobante.metodo,
                monto: comprobante.monto,
                referencia: comprobante.referencia,
                cuenta_bancaria_id: comprobante.cuenta_bancaria_id,
                banco_origen_id: comprobante.banco_origen_id,
                nota,
                ...(facturas?.length ? { facturas } : {}),
            },
        })
        if (respuesta.status >= 300) {
            return respuesta
        }
        const pago = respuesta.cuerpo as Schema<'Pago'>
        const momento = ahora()
        Object.assign(comprobante, {
            estado: 'aprobado',
            pago_id: pago.id,
            verificado_por: usuarioDe(solicitud),
            verificado_en: momento,
            version: comprobante.version + 1,
            updated_at: momento,
        })
        registrarAccion(solicitud, 'comprobantes.aprobar', { tipo: 'comprobante', id: comprobante.id }, cuerpo)
        return { status: 200, cuerpo: { ...comprobante, pago } }
    })),

    'POST /api/v1/comprobantes/:id/rechazar': conPermiso('comprobantes.rechazar', conIdempotencia((solicitud) => {
        const comprobante = bd.comprobantes.find(c => c.id === idDe(solicitud))
        if (!comprobante) {
            return noEncontrado('el comprobante')
        }
        const { motivo } = cuerpoObjeto(solicitud)
        const texto = typeof motivo === 'string' ? motivo.trim() : ''
        if (texto.length < 3 || texto.length > 500) {
            return datosInvalidos([{ field: 'motivo', message: 'El motivo debe tener entre 3 y 500 caracteres', rule: 'minLength' }])
        }
        if (comprobante.estado !== 'pendiente') {
            return revisado(comprobante)
        }
        const momento = ahora()
        Object.assign(comprobante, {
            estado: 'rechazado',
            motivo_rechazo: texto,
            verificado_por: usuarioDe(solicitud),
            verificado_en: momento,
            version: comprobante.version + 1,
            updated_at: momento,
        })
        registrarAccion(solicitud, 'comprobantes.rechazar', { tipo: 'comprobante', id: comprobante.id }, { motivo: texto })
        return { status: 200, cuerpo: comprobante }
    })),
}
