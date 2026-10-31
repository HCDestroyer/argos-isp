import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirPppoeAdmitido } from '#network/modo_seguridad'
import { cifrar } from '#shared/cifrado'
import { actualizarConVersion } from '#shared/version'
import type { CatalogoEventos } from '#shared/eventos'
import { obtenerImplementacionPlan } from '#network/actions/obtener_implementacion_plan'
import { verServicio, type ModoIpv6, type TipoConexion } from '#core/consultas/servicios'
import { exigirReferencia, exigirUserPppLibre } from '#core/actions/crear_servicio'
import {
    asignacionesVigentes,
    generarPassPpp,
    generarUserPpp,
    modoIpv6PorRadius,
    reconciliarAsignaciones,
    validarModoIpv6,
    validarTipoConexion,
} from '#core/asignaciones_servicio'
import { refrescarAaaAlConfirmar, type ObjetivoAaa } from '#core/aaa'
import {
    CAMPOS_QUE_AFECTAN_CORTE,
    guardarExcepciones,
    paraAuditoriaServicio,
    validarExcepciones,
} from '#core/excepciones_servicio'
import { registrarTramo } from '#network/historial'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import { planTemporalActivo } from '#core/planes_temporales'
import { reconciliarIncluidos } from '#core/adicionales'
import { advertenciasServicio } from '#network/tipos_plan'
import type { ServicioConAdvertencias } from '#core/actions/crear_servicio'

export interface EntradaEditarServicio {
    id: number
    version: number
    router_id?: number
    plan_id?: number
    plantilla_facturacion_id?: number | null
    tipo_conexion?: TipoConexion
    amarre_ip_mac?: boolean
    /** solo al pasar a `pppoe` (si no viene se genera) */
    user_ppp?: string
    pass_ppp?: string
    mac?: string | null
    direccion?: string | null
    coordenadas?: string | null
    fecha_instalacion?: string | null
    costo_override?: string | null
    excluir_firewall?: boolean
    ipv4?: string
    ipv6_modo?: ModoIpv6
    ipv6_duid?: string | null
    prefijo_delegado_v6?: string
    /** `{ campo: valor }`; `null` borra la excepción, un campo ausente no se toca */
    excepciones?: Record<string, unknown>
    /**
     * Solo interno (`routers.unir`, nunca por la API): el router nuevo es el mismo equipo que el
     * anterior y sus redes y pools ya pasaron a él. Conserva las asignaciones tal cual y el evento
     * sale con `motivo: 'union_routers'` (`contratos/routers.md`).
     */
    mismo_equipo?: boolean
}

type CampoConfig = CatalogoEventos['servicio.config_cambiada']['campos'][number]

/**
 * Edita un servicio (control optimista por `version`: la segunda sesión con la misma versión
 * recibe 409). Cambiar router, plan, IP o modo IPv6 reconcilia las asignaciones y emite
 * `servicio.config_cambiada` (con los campos afectados) y, si cambiaron IPs o prefijos,
 * `asignacion.cambiada`. El estado no se edita aquí: tiene sus acciones propias.
 *
 * Cambiar `tipo_conexion` (`contratos/routeros.md`) es una edición más con diff y emite
 * `servicio.config_cambiada` con `tipo_conexion`:
 * - a `pppoe`: genera `user_ppp`/`pass_ppp` si no vienen;
 * - desde `pppoe`: borra las credenciales y escribe la lápida en `aaa:user:<user_ppp viejo>`;
 *   los modos IPv6 por RADIUS pasan a `ninguno` si no se pidió otro modo.
 * Cambiar `mac` o `amarre_ip_mac` emite `servicio.config_cambiada` con ese campo (lease y ARP).
 *
 * `excepciones` (tarea 11) se valida con `validarExcepcion` de A3 y se guarda en
 * `core.servicios_excepciones` con diff por campo (`excepcion_<campo>`). Si cambia una que afecta
 * el corte (`facturas_para_limitar`, `facturas_para_cortar`, `reglas_promesa`), se llama
 * `EvaluarEstadoServicio` anidada: A3 decide si el estado cambia, A1 no.
 *
 * Con un plan temporal activo (lealtad) el `plan_id` del servicio es el temporal: cambiarlo responde
 * 409 `plan_temporal_activo` (primero se cancela con `servicios.cancelar_plan_temporal`).
 *
 * Cambiar de plan reconcilia los adicionales `incluido` con los del plan nuevo
 * (`reconciliarIncluidos`): los que el plan nuevo no trae se dan de baja, los que faltan se agregan;
 * `cortesia` y `cobrado` se conservan (`contratos/adicionales.md`).
 */
export default class EditarServicio extends DomainAction<EntradaEditarServicio, ServicioConAdvertencias> {
    readonly nombre = 'servicios.editar'

    protected async handle(input: EntradaEditarServicio, t: Transaccion): Promise<ServicioConAdvertencias> {
        const {
            id,
            version,
            ipv4,
            prefijo_delegado_v6: prefijoEstatico,
            pass_ppp: passPpp,
            user_ppp: userPppEntrada,
            excepciones: excepcionesEntrada,
            mismo_equipo: mismoEquipo,
            ...datos
        } = input
        t.fijarEntidad('servicio', id)
        const antes = await verServicio(id, t.trx)
        t.fijarEmpresa(antes.empresa_id)
        if (antes.estado === 'retirado') {
            throw new ReglaNegocio('El servicio está retirado: no se edita', 'servicio_retirado')
        }

        const routerId = datos.router_id ?? antes.router_id
        const planId = datos.plan_id ?? antes.plan_id
        if (datos.router_id !== undefined && datos.router_id !== antes.router_id) {
            const router = (await t.trx
                .from('network.routers')
                .where('id', routerId)
                .select('activo')
                .first()) as {
                activo: boolean
            } | null
            if (!router) {
                throw new ValidacionFallida([
                    { field: 'router_id', message: 'El router no existe', rule: 'exists' },
                ])
            }
            if (!router.activo) throw new ReglaNegocio('El router está desactivado', 'router_inactivo')
        }
        if (datos.plan_id !== undefined) await exigirReferencia(t, 'network.planes', planId, 'plan_id')
        if (planId !== antes.plan_id) {
            const temporal = await planTemporalActivo(id, t.trx)
            if (temporal) {
                throw new Conflicto(
                    `El servicio tiene el plan temporal ${temporal.id} activo hasta ${temporal.fin}: ` +
                        'cancélalo antes de cambiar el plan',
                    'plan_temporal_activo',
                    'Plan temporal activo',
                )
            }
        }
        if (datos.plantilla_facturacion_id) {
            await exigirReferencia(
                t,
                'billing.plantillas_facturacion',
                datos.plantilla_facturacion_id,
                'plantilla_facturacion_id',
            )
        }
        const mismoPlanYRouter = planId === antes.plan_id && routerId === antes.router_id
        const plan = await obtenerImplementacionPlan(planId, routerId, t.trx, {
            aunqueNoDisponible: mismoPlanYRouter,
        })
        if (planId !== antes.plan_id && !plan.activo) {
            throw new ReglaNegocio(`El plan ${plan.nombre} está inactivo`, 'plan_inactivo')
        }

        const excepciones = excepcionesEntrada ? await validarExcepciones(excepcionesEntrada) : {}

        const tipo = datos.tipo_conexion ?? antes.tipo_conexion
        const cambiaTipo = tipo !== antes.tipo_conexion
        let modo = datos.ipv6_modo ?? antes.ipv6_modo
        // Pasar a un plan solo IPv4 apaga IPv6 si no se pidió otro modo.
        if (datos.ipv6_modo === undefined && plan.dual_stack === 'v4') modo = 'ninguno'
        // Dejar PPPoE apaga los modos que entrega RADIUS si no se pidió otro modo.
        if (datos.ipv6_modo === undefined && tipo !== 'pppoe' && modoIpv6PorRadius(modo)) modo = 'ninguno'
        // Volver a PPPoE sin amarre: el amarre IP-MAC es solo sin PPPoE.
        const amarre = datos.amarre_ip_mac ?? (tipo === 'pppoe' ? false : antes.amarre_ip_mac)
        if (userPppEntrada !== undefined && !(cambiaTipo && tipo === 'pppoe')) {
            throw new ValidacionFallida([
                {
                    field: 'user_ppp',
                    message: 'El user_ppp solo se indica al cambiar el servicio a pppoe',
                    rule: 'tipo_conexion',
                },
            ])
        }
        validarTipoConexion(plan, {
            tipo,
            modo,
            mac: datos.mac !== undefined ? datos.mac : antes.mac,
            amarre,
            pass_ppp: passPpp,
        })
        validarModoIpv6(plan, modo, {
            ipv6_duid: datos.ipv6_duid !== undefined ? datos.ipv6_duid : antes.ipv6_duid,
            prefijo_delegado_v6: prefijoEstatico,
        })
        // PPPoE en un router sin RADIUS: 422 al mover el servicio o al pasarlo a pppoe (un PPPoE que ya
        // estaba en el router se sigue editando; `#network/modo_seguridad`)
        if (routerId !== antes.router_id || cambiaTipo) await exigirPppoeAdmitido(t.trx, routerId, tipo)

        const columnas: Record<string, unknown> = Object.fromEntries(
            Object.entries(datos).filter(([, valor]) => valor !== undefined),
        )
        columnas.ipv6_modo = modo
        columnas.amarre_ip_mac = amarre
        if (passPpp !== undefined) columnas.pass_ppp = cifrar(passPpp)
        if (cambiaTipo && tipo === 'pppoe') {
            const cliente = (await t.trx
                .from('core.clientes')
                .where('id', antes.cliente_id)
                .select('nombre')
                .firstOrFail()) as { nombre: string }
            const nuevoUser =
                userPppEntrada ?? (await generarUserPpp(t.trx, antes.cliente_id, cliente.nombre))
            await exigirUserPppLibre(t, nuevoUser)
            columnas.user_ppp = nuevoUser
            columnas.pass_ppp = cifrar(passPpp ?? generarPassPpp())
        } else if (cambiaTipo && antes.tipo_conexion === 'pppoe') {
            columnas.user_ppp = null
            columnas.pass_ppp = null
        }
        await actualizarConVersion(t.trx, 'core.servicios', id, version, columnas)

        const asignacionesAntes = await asignacionesVigentes(t.trx, id)
        // `routers.unir`: las direcciones ya son del router que queda (mismo equipo); no se tocan
        const asignaciones = mismoEquipo
            ? asignacionesAntes
            : await reconciliarAsignaciones(t.trx, {
                  servicioId: id,
                  routerId,
                  plan,
                  modo,
                  tipoConexion: tipo,
                  ipv4,
                  prefijoEstatico,
              })

        const excepcionesCambiadas = await guardarExcepciones(t.trx, id, excepciones)

        const despues = await verServicio(id, t.trx)
        await t.registrarCambios(
            { tipo: 'servicio', id },
            paraAuditoriaServicio(antes),
            // la contraseña nunca se audita; solo que cambió
            columnas.pass_ppp !== undefined
                ? { ...paraAuditoriaServicio(despues), clave_ppp_cambiada: true }
                : paraAuditoriaServicio(despues),
        )

        const campos: CampoConfig[] = []
        if (despues.plan_id !== antes.plan_id) campos.push('plan')
        if (despues.router_id !== antes.router_id) campos.push('router')
        if (despues.tipo_conexion !== antes.tipo_conexion) campos.push('tipo_conexion')
        if (despues.mac !== antes.mac) campos.push('mac')
        if (despues.amarre_ip_mac !== antes.amarre_ip_mac) campos.push('amarre_ip_mac')
        if (asignaciones.ipv4 !== asignacionesAntes.ipv4) campos.push('ips')
        if (
            asignaciones.prefijo_enlace_v6 !== asignacionesAntes.prefijo_enlace_v6 ||
            asignaciones.prefijo_delegado_v6 !== asignacionesAntes.prefijo_delegado_v6 ||
            despues.ipv6_modo !== antes.ipv6_modo
        ) {
            campos.push('prefijo_v6')
        }
        if (campos.includes('plan')) {
            await reconciliarIncluidos(
                t,
                { id, empresa_id: despues.empresa_id, cliente_id: despues.cliente_id },
                despues.plan_id,
                'cambio_plan',
            )
        }
        if (campos.length > 0) {
            await registrarTramo(t.trx, id, `edicion: ${campos.join(', ')}`)
            await t.emit('servicio.config_cambiada', {
                servicio_id: id,
                empresa_id: despues.empresa_id,
                campos,
                ...(mismoEquipo ? { motivo: 'union_routers' as const } : {}),
            })
        }
        if (campos.includes('ips') || campos.includes('prefijo_v6')) {
            await t.emit('asignacion.cambiada', {
                servicio_id: id,
                empresa_id: despues.empresa_id,
                ipv4: asignaciones.ipv4 ? [asignaciones.ipv4] : [],
                prefijo_enlace_v6: asignaciones.prefijo_enlace_v6,
                prefijo_delegado_v6: asignaciones.prefijo_delegado_v6,
                inicio: new Date().toISOString(),
                fin: null,
            })
        }
        const objetivos: ObjetivoAaa[] = [{ servicioId: id }]
        // dejó de ser PPPoE: lápida (sin credenciales) en la clave vieja; aaa lo rechaza
        if (antes.user_ppp && antes.user_ppp !== despues.user_ppp) {
            objetivos.push({ lapida: { userPpp: antes.user_ppp, servicioId: id, version: despues.version } })
        }
        refrescarAaaAlConfirmar(t, ...objetivos)

        if (excepcionesCambiadas.some((campo) => CAMPOS_QUE_AFECTAN_CORTE.includes(campo as never))) {
            await new EvaluarEstadoServicio().execute({ servicio_id: id }, t.ctx, { trx: t.trx })
            const evaluado = await verServicio(id, t.trx)
            return { ...evaluado, warnings: await advertenciasServicio(t.trx, id) }
        }
        return { ...despues, warnings: await advertenciasServicio(t.trx, id) }
    }
}
