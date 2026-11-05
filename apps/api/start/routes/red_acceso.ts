/*
|--------------------------------------------------------------------------
| Rutas de la red de acceso (A1): OLT, puertos PON, VLAN y servidores PPPoE
|--------------------------------------------------------------------------
|
| `.claude/integration/contratos/red-acceso.md` §4. Se suman a las de `network.ts`.
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import { exigirAlcance } from '#core/acl'
import { empresasDeLaLista } from '#shared/empresa_activa'
import * as v from '#network/red_acceso/validators'
import {
    DescubrimientoRedAcceso,
    Olt,
    PuertoPon,
    RedAccesoRouter,
    ResultadoAdopcion,
    ServidorPppoe,
    Vlan,
    VistaPreviaTomarControl,
} from '#network/red_acceso/esquemas'
import {
    listarOlts,
    listarServidoresPppoe,
    listarVlans,
    redAccesoRouter,
    verOlt,
    verServidorPppoe,
    verVlan,
} from '#network/red_acceso/consultas'
import { exigirVisible } from '#network/red_acceso/reglas'
import { descubrirRedAcceso } from '#network/red_acceso/inventario'
import { verRouter } from '#network/consultas/routers'
import CrearOlt from '#network/actions/crear_olt'
import EditarOlt from '#network/actions/editar_olt'
import EliminarOlt from '#network/actions/eliminar_olt'
import CrearPuertoPon from '#network/actions/crear_puerto_pon'
import EditarPuertoPon from '#network/actions/editar_puerto_pon'
import EliminarPuertoPon from '#network/actions/eliminar_puerto_pon'
import CrearVlan from '#network/actions/crear_vlan'
import EditarVlan from '#network/actions/editar_vlan'
import EliminarVlan from '#network/actions/eliminar_vlan'
import CrearServidorPppoe from '#network/actions/crear_servidor_pppoe'
import EditarServidorPppoe from '#network/actions/editar_servidor_pppoe'
import EliminarServidorPppoe from '#network/actions/eliminar_servidor_pppoe'
import AdoptarRedAcceso from '#network/actions/adoptar_red_acceso'
import TomarControlRedAcceso, {
    vistaPreviaTomarControl,
    type EntidadTomarControl,
} from '#network/actions/tomar_control_red_acceso'

const ETIQUETA = 'red_acceso'

const redAcceso: Ruta[] = [
    /*
    | OLT y puertos PON
    */
    definirRuta({
        metodo: 'get',
        ruta: '/olts',
        operacion: 'oltsListar',
        resumen: 'Listar OLT (las de la empresa activa y las compartidas)',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.ver',
        query: v.listarOltsValidator,
        respuesta: { status: 200, descripcion: 'Página de OLT', esquema: pagina(Olt) },
        handler: (ctx, { query }) => listarOlts(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/olts',
        operacion: 'oltsCrear',
        resumen: 'Registrar una OLT (dato para ordenar; Argos no habla con la OLT)',
        descripcion: '409 `olt_duplicada` si el nombre ya existe.',
        etiqueta: ETIQUETA,
        permiso: 'olts.crear',
        cuerpo: v.crearOltValidator,
        respuesta: { status: 201, descripcion: 'OLT creada', esquema: Olt },
        handler: (ctx, { cuerpo }) => new CrearOlt().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/olts/:id',
        operacion: 'oltsVer',
        resumen: 'Ver una OLT con sus puertos PON',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.ver',
        respuesta: { status: 200, descripcion: 'OLT', esquema: Olt },
        handler: async (ctx, { params }) => {
            const olt = await verOlt(Number(params.id))
            exigirVisible(ctx.contextoAccion(), olt.empresa_id)
            return olt
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/olts/:id',
        operacion: 'oltsEditar',
        resumen: 'Editar una OLT',
        etiqueta: ETIQUETA,
        permiso: 'olts.editar',
        cuerpo: v.editarOltValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'OLT', esquema: Olt },
        handler: (ctx, { cuerpo, params }) =>
            new EditarOlt().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'delete',
        ruta: '/olts/:id',
        operacion: 'oltsEliminar',
        resumen: 'Eliminar una OLT y sus puertos (409 `olt_con_vlans` si algún puerto tiene VLAN)',
        etiqueta: ETIQUETA,
        permiso: 'olts.eliminar',
        respuesta: { status: 204, descripcion: 'OLT eliminada' },
        handler: async (ctx, { params }) => {
            await new EliminarOlt().execute({ id: Number(params.id) }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/olts/:id/puertos-pon',
        operacion: 'puertosPonCrear',
        resumen: 'Agregar un puerto PON a una OLT',
        descripcion: '409 `puerto_duplicado` si la OLT ya tiene ese identificador.',
        etiqueta: ETIQUETA,
        permiso: 'olts.editar',
        cuerpo: v.crearPuertoPonValidator,
        respuesta: { status: 201, descripcion: 'Puerto creado', esquema: PuertoPon },
        handler: (ctx, { cuerpo, params }) =>
            new CrearPuertoPon().execute({ ...cuerpo, olt_id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/puertos-pon/:id',
        operacion: 'puertosPonEditar',
        resumen: 'Editar un puerto PON',
        etiqueta: ETIQUETA,
        permiso: 'olts.editar',
        cuerpo: v.editarPuertoPonValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Puerto', esquema: PuertoPon },
        handler: (ctx, { cuerpo, params }) =>
            new EditarPuertoPon().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'delete',
        ruta: '/puertos-pon/:id',
        operacion: 'puertosPonEliminar',
        resumen: 'Eliminar un puerto PON sin VLAN (409 `puerto_con_vlans`)',
        etiqueta: ETIQUETA,
        permiso: 'olts.editar',
        respuesta: { status: 204, descripcion: 'Puerto eliminado' },
        handler: async (ctx, { params }) => {
            await new EliminarPuertoPon().execute({ id: Number(params.id) }, ctx.contextoAccion())
        },
    }),

    /*
    | Red de acceso de un router
    */
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/red-acceso',
        operacion: 'routersRedAcceso',
        resumen: 'Red de acceso del router: VLAN, servidores PPPoE (con local-address) y OLT/puertos usados',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.ver',
        respuesta: { status: 200, descripcion: 'Red de acceso', esquema: RedAccesoRouter },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            await verRouter(id)
            return redAccesoRouter(id, empresasDeLaLista(ctx.empresa))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/vlans',
        operacion: 'vlansListar',
        resumen: 'VLAN del router (filtros por OLT y puerto PON)',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.ver',
        query: v.listarVlansValidator,
        respuesta: { status: 200, descripcion: 'VLAN', esquema: lista(Vlan) },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            await verRouter(id)
            return listarVlans(id, query, empresasDeLaLista(ctx.empresa, query.empresas))
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/vlans',
        operacion: 'vlansCrear',
        resumen: 'Crear una VLAN administrada por Argos en el router',
        descripcion:
            'A2 la escribe en RouterOS (`comment = argosisp:vlan:<id>`). 409 `vlan_duplicada` o ' +
            '`nombre_interfaz_duplicado`; 422 `puerto_pon_lleno` (máximo 2 VLAN por puerto PON).',
        etiqueta: ETIQUETA,
        permiso: 'vlans.crear',
        cuerpo: v.crearVlanValidator,
        respuesta: { status: 201, descripcion: 'VLAN creada', esquema: Vlan },
        handler: (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return new CrearVlan().execute({ ...cuerpo, router_id: Number(params.id) }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/vlans/:id',
        operacion: 'vlansVer',
        resumen: 'Ver una VLAN',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.ver',
        respuesta: { status: 200, descripcion: 'VLAN', esquema: Vlan },
        handler: async (ctx, { params }) => {
            const vlan = await verVlan(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [vlan.router_id] })
            exigirVisible(ctx.contextoAccion(), vlan.empresa_id)
            return vlan
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/vlans/:id',
        operacion: 'vlansEditar',
        resumen: 'Editar una VLAN (en una adoptada solo puerto PON, empresa y descripción)',
        etiqueta: ETIQUETA,
        permiso: 'vlans.editar',
        cuerpo: v.editarVlanValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'VLAN', esquema: Vlan },
        handler: async (ctx, { cuerpo, params }) => {
            const vlan = await verVlan(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [vlan.router_id] })
            return new EditarVlan().execute({ ...cuerpo, id: vlan.id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'delete',
        ruta: '/vlans/:id',
        operacion: 'vlansEliminar',
        resumen: 'Eliminar una VLAN sin servidor PPPoE (409 `vlan_con_servidor`)',
        etiqueta: ETIQUETA,
        permiso: 'vlans.eliminar',
        respuesta: { status: 204, descripcion: 'VLAN eliminada' },
        handler: async (ctx, { params }) => {
            const vlan = await verVlan(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [vlan.router_id] })
            await new EliminarVlan().execute({ id: vlan.id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/servidores-pppoe',
        operacion: 'servidoresPppoeListar',
        resumen: 'Servidores PPPoE del router',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.ver',
        respuesta: { status: 200, descripcion: 'Servidores PPPoE', esquema: lista(ServidorPppoe) },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            await verRouter(id)
            return listarServidoresPppoe(id, empresasDeLaLista(ctx.empresa))
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/servidores-pppoe',
        operacion: 'servidoresPppoeCrear',
        resumen: 'Crear un servidor PPPoE administrado por Argos (uno por VLAN o interfaz)',
        descripcion:
            '`red_ipv4_id` obligatoria (422 `red_requerida`): su gateway es el local-address del perfil; sin ' +
            'gateway, la primera IP utilizable de la red (`local_address_derivado`). 409 `interfaz_con_servidor`, `vlan_con_servidor`, ' +
            '`servidor_duplicado`. A2 lo escribe en RouterOS con su perfil `argosisp-pppoe-<id>`.',
        etiqueta: ETIQUETA,
        permiso: 'servidores_pppoe.crear',
        cuerpo: v.crearServidorPppoeValidator,
        respuesta: { status: 201, descripcion: 'Servidor creado', esquema: ServidorPppoe },
        handler: (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return new CrearServidorPppoe().execute(
                { ...cuerpo, router_id: Number(params.id) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servidores-pppoe/:id',
        operacion: 'servidoresPppoeVer',
        resumen: 'Ver un servidor PPPoE',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.ver',
        respuesta: { status: 200, descripcion: 'Servidor PPPoE', esquema: ServidorPppoe },
        handler: async (ctx, { params }) => {
            const servidor = await verServidorPppoe(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [servidor.router_id] })
            exigirVisible(ctx.contextoAccion(), servidor.empresa_id)
            return servidor
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/servidores-pppoe/:id',
        operacion: 'servidoresPppoeEditar',
        resumen: 'Editar un servidor PPPoE (en uno adoptado solo los campos de Argos)',
        etiqueta: ETIQUETA,
        permiso: 'servidores_pppoe.editar',
        cuerpo: v.editarServidorPppoeValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Servidor PPPoE', esquema: ServidorPppoe },
        handler: async (ctx, { cuerpo, params }) => {
            const servidor = await verServidorPppoe(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [servidor.router_id] })
            return new EditarServidorPppoe().execute({ ...cuerpo, id: servidor.id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'delete',
        ruta: '/servidores-pppoe/:id',
        operacion: 'servidoresPppoeEliminar',
        resumen: 'Eliminar un servidor PPPoE sin servicios (409 `servidor_con_servicios`)',
        etiqueta: ETIQUETA,
        permiso: 'servidores_pppoe.eliminar',
        respuesta: { status: 204, descripcion: 'Servidor eliminado' },
        handler: async (ctx, { params }) => {
            const servidor = await verServidorPppoe(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [servidor.router_id] })
            await new EliminarServidorPppoe().execute({ id: servidor.id }, ctx.contextoAccion())
        },
    }),

    /*
    | Descubrir y adoptar
    */
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/red-acceso/descubrir',
        operacion: 'routersRedAccesoDescubrir',
        resumen: 'Leer del router sus VLAN, servidores PPPoE, perfiles y pools (no escribe)',
        descripcion:
            'Cada VLAN y servidor sale marcado `nuevo`, `adoptado` o `administrado` con sus diferencias; el ' +
            'servidor trae la red sugerida (gateway = local-address de su perfil). `sin_router`: lo registrado que ' +
            'el router ya no tiene. 501 `descubrir_no_disponible` si el lector de RouterOS aún no existe.',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.descubrir',
        respuesta: { status: 200, descripcion: 'Inventario', esquema: DescubrimientoRedAcceso },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, { router: [id] })
            await verRouter(id)
            return descubrirRedAcceso(id, ctx.contextoAccion().requestId)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/red-acceso/adoptar',
        operacion: 'routersRedAccesoAdoptar',
        resumen: 'Importar VLAN y servidores PPPoE que ya existen en el router (no toca el router)',
        descripcion:
            'Relee el inventario y crea las filas `adoptado` con los valores de RouterOS. 409 `inventario_cambio` ' +
            'si un `ros_id` ya no está, `ya_registrado` si ya estaba en Argos. La VLAN de un servidor se adopta con él.',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.adoptar',
        cuerpo: v.adoptarRedAccesoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Lo adoptado', esquema: ResultadoAdopcion },
        handler: (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return new AdoptarRedAcceso().execute(
                { ...cuerpo, router_id: Number(params.id) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/vlans/:id/vista-previa-tomar-control',
        operacion: 'vlansVistaPreviaTomarControl',
        resumen:
            'Qué cambiaría en el router si Argos administra este objeto adoptado (lee el router, no escribe)',
        descripcion:
            'El diff lo calcula RouterOS (A2) leyendo el router: `cambios[]` por menú y propiedad (actual → deseado), ' +
            '`sesiones` y `advertencias`. `huella` y `version` se envían al tomar control. 501 ' +
            '`descubrir_no_disponible` mientras no exista el lector.',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.tomar_control',
        respuesta: { status: 200, descripcion: 'Vista previa', esquema: VistaPreviaTomarControl },
        handler: async (ctx, { params }) => {
            const fila = await verVlan(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [fila.router_id] })
            exigirVisible(ctx.contextoAccion(), fila.empresa_id)
            return vistaPreviaTomarControl(
                'vlan' as EntidadTomarControl,
                fila.id,
                ctx.contextoAccion().requestId,
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/vlans/:id/tomar-control',
        operacion: 'vlansTomarControl',
        resumen: 'Pasar a administrado un objeto adoptado (Argos lo empieza a escribir en el router)',
        descripcion:
            '`version` y `huella` de la vista previa: 409 `conflicto_version` o `router_cambio` si algo cambió. ' +
            '422 `ya_administrado`, o `red_requerida` en un servidor sin red. Emite `red_acceso.cambiada` con ' +
            '`accion: tomar_control`.',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.tomar_control',
        cuerpo: v.tomarControlValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Ahora administrado', esquema: Vlan },
        handler: async (ctx, { cuerpo, params }) => {
            const fila = await verVlan(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [fila.router_id] })
            return new TomarControlRedAcceso().execute(
                { ...cuerpo, entidad: 'vlan', id: fila.id },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servidores-pppoe/:id/vista-previa-tomar-control',
        operacion: 'servidoresPppoeVistaPreviaTomarControl',
        resumen:
            'Qué cambiaría en el router si Argos administra este objeto adoptado (lee el router, no escribe)',
        descripcion:
            'El diff lo calcula RouterOS (A2) leyendo el router: `cambios[]` por menú y propiedad (actual → deseado), ' +
            '`sesiones` y `advertencias`. `huella` y `version` se envían al tomar control. 501 ' +
            '`descubrir_no_disponible` mientras no exista el lector.',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.tomar_control',
        respuesta: { status: 200, descripcion: 'Vista previa', esquema: VistaPreviaTomarControl },
        handler: async (ctx, { params }) => {
            const fila = await verServidorPppoe(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [fila.router_id] })
            exigirVisible(ctx.contextoAccion(), fila.empresa_id)
            return vistaPreviaTomarControl(
                'servidor_pppoe' as EntidadTomarControl,
                fila.id,
                ctx.contextoAccion().requestId,
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servidores-pppoe/:id/tomar-control',
        operacion: 'servidoresPppoeTomarControl',
        resumen: 'Pasar a administrado un objeto adoptado (Argos lo empieza a escribir en el router)',
        descripcion:
            '`version` y `huella` de la vista previa: 409 `conflicto_version` o `router_cambio` si algo cambió. ' +
            '422 `ya_administrado`, o `red_requerida` en un servidor sin red. Emite `red_acceso.cambiada` con ' +
            '`accion: tomar_control`.',
        etiqueta: ETIQUETA,
        permiso: 'red_acceso.tomar_control',
        cuerpo: v.tomarControlValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Ahora administrado', esquema: ServidorPppoe },
        handler: async (ctx, { cuerpo, params }) => {
            const fila = await verServidorPppoe(Number(params.id))
            exigirAlcance(ctx.alcance, { router: [fila.router_id] })
            return new TomarControlRedAcceso().execute(
                { ...cuerpo, entidad: 'servidor_pppoe', id: fila.id },
                ctx.contextoAccion(),
            )
        },
    }),
]

export default redAcceso
