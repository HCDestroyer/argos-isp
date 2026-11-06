import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema, ReglaNegocio, type ErrorCampo } from '#shared/errores'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { verRouter, type RouterVista } from '#network/consultas/routers'
import { auditableRouter } from '#network/actions/crear_router'
import { MAXIMO_SERVICIOS_LISTADOS, MENSAJE_PPPOE_LOCAL_REQUIERE_API } from '#network/modo_seguridad'
import { analizarServiciosRouter, ETIQUETA_TIPO } from '#network/tipo_conexion_router'
import EditarServicio from '#core/actions/editar_servicio'
import type { TipoConexion } from '#core/consultas/servicios'

export interface EntradaCambiarTipoConexionRouter {
    id: number
    version: number
    tipo_conexion: TipoConexion
    motivo?: string
}

export interface ResultadoCambiarTipoConexion {
    router: RouterVista
    de: TipoConexion
    a: TipoConexion
    /** servicios que pasaron al tipo nuevo (cada uno con su `servicio.config_cambiada`) */
    servicios: number[]
}

/**
 * Cambia el tipo de conexión de un router y de todos sus servicios no retirados (decisión del PM,
 * 5 nov; `contratos/tipo-conexion-router.md`). Con el tipo actual es «unificar»: pasan al del router
 * los servicios que difieren.
 *
 * - 422 `pppoe_local_requiere_api` si pasa a `pppoe` un router `api` sin credenciales de la API.
 * - 422 `tipo_conexion_servicios_incompletos` si algún servicio quedaría inválido y no se completa solo
 *   (sin MAC para `dhcp_fija`, sin IPv4 posible, plan solo IPv6), con un `errors[]` por falta
 *   (`field: servicios.<id>.<mac|ipv4|plan>`). Lo que se completa solo (credenciales PPPoE, IPv4 de
 *   las redes del router, modo IPv6 por RADIUS → ninguno) no bloquea: lo hace `servicios.editar`.
 * - Cada servicio pasa por `servicios.editar` anidada (auditoría y diff por fila, nunca un UPDATE
 *   masivo): emite `servicio.config_cambiada` con `tipo_conexion` (y `ips`/`prefijo_v6` si cambiaron),
 *   que RouterOS, `aaa-cache` y `coa` ya atienden. El router emite `router.tipo_conexion_cambiado`.
 */
export default class CambiarTipoConexionRouter extends DomainAction<
    EntradaCambiarTipoConexionRouter,
    ResultadoCambiarTipoConexion
> {
    readonly nombre = 'routers.cambiar_tipo_conexion'

    protected async handle(
        input: EntradaCambiarTipoConexionRouter,
        t: Transaccion,
    ): Promise<ResultadoCambiarTipoConexion> {
        t.fijarEntidad('router', input.id)
        await t.trx.from('network.routers').where('id', input.id).forUpdate().select('id')
        const antes = await verRouter(input.id, t.trx)
        verificarVersion('network.routers', input.id, antes.version, input.version)
        const tipo = input.tipo_conexion
        if (!antes.activo) throw new ReglaNegocio('El router está desactivado', 'router_inactivo')

        if (tipo === 'pppoe' && antes.modo_seguridad === 'api') {
            const r = (await t.trx
                .from('network.routers')
                .where('id', input.id)
                .select('api_usuario', 'api_password')
                .first()) as { api_usuario: string | null; api_password: string | null }
            if (!r.api_usuario || !r.api_password) {
                throw new ReglaNegocio(MENSAJE_PPPOE_LOCAL_REQUIERE_API, 'pppoe_local_requiere_api', [
                    {
                        field: 'tipo_conexion',
                        rule: 'pppoe_local_requiere_api',
                        message: MENSAJE_PPPOE_LOCAL_REQUIERE_API,
                    },
                ])
            }
        }

        const analisis = await analizarServiciosRouter(t.trx, input.id, antes.tipo_conexion, tipo)
        const cambian = analisis.filter((s) => s.cambia)
        const incompletos = cambian.filter((s) => s.faltan.length > 0)
        if (incompletos.length > 0) {
            const errores: ErrorCampo[] = incompletos.flatMap((s) =>
                s.faltan.map((falta, i) => ({
                    field: `servicios.${s.servicio_id}.${falta}`,
                    rule: 'tipo_conexion_servicios_incompletos',
                    message: `Servicio ${s.servicio_id} (${s.cliente_nombre}): ${s.mensajes[i]}`,
                })),
            )
            throw new ReglaNegocio(
                `${incompletos.length} ${incompletos.length === 1 ? 'servicio quedaría' : 'servicios quedarían'} ` +
                    `sin lo que ${ETIQUETA_TIPO[tipo]} necesita. Complétalos (ver la vista previa) y vuelve a intentar`,
                'tipo_conexion_servicios_incompletos',
                errores.slice(0, MAXIMO_SERVICIOS_LISTADOS),
            )
        }

        if (antes.tipo_conexion !== tipo) {
            await actualizarConVersion(t.trx, 'network.routers', input.id, input.version, {
                tipo_conexion: tipo,
            })
        }
        const despues = await verRouter(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'router', id: input.id },
            auditableRouter(antes),
            auditableRouter(despues),
        )

        const cambiados: number[] = []
        for (const s of cambian) {
            const fila = (await t.trx
                .from('core.servicios')
                .where('id', s.servicio_id)
                .select('version', 'empresa_id')
                .first()) as { version: number; empresa_id: number }
            exigirAccesoEmpresa(t.ctx, Number(fila.empresa_id))
            try {
                await new EditarServicio().execute(
                    { id: s.servicio_id, version: fila.version, tipo_conexion: tipo },
                    t.ctx,
                    { trx: t.trx },
                )
            } catch (error) {
                if (!(error instanceof Problema)) throw error
                throw new ReglaNegocio(
                    `El servicio ${s.servicio_id} (${s.cliente_nombre}) no puede pasar a ${ETIQUETA_TIPO[tipo]}: ` +
                        `${error.detalle ?? error.titulo}`,
                    'tipo_conexion_servicios_incompletos',
                    (error.errores ?? []).map((e) => ({
                        ...e,
                        field: `servicios.${s.servicio_id}.${e.field}`,
                    })),
                )
            }
            cambiados.push(s.servicio_id)
        }

        if (antes.tipo_conexion !== tipo || cambiados.length > 0) {
            await t.emit('router.tipo_conexion_cambiado', {
                router_id: input.id,
                empresa_id: despues.empresa_sugerida_id === null ? null : Number(despues.empresa_sugerida_id),
                de: antes.tipo_conexion,
                a: tipo,
                servicios: cambiados,
                motivo: antes.tipo_conexion === tipo ? ('unificar' as const) : ('cambio' as const),
            })
        }
        return { router: despues, de: antes.tipo_conexion, a: tipo, servicios: cambiados }
    }
}
