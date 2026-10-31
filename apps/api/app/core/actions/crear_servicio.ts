import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirPppoeAdmitido } from '#network/modo_seguridad'
import { cifrar } from '#shared/cifrado'
import { obtenerImplementacionPlan } from '#network/actions/obtener_implementacion_plan'
import { verServicio, type ModoIpv6, type ServicioVista, type TipoConexion } from '#core/consultas/servicios'
import {
    generarPassPpp,
    generarUserPpp,
    modoIpv6PorDefecto,
    reconciliarAsignaciones,
    validarModoIpv6,
    validarTipoConexion,
} from '#core/asignaciones_servicio'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { registrarTramo } from '#network/historial'
import { plantillaPorDefecto } from '#core/plantilla_por_defecto'
import { vincularExterno, type IdExterno } from '#core/ids_externos'
import { guardarExcepciones, paraAuditoriaServicio, validarExcepciones } from '#core/excepciones_servicio'
import { resolverEmpresaServicio } from '#core/empresas'
import { reconciliarIncluidos } from '#core/adicionales'
import type { EstadoInicialServicio } from '#core/instalacion'
import { advertenciasServicio, type Advertencia } from '#network/tipos_plan'
import { telefonoParaGuardar } from '#core/telefonos'

/** Servicio con las advertencias del tipo de su plan (`app/network/tipos_plan.ts`); nunca bloquean. */
export type ServicioConAdvertencias = ServicioVista & { warnings: Advertencia[] }

export interface EntradaCrearServicio {
    cliente_id: number
    /**
     * Empresa (NIT) que factura el servicio. Sin ella: la sugerida de la zona del cliente, la del
     * router, la empresa activa del contexto o la única activa (`resolverEmpresaServicio`).
     */
    empresa_id?: number | null
    router_id: number
    plan_id: number
    plantilla_facturacion_id?: number | null
    /**
     * Sin `plantilla_facturacion_id` (undefined), usar la plantilla por defecto
     * (`plantillaPorDefecto`). Lo pide `POST /servicios`; las llamadas internas no.
     */
    plantillaPorDefecto?: boolean
    /** `pppoe` por defecto; `ip_estatica` y `dhcp_fija` sin credenciales (`contratos/routeros.md`) */
    tipo_conexion?: TipoConexion
    amarre_ip_mac?: boolean
    user_ppp?: string
    pass_ppp?: string
    mac?: string | null
    direccion?: string | null
    /** cómo llegar, texto libre (pedido A12 de Iris) */
    referencia?: string | null
    /** contacto en sitio (pedido A13 de Iris); el teléfono se normaliza (`#core/telefonos`) */
    contacto_nombre?: string | null
    contacto_telefono?: string | null
    coordenadas?: string | null
    fecha_instalacion?: string | null
    costo_override?: string | null
    excluir_firewall?: boolean
    ipv4?: string
    /** red IPv4 del router de la que asignar (pedido de A4); si no viene, la regla general */
    red_ipv4_id?: number
    ipv6_modo?: ModoIpv6
    ipv6_duid?: string | null
    prefijo_delegado_v6?: string
    /** excepciones a la plantilla `{ campo: valor }` (campos de `app/billing/excepciones.ts`) */
    excepciones?: Record<string, unknown>
    /**
     * `activo` (por defecto) o `pendiente_instalacion` (venta desde Iris, `contratos/instalacion.md`):
     * el pendiente ya tiene credenciales, router, plan e IPs, pero no navega ni factura hasta
     * `servicios.activar_instalacion`; su `instalado_en` queda en null.
     */
    estado_inicial?: EstadoInicialServicio
    /** id en un sistema de origen (importador); 409 `externo_duplicado` si ya está vinculado */
    externo?: IdExterno
}

/** Valida que existan las referencias del cuerpo (422 por campo, no 404). */
export async function exigirReferencia(t: Transaccion, tabla: string, id: number, campo: string) {
    const fila = await t.trx.from(tabla).where('id', id).select('id').first()
    if (!fila) throw new ValidacionFallida([{ field: campo, message: 'No existe', rule: 'exists' }])
}

/** 409 si el `user_ppp` ya existe. */
export async function exigirUserPppLibre(t: Transaccion, userPpp: string) {
    const repetido = await t.trx.from('core.servicios').where('user_ppp', userPpp).first()
    if (repetido) throw new Conflicto(`El user_ppp ${userPpp} ya existe`, 'user_ppp_duplicado')
}

/**
 * Alta de un servicio: valida cliente, router activo, plan disponible en el router y plantilla.
 * - `pppoe` (por defecto): genera `user_ppp` y `pass_ppp` si no vienen (la contraseña se guarda
 *   cifrada v1).
 * - `ip_estatica` / `dhcp_fija`: sin credenciales; IPv4 obligatoria de las redes del router;
 *   `dhcp_fija` exige `mac` (`validarTipoConexion`).
 *
 * Con `estado_inicial: pendiente_instalacion` nace pendiente (sin `instalado_en`); por defecto activo.
 *
 * Asigna IPv4 y reserva prefijos IPv6 según el modo; guarda las excepciones a la plantilla
 * (validadas por A3); emite `servicio.creado` y `asignacion.cambiada`. Asigna los adicionales que
 * trae el plan para la empresa del servicio (`modalidad: incluido`, `servicio.adicional_agregado`).
 */
export default class CrearServicio extends DomainAction<EntradaCrearServicio, ServicioConAdvertencias> {
    readonly nombre = 'servicios.crear'

    protected async handle(input: EntradaCrearServicio, t: Transaccion): Promise<ServicioConAdvertencias> {
        const cliente = (await t.trx
            .from('core.clientes')
            .where('id', input.cliente_id)
            .select('nombre', 'zona_id')
            .first()) as {
            nombre: string
            zona_id: number | null
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
        const empresaId = await resolverEmpresaServicio(t.trx, t.ctx, {
            empresa_id: input.empresa_id,
            zona_id: cliente.zona_id === null ? null : Number(cliente.zona_id),
            router_id: input.router_id,
        })
        t.fijarEmpresa(empresaId)
        let plantillaId = input.plantilla_facturacion_id ?? null
        if (input.plantilla_facturacion_id === undefined && input.plantillaPorDefecto) {
            plantillaId = await plantillaPorDefecto(t.trx)
        }
        if (plantillaId) {
            await exigirReferencia(
                t,
                'billing.plantillas_facturacion',
                plantillaId,
                'plantilla_facturacion_id',
            )
        }
        await exigirReferencia(t, 'network.planes', input.plan_id, 'plan_id')
        const plan = await obtenerImplementacionPlan(input.plan_id, input.router_id, t.trx)
        if (!plan.activo) throw new ReglaNegocio(`El plan ${plan.nombre} está inactivo`, 'plan_inactivo')

        const excepciones = input.excepciones ? await validarExcepciones(input.excepciones) : {}

        const tipo = input.tipo_conexion ?? 'pppoe'
        const modo = input.ipv6_modo ?? modoIpv6PorDefecto(plan, tipo)
        validarTipoConexion(plan, {
            tipo,
            modo,
            mac: input.mac,
            amarre: input.amarre_ip_mac ?? false,
            user_ppp: input.user_ppp,
            pass_ppp: input.pass_ppp,
        })
        validarModoIpv6(plan, modo, input)
        // un router sin RADIUS (`modo_seguridad = 'api'`) no admite PPPoE (`#network/modo_seguridad`)
        await exigirPppoeAdmitido(t.trx, input.router_id, tipo)

        const contactoTelefono =
            telefonoParaGuardar('contacto_telefono', input.contacto_telefono, undefined, t.ctx) ?? null

        let userPpp: string | null = null
        let passPpp: string | null = null
        if (tipo === 'pppoe') {
            userPpp = input.user_ppp ?? (await generarUserPpp(t.trx, input.cliente_id, cliente.nombre))
            await exigirUserPppLibre(t, userPpp)
            passPpp = cifrar(input.pass_ppp ?? generarPassPpp())
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('core.servicios')
            .insert({
                cliente_id: input.cliente_id,
                empresa_id: empresaId,
                router_id: input.router_id,
                plan_id: input.plan_id,
                plantilla_facturacion_id: plantillaId,
                tipo_conexion: tipo,
                amarre_ip_mac: input.amarre_ip_mac ?? false,
                user_ppp: userPpp,
                pass_ppp: passPpp,
                mac: input.mac ?? null,
                direccion: input.direccion ?? null,
                referencia: input.referencia ?? null,
                contacto_nombre: input.contacto_nombre ?? null,
                contacto_telefono: contactoTelefono,
                coordenadas: input.coordenadas ?? null,
                fecha_instalacion: input.fecha_instalacion ?? null,
                costo_override: input.costo_override ?? null,
                excluir_firewall: input.excluir_firewall ?? false,
                ipv6_modo: modo,
                ipv6_duid: input.ipv6_duid ?? null,
                ...(input.estado_inicial === 'pendiente_instalacion'
                    ? { estado: 'pendiente_instalacion', instalado_en: null }
                    : {}),
            })
            .returning('id')) as Array<{ id: number }>
        const id = fila!.id
        t.fijarEntidad('servicio', id)
        await vincularExterno(t.trx, 'servicio', id, input.externo)

        const asignaciones = await reconciliarAsignaciones(t.trx, {
            servicioId: id,
            routerId: input.router_id,
            plan,
            modo,
            tipoConexion: tipo,
            ipv4: input.ipv4,
            redIpv4Id: input.red_ipv4_id,
            prefijoEstatico: input.prefijo_delegado_v6,
        })

        await registrarTramo(t.trx, id, 'alta')
        await guardarExcepciones(t.trx, id, excepciones)

        const servicio = await verServicio(id, t.trx)
        await t.registrarCambios({ tipo: 'servicio', id }, null, {
            ...paraAuditoriaServicio(servicio),
            ...(tipo === 'pppoe' ? { pass_ppp: 'definida' } : {}),
        })
        await t.emit('servicio.creado', {
            servicio_id: id,
            empresa_id: empresaId,
            cliente_id: input.cliente_id,
            router_id: input.router_id,
            plan_id: input.plan_id,
        })
        await t.emit('asignacion.cambiada', {
            servicio_id: id,
            empresa_id: empresaId,
            ipv4: asignaciones.ipv4 ? [asignaciones.ipv4] : [],
            prefijo_enlace_v6: asignaciones.prefijo_enlace_v6,
            prefijo_delegado_v6: asignaciones.prefijo_delegado_v6,
            inicio: new Date().toISOString(),
            fin: null,
        })
        await reconciliarIncluidos(
            t,
            { id, empresa_id: empresaId, cliente_id: input.cliente_id },
            input.plan_id,
            'cambio_plan',
        )
        refrescarAaaAlConfirmar(t, { servicioId: id })
        return { ...servicio, warnings: await advertenciasServicio(t.trx, id) }
    }
}
