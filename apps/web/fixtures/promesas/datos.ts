import type { Schema } from '@argosisp/contracts'
import { servicios } from '../servicios/datos'

type Promesa = Schema<'Promesa'>
type Verificacion = { regla: string, cumple: boolean, detalle: string }

/**
 * Forma de `resultado_evaluacion` que propone el panel a A3 (el contrato lo deja libre):
 * la decisión, la regla que decidió, el motivo legible y cada verificación hecha.
 */
export interface ResultadoEvaluacionFixture {
    [clave: string]: unknown
    decision: 'aprobada' | 'rechazada' | 'pendiente_aprobacion'
    regla: string
    motivo: string
    canal: Promesa['canal']
    verificaciones: Verificacion[]
}

function servicioDe(clienteId: number): Schema<'Servicio'> {
    const servicio = servicios.find(s => s.cliente_id === clienteId && !s.user_ppp?.endsWith('-b'))
    if (!servicio) {
        throw new Error(`Fixture: el cliente ${clienteId} no tiene servicio`)
    }
    return servicio
}

function promesa(id: number, clienteId: number, datos: Pick<Promesa, 'vence_en' | 'monto' | 'estado' | 'canal' | 'aprobada_por' | 'created_at'>, evaluacion: ResultadoEvaluacionFixture): Promesa {
    const servicio = servicioDe(clienteId)
    return {
        id,
        servicio_id: servicio.id,
        cliente_id: clienteId,
        ...datos,
        resultado_evaluacion: evaluacion,
        version: 1,
        updated_at: datos.created_at,
    }
}

const BASICAS: Verificacion[] = [
    { regla: 'habilitadas', cumple: true, detalle: 'La plantilla permite promesas' },
    { regla: 'canal', cumple: true, detalle: 'El canal está permitido' },
]

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
    }, {
        decision: 'aprobada',
        regla: 'plazo_max_dias',
        motivo: 'Plazo de 3 días dentro del máximo de 3 del canal portal',
        canal: 'portal',
        verificaciones: [...BASICAS, { regla: 'plazo_max_dias', cumple: true, detalle: '3 de 3 días' }],
    }),
    promesa(2, 17, {
        vence_en: '2026-10-05T05:59:59.000Z',
        monto: '200.00',
        estado: 'incumplida',
        canal: 'operador',
        aprobada_por: null,
        created_at: '2026-10-01T15:00:00.000Z',
    }, {
        decision: 'aprobada',
        regla: 'plazo_max_dias',
        motivo: 'Plazo de 4 días dentro del máximo de 5',
        canal: 'operador',
        verificaciones: [...BASICAS, { regla: 'plazo_max_dias', cumple: true, detalle: '4 de 5 días' }],
    }),
    promesa(3, 12, {
        vence_en: '2026-10-18T05:59:59.000Z',
        monto: '175.00',
        estado: 'activa',
        canal: 'operador',
        aprobada_por: null,
        created_at: '2026-10-14T17:30:00.000Z',
    }, {
        decision: 'aprobada',
        regla: 'plazo_max_dias',
        motivo: 'Plazo de 3 días dentro del máximo de 5',
        canal: 'operador',
        verificaciones: [...BASICAS, { regla: 'plazo_max_dias', cumple: true, detalle: '3 de 5 días' }, { regla: 'max_por_periodo', cumple: true, detalle: '1 de 1 en el periodo' }],
    }),
    promesa(4, 6, {
        vence_en: '2026-10-20T05:59:59.000Z',
        monto: '450.00',
        estado: 'pendiente_aprobacion',
        canal: 'operador',
        aprobada_por: null,
        created_at: '2026-10-15T15:10:00.000Z',
    }, {
        decision: 'pendiente_aprobacion',
        regla: 'canales.operador.requiere_aprobacion',
        motivo: 'La plantilla pide aprobación para las promesas del canal operador',
        canal: 'operador',
        verificaciones: [...BASICAS, { regla: 'plazo_max_dias', cumple: true, detalle: '4 de 5 días' }, { regla: 'requiere_aprobacion', cumple: false, detalle: 'Necesita un supervisor' }],
    }),
]
