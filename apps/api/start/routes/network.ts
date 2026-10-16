/*
|--------------------------------------------------------------------------
| Rutas de red (A1; sesiones: A2): routers, IPAM IPv4/IPv6, planes, sesiones
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import * as v from '#network/validators'
import { exigirAlcance } from '#core/acl'
import CrearRouter from '#network/actions/crear_router'
import EditarRouter from '#network/actions/editar_router'
import CambiarControlVelocidad from '#network/actions/cambiar_control_velocidad'
import CrearRedIpv4 from '#network/actions/crear_red_ipv4'
import { listarRedesIpv4, listarRouters, verRouter } from '#network/consultas/routers'
import {
    Ipv6Bloque,
    Ipv6Pool,
    Plan,
    PlanEfectivo,
    PlanRouter,
    RedIpv4,
    Router,
    Sesion,
} from '#network/esquemas'
import CrearBloqueIpv6 from '#network/actions/crear_bloque_ipv6'
import CrearPoolIpv6 from '#network/actions/crear_pool_ipv6'
import { listarBloques, listarPools, verBloque } from '#network/consultas/ipv6'
import CrearPlan from '#network/actions/crear_plan'
import EditarPlan from '#network/actions/editar_plan'
import ImplementarPlan from '#network/actions/implementar_plan'
import { planesDisponiblesEnRouter } from '#network/actions/obtener_implementacion_plan'
import { implementacionesDePlan, listarPlanes, verPlan } from '#network/consultas/planes'
import { dimensionesDeSesion, listarSesiones, verSesion } from '#network/sesiones/consultas'
import DesconectarSesion from '#network/sesiones/actions/desconectar_sesion'
import { registrarSeccionMetricas } from '#monitoreo/metricas'
import { leerMetricasRouterOS } from '#network/routeros/metricas'

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
        handler: (ctx, { query }) => listarRouters(query, ctx.alcance),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers',
        operacion: 'routersCrear',
        resumen: 'Crear router',
        etiqueta: 'routers',
        permiso: 'routers.crear',
        cuerpo: v.crearRouterValidator,
        respuesta: { status: 201, descripcion: 'Router creado', esquema: Router },
        handler: (ctx, { cuerpo }) => new CrearRouter().execute(cuerpo, ctx.contextoAccion()),
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
        etiqueta: 'sesiones',
        permiso: 'sesiones.ver',
        query: v.listarSesionesValidator,
        respuesta: { status: 200, descripcion: 'Página de sesiones', esquema: pagina(Sesion) },
        handler: (ctx, { query }) => listarSesiones(query, ctx.alcance),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/sesiones/:id/desconectar',
        operacion: 'sesionesDesconectar',
        resumen: 'Desconectar sesión (Disconnect-Request al NAS)',
        descripcion:
            'Emite `sesion.desconexion_solicitada`; `coa` manda el Disconnect-Request al NAS de la sesión y ' +
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

export default [...routers, ...planes, ...sesiones]
