import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Tipo de plan (decisión del PM, 19 oct): `residencial`, `empresarial` o `dedicado`
 * (`network.planes.tipo`). Las reglas son **solo advertencias** (`warnings[]` en la respuesta de
 * crear o editar), nunca un 422:
 *
 * - `plan_dedicado_asimetrico`: un `dedicado` con bajada distinta de la subida.
 * - `plan_dedicado_compartido`: un `dedicado` con `reuso` (compartición 1:N) distinto de 1.
 * - `servicio_cliente_cf`: un servicio de un plan `empresarial` o `dedicado` cuyo cliente factura
 *   como CF (`tipo_documento_fiscal = 'cf'`).
 */
export const TIPOS_PLAN = ['residencial', 'empresarial', 'dedicado'] as const
export type TipoPlan = (typeof TIPOS_PLAN)[number]

export interface Advertencia {
    codigo: 'plan_dedicado_asimetrico' | 'plan_dedicado_compartido' | 'servicio_cliente_cf'
    mensaje: string
}

export function advertenciasPlan(plan: {
    tipo: TipoPlan
    bajada_kbps: number
    subida_kbps: number
    reuso: number
}): Advertencia[] {
    if (plan.tipo !== 'dedicado') return []
    const advertencias: Advertencia[] = []
    if (Number(plan.bajada_kbps) !== Number(plan.subida_kbps)) {
        advertencias.push({
            codigo: 'plan_dedicado_asimetrico',
            mensaje: `Plan dedicado asimétrico: ${plan.bajada_kbps} kbps de bajada y ${plan.subida_kbps} de subida`,
        })
    }
    if (Number(plan.reuso) !== 1) {
        advertencias.push({
            codigo: 'plan_dedicado_compartido',
            mensaje: `Plan dedicado con compartición 1:${plan.reuso}; un dedicado suele ser 1:1`,
        })
    }
    return advertencias
}

/** Advertencias de un servicio por el tipo de su plan y el documento fiscal de su cliente. */
export async function advertenciasServicio(
    cliente: QueryClientContract,
    servicioId: number,
): Promise<Advertencia[]> {
    const fila = (await cliente
        .from('core.servicios as s')
        .join('network.planes as p', 'p.id', 's.plan_id')
        .join('core.clientes as c', 'c.id', 's.cliente_id')
        .where('s.id', servicioId)
        .select('p.tipo', 'p.nombre', 'c.tipo_documento_fiscal')
        .first()) as { tipo: TipoPlan; nombre: string; tipo_documento_fiscal: string | null } | null
    if (!fila || fila.tipo === 'residencial' || fila.tipo_documento_fiscal !== 'cf') return []
    return [
        {
            codigo: 'servicio_cliente_cf',
            mensaje: `El plan ${fila.nombre} es ${fila.tipo} y el cliente factura como consumidor final (CF)`,
        },
    ]
}
