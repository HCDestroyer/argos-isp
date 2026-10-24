import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, paginar, registrarAccion } from '../comun'
import { fechaGuatemala } from '../libro/datos'

type Conciliacion = Schema<'ConciliacionPasarela'>

/** Dos corridas de la conciliación de la pasarela falsa: una limpia y otra con un monto distinto. */
export const conciliacionesPasarela: Conciliacion[] = [
    { id: 1, proveedor: 'falso', fecha: '2026-10-08', revisados: 3, conciliados: 3, cobros_conciliados: [1, 2, 3], diferencias: [], ejecutado_por: null, created_at: '2026-10-09T08:05:00.000Z' },
    {
        id: 2,
        proveedor: 'falso',
        fecha: '2026-10-14',
        revisados: 2,
        conciliados: 1,
        cobros_conciliados: [4],
        diferencias: [{ tipo: 'monto_distinto', cobro_id: 5, pago_id: 7001, id_proveedor: 'pf_0005', nuestro: '175.00', proveedor: '170.00', detalle: 'El proveedor reporta Q170.00 y el pago registrado es de Q175.00' }],
        ejecutado_por: null,
        created_at: '2026-10-15T08:05:00.000Z',
    },
]

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export const rutasProcesosFacturacion: RutasFixture = {
    /**
     * Como `EjecutarCorte` (A3), simplificado: evalúa los servicios no retirados (o solo `servicio_id`)
     * y no cambia ninguno; la evaluación real la prueba la API.
     */
    'POST /api/v1/facturas/corte': conPermiso('facturas.generar', conIdempotencia((solicitud) => {
        const servicioId = cuerpoObjeto(solicitud).servicio_id
        const servicios = bd.servicios.filter(s => s.estado !== 'retirado' && (typeof servicioId !== 'number' || s.id === servicioId))
        const horas = typeof servicioId === 'number' ? ['*'] : [...new Set(bd.plantillas.map(p => p.hora_corte.slice(0, 5)))].sort()
        const resultado: Schema<'ResultadoCorte'> = { horas, evaluados: servicios.length, cambiados: 0, errores: 0, vencimiento: { vencidas: 0, moras: 0, errores: 0, bloqueados: 0, bloqueos: [] } }
        registrarAccion(solicitud, 'servicios.corte', { tipo: 'servicio', id: typeof servicioId === 'number' ? servicioId : 0 }, { servicio_id: servicioId ?? null })
        return { status: 200, cuerpo: resultado }
    })),

    'GET /api/v1/pasarela/conciliaciones': conPermiso('pagos.ver', (solicitud) => {
        const fecha = solicitud.query.get('fecha')
        if (fecha && !FECHA.test(fecha)) {
            return datosInvalidos([{ field: 'fecha', message: 'Fecha inválida', rule: 'regex' }])
        }
        const filas = bd.conciliacionesPasarela.filter(c => !fecha || c.fecha === fecha).sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    /** Como `ConciliarPasarela` (A3): un día de Guatemala, por defecto ayer; la pasarela falsa no tiene cobros nuevos. */
    'POST /api/v1/pasarela/conciliar': conPermiso('facturas.generar', conIdempotencia((solicitud) => {
        const pedida = cuerpoObjeto(solicitud).fecha
        if (pedida !== undefined && (typeof pedida !== 'string' || !FECHA.test(pedida))) {
            return datosInvalidos([{ field: 'fecha', message: 'Fecha inválida', rule: 'regex' }])
        }
        const fecha = typeof pedida === 'string' ? pedida : fechaGuatemala(new Date(Date.now() - 86_400_000).toISOString())
        const corrida: Conciliacion = { id: siguienteId(bd.conciliacionesPasarela), proveedor: 'falso', fecha, revisados: 0, conciliados: 0, cobros_conciliados: [], diferencias: [], ejecutado_por: 1, created_at: ahora() }
        bd.conciliacionesPasarela.push(corrida)
        registrarAccion(solicitud, 'pasarela.conciliar', { tipo: 'conciliacion_pasarela', id: corrida.id }, { fecha })
        return { status: 200, cuerpo: corrida }
    })),
}
