import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { verPlan, type PlanVista } from '#network/consultas/planes'
import { vincularExterno, type IdExterno } from '#core/ids_externos'
import { validarVelocidad, VELOCIDAD_POR_DEFECTO, type VelocidadPlan } from '#network/velocidad'
import { advertenciasPlan, type Advertencia, type TipoPlan } from '#network/tipos_plan'

export interface DatosPlan {
    nombre?: string
    precio?: string
    bajada_kbps?: number
    subida_kbps?: number
    bajada_limitada_kbps?: number
    subida_limitada_kbps?: number
    reuso?: number
    garantizado_pct?: number | null
    rafaga_bajada_kbps?: number | null
    rafaga_subida_kbps?: number | null
    rafaga_umbral_pct?: number
    rafaga_segundos?: number
    prioridad?: number
    dual_stack?: 'ambos' | 'v4' | 'v6'
    tamano_prefijo_delegado?: 64 | 56 | 48
    tipo?: TipoPlan
    global?: boolean
    activo?: boolean
}

export interface EntradaCrearPlan extends DatosPlan {
    /** id en un sistema de origen (importador); 409 `externo_duplicado` si ya está vinculado */
    externo?: IdExterno
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

/** 422 por campo si la velocidad no es coherente (`validarVelocidad`). */
export function exigirVelocidadValida(velocidad: VelocidadPlan, detalle?: string) {
    const errores = validarVelocidad(velocidad)
    if (errores.length > 0) {
        throw new ValidacionFallida(
            errores,
            detalle ? `${detalle}: ${errores[0]!.message}` : errores[0]!.message,
        )
    }
}

/**
 * Crea un plan (velocidades normal y limitada, precio, dual stack, tamaño del prefijo delegado).
 * `global`: disponible en todos los routers; si no, solo donde tenga implementación.
 * Velocidad (`contratos/velocidad.md`): reuso, garantizado, ráfaga y prioridad con los valores por
 * defecto del contrato; 422 por campo si no son coherentes.
 * `tipo` (`residencial` por defecto, `empresarial`, `dedicado`): la respuesta trae `warnings[]` si un
 * dedicado es asimétrico o compartido (`advertenciasPlan`); nunca es un 422.
 */
/** Plan con las advertencias de su tipo (`app/network/tipos_plan.ts`); nunca bloquean. */
export type PlanConAdvertencias = PlanVista & { warnings: Advertencia[] }

export default class CrearPlan extends DomainAction<EntradaCrearPlan, PlanConAdvertencias> {
    readonly nombre = 'planes.crear'

    protected async handle(entrada: EntradaCrearPlan, t: Transaccion): Promise<PlanConAdvertencias> {
        const { externo, ...input } = entrada
        const repetido = await t.trx.from('network.planes').where('nombre', input.nombre).first()
        if (repetido) throw new Conflicto(`Ya existe el plan ${input.nombre}`, 'plan_duplicado')
        exigirVelocidadValida({
            ...VELOCIDAD_POR_DEFECTO,
            ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        } as VelocidadPlan)
        const [fila] = (await t.trx
            .insertQuery()
            .table('network.planes')
            .insert(columnasPlan(input))
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('plan', fila!.id)
        await vincularExterno(t.trx, 'plan', fila!.id, externo)
        const plan = await verPlan(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'plan', id: plan.id }, null, plan)
        return { ...plan, warnings: advertenciasPlan(plan) }
    }
}
