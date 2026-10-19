import type { Schema } from '@argosisp/contracts'
import { bd } from '../bd'

type Advertencia = Schema<'Advertencia'>
type Plan = Schema<'Plan'>

export const TIPOS_PLAN: readonly NonNullable<Plan['tipo']>[] = ['residencial', 'empresarial', 'dedicado']

/** Como `advertenciasPlan` de A1 (`app/network/tipos_plan.ts`): un dedicado asimétrico o compartido. */
export function advertenciasPlan(plan: Pick<Plan, 'tipo' | 'bajada_kbps' | 'subida_kbps' | 'reuso'>): Advertencia[] {
    if (plan.tipo !== 'dedicado') {
        return []
    }
    const advertencias: Advertencia[] = []
    if (plan.bajada_kbps !== plan.subida_kbps) {
        advertencias.push({ codigo: 'plan_dedicado_asimetrico', mensaje: `Plan dedicado asimétrico: ${plan.bajada_kbps} kbps de bajada y ${plan.subida_kbps} de subida` })
    }
    if (plan.reuso !== 1) {
        advertencias.push({ codigo: 'plan_dedicado_compartido', mensaje: `Plan dedicado con compartición 1:${plan.reuso}; un dedicado suele ser 1:1` })
    }
    return advertencias
}

/** Como `advertenciasServicio` de A1: plan empresarial o dedicado de un cliente que factura como CF. */
export function advertenciasServicio(servicio: Pick<Schema<'Servicio'>, 'plan_id' | 'cliente_id'>): Advertencia[] {
    const plan = bd.planes.find(p => p.id === servicio.plan_id)
    const cliente = bd.clientes.find(c => c.id === servicio.cliente_id)
    const tipo = plan?.tipo ?? 'residencial'
    if (!plan || tipo === 'residencial' || cliente?.tipo_documento_fiscal !== 'cf') {
        return []
    }
    return [{ codigo: 'servicio_cliente_cf', mensaje: `El plan ${plan.nombre} es ${tipo} y el cliente factura como consumidor final (CF)` }]
}
