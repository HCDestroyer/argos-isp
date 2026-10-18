import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, idDe, noEncontrado, numeroQuery, paginar, registrarAccion, usuariosPorToken } from '../comun'
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

function nombreUsuarioDe(solicitud: SolicitudFixture): string | null {
    return solicitud.token ? (usuariosPorToken[solicitud.token]?.nombre ?? null) : null
}

const METODOS: readonly Comprobante['metodo'][] = ['deposito', 'transferencia', 'ach', 'remesa']
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** Como `resumenComprobantes` (A3): total y monto de lo filtrado; pendientes sin el filtro de estado. */
function resumenDe(filtradas: readonly Comprobante[], sinEstado: readonly Comprobante[]): Schema<'ResumenComprobantes'> {
    const suma = (filas: readonly Comprobante[]) => filas.reduce((total, c) => total.plus(c.monto), new Decimal(0)).toFixed(2)
    const pendientes = sinEstado.filter(c => c.estado === 'pendiente')
    return { total: filtradas.length, monto: suma(filtradas), pendientes: pendientes.length, monto_pendiente: suma(pendientes) }
}

/** Como `pendientesDelServicio` de `AprobarComprobante`: facturas con saldo del servicio, la más antigua primero. */
function pendientesDelServicio(servicioId: number): number[] {
    return bd.facturas
        .filter(f => f.servicio_id === servicioId && f.estado !== 'pagada' && f.estado !== 'anulada' && f.estado !== 'por_certificar')
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
        const metodo = solicitud.query.get('metodo')
        const cuenta = numeroQuery(solicitud, 'cuenta_bancaria_id')
        const desde = solicitud.query.get('desde')
        const hasta = solicitud.query.get('hasta')
        const errores: NonNullable<Problem['errors']> = []
        if (estado && !(ESTADOS as readonly string[]).includes(estado)) {
            errores.push({ field: 'estado', message: 'Estado inválido', rule: 'enum' })
        }
        if (metodo && !(METODOS as readonly string[]).includes(metodo)) {
            errores.push({ field: 'metodo', message: 'Método inválido', rule: 'enum' })
        }
        for (const [campo, valor] of [['desde', desde], ['hasta', hasta]] as const) {
            if (valor && !FECHA.test(valor)) {
                errores.push({ field: campo, message: 'Fecha inválida', rule: 'regex' })
            }
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        // Como `listarComprobantes`: por id descendente; el resumen cubre todas las páginas.
        const sinEstado = deLaEmpresa(bd.comprobantes, solicitud)
            .filter(c => cliente === undefined || c.cliente_id === cliente)
            .filter(c => !metodo || c.metodo === metodo)
            .filter(c => cuenta === undefined || c.cuenta_bancaria_id === cuenta)
            .filter(c => !desde || c.fecha_deposito >= desde)
            .filter(c => !hasta || c.fecha_deposito <= hasta)
            .sort((a, b) => b.id - a.id)
        const filas = sinEstado.filter(c => !estado || c.estado === estado)
        const cuerpo: Schema<'PaginaComprobantes'> = { ...paginar(filas, solicitud), resumen: resumenDe(filas, sinEstado) }
        return { status: 200, cuerpo }
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
            verificado_por_nombre: nombreUsuarioDe(solicitud),
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
            verificado_por_nombre: nombreUsuarioDe(solicitud),
            verificado_en: momento,
            version: comprobante.version + 1,
            updated_at: momento,
        })
        registrarAccion(solicitud, 'comprobantes.rechazar', { tipo: 'comprobante', id: comprobante.id }, { motivo: texto })
        return { status: 200, cuerpo: comprobante }
    })),
}
