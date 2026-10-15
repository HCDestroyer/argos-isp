import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { actualizarConVersion } from '#shared/version'
import type { CatalogoEventos } from '#shared/eventos'
import { obtenerImplementacionPlan } from '#network/actions/obtener_implementacion_plan'
import { verServicio, type ModoIpv6, type ServicioVista } from '#core/consultas/servicios'
import { exigirReferencia } from '#core/actions/crear_servicio'
import { asignacionesVigentes, reconciliarAsignaciones, validarModoIpv6 } from '#core/asignaciones_servicio'
import { refrescarAaaAlConfirmar } from '#core/aaa'

export interface EntradaEditarServicio {
    id: number
    version: number
    router_id?: number
    plan_id?: number
    plantilla_facturacion_id?: number | null
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
}

type CampoConfig = CatalogoEventos['servicio.config_cambiada']['campos'][number]

/**
 * Edita un servicio (control optimista por `version`: la segunda sesión con la misma versión
 * recibe 409). Cambiar router, plan, IP o modo IPv6 reconcilia las asignaciones y emite
 * `servicio.config_cambiada` (con los campos afectados) y, si cambiaron IPs o prefijos,
 * `asignacion.cambiada`. El estado no se edita aquí: tiene sus acciones propias.
 */
export default class EditarServicio extends DomainAction<EntradaEditarServicio, ServicioVista> {
    readonly nombre = 'servicios.editar'

    protected async handle(input: EntradaEditarServicio, t: Transaccion): Promise<ServicioVista> {
        const { id, version, ipv4, prefijo_delegado_v6: prefijoEstatico, pass_ppp: passPpp, ...datos } = input
        t.fijarEntidad('servicio', id)
        const antes = await verServicio(id, t.trx)
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

        let modo = datos.ipv6_modo ?? antes.ipv6_modo
        // Pasar a un plan solo IPv4 apaga IPv6 si no se pidió otro modo.
        if (datos.ipv6_modo === undefined && plan.dual_stack === 'v4') modo = 'ninguno'
        validarModoIpv6(plan, modo, {
            ipv6_duid: datos.ipv6_duid !== undefined ? datos.ipv6_duid : antes.ipv6_duid,
            prefijo_delegado_v6: prefijoEstatico,
        })

        const columnas: Record<string, unknown> = Object.fromEntries(
            Object.entries(datos).filter(([, valor]) => valor !== undefined),
        )
        columnas.ipv6_modo = modo
        if (passPpp !== undefined) columnas.pass_ppp = cifrar(passPpp)
        await actualizarConVersion(t.trx, 'core.servicios', id, version, columnas)

        const asignacionesAntes = await asignacionesVigentes(t.trx, id)
        const asignaciones = await reconciliarAsignaciones(t.trx, {
            servicioId: id,
            routerId,
            plan,
            modo,
            ipv4,
            prefijoEstatico,
        })

        const despues = await verServicio(id, t.trx)
        await t.registrarCambios(
            { tipo: 'servicio', id },
            antes,
            // la contraseña nunca se audita; solo que cambió
            passPpp !== undefined ? { ...despues, clave_ppp_cambiada: true } : despues,
        )

        const campos: CampoConfig[] = []
        if (despues.plan_id !== antes.plan_id) campos.push('plan')
        if (despues.router_id !== antes.router_id) campos.push('router')
        if (asignaciones.ipv4 !== asignacionesAntes.ipv4) campos.push('ips')
        if (
            asignaciones.prefijo_enlace_v6 !== asignacionesAntes.prefijo_enlace_v6 ||
            asignaciones.prefijo_delegado_v6 !== asignacionesAntes.prefijo_delegado_v6 ||
            despues.ipv6_modo !== antes.ipv6_modo
        ) {
            campos.push('prefijo_v6')
        }
        if (campos.length > 0) await t.emit('servicio.config_cambiada', { servicio_id: id, campos })
        if (campos.includes('ips') || campos.includes('prefijo_v6')) {
            await t.emit('asignacion.cambiada', {
                servicio_id: id,
                ipv4: asignaciones.ipv4 ? [asignaciones.ipv4] : [],
                prefijo_enlace_v6: asignaciones.prefijo_enlace_v6,
                prefijo_delegado_v6: asignaciones.prefijo_delegado_v6,
                inicio: new Date().toISOString(),
                fin: null,
            })
        }
        refrescarAaaAlConfirmar(t, { servicioId: id })
        return despues
    }
}
