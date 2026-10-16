import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { obtenerImplementacionPlan } from '#network/actions/obtener_implementacion_plan'
import { verServicio, type ModoIpv6, type ServicioVista } from '#core/consultas/servicios'
import {
    generarPassPpp,
    generarUserPpp,
    modoIpv6PorDefecto,
    reconciliarAsignaciones,
    validarModoIpv6,
} from '#core/asignaciones_servicio'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { guardarExcepciones, paraAuditoriaServicio, validarExcepciones } from '#core/excepciones_servicio'

export interface EntradaCrearServicio {
    cliente_id: number
    router_id: number
    plan_id: number
    plantilla_facturacion_id?: number | null
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
    /** excepciones a la plantilla `{ campo: valor }` (campos de `app/billing/excepciones.ts`) */
    excepciones?: Record<string, unknown>
}

/** Valida que existan las referencias del cuerpo (422 por campo, no 404). */
export async function exigirReferencia(t: Transaccion, tabla: string, id: number, campo: string) {
    const fila = await t.trx.from(tabla).where('id', id).select('id').first()
    if (!fila) throw new ValidacionFallida([{ field: campo, message: 'No existe', rule: 'exists' }])
}

/**
 * Alta de un servicio PPPoE: valida cliente, router activo, plan disponible en el router y
 * plantilla; genera `user_ppp` y `pass_ppp` si no vienen (la contraseña se guarda cifrada v1);
 * asigna IPv4 y reserva prefijos IPv6 según el modo; guarda las excepciones a la plantilla
 * (validadas por A3); emite `servicio.creado` y `asignacion.cambiada`.
 */
export default class CrearServicio extends DomainAction<EntradaCrearServicio, ServicioVista> {
    readonly nombre = 'servicios.crear'

    protected async handle(input: EntradaCrearServicio, t: Transaccion): Promise<ServicioVista> {
        const cliente = (await t.trx
            .from('core.clientes')
            .where('id', input.cliente_id)
            .select('nombre')
            .first()) as {
            nombre: string
        } | null
        if (!cliente) {
            throw new ValidacionFallida([
                { field: 'cliente_id', message: 'El cliente no existe', rule: 'exists' },
            ])
        }
        const router = (await t.trx
            .from('network.routers')
            .where('id', input.router_id)
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
        if (input.plantilla_facturacion_id) {
            await exigirReferencia(
                t,
                'billing.plantillas_facturacion',
                input.plantilla_facturacion_id,
                'plantilla_facturacion_id',
            )
        }
        await exigirReferencia(t, 'network.planes', input.plan_id, 'plan_id')
        const plan = await obtenerImplementacionPlan(input.plan_id, input.router_id, t.trx)
        if (!plan.activo) throw new ReglaNegocio(`El plan ${plan.nombre} está inactivo`, 'plan_inactivo')

        const excepciones = input.excepciones ? await validarExcepciones(input.excepciones) : {}

        const modo = input.ipv6_modo ?? modoIpv6PorDefecto(plan)
        validarModoIpv6(plan, modo, input)

        const userPpp = input.user_ppp ?? (await generarUserPpp(t.trx, input.cliente_id, cliente.nombre))
        const repetido = await t.trx.from('core.servicios').where('user_ppp', userPpp).first()
        if (repetido) throw new Conflicto(`El user_ppp ${userPpp} ya existe`, 'user_ppp_duplicado')

        const [fila] = (await t.trx
            .insertQuery()
            .table('core.servicios')
            .insert({
                cliente_id: input.cliente_id,
                router_id: input.router_id,
                plan_id: input.plan_id,
                plantilla_facturacion_id: input.plantilla_facturacion_id ?? null,
                user_ppp: userPpp,
                pass_ppp: cifrar(input.pass_ppp ?? generarPassPpp()),
                mac: input.mac ?? null,
                direccion: input.direccion ?? null,
                coordenadas: input.coordenadas ?? null,
                fecha_instalacion: input.fecha_instalacion ?? null,
                costo_override: input.costo_override ?? null,
                excluir_firewall: input.excluir_firewall ?? false,
                ipv6_modo: modo,
                ipv6_duid: input.ipv6_duid ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        const id = fila!.id
        t.fijarEntidad('servicio', id)

        const asignaciones = await reconciliarAsignaciones(t.trx, {
            servicioId: id,
            routerId: input.router_id,
            plan,
            modo,
            ipv4: input.ipv4,
            prefijoEstatico: input.prefijo_delegado_v6,
        })

        await guardarExcepciones(t.trx, id, excepciones)

        const servicio = await verServicio(id, t.trx)
        await t.registrarCambios({ tipo: 'servicio', id }, null, {
            ...paraAuditoriaServicio(servicio),
            pass_ppp: 'definida',
        })
        await t.emit('servicio.creado', {
            servicio_id: id,
            cliente_id: input.cliente_id,
            router_id: input.router_id,
            plan_id: input.plan_id,
        })
        await t.emit('asignacion.cambiada', {
            servicio_id: id,
            ipv4: asignaciones.ipv4 ? [asignaciones.ipv4] : [],
            prefijo_enlace_v6: asignaciones.prefijo_enlace_v6,
            prefijo_delegado_v6: asignaciones.prefijo_delegado_v6,
            inicio: new Date().toISOString(),
            fin: null,
        })
        refrescarAaaAlConfirmar(t, { servicioId: id })
        return servicio
    }
}
