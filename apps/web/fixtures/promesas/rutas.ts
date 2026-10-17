import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, numeroQuery, paginar, problema, registrarAccion, usuariosPorToken } from '../comun'
import { evaluarPromesa } from './simulador'

type Promesa = Schema<'Promesa'>
type Canal = Promesa['canal']

const CANALES: readonly Canal[] = ['portal', 'ia', 'operador', 'supervisor']
const ESTADOS: readonly Promesa['estado'][] = ['activa', 'cumplida', 'incumplida', 'cancelada', 'pendiente_aprobacion', 'rechazada']
const MONTO = /^\d{1,12}(\.\d{1,2})?$/

function esCanal(valor: unknown): valor is Canal {
    return typeof valor === 'string' && (CANALES as readonly string[]).includes(valor)
}

/**
 * Lo que hace `evaluarEstadoServicio` tras una promesa activa: un servicio limitado o suspendido
 * por deuda (no a mano) vuelve a `activo` con la bandera `promesa_activa`.
 */
function activarPorPromesa(servicioId: number): void {
    const indice = bd.servicios.findIndex(s => s.id === servicioId)
    const servicio = bd.servicios[indice]
    if (!servicio) {
        return
    }
    const reactivar = !servicio.suspension_manual && (servicio.estado === 'suspendido' || servicio.estado === 'limitado')
    bd.servicios[indice] = {
        ...servicio,
        estado: reactivar ? 'activo' : servicio.estado,
        promesa_activa: true,
        version: servicio.version + 1,
        updated_at: ahora(),
    }
}

/** Problem con `type` `urn:argosisp:problema:<codigo>`, como `ReglaNegocio` y `Conflicto` de la API. */
function problemaCodigo(status: number, codigo: string, titulo: string, detalle: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: titulo, status, detail: detalle }
    return { status, cuerpo }
}

/** Como `exigirEstadoPromesa` de la API: 409 `promesa_no_pendiente`. */
function noPendiente(promesa: Schema<'Promesa'>, permitidos: string[], accion: string): RespuestaFixture {
    const cuerpo: Problem = {
        type: 'urn:argosisp:problema:promesa_no_pendiente',
        title: 'Estado de la promesa',
        status: 409,
        detail: `La promesa ${promesa.id} está ${promesa.estado}; solo se puede ${accion} si está ${permitidos.join(' o ')}`,
    }
    return { status: 409, cuerpo }
}

/**
 * Como `RechazarPromesa` / `CancelarPromesa` (A3): motivo obligatorio, `resultado_evaluacion.cierre`
 * y, si estaba activa, el servicio pierde la bandera y vuelve a evaluarse (aquí: vuelve a cortarse
 * si tiene facturas vencidas).
 */
function cerrar(solicitud: SolicitudFixture, estado: 'rechazada' | 'cancelada', permitidos: string[], accion: string): RespuestaFixture {
    const promesa = bd.promesas.find(p => p.id === idDe(solicitud))
    if (!promesa) {
        return noEncontrado('la promesa')
    }
    const { motivo } = cuerpoObjeto(solicitud)
    const texto = typeof motivo === 'string' ? motivo.trim() : ''
    if (texto.length < 3) {
        return datosInvalidos([{ field: 'motivo', message: 'El motivo es obligatorio (mínimo 3 caracteres)', rule: 'required' }])
    }
    if (!permitidos.includes(promesa.estado)) {
        return noPendiente(promesa, permitidos, accion)
    }
    const estabaActiva = promesa.estado === 'activa'
    const momento = ahora()
    Object.assign(promesa, {
        estado,
        resultado_evaluacion: { ...(promesa.resultado_evaluacion ?? {}), cierre: { estado, en: momento, motivo: texto, por: usuario(solicitud) } },
        version: promesa.version + 1,
        updated_at: momento,
    })
    if (estabaActiva) {
        const indice = bd.servicios.findIndex(s => s.id === promesa.servicio_id)
        const servicio = bd.servicios[indice]
        if (servicio) {
            const vencidas = bd.facturas.some(f => f.servicio_id === servicio.id && f.estado === 'vencida')
            bd.servicios[indice] = { ...servicio, promesa_activa: false, estado: vencidas && servicio.estado === 'activo' ? 'suspendido' : servicio.estado, version: servicio.version + 1, updated_at: momento }
        }
    }
    registrarAccion(solicitud, `promesas.${accion}`, { tipo: 'promesa', id: promesa.id }, { motivo: texto })
    return { status: 200, cuerpo: promesa }
}

function usuario(solicitud: SolicitudFixture): number | null {
    return solicitud.token ? (usuariosPorToken[solicitud.token]?.id ?? null) : null
}

/** Promesas de pago (hoy 501 en la API: A3 las implementa el día 4). */
export const rutasPromesas: RutasFixture = {
    'GET /api/v1/promesas': conPermiso('promesas.ver', (solicitud) => {
        const servicio = numeroQuery(solicitud, 'servicio_id')
        const cliente = numeroQuery(solicitud, 'cliente_id')
        const estado = solicitud.query.get('estado')
        if (estado && !(ESTADOS as readonly string[]).includes(estado)) {
            return datosInvalidos([{ field: 'estado', message: 'Estado inválido', rule: 'enum' }])
        }
        const filas = bd.promesas
            .filter(p => servicio === undefined || p.servicio_id === servicio)
            .filter(p => cliente === undefined || p.cliente_id === cliente)
            .filter(p => !estado || p.estado === estado)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'POST /api/v1/promesas': conPermiso('promesas.crear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const servicio = bd.servicios.find(s => s.id === cuerpo.servicio_id)
        const vence = typeof cuerpo.vence_en === 'string' ? new Date(cuerpo.vence_en) : null
        const errores = []
        if (!servicio) {
            errores.push({ field: 'servicio_id', message: 'El servicio no existe', rule: 'exists' })
        }
        if (!vence || Number.isNaN(vence.getTime())) {
            errores.push({ field: 'vence_en', message: 'Fecha y hora inválidas', rule: 'date' })
        }
        else if (vence.getTime() <= Date.now()) {
            errores.push({ field: 'vence_en', message: 'La promesa debe vencer en el futuro', rule: 'after' })
        }
        if (typeof cuerpo.monto !== 'string' || !MONTO.test(cuerpo.monto) || new Decimal(cuerpo.monto).lte(0)) {
            errores.push({ field: 'monto', message: 'El monto debe ser mayor que cero, con hasta 2 decimales', rule: 'regex' })
        }
        if (cuerpo.canal !== undefined && !esCanal(cuerpo.canal)) {
            errores.push({ field: 'canal', message: 'Canal inválido', rule: 'enum' })
        }
        if (errores.length || !servicio || !vence) {
            return datosInvalidos(errores)
        }
        if (servicio.estado === 'retirado') {
            return problema(422, 'Regla de negocio', 'El servicio está retirado')
        }
        if (!bd.plantillas.some(p => p.id === servicio.plantilla_facturacion_id)) {
            return problemaCodigo(422, 'sin_plantilla', 'Regla de negocio', 'El servicio no tiene plantilla de facturación')
        }
        // Como `CrearPromesaPago` (A3): una sola promesa abierta por servicio (409 `promesa_abierta`).
        const abierta = bd.promesas.find(p => p.servicio_id === servicio.id && (p.estado === 'activa' || p.estado === 'pendiente_aprobacion'))
        if (abierta) {
            return problemaCodigo(409, 'promesa_abierta', 'Promesa abierta', `El servicio ${servicio.id} ya tiene la promesa ${abierta.id} ${abierta.estado === 'activa' ? 'activa' : 'pendiente de aprobación'}`)
        }
        const canal = esCanal(cuerpo.canal) ? cuerpo.canal : 'operador'
        const monto = new Decimal(String(cuerpo.monto))
        const pendiente = bd.facturas
            .filter(f => f.servicio_id === servicio.id && (f.estado === 'emitida' || f.estado === 'vencida' || f.estado === 'parcial'))
            .reduce((suma, f) => suma.plus(f.total).minus(f.pagado), new Decimal(0))
        if (pendiente.gt(0) && monto.gt(pendiente)) {
            return datosInvalidos([{ field: 'monto', message: `El monto supera la deuda pendiente del servicio (Q${pendiente.toFixed(2)})`, rule: 'monto_maximo' }])
        }
        const evaluacion = evaluarPromesa(servicio, canal, vence, monto)
        const estado: Promesa['estado'] = evaluacion.resultado === 'aprobada' ? 'activa' : evaluacion.resultado
        const momento = ahora()
        const nueva: Promesa = {
            id: siguienteId(bd.promesas),
            servicio_id: servicio.id,
            cliente_id: servicio.cliente_id,
            vence_en: vence.toISOString(),
            monto: monto.toFixed(2),
            estado,
            canal,
            aprobada_por: null,
            resultado_evaluacion: evaluacion,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.promesas.push(nueva)
        if (estado === 'activa') {
            activarPorPromesa(servicio.id)
        }
        registrarAccion(solicitud, 'promesas.crear', { tipo: 'promesa', id: nueva.id }, { servicio_id: servicio.id, vence_en: nueva.vence_en, monto: nueva.monto, canal })
        return { status: 201, cuerpo: nueva }
    })),

    'POST /api/v1/promesas/:id/aprobar': conPermiso('promesas.aprobar', conIdempotencia((solicitud) => {
        const promesa = bd.promesas.find(p => p.id === idDe(solicitud))
        if (!promesa) {
            return noEncontrado('la promesa')
        }
        if (promesa.estado !== 'pendiente_aprobacion') {
            return noPendiente(promesa, ['pendiente_aprobacion'], 'aprobar')
        }
        const { nota } = cuerpoObjeto(solicitud)
        const momento = ahora()
        const aprobacion: Schema<'AprobacionPromesa'> = { por: usuario(solicitud), en: momento, nota: typeof nota === 'string' && nota.trim() ? nota.trim() : null }
        Object.assign(promesa, {
            estado: 'activa',
            aprobada_por: usuario(solicitud),
            resultado_evaluacion: { ...(promesa.resultado_evaluacion ?? {}), aprobacion },
            version: promesa.version + 1,
            updated_at: momento,
        })
        activarPorPromesa(promesa.servicio_id)
        registrarAccion(solicitud, 'promesas.aprobar', { tipo: 'promesa', id: promesa.id }, { nota: typeof nota === 'string' ? nota : null })
        return { status: 200, cuerpo: promesa }
    })),

    'POST /api/v1/promesas/:id/rechazar': conPermiso('promesas.rechazar', conIdempotencia(solicitud => cerrar(solicitud, 'rechazada', ['pendiente_aprobacion'], 'rechazar'))),

    'POST /api/v1/promesas/:id/cancelar': conPermiso('promesas.cancelar', conIdempotencia(solicitud => cerrar(solicitud, 'cancelada', ['activa', 'pendiente_aprobacion'], 'cancelar'))),
}
