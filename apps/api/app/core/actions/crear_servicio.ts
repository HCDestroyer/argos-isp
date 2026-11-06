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
import { resolverServidorServicio } from '#network/red_acceso/servicio'
import { exigirTipoDelRouter } from '#network/tipo_conexion_router'

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
    /**
     * El del router (`network.routers.tipo_conexion`; `contratos/tipo-conexion-router.md`). Opcional: si
     * llega distinto, 422 `tipo_conexion_del_router`. `ip_estatica` y `dhcp_fija` van sin credenciales
     * (`contratos/routeros.md`).
     */
    tipo_conexion?: TipoConexion
    /**
     * Solo interno (importador, nunca por la API): el servicio ya existe en el sistema de origen con su
     * tipo y se conserva aunque difiera del router (como los servicios anteriores a la regla).
     */
    conservarTipo?: boolean
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
    /**
     * Servidor PPPoE del router (`contratos/red-acceso.md` §3). Sin él se deriva de la red; con varios
     * candidatos, 422 `servidor_pppoe_requerido`. La IPv4 sale de su red y los prefijos de sus pools.
     */
    servidor_pppoe_id?: number | null
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

/**
 * Reserva el `user_ppp` para el servicio (`servicioId`; sin él, un alta) dentro de la transacción:
 * - advisory lock por usuario: dos altas o renombres a la vez al mismo usuario se serializan y el
 *   segundo ve el primero confirmado (409 `user_ppp_duplicado`, nunca el 23505 genérico);
 * - 409 `user_ppp_duplicado` si otro servicio lo tiene, también uno retirado (su usuario no se
 *   reutiliza: bitácora, sesiones y el CPE viejo que sigue marcando con él);
 * - 409 `user_ppp_en_sesion` si hay una sesión abierta con ese usuario que no es del servicio (el
 *   usuario se liberó por renombre o eliminación y el NAS todavía no cerró la sesión vieja). Se
 *   libera solo al cerrarse la sesión (Stop, Disconnect o `sesiones.cerrar_colgadas`), sin TTL.
 * Distingue mayúsculas, como RADIUS (`aaa` busca la clave exacta) y el `/ppp secret` de RouterOS.
 */
export async function exigirUserPppLibre(t: Transaccion, userPpp: string, servicioId?: number) {
    await t.trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('core:user_ppp:' || ?::text))`, [userPpp])
    const repetido = (await t.trx
        .from('core.servicios')
        .where('user_ppp', userPpp)
        .if(servicioId !== undefined, (q) => q.whereNot('id', servicioId!))
        .select('id')
        .first()) as { id: number } | null
    if (repetido) {
        throw new Conflicto(
            `El user_ppp ${userPpp} ya existe en el servicio ${repetido.id}`,
            'user_ppp_duplicado',
        )
    }
    const sesion = (await t.trx
        .from('network.sesiones')
        .where('user_ppp', userPpp)
        .whereNull('fin')
        // del propio servicio sí: vuelve a su usuario (A→B→A) con la sesión vieja todavía abierta
        .if(servicioId !== undefined, (q) =>
            q.where((w) => w.whereNull('servicio_id').orWhereNot('servicio_id', servicioId!)),
        )
        .select('id')
        .first()) as { id: number } | null
    if (sesion) {
        throw new Conflicto(
            `El user_ppp ${userPpp} tiene todavía una sesión abierta (${sesion.id}) de otro servicio: ` +
                'se puede usar cuando el router la cierre',
            'user_ppp_en_sesion',
            'Usuario PPPoE en uso',
        )
    }
}

/**
 * Alta de un servicio: valida cliente, router activo, plan disponible en el router y plantilla.
 * El tipo de conexión es el del router (`contratos/tipo-conexion-router.md`): `tipo_conexion` es
 * opcional y, si llega distinto, 422 `tipo_conexion_del_router`.
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
            .select('activo', 'tipo_conexion')
            .first()) as {
            activo: boolean
            tipo_conexion: TipoConexion
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

        // el tipo lo define el router (decisión del PM, 5 nov); distinto → 422 `tipo_conexion_del_router`
        if (!input.conservarTipo) exigirTipoDelRouter(router.tipo_conexion, input.tipo_conexion)
        const tipo = input.conservarTipo
            ? (input.tipo_conexion ?? router.tipo_conexion)
            : router.tipo_conexion
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

        const servidor = await resolverServidorServicio(t.trx, {
            routerId: input.router_id,
            tipo,
            empresaId,
            servidorId: input.servidor_pppoe_id,
            ipv4: input.ipv4,
            redIpv4Id: input.red_ipv4_id,
        })

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
                servidor_pppoe_id: servidor?.id ?? null,
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
            // sin IP ni red pedidas, la IPv4 sale de la red del servidor PPPoE
            redIpv4Id: input.red_ipv4_id ?? (input.ipv4 ? undefined : (servidor?.red_ipv4_id ?? undefined)),
            prefijoEstatico: input.prefijo_delegado_v6,
            poolsV6: servidor
                ? { enlace: servidor.ipv6_pool_enlace_id, delegacion: servidor.ipv6_pool_delegacion_id }
                : undefined,
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
