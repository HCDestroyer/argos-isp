import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ReglaNegocio } from '#shared/errores'
import { emitirComodato, servicioDe } from '#inventario/comodato'
import type { UnidadFila } from '#inventario/unidades'
import { destinoWebhooksIris } from '#integraciones/iris/configuracion'
import { alcanceConectorIris } from '#integraciones/iris/envios'

/**
 * `inventario.solicitar_orden_retiro` (`POST /servicios/:id/equipos/:unidad_id/orden-retiro`): pide a
 * Iris, a mano, la orden de retiro de una unidad «por recuperar» (botón «Crear orden de retiro (Iris)»
 * de Inventario › Por recuperar).
 *
 * Argos pide la orden de retiro a Iris con el webhook `inventario.equipo_por_recuperar`
 * (`contratos/iris.md` §2.3: «Crea una orden de retiro (`origen = argos`), si no hay una abierta para
 * esa unidad»). De fábrica sale solo al retirar el servicio (decisión 17, `RevisarComodatos`); esta
 * acción lo vuelve a emitir, con el mismo payload, para la unidad pedida: cuando el retiro se hizo con
 * la casilla «el equipo ya se entregó» o con `retiro.orden_iris` apagado y luego no se entregó, o
 * cuando Iris cerró la orden sin recuperarlo. Iris no duplica: con una orden abierta para la unidad,
 * el webhook no crea otra. No cambia la unidad ni el libro.
 *
 * - 404 si la unidad no existe; 409 `unidad_no_por_recuperar` si no está `por_recuperar` en ese
 *   servicio.
 * - 422 `iris_no_conectado` si el conector de Iris está apagado o sin receptor, o si la empresa del
 *   servicio no está en el alcance del usuario técnico «Iris» (el webhook no saldría).
 */

export interface EntradaSolicitarOrdenRetiro {
    servicio_id: number
    unidad_id: number
}

export interface OrdenRetiroSolicitada {
    unidad_id: number
    servicio_id: number
    empresa_id: number
    cliente_id: number
    evento: 'inventario.equipo_por_recuperar'
}

export default class SolicitarOrdenRetiro extends DomainAction<
    EntradaSolicitarOrdenRetiro,
    OrdenRetiroSolicitada
> {
    readonly nombre = 'inventario.solicitar_orden_retiro'

    protected async handle(
        input: EntradaSolicitarOrdenRetiro,
        t: Transaccion,
    ): Promise<OrdenRetiroSolicitada> {
        t.fijarEntidad('unidad', input.unidad_id)
        const unidad = (await t.trx
            .from('inventario.unidades')
            .where('id', input.unidad_id)
            .forUpdate()
            .select('*')
            .first()) as UnidadFila | null
        if (!unidad) throw new NoEncontrado(`La unidad ${input.unidad_id} no existe`)
        const servicio = await servicioDe(t, input.servicio_id, Number(unidad.empresa_id))
        t.fijarEmpresa(servicio.empresa_id)
        if (unidad.estado !== 'por_recuperar' || Number(unidad.servicio_id) !== servicio.id) {
            throw new Conflicto(
                `La unidad ${unidad.serie ?? unidad.mac ?? unidad.id} no está por recuperar en el servicio ${servicio.id}`,
                'unidad_no_por_recuperar',
                'Unidad no está por recuperar',
            )
        }

        const destino = await destinoWebhooksIris(t.trx)
        const alcance = destino ? await alcanceConectorIris() : null
        if (!destino || !alcance || (!alcance.global && !alcance.empresas.includes(servicio.empresa_id))) {
            throw new ReglaNegocio(
                'Iris no está conectado para la empresa de este servicio: la orden de retiro no se puede pedir. Revise Configuración › Integraciones › Iris',
                'iris_no_conectado',
            )
        }

        await emitirComodato(
            t,
            'inventario.equipo_por_recuperar',
            {
                id: Number(unidad.id),
                empresa_id: Number(unidad.empresa_id),
                producto_id: Number(unidad.producto_id),
                serie: unidad.serie,
                mac: unidad.mac,
            },
            servicio,
        )
        return {
            unidad_id: Number(unidad.id),
            servicio_id: servicio.id,
            empresa_id: servicio.empresa_id,
            cliente_id: servicio.cliente_id,
            evento: 'inventario.equipo_por_recuperar',
        }
    }
}
