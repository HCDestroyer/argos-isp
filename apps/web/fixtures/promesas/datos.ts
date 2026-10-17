import type { Schema } from '@argosisp/contracts'
import { servicios } from '../servicios/datos'

type Promesa = Schema<'Promesa'>
type Evaluacion = Schema<'EvaluacionPromesa'>
type Regla = Schema<'ReglaEvaluada'>

function servicioDe(clienteId: number): Schema<'Servicio'> {
    const servicio = servicios.find(s => s.cliente_id === clienteId && !s.user_ppp?.endsWith('-b'))
    if (!servicio) {
        throw new Error(`Fixture: el cliente ${clienteId} no tiene servicio`)
    }
    return servicio
}

function promesa(id: number, clienteId: number, datos: Pick<Promesa, 'vence_en' | 'monto' | 'estado' | 'canal' | 'aprobada_por' | 'created_at'>, resultado: Evaluacion): Promesa {
    const servicio = servicioDe(clienteId)
    return {
        id,
        // Multiempresa (A3): la empresa del servicio.
        empresa_id: servicio.empresa_id,
        servicio_id: servicio.id,
        cliente_id: clienteId,
        ...datos,
        resultado_evaluacion: resultado,
        version: 1,
        updated_at: datos.created_at,
    }
}

function basicas(canal: Promesa['canal'], debe: string): Regla[] {
    return [
        { regla: 'habilitadas', ok: true, valor: null, limite: true, origen: 'general', detalle: 'La plantilla admite promesas' },
        { regla: 'canal_permitido', ok: true, valor: canal, limite: true, origen: canal, detalle: `El canal ${canal} puede crear promesas` },
        { regla: 'sin_deuda', ok: true, valor: debe, limite: null, origen: 'general', detalle: `El servicio debe Q${debe}` },
    ]
}

function plazo(dias: number, maximo: number, origen: Regla['origen'] = 'general'): Regla {
    return { regla: 'plazo_max_dias', ok: dias <= maximo, valor: dias, limite: maximo, origen, detalle: `Vence en ${dias} ${dias === 1 ? 'día' : 'días'} (máximo ${maximo})` }
}

function cupo(llevadas: number, maximo: number): Regla {
    return { regla: 'max_por_periodo', ok: llevadas < maximo, valor: llevadas, limite: maximo, origen: 'general', detalle: `Lleva ${llevadas} ${llevadas === 1 ? 'promesa' : 'promesas'} en el periodo (máximo ${maximo})` }
}

/** `Schema<'EvaluacionPromesa'>` como la deja `evaluarPromesa` (A3) al crear la promesa. */
function evaluacion(datos: Pick<Evaluacion, 'resultado' | 'regla' | 'motivo' | 'canal' | 'evaluada_en' | 'reglas'> & Partial<Evaluacion> & { debe: string }): Evaluacion {
    const { debe, ...resto } = datos
    return {
        deuda: { pendiente: debe, vencida: debe, pagado_pendientes: '0.00', facturas_vencidas: 1 },
        historial: { ventana: 6, resueltas: 0, cumplidas: 0, cumplimiento_pct: null },
        siguiente_facturacion: '2026-11-01',
        ...resto,
    }
}

/**
 * Promesas iniciales: la activa del cliente 12 (servicio con `promesa_activa`), una pendiente de
 * aprobación de una empresa y dos del historial (cumplida e incumplida).
 */
export const promesas: Promesa[] = [
    promesa(1, 5, {
        vence_en: '2026-09-18T05:59:59.000Z',
        monto: '150.00',
        estado: 'cumplida',
        canal: 'portal',
        aprobada_por: null,
        created_at: '2026-09-15T16:00:00.000Z',
    }, evaluacion({
        resultado: 'aprobada',
        regla: null,
        motivo: 'Cumple todas las reglas de promesa de la plantilla',
        canal: 'portal',
        evaluada_en: '2026-09-15T16:00:00.000Z',
        debe: '150.00',
        reglas: [...basicas('portal', '150.00'), plazo(3, 3, 'portal'), cupo(0, 1)],
        siguiente_facturacion: '2026-10-01',
        cierre: { estado: 'cumplida', en: '2026-09-17T20:00:00.000Z', pagado: '150.00', deuda_vencida: '0.00' },
    })),
    promesa(2, 17, {
        vence_en: '2026-10-05T05:59:59.000Z',
        monto: '200.00',
        estado: 'incumplida',
        canal: 'operador',
        aprobada_por: null,
        created_at: '2026-10-01T15:00:00.000Z',
    }, evaluacion({
        resultado: 'aprobada',
        regla: null,
        motivo: 'Cumple todas las reglas de promesa de la plantilla',
        canal: 'operador',
        evaluada_en: '2026-10-01T15:00:00.000Z',
        debe: '200.00',
        reglas: [...basicas('operador', '200.00'), plazo(4, 5), cupo(0, 1)],
        cierre: { estado: 'incumplida', en: '2026-10-05T06:00:00.000Z', pagado: '0.00', deuda_vencida: '200.00' },
    })),
    promesa(3, 12, {
        vence_en: '2026-10-18T05:59:59.000Z',
        monto: '175.00',
        estado: 'activa',
        canal: 'operador',
        aprobada_por: null,
        created_at: '2026-10-14T17:30:00.000Z',
    }, evaluacion({
        resultado: 'aprobada',
        regla: null,
        motivo: 'Cumple todas las reglas de promesa de la plantilla',
        canal: 'operador',
        evaluada_en: '2026-10-14T17:30:00.000Z',
        debe: '175.00',
        reglas: [...basicas('operador', '175.00'), plazo(3, 5), cupo(0, 1)],
    })),
    promesa(4, 6, {
        vence_en: '2026-10-20T05:59:59.000Z',
        monto: '450.00',
        estado: 'pendiente_aprobacion',
        canal: 'operador',
        aprobada_por: null,
        created_at: '2026-10-15T15:10:00.000Z',
    }, evaluacion({
        resultado: 'pendiente_aprobacion',
        regla: 'requiere_aprobacion',
        motivo: 'Las promesas del canal operador requieren aprobación de un supervisor',
        canal: 'operador',
        evaluada_en: '2026-10-15T15:10:00.000Z',
        debe: '450.00',
        reglas: [
            ...basicas('operador', '450.00'),
            plazo(4, 5),
            cupo(0, 1),
            { regla: 'requiere_aprobacion', ok: true, valor: 'operador', limite: true, origen: 'operador', detalle: 'Las promesas del canal operador requieren aprobación de un supervisor' },
        ],
    })),
]
