import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import { auditableRouter } from '#network/actions/crear_router'
import { verRouter, type RouterVista } from '#network/consultas/routers'
import { ACCION_QOS, emitirQos } from '#network/actions/qos_comun'
import { perfilEfectivoId, planesConQos, verPerfil } from '#network/consultas/qos'
import { costoQos, QOS_MAX_HOJAS } from '#network/qos'

export interface EntradaAsignarPerfilQos {
    router_id: number
    version: number
    /** null = el predeterminado */
    qos_perfil_id: number | null
    motivo?: string
}

/**
 * Elige el perfil de QoS por clases de un router (`POST /routers/:id/qos-perfil`, `contratos/qos.md`
 * §2). El perfil debe ser común o de la `empresa_sugerida_id` del router (422 `qos_empresa`) y caber
 * en el límite de hojas (422 `qos_costo`). Diff del router en `audit.cambios` y `qos.config_cambiada`
 * (el router se reconcilia si tiene algún plan con `qos`). Sin cambios: 200 sin evento.
 */
export default class AsignarPerfilQos extends DomainAction<EntradaAsignarPerfilQos, RouterVista> {
    readonly nombre = ACCION_QOS

    protected async handle(input: EntradaAsignarPerfilQos, t: Transaccion): Promise<RouterVista> {
        t.fijarEntidad('router', input.router_id)
        const antes = await verRouter(input.router_id, t.trx)
        verificarVersion('network.routers', input.router_id, antes.version, input.version)
        if ((antes.qos_perfil_id ?? null) === input.qos_perfil_id) return antes
        const efectivo = await perfilEfectivoId(input.qos_perfil_id, t.trx)
        if (efectivo === null) throw new NoEncontrado('No hay un perfil de QoS predeterminado')
        const perfil = await verPerfil(efectivo, t.trx)
        if (perfil.empresa_id !== null && perfil.empresa_id !== antes.empresa_sugerida_id) {
            throw new ValidacionFallida(
                [
                    {
                        field: 'qos_perfil_id',
                        rule: 'qos_empresa',
                        message:
                            'el perfil es de otra empresa: un router solo usa perfiles comunes o de su empresa sugerida',
                    },
                ],
                'El perfil de QoS no se puede usar en este router',
            )
        }
        const planes = await planesConQos(input.router_id, t.trx)
        const costo = costoQos(
            { perfil_id: perfil.id, clases: perfil.clases.filter((c) => c.activa) },
            planes,
        )
        if (costo.hojas > QOS_MAX_HOJAS) {
            throw new ValidacionFallida(
                [
                    {
                        field: 'qos_perfil_id',
                        rule: 'qos_costo',
                        message: `el router pasaría de ${QOS_MAX_HOJAS} hojas de QoS (${costo.hojas})`,
                    },
                ],
                'El router pasaría del límite de QoS',
            )
        }
        await actualizarConVersion(t.trx, 'network.routers', input.router_id, input.version, {
            qos_perfil_id: input.qos_perfil_id,
        })
        const despues = await verRouter(input.router_id, t.trx)
        await t.registrarCambios(
            { tipo: 'router', id: input.router_id },
            auditableRouter(antes),
            auditableRouter(despues),
        )
        await emitirQos(t, {
            perfil_id: perfil.id,
            clase_id: null,
            router_id: input.router_id,
            campos: ['qos_perfil_id'],
            routers: planes > 0 && despues.activo ? [input.router_id] : [],
        })
        return despues
    }
}
