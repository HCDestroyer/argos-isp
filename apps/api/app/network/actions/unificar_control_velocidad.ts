import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { verRouter } from '#network/consultas/routers'
import { verImplementacion } from '#network/consultas/planes'
import { capasCambiadas } from '#network/estrategia_velocidad'
import { excepcionesDelRouter } from '#network/consultas/unificar_velocidad'
import {
    exigirEstrategiaValida,
    planesParaValidar,
    validarRouter,
} from '#network/actions/cambiar_estrategia_velocidad'

export interface EntradaUnificarControlVelocidad {
    router_id: number
    /** planes con excepción que el usuario vio en la vista previa */
    planes: number[]
    reconectar?: boolean
    motivo?: string
}

export interface ResultadoUnificarVelocidad {
    router_id: number
    planes: number[]
}

/**
 * Quita las excepciones de estrategia por plan de un router (`contratos/control-velocidad.md` §11):
 * todos sus planes quedan con el modo del router. Solo con aviso: `planes` debe ser exactamente la
 * lista de la vista previa (409 `excepciones_cambiaron` si no). Valida la matriz del router sin
 * excepciones (422), deja el diff de cada implementación y emite un `router.estrategia_cambiada`
 * por plan con `motivo: 'unificar'`; reescribe `aaa:user:*` del router al confirmar.
 */
export default class UnificarControlVelocidad extends DomainAction<
    EntradaUnificarControlVelocidad,
    ResultadoUnificarVelocidad
> {
    readonly nombre = 'routers.unificar_control_velocidad'

    protected async handle(
        input: EntradaUnificarControlVelocidad,
        t: Transaccion,
    ): Promise<ResultadoUnificarVelocidad> {
        t.fijarEntidad('router', input.router_id)
        // serializa con otros cambios de estrategia del router
        await t.trx.from('network.routers').where('id', input.router_id).forUpdate().first()
        const router = await verRouter(input.router_id, t.trx)
        const excepciones = await excepcionesDelRouter(input.router_id, t.trx)
        const actuales = excepciones.map((e) => e.plan_id).sort((a, b) => a - b)
        const vistos = [...new Set(input.planes)].sort((a, b) => a - b)
        if (JSON.stringify(actuales) !== JSON.stringify(vistos)) {
            throw new Conflicto(
                `Las excepciones del router cambiaron (hoy: ${actuales.join(', ') || 'ninguna'}): vuelve a pedir la vista previa`,
                'excepciones_cambiaron',
            )
        }
        if (excepciones.length === 0) return { router_id: input.router_id, planes: [] }

        const enRouter = await planesParaValidar(input.router_id, t.trx)
        const planes = enRouter.map((p) => ({ ...p, excepcion: null }))
        exigirEstrategiaValida(await validarRouter(router, router.estrategia_velocidad, t.trx, planes))

        for (const e of excepciones) {
            const antes = (await verImplementacion(e.plan_id, input.router_id, t.trx))!
            await actualizarConVersion(t.trx, 'network.planes_routers', e.id, e.version, {
                estrategia_velocidad: null,
            })
            const despues = (await verImplementacion(e.plan_id, input.router_id, t.trx))!
            await t.registrarCambios({ tipo: 'plan_router', id: e.id }, antes, despues)
            await t.emit('router.estrategia_cambiada', {
                router_id: input.router_id,
                plan_id: e.plan_id,
                de: e.excepcion as Record<string, unknown>,
                a: null,
                capas: capasCambiadas(e.excepcion, null),
                reconectar: input.reconectar ?? false,
                motivo: 'unificar',
            })
        }
        refrescarAaaAlConfirmar(t, { routerId: input.router_id })
        return { router_id: input.router_id, planes: actuales }
    }
}
