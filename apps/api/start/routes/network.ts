/*
|--------------------------------------------------------------------------
| Rutas de red (A1; sesiones: A2): routers, IPAM IPv4/IPv6, planes, sesiones
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import * as v from '#network/validators'
import { alcanceDePermiso, exigirAlcance, filtrarPorAlcance } from '#core/acl'
import db from '@adonisjs/lucid/services/db'
import CrearRouter from '#network/actions/crear_router'
import EditarRouter from '#network/actions/editar_router'
import UnirRouters from '#network/actions/unir_routers'
import { gruposDuplicados } from '#network/routers_duplicados'
import EliminarRouter from '#network/actions/eliminar_router'
import { routerEliminable } from '#network/eliminacion'
import { Eliminable } from '#core/esquemas'
import CambiarControlVelocidad from '#network/actions/cambiar_control_velocidad'
import CrearRedIpv4 from '#network/actions/crear_red_ipv4'
import { listarRedesIpv4, listarRouters, verRouter } from '#network/consultas/routers'
import { empresasDeLaLista } from '#shared/empresa_activa'
import {
    Ipv6Bloque,
    Ipv6Pool,
    Plan,
    PlanEfectivo,
    PlanRouter,
    VistaPreviaVelocidad,
    RedIpv4,
    Router,
    Sesion,
    EventoRed,
    ResumenSesionesRouter,
    MigracionAaaRouter,
    VistaPreviaControl,
    GrupoRoutersDuplicados,
    UnionRouters,
    DireccionamientoRouter,
    MigracionPools,
    VistaPreviaBloqueIpv6,
    VistaPreviaPoolIpv6,
} from '#network/esquemas'
import CrearBloqueIpv6 from '#network/actions/crear_bloque_ipv6'
import CrearPoolIpv6 from '#network/actions/crear_pool_ipv6'
import EditarRedIpv4 from '#network/actions/editar_red_ipv4'
import EditarBloqueIpv6 from '#network/actions/editar_bloque_ipv6'
import EditarPoolIpv6 from '#network/actions/editar_pool_ipv6'
import MigrarRedIpv4 from '#network/actions/migrar_red_ipv4'
import MigrarBloqueIpv6 from '#network/actions/migrar_bloque_ipv6'
import { listarBloques, listarPools, verBloque, verPool } from '#network/consultas/ipv6'
import { verRedIpv4 } from '#network/consultas/routers'
import {
    direccionamientoRouter,
    vistaPreviaBloqueIpv6,
    vistaPreviaPoolIpv6,
} from '#network/consultas/direccionamiento'
import { alcancesDelToken } from '#middleware/autorizar_middleware'
import { Prohibido } from '#shared/errores'
import type { HttpContext } from '@adonisjs/core/http'
import type { Permiso } from '#core/permisos'
import CrearPlan, { exigirVelocidadValida } from '#network/actions/crear_plan'
import EditarPlan from '#network/actions/editar_plan'
import ImplementarPlan from '#network/actions/implementar_plan'
import { planesDisponiblesEnRouter } from '#network/actions/obtener_implementacion_plan'
import { implementacionesDePlan, listarPlanes, verPlan } from '#network/consultas/planes'
import {
    dimensionesDeSesion,
    listarSesiones,
    resumenSesionesRouter,
    verSesion,
} from '#network/sesiones/consultas'
import DesconectarSesion from '#network/sesiones/actions/desconectar_sesion'
import { listarEventosRed } from '#network/sesiones/eventos_red'
import { verMigracionAaa } from '#network/sesiones/migracion_aaa'
import MarcarRouterMigrado from '#network/sesiones/actions/marcar_router_migrado'
import { registrarSeccionMetricas } from '#monitoreo/metricas'
import { leerMetricasRouterOS } from '#network/routeros/metricas'
import { VELOCIDAD_POR_DEFECTO, vistaPreviaVelocidad, type VelocidadPlan } from '#network/velocidad'
import { vistaPreviaControl } from '#network/routeros/cambio_control'
import velocidad from '#start/routes/velocidad'
import qos from '#start/routes/qos'
import {
    ConexionRouter,
    PeersWireguard,
    PruebaConexion,
    ReconciliacionEncolada,
    RegistroConexion,
    SincronizacionServicio,
} from '#network/esquemas'
import ProbarConexion from '#network/conexion/actions/probar_conexion'
import SincronizarRouterServicio from '#network/actions/sincronizar_router_servicio'
import { exigirServicio } from '#core/acceso_empresa'
import ReconciliarAhora from '#network/conexion/actions/reconciliar_ahora'
import { parsearAdmin } from '#network/conexion/config'
import { listarPeers, verConexion } from '#network/conexion/consultas'
import { limitarRegistro } from '#network/conexion/limite_registro'
import GenerarScript, { type ScriptConexion } from '#network/conexion/actions/generar_script'
import RotarConexion from '#network/conexion/actions/rotar_conexion'
import RegistrarConexion from '#network/conexion/actions/registrar_conexion'
import ConexionClave from '#network/conexion/actions/conexion_clave'
import RegistrarEstadoWireguard from '#network/conexion/actions/registrar_estado_wireguard'

/** 403 si el actor no tiene además `permiso` (la ruta ya exigió el suyo). */
async function exigirPermisoExtra(ctx: HttpContext, permiso: Permiso, motivo: string) {
    const usuario = ctx.auth.user
    const alcance = usuario ? await alcanceDePermiso(usuario.id, permiso, alcancesDelToken(ctx)) : null
    if (!alcance) throw new Prohibido(`Para ${motivo} necesitas además el permiso ${permiso}`)
    return alcance
}

/**
 * Migrar pools (`contratos/pools.md` §3): alcance sobre el router de origen y el de destino;
 * mudar también bloques o redes pide el permiso de esa familia, y mover servicios pide
 * `servicios.editar` con alcance sobre el destino.
 */
async function exigirMigracion(
    ctx: HttpContext,
    origen: number,
    cuerpo: { router_id: number; mover_servicios?: boolean },
    extra: { permiso: Permiso; ids: number[] | undefined; motivo: string },
) {
    exigirAlcance(ctx.alcance, { router: [origen] })
    exigirAlcance(ctx.alcance, { router: [cuerpo.router_id] })
    if (extra.ids?.length) await exigirPermisoExtra(ctx, extra.permiso, extra.motivo)
    if (cuerpo.mover_servicios) {
        const alcance = await exigirPermisoExtra(ctx, 'servicios.editar', 'mover los servicios del pool')
        exigirAlcance(alcance, { router: [origen] })
        exigirAlcance(alcance, { router: [cuerpo.router_id] })
    }
}

// A2: colas simples por router en `/metrics` (lo que leyó el reconciliador; el scrape no toca el router).
registrarSeccionMetricas('routeros', leerMetricasRouterOS)

const routers: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/routers',
        operacion: 'routersListar',
        resumen: 'Listar routers',
        etiqueta: 'routers',
        permiso: 'routers.ver',
        query: v.listarRoutersValidator,
        respuesta: { status: 200, descripcion: 'Página de routers', esquema: pagina(Router) },
        handler: (ctx, { query }) =>
            listarRouters(query, ctx.alcance, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers',
        operacion: 'routersCrear',
        resumen: 'Crear router',
        descripcion:
            'Con `modo_seguridad: radius` (por defecto) la `nas_ip` es obligatoria (422 en `nas_ip`). Con `api` es un ' +
            'router sin RADIUS (solo ip_estatica y dhcp_fija por la API REST): `nas_ip` y `radius_secret` son ' +
            'opcionales. 409 `router_duplicado` si el MikroTik ya está registrado.',
        etiqueta: 'routers',
        permiso: 'routers.crear',
        cuerpo: v.crearRouterValidator,
        respuesta: { status: 201, descripcion: 'Router creado', esquema: Router },
        handler: (ctx, { cuerpo }) => new CrearRouter().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/duplicados',
        operacion: 'routersDuplicados',
        resumen: 'Routers activos que parecen el mismo MikroTik (para unirlos)',
        descripcion:
            'Grupos de routers activos que comparten la dirección de la API (host:puerto), la nas_ip o el número de ' +
            'serie del equipo (que lee el sondeo), con sus servicios. Con `router_id`, solo el grupo de ese router ' +
            '(aviso en la ficha); lista vacía si no tiene duplicados. Se resuelven con POST /routers/:id/unir ' +
            '(contratos/routers.md §2).',
        etiqueta: 'routers',
        permiso: 'routers.ver',
        query: v.duplicadosRoutersValidator,
        respuesta: {
            status: 200,
            descripcion: 'Grupos de duplicados',
            esquema: lista(GrupoRoutersDuplicados),
        },
        handler: async (ctx, { query }) => {
            let visibles: number[] | null = null
            if (ctx.alcance) {
                const consulta = db.from('network.routers').select('id')
                filtrarPorAlcance(consulta, ctx.alcance, { router: (q, ids) => q.whereIn('id', ids) })
                visibles = ((await consulta) as Array<{ id: number }>).map((f) => Number(f.id))
            }
            return gruposDuplicados({ routerId: query.router_id, routers: visibles })
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id',
        operacion: 'routersVer',
        resumen: 'Ver router',
        etiqueta: 'routers',
        permiso: 'routers.ver',
        respuesta: { status: 200, descripcion: 'Router', esquema: Router },
        handler: (ctx, { params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return verRouter(Number(params.id))
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/routers/:id',
        operacion: 'routersEditar',
        resumen: 'Editar router',
        descripcion:
            'Un router que queda en `radius` necesita `nas_ip` (422 en `nas_ip`; `nas_ip: null` solo en `api`). ' +
            'Pasar a `api` con servicios pppoe no retirados: 422 `servicios_pppoe_en_router` con un `errors[]` por ' +
            'servicio (`field: servicios.<id>`, hasta 50). Cambiar `modo_seguridad`, `nas_ip` o `radius_secret` emite ' +
            '`router.radius_cambiado`.',
        etiqueta: 'routers',
        permiso: 'routers.editar',
        cuerpo: v.editarRouterValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Router actualizado', esquema: Router },
        handler: (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return new EditarRouter().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/eliminable',
        operacion: 'routersEliminable',
        resumen: '¿Se puede eliminar el router? (nunca se usó) y, si no, qué lo impide',
        descripcion: 'Para que el panel muestre «Eliminar» o «Desactivar». Contrato `contratos/eliminar.md`.',
        etiqueta: 'routers',
        permiso: 'routers.ver',
        respuesta: { status: 200, descripcion: 'Si es eliminable y los motivos', esquema: Eliminable },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            const router = await verRouter(id) // 404 si no existe
            return routerEliminable(id, router.nas_ip)
        },
    }),
    definirRuta({
        metodo: 'delete',
        ruta: '/routers/:id',
        operacion: 'routersEliminar',
        resumen: 'Eliminar un router que nunca se usó (si tiene historial: 422, desactívalo)',
        descripcion:
            'Solo admin. Con servicios (también retirados), sesiones, historial, asignaciones en sus redes, comandos ' +
            'enviados al equipo, bodegas o alcances responde 422 `router_con_historial` con `errors[]`. Borra sus ' +
            'redes IPv4, bloques y pools IPv6, `planes_routers` y su conexión, y emite `router.eliminado`. ' +
            'Contrato `contratos/eliminar.md`.',
        etiqueta: 'routers',
        permiso: 'routers.eliminar',
        query: v.eliminarRouterValidator,
        idempotente: true,
        versionada: true,
        respuesta: { status: 204, descripcion: 'Router eliminado' },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            await new EliminarRouter().execute({ id, version: query.version }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/cambiar-control-velocidad',
        operacion: 'routersCambiarControlVelocidad',
        resumen: 'Cambiar el control de velocidad del router (simple o arbol_pcq)',
        descripcion:
            'Solo cambia el campo y emite `router.control_cambiado`; la ejecución en el router (colas, árbol, PCQ) ' +
            'es del dispatcher. Si ya está en ese modo responde 200 sin evento. 409 si la `version` no coincide.',
        etiqueta: 'routers',
        permiso: 'routers.cambiar_control_velocidad',
        cuerpo: v.cambiarControlVelocidadValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Router con el control nuevo', esquema: Router },
        handler: (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return new CambiarControlVelocidad().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/unir',
        operacion: 'routersUnir',
        resumen: 'Unir dos registros del mismo MikroTik (el router :id absorbe a absorber_id)',
        descripcion:
            'Solo admin. Pasan al router :id las implementaciones de planes (si los dos implementan el mismo plan, ' +
            'gana la de :id y se avisa), las redes IPv4, los bloques y pools IPv6, los servicios no retirados (cada ' +
            'uno con servicios.editar anidada: auditoría, servicio.config_cambiada con router y motivo ' +
            'union_routers, aaa y RouterOS por evento, sin cambiar sus direcciones) y las sesiones abiertas. El ' +
            'absorbido queda desactivado con unido_a_id. `version` es la del router :id (409 si cambió). ' +
            '`simular: true` devuelve lo que pasaría con sus avisos sin guardar nada. 422 `router_unido`, ' +
            '`router_inactivo`, `servicio_no_unible` o `secreto_radius_distinto` (primero el mismo secreto RADIUS en el ' +
            'equipo y en Argos; la simulación lo devuelve en `bloqueos`). Los routers ya unidos al absorbido pasan a ' +
            'apuntar al que queda (contratos/routers.md §3).',
        etiqueta: 'routers',
        permiso: 'routers.unir',
        cuerpo: v.unirRoutersValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Unión (o su simulación)', esquema: UnionRouters },
        handler: (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            exigirAlcance(ctx.alcance, { router: [cuerpo.absorber_id] })
            const entrada = { id, version: cuerpo.version, absorber_id: cuerpo.absorber_id }
            return cuerpo.simular
                ? UnirRouters.simular(entrada, ctx.contextoAccion())
                : new UnirRouters().execute(entrada, ctx.contextoAccion())
        },
    }),
    // A2: vista previa del cambio de modo (lo ejecuta el worker de RouterOS con el evento).
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/vista-previa-control',
        operacion: 'routersVistaPreviaControl',
        resumen: 'Vista previa del cambio de control de velocidad (qué se crea y qué se borra)',
        descripcion:
            'Calcula, con los datos vigentes y sin tocar el router, los objetos que el cambio a `a` crea, ' +
            'corrige y borra (colas, árbol, PCQ, mangle, address-lists, perfiles PPP), los lotes y las ' +
            'sesiones PPPoE que reciben Disconnect. Con `a` igual al modo actual, todo vacío. 404 si el router no existe.',
        etiqueta: 'routers',
        permiso: 'routers.cambiar_control_velocidad',
        query: v.vistaPreviaControlValidator,
        respuesta: { status: 200, descripcion: 'Vista previa', esquema: VistaPreviaControl },
        handler: (ctx, { query, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return vistaPreviaControl(Number(params.id), query.a)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/redes-ipv4',
        operacion: 'redesIpv4Listar',
        resumen: 'Redes IPv4 del router',
        etiqueta: 'ipam',
        permiso: 'redes.ver',
        respuesta: { status: 200, descripcion: 'Redes IPv4', esquema: lista(RedIpv4) },
        handler: (ctx, { params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return listarRedesIpv4(Number(params.id))
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/redes-ipv4',
        operacion: 'redesIpv4Crear',
        resumen: 'Agregar red IPv4 al router',
        etiqueta: 'ipam',
        permiso: 'redes.crear',
        cuerpo: v.crearRedIpv4Validator,
        respuesta: { status: 201, descripcion: 'Red creada', esquema: RedIpv4 },
        handler: (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return new CrearRedIpv4().execute(
                { ...cuerpo, router_id: Number(params.id) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/ipv6-bloques',
        operacion: 'ipv6BloquesListar',
        resumen: 'Bloques IPv6 del router',
        etiqueta: 'ipam',
        permiso: 'ipv6.ver',
        respuesta: { status: 200, descripcion: 'Bloques IPv6', esquema: lista(Ipv6Bloque) },
        handler: (ctx, { params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return listarBloques(Number(params.id))
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/ipv6-bloques',
        operacion: 'ipv6BloquesCrear',
        resumen: 'Agregar bloque IPv6 al router',
        etiqueta: 'ipam',
        permiso: 'ipv6.crear',
        cuerpo: v.crearBloqueIpv6Validator,
        respuesta: { status: 201, descripcion: 'Bloque creado', esquema: Ipv6Bloque },
        handler: (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return new CrearBloqueIpv6().execute(
                { ...cuerpo, router_id: Number(params.id) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/ipv6-bloques/:id/pools',
        operacion: 'ipv6PoolsListar',
        resumen: 'Pools IPv6 de un bloque',
        etiqueta: 'ipam',
        permiso: 'ipv6.ver',
        respuesta: { status: 200, descripcion: 'Pools IPv6', esquema: lista(Ipv6Pool) },
        handler: async (ctx, { params }) => {
            const bloque = await verBloque(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [bloque.router_id] })
            return listarPools(bloque.id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/ipv6-bloques/:id/pools',
        operacion: 'ipv6PoolsCrear',
        resumen: 'Crear pool IPv6 (enlace /64 o delegación /56, /48)',
        etiqueta: 'ipam',
        permiso: 'ipv6.crear',
        cuerpo: v.crearPoolIpv6Validator,
        respuesta: { status: 201, descripcion: 'Pool creado', esquema: Ipv6Pool },
        handler: async (ctx, { cuerpo, params }) => {
            const bloque = await verBloque(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [bloque.router_id] })
            return new CrearPoolIpv6().execute({ ...cuerpo, bloque_id: bloque.id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/direccionamiento',
        operacion: 'routersDireccionamiento',
        resumen: 'Direccionamiento del router: pools con ocupación y qué recibe cada servicio',
        descripcion:
            'Redes IPv4 y bloques IPv6 (con sus pools) del router, cada uno con su ocupación; totales por ' +
            'familia y, por cada plan disponible en el router, de dónde sale la IPv4, qué prefijos IPv6 recibe ' +
            'un servicio nuevo (modo radius_servicio) y avisos si faltan pools o direcciones libres ' +
            '(contratos/pools.md §2 y §4). 404 si el router no existe.',
        etiqueta: 'ipam',
        permiso: 'routers.ver',
        respuesta: { status: 200, descripcion: 'Direccionamiento', esquema: DireccionamientoRouter },
        handler: (ctx, { params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return direccionamientoRouter(Number(params.id))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/redes-ipv4/:id',
        operacion: 'redesIpv4Ver',
        resumen: 'Ver red IPv4 (con su ocupación)',
        etiqueta: 'ipam',
        permiso: 'redes.ver',
        respuesta: { status: 200, descripcion: 'Red IPv4', esquema: RedIpv4 },
        handler: async (ctx, { params }) => {
            const red = await verRedIpv4(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [red.router_id] })
            return red
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/redes-ipv4/:id',
        operacion: 'redesIpv4Editar',
        resumen: 'Editar red IPv4: nombre, red, gateway, rango, DNS y tipo',
        descripcion:
            'Agrandar o achicar la red, mover el gateway o cambiar el rango: 422 `ips_asignadas_fuera` con la ' +
            'lista en `errors[]` si alguna IP asignada quedaría fuera; 409 `red_traslapada` si se traslapa con ' +
            'otra red; 409 `conflicto_version` si la `version` no coincide (contratos/pools.md §1).',
        etiqueta: 'ipam',
        permiso: 'redes.editar',
        cuerpo: v.editarRedIpv4Validator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Red actualizada', esquema: RedIpv4 },
        handler: async (ctx, { cuerpo, params }) => {
            const red = await verRedIpv4(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [red.router_id] })
            return new EditarRedIpv4().execute({ ...cuerpo, id: red.id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/redes-ipv4/:id/migrar',
        operacion: 'redesIpv4Migrar',
        resumen: 'Pasar la red IPv4 a otro router',
        descripcion:
            'Sin `mover_servicios`, si algún servicio usa IPs de la red responde 422 `pool_con_servicios` con ' +
            'la lista. Con `mover_servicios: true` (pide además `servicios.editar`) cada servicio pasa al router ' +
            'de destino conservando su IPv4; su IPv6 se vuelve a reservar en el destino salvo que sus bloques ' +
            'se muden también (`bloques_ipv6`, pide `ipv6.migrar`). Si un servicio no puede pasar, 422 ' +
            '`servicio_no_migrable` y no cambia nada. `simular: true` devuelve lo que pasaría sin guardar ' +
            '(contratos/pools.md §3).',
        etiqueta: 'ipam',
        permiso: 'redes.migrar',
        cuerpo: v.migrarRedIpv4Validator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Migración (o su simulación)', esquema: MigracionPools },
        handler: async (ctx, { cuerpo, params }) => {
            const red = await verRedIpv4(Number(params.id))
            await exigirMigracion(ctx, red.router_id, cuerpo, {
                permiso: 'ipv6.migrar',
                ids: cuerpo.bloques_ipv6,
                motivo: 'mudar también bloques IPv6',
            })
            const { simular, ...entrada } = cuerpo
            const datos = { ...entrada, id: red.id }
            return simular
                ? MigrarRedIpv4.simular(datos, ctx.contextoAccion())
                : new MigrarRedIpv4().execute(datos, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/ipv6-bloques/vista-previa',
        operacion: 'ipv6BloquesVistaPrevia',
        resumen: 'Vista previa de un bloque IPv6: cuántos clientes caben y qué recibe cada uno (no guarda)',
        descripcion:
            'Sugiere la división del bloque: la segunda mitad para el pool de delegación (`tamano_delegado` por ' +
            'cliente) y, al inicio de la primera, el pool de enlace /64 para la misma cantidad de clientes. ' +
            'Incluye lo que recibirían los dos primeros servicios. 422 si el bloque es muy chico ' +
            '(contratos/pools.md §4).',
        etiqueta: 'ipam',
        permiso: 'ipv6.ver',
        cuerpo: v.vistaPreviaBloqueIpv6Validator,
        respuesta: { status: 200, descripcion: 'Vista previa', esquema: VistaPreviaBloqueIpv6 },
        handler: (_ctx, { cuerpo }) => vistaPreviaBloqueIpv6(cuerpo),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/ipv6-bloques/:id',
        operacion: 'ipv6BloquesVer',
        resumen: 'Ver bloque IPv6',
        etiqueta: 'ipam',
        permiso: 'ipv6.ver',
        respuesta: { status: 200, descripcion: 'Bloque IPv6', esquema: Ipv6Bloque },
        handler: async (ctx, { params }) => {
            const bloque = await verBloque(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [bloque.router_id] })
            return bloque
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/ipv6-bloques/:id',
        operacion: 'ipv6BloquesEditar',
        resumen: 'Editar bloque IPv6: nombre, proveedor y prefijo',
        descripcion:
            'Achicar el prefijo dejando fuera algún pool: 422 `pools_fuera_del_bloque` con la lista; traslape ' +
            'con otro bloque: 409 `bloque_traslapado`; `version` distinta: 409 (contratos/pools.md §1).',
        etiqueta: 'ipam',
        permiso: 'ipv6.editar',
        cuerpo: v.editarBloqueIpv6Validator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Bloque actualizado', esquema: Ipv6Bloque },
        handler: async (ctx, { cuerpo, params }) => {
            const bloque = await verBloque(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [bloque.router_id] })
            return new EditarBloqueIpv6().execute({ ...cuerpo, id: bloque.id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/ipv6-bloques/:id/migrar',
        operacion: 'ipv6BloquesMigrar',
        resumen: 'Pasar el bloque IPv6 (con todos sus pools) a otro router',
        descripcion:
            'Un pool se muda con su bloque. Sin `mover_servicios`, si algún servicio usa prefijos del bloque ' +
            'responde 422 `pool_con_servicios` con la lista. Con `mover_servicios: true` (pide además ' +
            '`servicios.editar`) cada servicio pasa al router de destino conservando sus prefijos; su IPv4 se ' +
            'vuelve a asignar en el destino salvo que su red se mude también (`redes_ipv4`, pide `redes.migrar`). ' +
            'Si un servicio no puede pasar, 422 `servicio_no_migrable` y no cambia nada. `simular: true` ' +
            'devuelve lo que pasaría sin guardar (contratos/pools.md §3).',
        etiqueta: 'ipam',
        permiso: 'ipv6.migrar',
        cuerpo: v.migrarBloqueIpv6Validator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Migración (o su simulación)', esquema: MigracionPools },
        handler: async (ctx, { cuerpo, params }) => {
            const bloque = await verBloque(Number(params.id))
            await exigirMigracion(ctx, bloque.router_id, cuerpo, {
                permiso: 'redes.migrar',
                ids: cuerpo.redes_ipv4,
                motivo: 'mudar también redes IPv4',
            })
            const { simular, ...entrada } = cuerpo
            const datos = { ...entrada, id: bloque.id }
            return simular
                ? MigrarBloqueIpv6.simular(datos, ctx.contextoAccion())
                : new MigrarBloqueIpv6().execute(datos, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/ipv6-pools/vista-previa',
        operacion: 'ipv6PoolsVistaPrevia',
        resumen: 'Vista previa de un pool IPv6: cuántos clientes caben y qué recibe cada uno (no guarda)',
        etiqueta: 'ipam',
        permiso: 'ipv6.ver',
        cuerpo: v.vistaPreviaPoolIpv6Validator,
        respuesta: { status: 200, descripcion: 'Vista previa', esquema: VistaPreviaPoolIpv6 },
        handler: (_ctx, { cuerpo }) => vistaPreviaPoolIpv6(cuerpo),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/ipv6-pools/:id',
        operacion: 'ipv6PoolsVer',
        resumen: 'Ver pool IPv6 (con su ocupación y lo que entrega)',
        etiqueta: 'ipam',
        permiso: 'ipv6.ver',
        respuesta: { status: 200, descripcion: 'Pool IPv6', esquema: Ipv6Pool },
        handler: async (ctx, { params }) => {
            const pool = await verPool(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [pool.router_id] })
            return pool
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/ipv6-pools/:id',
        operacion: 'ipv6PoolsEditar',
        resumen: 'Editar pool IPv6: nombre, nombre en el router, prefijo, tipo y tamaño de entrega',
        descripcion:
            'Achicar o mover el prefijo dejando fuera prefijos asignados: 422 `prefijos_asignados_fuera` con la ' +
            'lista. `tipo` y `tamano_entrega` solo cambian en un pool sin asignaciones (422 ' +
            '`pool_con_asignaciones`). Traslape: 409 `pool_traslapado`; `version` distinta: 409 ' +
            '(contratos/pools.md §1).',
        etiqueta: 'ipam',
        permiso: 'ipv6.editar',
        cuerpo: v.editarPoolIpv6Validator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Pool actualizado', esquema: Ipv6Pool },
        handler: async (ctx, { cuerpo, params }) => {
            const pool = await verPool(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [pool.router_id] })
            return new EditarPoolIpv6().execute({ ...cuerpo, id: pool.id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/planes',
        operacion: 'routersPlanes',
        resumen: 'Planes disponibles en el router (configuración efectiva)',
        etiqueta: 'planes',
        permiso: 'planes.ver',
        respuesta: { status: 200, descripcion: 'Planes disponibles', esquema: lista(PlanEfectivo) },
        handler: (ctx, { params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return planesDisponiblesEnRouter(Number(params.id))
        },
    }),
]

const planes: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/planes',
        operacion: 'planesListar',
        resumen: 'Listar planes',
        etiqueta: 'planes',
        permiso: 'planes.ver',
        query: v.listarPlanesValidator,
        respuesta: { status: 200, descripcion: 'Página de planes', esquema: pagina(Plan) },
        handler: (_ctx, { query }) => listarPlanes(query),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/planes',
        operacion: 'planesCrear',
        resumen: 'Crear plan',
        etiqueta: 'planes',
        permiso: 'planes.crear',
        cuerpo: v.crearPlanValidator,
        respuesta: { status: 201, descripcion: 'Plan creado', esquema: Plan },
        handler: (ctx, { cuerpo }) => new CrearPlan().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/planes/vista-previa',
        operacion: 'planesVistaPrevia',
        resumen: 'Vista previa del rate-limit de un plan (no guarda)',
        descripcion:
            'Calcula con `app/network/velocidad.ts` (la misma función que usan aaa y el dispatcher) el ' +
            '`Mikrotik-Rate-Limit` activo y limitado y los límites de la cola padre con `activos` servicios. ' +
            '422 por campo con las mismas reglas que crear el plan (`validarVelocidad`).',
        etiqueta: 'planes',
        permiso: 'planes.ver',
        cuerpo: v.vistaPreviaPlanValidator,
        respuesta: { status: 200, descripcion: 'Vista previa', esquema: VistaPreviaVelocidad },
        handler: async (_ctx, { cuerpo }) => {
            const { activos, ...campos } = cuerpo
            const plan = {
                ...VELOCIDAD_POR_DEFECTO,
                ...Object.fromEntries(Object.entries(campos).filter(([, valor]) => valor !== undefined)),
            } as VelocidadPlan
            exigirVelocidadValida(plan)
            return vistaPreviaVelocidad(plan, activos ?? 1)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/planes/:id',
        operacion: 'planesVer',
        resumen: 'Ver plan',
        etiqueta: 'planes',
        permiso: 'planes.ver',
        respuesta: { status: 200, descripcion: 'Plan', esquema: Plan },
        handler: (_ctx, { params }) => verPlan(Number(params.id)),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/planes/:id',
        operacion: 'planesEditar',
        resumen: 'Editar plan',
        etiqueta: 'planes',
        permiso: 'planes.editar',
        cuerpo: v.editarPlanValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Plan actualizado', esquema: Plan },
        handler: (ctx, { cuerpo, params }) =>
            new EditarPlan().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/planes/:id/routers',
        operacion: 'planesImplementaciones',
        resumen: 'Implementaciones del plan por router',
        etiqueta: 'planes',
        permiso: 'planes.ver',
        respuesta: { status: 200, descripcion: 'Implementaciones', esquema: lista(PlanRouter) },
        handler: (_ctx, { params }) => implementacionesDePlan(Number(params.id)),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/planes/:id/routers/:routerId',
        operacion: 'planesImplementar',
        resumen: 'Crear o editar la implementación del plan en un router',
        etiqueta: 'planes',
        permiso: 'planes.editar',
        cuerpo: v.implementacionPlanValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Implementación guardada', esquema: PlanRouter },
        handler: (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.routerId)] })
            return new ImplementarPlan().execute(
                { ...cuerpo, plan_id: Number(params.id), router_id: Number(params.routerId) },
                ctx.contextoAccion(),
            )
        },
    }),
]

const sesiones: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/sesiones',
        operacion: 'sesionesListar',
        resumen: 'Sesiones PPPoE (activas o históricas)',
        descripcion:
            '`desde`/`hasta` filtran por solapamiento: la sesión estuvo viva en algún momento de ' +
            '[desde, hasta) (abierta o `fin >= desde`, e `inicio < hasta`).',
        etiqueta: 'sesiones',
        permiso: 'sesiones.ver',
        query: v.listarSesionesValidator,
        respuesta: { status: 200, descripcion: 'Página de sesiones', esquema: pagina(Sesion) },
        handler: (ctx, { query }) => listarSesiones(query, ctx.alcance),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/resumen-sesiones',
        operacion: 'routersResumenSesiones',
        resumen:
            'Resumen de sesiones del router: servicios, sesiones activas y PPPoE sin sesión desde una fecha',
        descripcion:
            'Servicios PPPoE no retirados del router, cuántos tienen sesión abierta y la lista de los que no ' +
            'tuvieron ninguna sesión viva (abierta o con `fin >= desde`) desde `desde`. Sin `desde`, usa la ' +
            'fecha de migración marcada (`aaa_desde`); 422 si no hay. 404 si el router no existe.',
        etiqueta: 'sesiones',
        permiso: 'sesiones.ver',
        query: v.resumenSesionesRouterValidator,
        respuesta: { status: 200, descripcion: 'Resumen de sesiones', esquema: ResumenSesionesRouter },
        handler: (ctx, { query, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            return resumenSesionesRouter(id, query.desde, ctx.alcance)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/migracion-aaa',
        operacion: 'routersMigracionAaa',
        resumen: 'Fecha de migración del router al nuevo aaa',
        descripcion:
            '`aaa_desde` marcado por el operador (null si no se marcó) y `primer_accounting` como referencia. ' +
            '404 si el router no existe.',
        etiqueta: 'routers',
        permiso: 'routers.ver',
        respuesta: { status: 200, descripcion: 'Migración del router', esquema: MigracionAaaRouter },
        handler: (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            return verMigracionAaa(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/marcar-migrado',
        operacion: 'routersMarcarMigrado',
        resumen: 'Marcar cuándo el router pasó al nuevo aaa',
        descripcion:
            '`desde` omitido = ahora; `null` = desmarcar (vuelta atrás). Con `version` (la leída) responde ' +
            '409 si otro la cambió. 422 si `desde` es futura. Queda en la bitácora con el valor anterior. ' +
            'No toca el router ni las sesiones.',
        etiqueta: 'routers',
        permiso: 'routers.marcar_migrado',
        cuerpo: v.marcarRouterMigradoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Migración del router', esquema: MigracionAaaRouter },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            return new MarcarRouterMigrado().execute({ router_id: id, ...cuerpo }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/sesiones/:id/desconectar',
        operacion: 'sesionesDesconectar',
        resumen: 'Desconectar sesión (Disconnect-Request al NAS)',
        descripcion:
            'Emite `sesion.desconexion_solicitada`; `coa` manda el Disconnect-Request al NAS de la sesión (en una ' +
            'sesión de sondeo de un router sin RADIUS, el dispatcher de RouterOS la quita de /ppp/active y la cierra) y ' +
            'registra la respuesta en `audit.red`. La sesión se cierra cuando llega el Stop del NAS. ' +
            '404 si no existe, 409 si ya terminó.',
        etiqueta: 'sesiones',
        permiso: 'sesiones.desconectar',
        cuerpo: v.desconectarSesionValidator,
        idempotente: true,
        respuesta: { status: 202, descripcion: 'Desconexión solicitada', esquema: Sesion },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDeSesion(id))
            await new DesconectarSesion().execute({ id, motivo: cuerpo.motivo }, ctx.contextoAccion())
            return verSesion(id)
        },
    }),
]

// A2: lectura de `audit.red` (CoA, Disconnect y RouterOS) para el panel.
const red: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/red/eventos',
        operacion: 'redEventosListar',
        resumen: 'Eventos de red: CoA, Disconnect y comandos a RouterOS con la respuesta del equipo',
        descripcion:
            'Lectura de `audit.red`, el más reciente primero. Filtros por router, servicio, tipo, resultado ' +
            '(`ok` / `error`) y fecha (`desde` inclusive, `hasta` exclusive). Credenciales como `***`. ' +
            'Alcance por router y zona.',
        etiqueta: 'red',
        permiso: 'red.ver',
        query: v.listarEventosRedValidator,
        respuesta: { status: 200, descripcion: 'Página de eventos de red', esquema: pagina(EventoRed) },
        handler: (ctx, { query }) => listarEventosRed(query, ctx.alcance),
    }),
]

/** Descarga del `.rsc`: lleva secretos, así que nunca se guarda en caché. */
function enviarScript(ctx: HttpContext, script: ScriptConexion): void {
    ctx.response.header('Content-Type', 'text/plain; charset=utf-8')
    ctx.response.header('Content-Disposition', `attachment; filename="${script.nombre_archivo}"`)
    ctx.response.header('Cache-Control', 'no-store')
    ctx.response.header('X-Content-Type-Options', 'nosniff')
    ctx.response.send(script.script)
}

const origenPeticion = (ctx: HttpContext) => `${ctx.request.protocol()}://${ctx.request.host()}`

const SOBRE_EL_SCRIPT =
    'Devuelve el `.rsc` (text/plain, descarga) armado con las plantillas de A6 (`infra/mikrotik/plantillas`, ' +
    'variables de `variables.json`): túnel WireGuard, usuario `argosisp-api` con clave nueva, cliente RADIUS ' +
    '(secreto del router) y puertos de gestión cerrados (`contratos/conexion-routers.md`). Lleva secretos: el ' +
    'panel lo descarga y no lo guarda. Emite un token de registro nuevo (24 h, un uso; el anterior deja de ' +
    'valer) y `router.conexion_generada`. `?admin=` IPs/redes IPv4 separadas por coma para `argosisp-admin`; ' +
    '`?incluir=servicio` suma PPPoE, perfiles y corte (422 `servicio_incompleto` si faltan datos del servidor). ' +
    '422 `script_requiere_radius` si el router está en modo `api` (sin RADIUS); ' +
    '422 `radius_secret_requerido` sin secreto RADIUS válido (16 a 128 caracteres); 503 ' +
    '`wireguard_no_configurado` (WireGuard apagado, sin clave publicada por el agente, sin endpoint o sin ' +
    '`API_PUBLIC_URL` https) o `plantillas_no_disponibles`.'

// Conexión de routers por WireGuard (contratos/conexion-routers.md)
const conexion: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/sincronizar-router',
        operacion: 'serviciosSincronizarRouter',
        resumen: 'Sincronizar ya el servicio con su MikroTik (cola, address-list, lease y ARP)',
        descripcion:
            'Ejecuta `routeros.aplicar_servicio` en el acto y devuelve lo corregido (`cambios[]`) o ' +
            '`ya_estaba_bien`. Idempotente y con candado por servicio; cada comando queda en `audit.red`. Si el ' +
            'router no responde, 200 con `error` (`motivo`, `detalle`). 422 `servicio_pendiente_instalacion`; ' +
            '422 `router_sin_api` (router inactivo o sin usuario y clave de la API).',
        etiqueta: 'servicios',
        permiso: 'servicios.sincronizar_router',
        idempotente: true,
        respuesta: {
            status: 200,
            descripcion: 'Resultado de la sincronización',
            esquema: SincronizacionServicio,
        },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new SincronizarRouterServicio().execute({ servicio_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/probar-conexion',
        operacion: 'routersProbarConexion',
        resumen: 'Probar la conexión con el router (túnel, API REST, datos del equipo, RADIUS y corte)',
        descripcion:
            'Chequeos `{ clave, ok, detalle, ms }`: `tunel` (si tiene conexión WireGuard: conectado y handshake ' +
            'en los últimos 180 s), `api` (`GET /rest/system/resource` con las credenciales guardadas; si falla, ' +
            '`motivo` = `no_responde`, `credenciales`, `certificado` o `respuesta`), `equipo` (versión, modelo, ' +
            'uptime y CPU) y `radius` (modo radius: `/radius` con servicio ppp hacia Argos; el secreto se compara ' +
            'solo si el router lo devuelve y nunca sale) y `corte` (A2, si la API respondió: address-list `suspendidos`, ' +
            'reglas de filter y NAT activas y en orden, `/tool/fetch` al destino real del NAT `http://ip:puerto/corte`, ' +
            'suspendidos fuera de la lista y FastTrack; el detalle completo con comandos de RouterOS en `corte`). ' +
            'Cada GET queda en `audit.red`; si la API responde, ' +
            'actualiza `en_linea` y `ultimo_contacto` como el sondeo. Responde 200 aunque el router esté caído.',
        etiqueta: 'routers',
        permiso: 'routers.probar_conexion',
        respuesta: { status: 200, descripcion: 'Resultado de la prueba', esquema: PruebaConexion },
        handler: (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            return new ProbarConexion().execute({ router_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/reconciliar',
        operacion: 'routersReconciliar',
        resumen: 'Reconciliar ahora la configuración de RouterOS del router',
        descripcion:
            'Encola `routeros.reconciliar` (`motivo: manual`) en el worker de routeros, con lock: si ya hay uno ' +
            'esperando o en curso para el router, responde el mismo `job_id` con `encolado: false`. Lo corregido ' +
            'queda en `audit.red`. 404 si el router no existe.',
        etiqueta: 'routers',
        permiso: 'routers.reconciliar',
        respuesta: { status: 202, descripcion: 'Reconciliación encolada', esquema: ReconciliacionEncolada },
        handler: (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            return new ReconciliarAhora().execute({ router_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/script-conexion',
        operacion: 'routersScriptConexion',
        resumen: 'Generar el script de conexión del router (.rsc)',
        descripcion: SOBRE_EL_SCRIPT,
        etiqueta: 'routers',
        permiso: 'routers.generar_script',
        query: v.scriptConexionValidator,
        respuesta: { status: 200, descripcion: 'Script .rsc', contenido: 'text/plain' },
        handler: async (ctx, { query, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            const script = await new GenerarScript().execute(
                {
                    router_id: id,
                    admin: parsearAdmin(query.admin),
                    incluir_servicio: query.incluir === 'servicio',
                    origen: origenPeticion(ctx),
                },
                ctx.contextoAccion(),
            )
            enviarScript(ctx, script)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/conexion',
        operacion: 'routersConexion',
        resumen: 'Estado de la conexión WireGuard del router',
        descripcion:
            'Estado (`sin_configurar`, `pendiente`, `conectado`), IP del túnel, clave pública, último handshake ' +
            'y vencimiento del token del último script. Nunca trae secretos. 404 si el router no existe.',
        etiqueta: 'routers',
        permiso: 'routers.ver',
        respuesta: { status: 200, descripcion: 'Conexión del router', esquema: ConexionRouter },
        handler: (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            return verConexion(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/conexion/rotar',
        operacion: 'routersConexionRotar',
        resumen: 'Rotar la conexión WireGuard del router y generar un script nuevo (.rsc)',
        descripcion:
            'Invalida el peer (borra la clave pública registrada, vuelve a `pendiente`, emite ' +
            '`router.conexion_rotada`) y responde el script nuevo como `GET /routers/:id/script-conexion` ' +
            '(mismos `?admin=` e `?incluir=`). La IP del túnel no cambia.',
        etiqueta: 'routers',
        permiso: 'routers.rotar_conexion',
        query: v.scriptConexionValidator,
        respuesta: { status: 200, descripcion: 'Script .rsc nuevo', contenido: 'text/plain' },
        handler: async (ctx, { query, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            const script = await new RotarConexion().execute(
                {
                    router_id: id,
                    admin: parsearAdmin(query.admin),
                    incluir_servicio: query.incluir === 'servicio',
                    origen: origenPeticion(ctx),
                },
                ctx.contextoAccion(),
            )
            enviarScript(ctx, script)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/conexion/clave',
        operacion: 'routersConexionClave',
        resumen: 'Pegar a mano la clave pública WireGuard del router',
        descripcion:
            'Para un router sin internet: la clave que imprimió el script. Mismo efecto que el registro por ' +
            'token (lo consume): el router queda `pendiente` hasta el primer handshake y `host`/`nas_ip` pasan ' +
            'a la IP del túnel. 422 `script_no_generado` si nunca se generó el script; 409 `clave_en_uso` si ' +
            'la clave es de otro router.',
        etiqueta: 'routers',
        permiso: 'routers.conexion_clave',
        cuerpo: v.conexionClaveValidator,
        respuesta: { status: 200, descripcion: 'Conexión del router', esquema: ConexionRouter },
        handler: (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            return new ConexionClave().execute(
                { router_id: id, public_key: cuerpo.public_key },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/conexion/registrar',
        operacion: 'routersConexionRegistrar',
        resumen: 'Registro del router con su token (lo llama el script, sin sesión)',
        descripcion:
            'Cuerpo `{ token, public_key, routeros_version, api_ca }` (§6.1). Token de un solo uso del último ' +
            'script, 24 h: si venció, se usó o no existe, 410 `token_invalido`. Responde `{ router_id, ip_tunel, ' +
            'servidor: { public_key, endpoint, puerto, ip } }`; con `api_ca`, Argos verifica con ella el ' +
            'certificado del router. Límite ' +
            'por IP (`ROUTERS_REGISTRO_LIMITE` por `ROUTERS_REGISTRO_VENTANA_S`): 429 con `Retry-After`. ' +
            '409 `clave_en_uso` si la clave es de otro router.',
        etiqueta: 'routers',
        seguridad: 'publico',
        permiso: null,
        cuerpo: v.registrarConexionValidator,
        limitada: true,
        antes: limitarRegistro,
        respuesta: { status: 200, descripcion: 'Router registrado', esquema: RegistroConexion },
        handler: (ctx, { cuerpo }) => new RegistrarConexion().execute(cuerpo, ctx.contextoAccion('api')),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/internal/wireguard/peers',
        operacion: 'internoWireguardPeers',
        resumen: 'Peers WireGuard vigentes (wireguard-agente)',
        descripcion:
            'Lista completa, sin paginar, de los routers activos con clave pública registrada y su IP del túnel ' +
            '(`contratos/conexion-routers.md` §6.3). El agente reconcilia la lista entera al arrancar y con ' +
            '`router.conexion_registrada`, `router.conexion_rotada`, `router.conexion_eliminada` y `router.eliminado` ' +
            '(un router eliminado ya no tiene fila de conexión: su peer sale de la lista).',
        etiqueta: 'interno',
        seguridad: 'interno',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Peers', esquema: PeersWireguard },
        handler: async () => ({ data: await listarPeers() }),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/internal/wireguard/estado',
        operacion: 'internoWireguardEstado',
        resumen: 'Estado del servidor WireGuard y último handshake por peer (wireguard-agente)',
        descripcion:
            '`{ servidor: { public_key, ip, red, puerto, interfaz, modo }, peers: [{ public_key, ultimo_handshake, ' +
            'endpoint, rx_bytes, tx_bytes }], generado_en }` (§6.3). Guarda la clave pública del servidor (va en ' +
            'los scripts) y el último handshake de cada router (solo avanza); `conectado` = handshake de menos ' +
            'de 3 min. Claves desconocidas se ignoran.',
        etiqueta: 'interno',
        seguridad: 'interno',
        permiso: null,
        cuerpo: v.estadoWireguardValidator,
        respuesta: { status: 204, descripcion: 'Estado registrado' },
        handler: async (ctx, { cuerpo }) => {
            await new RegistrarEstadoWireguard().execute(cuerpo, ctx.contextoAccion('interno'))
        },
    }),
]

// A2: control de velocidad por capas, sincronizar plan y corte (`start/routes/velocidad.ts`).
// A2: QoS por clases (`start/routes/qos.ts`, `contratos/qos.md`).
export default [...routers, ...conexion, ...planes, ...sesiones, ...red, ...velocidad, ...qos]
