import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { verPlan, type PlanVista } from '#network/consultas/planes'

export interface DatosPlan {
    nombre?: string
    precio?: string
    bajada_kbps?: number
    subida_kbps?: number
    bajada_limitada_kbps?: number
    subida_limitada_kbps?: number
    reuso?: number
    dual_stack?: 'ambos' | 'v4' | 'v6'
    tamano_prefijo_delegado?: 64 | 56 | 48
    global?: boolean
    activo?: boolean
}

export interface EntradaCrearPlan extends DatosPlan {
    nombre: string
    precio: string
    bajada_kbps: number
    subida_kbps: number
    bajada_limitada_kbps: number
    subida_limitada_kbps: number
}

export function columnasPlan(datos: DatosPlan): Record<string, unknown> {
    return Object.fromEntries(Object.entries(datos).filter(([, valor]) => valor !== undefined))
}

/**
 * Crea un plan (velocidades normal y limitada, precio, dual stack, tamaño del prefijo delegado).
 * `global`: disponible en todos los routers; si no, solo donde tenga implementación.
 */
export default class CrearPlan extends DomainAction<EntradaCrearPlan, PlanVista> {
    readonly nombre = 'planes.crear'

    protected async handle(input: EntradaCrearPlan, t: Transaccion): Promise<PlanVista> {
        const repetido = await t.trx.from('network.planes').where('nombre', input.nombre).first()
        if (repetido) throw new Conflicto(`Ya existe el plan ${input.nombre}`, 'plan_duplicado')
        const [fila] = (await t.trx
            .insertQuery()
            .table('network.planes')
            .insert(columnasPlan(input))
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('plan', fila!.id)
        const plan = await verPlan(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'plan', id: plan.id }, null, plan)
        return plan
    }
}
