import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import { auditableRouter } from '#network/actions/crear_router'
import { verRouter, type RouterVista } from '#network/consultas/routers'
import { verImplementacion, type PlanRouterVista } from '#network/consultas/planes'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import {
    capasCambiadas,
    controlDerivado,
    leerExcepcion,
    validarEstrategias,
    type EstrategiasRouter,
    type ExcepcionEstrategia,
    type PlanValidacion,
    type ResultadoValidacion,
} from '#network/estrategia_velocidad'

/**
 * Cambiar la estrategia de control de velocidad por capas (`contratos/control-velocidad.md` §4).
 * Dos acciones con el permiso del control de velocidad de hoy (`routers.cambiar_control_velocidad`):
 * la del router (una estrategia completa por tipo de conexión) y la excepción de un plan en ese router.
 *
 * - Valida la matriz de combinaciones con todo lo que queda en el router (la del router y las de sus
 *   planes): una combinación inválida → 422 con el porqué en `errors[]`.
 * - Solo cambia los campos (control optimista por `version`), los audita (diff en `audit.cambios`) y
 *   emite `router.estrategia_cambiada`; lo ejecuta en el router el worker de RouterOS por lotes (crear
 *   lo nuevo, mover, borrar lo viejo). Las sesiones PPPoE abiertas conservan lo que tenían hasta
 *   reconectar, salvo `reconectar: true`.
 * - Después del COMMIT reescribe `aaa:user:*` de los servicios afectados (perfil y rate-limit).
 * - Sin cambios: responde lo mismo, sin evento.
 */

export interface EntradaEstrategiaRouter {
    id: number
    version: number
    estrategia_velocidad: EstrategiasRouter
    motivo?: string
    reconectar?: boolean
}

export interface EntradaEstrategiaPlan {
    plan_id: number
    router_id: number
    /** de la implementación `planes_routers`; obligatoria si ya existe */
    version?: number
    estrategia_velocidad: ExcepcionEstrategia | null
    motivo?: string
    reconectar?: boolean
}

interface FilaPlanRouter {
    plan_id: number
    reuso: number
    estrategia_velocidad: unknown
}

/** Planes del router con su reuso efectivo y su excepción (para la matriz). */
export async function planesParaValidar(
    routerId: number,
    cliente: QueryClientContract,
): Promise<PlanValidacion[]> {
    const filas = (await cliente
        .from('network.planes as p')
        .leftJoin('network.planes_routers as pr', (j) =>
            j.on('pr.plan_id', '=', 'p.id').andOnVal('pr.router_id', '=', routerId),
        )
        .where((q) =>
            q
                .whereNotNull('pr.id')
                .orWhereExists((s) =>
                    s
                        .from('core.servicios as s')
                        .whereRaw('s.plan_id = p.id')
                        .where('s.router_id', routerId)
                        .whereNot('s.estado', 'retirado'),
                ),
        )
        .select(
            'p.id as plan_id',
            cliente.raw('COALESCE(pr.reuso, p.reuso) AS reuso'),
            'pr.estrategia_velocidad',
        )) as FilaPlanRouter[]
    return filas.map((f) => ({
        plan_id: Number(f.plan_id),
        reuso: Number(f.reuso),
        excepcion: leerExcepcion(f.estrategia_velocidad),
    }))
}

/** 422 con los errores de la matriz (`field`, `rule` y el porqué). */
export function exigirEstrategiaValida(resultado: ResultadoValidacion): void {
    if (resultado.errores.length === 0) return
    throw new ValidacionFallida(
        resultado.errores.map((e) => ({ field: e.field, rule: e.rule, message: e.message })),
        `La combinación de control de velocidad no es válida: ${resultado.errores[0]!.message}`,
    )
}

export async function validarRouter(
    router: Pick<RouterVista, 'id' | 'routeros_version' | 'capacidad_bajada_kbps' | 'capacidad_subida_kbps'>,
    estrategias: EstrategiasRouter,
    cliente: QueryClientContract,
    planes?: PlanValidacion[],
    campoPlan?: (planId: number) => string,
): Promise<ResultadoValidacion> {
    return validarEstrategias({
        estrategias,
        planes: planes ?? (await planesParaValidar(router.id, cliente)),
        routeros_version: router.routeros_version,
        capacidad_bajada_kbps: router.capacidad_bajada_kbps,
        capacidad_subida_kbps: router.capacidad_subida_kbps,
        campoPlan,
    })
}

export class CambiarEstrategiaVelocidad extends DomainAction<EntradaEstrategiaRouter, RouterVista> {
    readonly nombre = 'routers.cambiar_control_velocidad'

    protected async handle(input: EntradaEstrategiaRouter, t: Transaccion): Promise<RouterVista> {
        t.fijarEntidad('router', input.id)
        const antes = await verRouter(input.id, t.trx)
        const capas = capasCambiadas(antes.estrategia_velocidad, input.estrategia_velocidad)
        exigirEstrategiaValida(await validarRouter(antes, input.estrategia_velocidad, t.trx))
        if (capas.length === 0) {
            verificarVersion('network.routers', input.id, antes.version, input.version)
            return antes
        }
        await actualizarConVersion(t.trx, 'network.routers', input.id, input.version, {
            estrategia_velocidad: JSON.stringify(input.estrategia_velocidad),
            control_velocidad: controlDerivado(input.estrategia_velocidad),
        })
        const despues = await verRouter(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'router', id: input.id },
            auditableRouter(antes),
            auditableRouter(despues),
        )
        await t.emit('router.estrategia_cambiada', {
            router_id: input.id,
            plan_id: null,
            de: antes.estrategia_velocidad as unknown as Record<string, unknown>,
            a: despues.estrategia_velocidad as unknown as Record<string, unknown>,
            capas,
            reconectar: input.reconectar ?? false,
            motivo: input.motivo ?? null,
        })
        refrescarAaaAlConfirmar(t, { routerId: input.id })
        return despues
    }
}

export class CambiarEstrategiaPlanRouter extends DomainAction<EntradaEstrategiaPlan, PlanRouterVista> {
    readonly nombre = 'routers.cambiar_control_velocidad'

    protected async handle(input: EntradaEstrategiaPlan, t: Transaccion): Promise<PlanRouterVista> {
        const plan = await t.trx.from('network.planes').where('id', input.plan_id).select('id').first()
        if (!plan) throw new NoEncontrado(`El plan ${input.plan_id} no existe`)
        const router = await verRouter(input.router_id, t.trx)
        const excepcion = leerExcepcion(input.estrategia_velocidad)

        // La matriz con la excepción nueva en lugar de la que tenía el plan.
        const enRouter = await planesParaValidar(input.router_id, t.trx)
        const planes = enRouter.filter((p) => p.plan_id !== input.plan_id)
        const reuso = (await t.trx
            .from('network.planes as p')
            .leftJoin('network.planes_routers as pr', (j) =>
                j.on('pr.plan_id', '=', 'p.id').andOnVal('pr.router_id', '=', input.router_id),
            )
            .where('p.id', input.plan_id)
            .select(t.trx.raw('COALESCE(pr.reuso, p.reuso) AS reuso'))
            .first()) as { reuso: number }
        planes.push({ plan_id: input.plan_id, reuso: Number(reuso.reuso), excepcion })
        exigirEstrategiaValida(
            await validarRouter(
                router,
                router.estrategia_velocidad,
                t.trx,
                planes,
                () => 'estrategia_velocidad',
            ),
        )

        let antes = await verImplementacion(input.plan_id, input.router_id, t.trx)
        if (!antes) {
            // Un plan global sin implementación en el router: se crea la fila solo con la estrategia.
            await t.trx
                .insertQuery()
                .table('network.planes_routers')
                .insert({ plan_id: input.plan_id, router_id: input.router_id })
            antes = (await verImplementacion(input.plan_id, input.router_id, t.trx))!
        } else if (input.version === undefined) {
            throw new ValidacionFallida([
                {
                    field: 'version',
                    message: 'La implementación ya existe: envía la version que leíste',
                    rule: 'required',
                },
            ])
        }
        t.fijarEntidad('plan_router', antes.id)
        const previa = leerExcepcion(antes.estrategia_velocidad)
        const capas = capasCambiadas(previa, excepcion)
        if (capas.length === 0) {
            if (input.version !== undefined) {
                verificarVersion('network.planes_routers', antes.id, antes.version, input.version)
            }
            return antes
        }
        await actualizarConVersion(
            t.trx,
            'network.planes_routers',
            antes.id,
            input.version ?? antes.version,
            {
                estrategia_velocidad: excepcion ? JSON.stringify(excepcion) : null,
            },
        )
        const despues = (await verImplementacion(input.plan_id, input.router_id, t.trx))!
        await t.registrarCambios({ tipo: 'plan_router', id: antes.id }, antes, despues)
        await t.emit('router.estrategia_cambiada', {
            router_id: input.router_id,
            plan_id: input.plan_id,
            de: previa as Record<string, unknown> | null,
            a: excepcion as Record<string, unknown> | null,
            capas,
            reconectar: input.reconectar ?? false,
            motivo: input.motivo ?? null,
        })
        refrescarAaaAlConfirmar(t, { planId: input.plan_id, routerId: input.router_id })
        return despues
    }
}
