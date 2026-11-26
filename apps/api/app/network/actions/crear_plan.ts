import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { verPlan, type PlanVista } from '#network/consultas/planes'
import { vincularExterno, type IdExterno } from '#core/ids_externos'
import { validarVelocidad, VELOCIDAD_POR_DEFECTO, type VelocidadPlan } from '#network/velocidad'
import { advertenciasPlan, type Advertencia, type TipoPlan } from '#network/tipos_plan'
import {
    capacidadesDe,
    componentesPorDefecto,
    TIPO_SERVICIO_POR_DEFECTO,
    validarPlanPorTipo,
    type ComponenteServicio,
    type TipoServicio,
} from '#core/tipos_servicio'

export interface DatosPlan {
    nombre?: string
    precio?: string
    /** null (o ausente) solo en un plan de `cable`: no tiene velocidad */
    bajada_kbps?: number | null
    subida_kbps?: number | null
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
    /** `internet` (por defecto), `cable`, `iptv` o `mixto` (`contratos/tipos-servicio.md` §2) */
    tipo_servicio?: TipoServicio
    /** solo `mixto` (dos o tres); en los simples es el propio tipo y se completa solo */
    componentes?: ComponenteServicio[]
    /** solo `mixto`: línea de cable de la factura */
    precio_cable?: string | null
    /** solo `mixto`: línea de IPTV de la factura (sin internet, el resto del precio) */
    precio_iptv?: string | null
    /** plan empresarial que trae una IP pública (decisión del PM 30) */
    incluye_ip_publica?: boolean
    global?: boolean
    activo?: boolean
}

export interface EntradaCrearPlan extends DatosPlan {
    /** id en un sistema de origen (importador); 409 `externo_duplicado` si ya está vinculado */
    externo?: IdExterno
    nombre: string
    precio: string
}

export function columnasPlan(datos: DatosPlan): Record<string, unknown> {
    return Object.fromEntries(Object.entries(datos).filter(([, valor]) => valor !== undefined))
}

/**
 * Tipo de servicio completo del plan: el tipo (`internet` por defecto) y sus componentes (el propio
 * tipo en los simples). 422 por campo si no son coherentes con el precio, el desglose y la velocidad
 * (`validarPlanPorTipo`). `propuesto` es el plan resultante (en una edición, el actual con los cambios).
 */
export function exigirTipoPlanValido(
    propuesto: {
        tipo_servicio?: TipoServicio
        componentes?: readonly string[] | null
        precio: string
        precio_cable?: string | null
        precio_iptv?: string | null
        bajada_kbps?: number | null
        subida_kbps?: number | null
        bajada_limitada_kbps?: number | null
        subida_limitada_kbps?: number | null
    },
    /** `exigirLimitadas`: solo al crear (un plan viejo con limitada en 0 se sigue editando) */
    opciones: { exigirLimitadas: boolean },
): { tipo_servicio: TipoServicio; componentes: ComponenteServicio[] } {
    const tipo = propuesto.tipo_servicio ?? TIPO_SERVICIO_POR_DEFECTO
    const errores = validarPlanPorTipo({
        tipo_servicio: tipo,
        componentes: propuesto.componentes,
        precio: propuesto.precio,
        precio_cable: propuesto.precio_cable,
        precio_iptv: propuesto.precio_iptv,
        bajada_kbps: propuesto.bajada_kbps,
        subida_kbps: propuesto.subida_kbps,
    })
    if (
        opciones.exigirLimitadas &&
        capacidadesDe(tipo, propuesto.componentes as ComponenteServicio[] | null).requiereVelocidad
    ) {
        // sin velocidad limitada el servicio limitado navegaría a velocidad completa (aaa la usa al limitar)
        for (const campo of ['bajada_limitada_kbps', 'subida_limitada_kbps'] as const) {
            if (!propuesto[campo]) {
                errores.push({
                    field: campo,
                    message: 'La velocidad limitada es obligatoria y mayor que 0',
                    rule: 'required',
                })
            }
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores, errores[0]!.message)
    return {
        tipo_servicio: tipo,
        componentes:
            tipo === 'mixto'
                ? [...(propuesto.componentes as ComponenteServicio[])]
                : componentesPorDefecto(tipo),
    }
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
 * `tipo_servicio` (`internet` por defecto, `cable`, `iptv`, `mixto`; `contratos/tipos-servicio.md`):
 * 422 si el mixto no trae dos o tres componentes, si `precio_cable + precio_iptv` no cabe en el precio
 * o si falta la velocidad en un plan que no sea de cable.
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
        const tipoServicio = exigirTipoPlanValido(input, { exigirLimitadas: true })
        // un plan de cable no tiene velocidad: nada que validar y las limitadas quedan en 0 (DEFAULT)
        if (capacidadesDe(tipoServicio.tipo_servicio, tipoServicio.componentes).requiereVelocidad) {
            exigirVelocidadValida({
                ...VELOCIDAD_POR_DEFECTO,
                ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
            } as VelocidadPlan)
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('network.planes')
            .insert({ ...columnasPlan(input), ...tipoServicio })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('plan', fila!.id)
        await vincularExterno(t.trx, 'plan', fila!.id, externo)
        const plan = await verPlan(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'plan', id: plan.id }, null, plan)
        return { ...plan, warnings: advertenciasPlan(plan) }
    }
}
