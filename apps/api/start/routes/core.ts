/*
|--------------------------------------------------------------------------
| Rutas del núcleo (A1): auth, ACL, clientes, zonas, servicios, bitácora, IP, interno
|--------------------------------------------------------------------------
|
| Solo validan y llaman acciones. Las que no tienen `handler` responden 501.
|
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { listarAcciones, listarCambios } from '#shared/bitacora'
import { construirMe } from '#core/acl'
import IniciarSesion from '#core/actions/iniciar_sesion'
import CerrarSesion from '#core/actions/cerrar_sesion'
import CrearUsuario from '#core/actions/crear_usuario'
import EditarUsuario from '#core/actions/editar_usuario'
import CrearRol from '#core/actions/crear_rol'
import EditarRol from '#core/actions/editar_rol'
import CrearTokenApi from '#core/actions/crear_token_api'
import RevocarTokenApi from '#core/actions/revocar_token_api'
import { listarPermisos, listarRoles, listarTokens, listarUsuarios, verUsuario } from '#core/consultas/acl'
import { alcancesDelToken } from '#middleware/autorizar_middleware'
import { Problema } from '#shared/errores'
import * as v from '#core/validators'
import {
    AaaServicio,
    AccionAuditoria,
    CambioAuditoria,
    Cliente,
    Me,
    Permiso,
    ResolucionIp,
    Rol,
    Servicio,
    Sesion,
    TokenApi,
    TokenApiCreado,
    Usuario,
    Zona,
} from '#core/esquemas'

const auth: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/auth/login',
        operacion: 'authLogin',
        resumen: 'Iniciar sesión',
        etiqueta: 'auth',
        seguridad: 'publico',
        permiso: null,
        cuerpo: v.loginValidator,
        respuesta: { status: 200, descripcion: 'Sesión iniciada', esquema: Sesion },
        handler: (ctx, { cuerpo }) => new IniciarSesion().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/auth/logout',
        operacion: 'authLogout',
        resumen: 'Cerrar la sesión actual',
        etiqueta: 'auth',
        permiso: null,
        respuesta: { status: 204, descripcion: 'Sesión cerrada' },
        handler: async (ctx) => {
            if (ctx.auth.authenticatedViaGuard !== 'api') {
                throw new Problema(
                    400,
                    'no_es_sesion',
                    'No es una sesión de login',
                    'Un token de API se revoca con POST /tokens/:id/revocar',
                )
            }
            const usuario = ctx.auth.use('api').getUserOrFail()
            const tokenId = usuario.currentAccessToken.identifier
            await new CerrarSesion().execute(
                {
                    usuarioId: usuario.id,
                    tokenId:
                        typeof tokenId === 'string' || typeof tokenId === 'number'
                            ? tokenId
                            : Number(tokenId),
                },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/me',
        operacion: 'me',
        resumen: 'Usuario actual con roles y permisos',
        etiqueta: 'auth',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Usuario actual con permisos', esquema: Me },
        handler: (ctx) => construirMe(ctx.auth.getUserOrFail(), alcancesDelToken(ctx)),
    }),
]

const usuarios: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/usuarios',
        operacion: 'usuariosListar',
        resumen: 'Listar usuarios',
        etiqueta: 'acl',
        permiso: 'usuarios.ver',
        query: v.listarPaginadoValidator,
        respuesta: { status: 200, descripcion: 'Página de usuarios', esquema: pagina(Usuario) },
        handler: (_ctx, { query }) => listarUsuarios(query),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/usuarios',
        operacion: 'usuariosCrear',
        resumen: 'Crear usuario',
        etiqueta: 'acl',
        permiso: 'usuarios.crear',
        cuerpo: v.crearUsuarioValidator,
        respuesta: { status: 201, descripcion: 'Usuario creado', esquema: Usuario },
        handler: (ctx, { cuerpo }) => new CrearUsuario().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/usuarios/:id',
        operacion: 'usuariosVer',
        resumen: 'Ver usuario',
        etiqueta: 'acl',
        permiso: 'usuarios.ver',
        respuesta: { status: 200, descripcion: 'Usuario', esquema: Usuario },
        handler: (_ctx, { params }) => verUsuario(Number(params.id)),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/usuarios/:id',
        operacion: 'usuariosEditar',
        resumen: 'Editar usuario y sus roles',
        etiqueta: 'acl',
        permiso: 'usuarios.editar',
        cuerpo: v.editarUsuarioValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Usuario actualizado', esquema: Usuario },
        handler: (ctx, { cuerpo, params }) =>
            new EditarUsuario().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/roles',
        operacion: 'rolesListar',
        resumen: 'Listar roles con sus permisos',
        etiqueta: 'acl',
        permiso: 'roles.ver',
        respuesta: { status: 200, descripcion: 'Roles', esquema: { type: 'array', items: Rol } },
        handler: () => listarRoles(),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/roles',
        operacion: 'rolesCrear',
        resumen: 'Crear rol',
        etiqueta: 'acl',
        permiso: 'roles.crear',
        cuerpo: v.crearRolValidator,
        respuesta: { status: 201, descripcion: 'Rol creado', esquema: Rol },
        handler: (ctx, { cuerpo }) => new CrearRol().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/roles/:id',
        operacion: 'rolesEditar',
        resumen: 'Editar rol y sus permisos',
        etiqueta: 'acl',
        permiso: 'roles.editar',
        cuerpo: v.editarRolValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Rol actualizado', esquema: Rol },
        handler: (ctx, { cuerpo, params }) =>
            new EditarRol().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/permisos',
        operacion: 'permisosListar',
        resumen: 'Catálogo de permisos',
        etiqueta: 'acl',
        permiso: 'roles.ver',
        respuesta: { status: 200, descripcion: 'Permisos', esquema: { type: 'array', items: Permiso } },
        handler: () => listarPermisos(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/tokens',
        operacion: 'tokensListar',
        resumen: 'Listar tokens de API',
        etiqueta: 'acl',
        permiso: 'tokens.ver',
        query: v.listarPaginadoValidator,
        respuesta: { status: 200, descripcion: 'Página de tokens', esquema: pagina(TokenApi) },
        handler: (_ctx, { query }) => listarTokens(query),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/tokens',
        operacion: 'tokensCrear',
        resumen: 'Crear token de API (se muestra una sola vez)',
        etiqueta: 'acl',
        permiso: 'tokens.crear',
        cuerpo: v.crearTokenValidator,
        respuesta: { status: 201, descripcion: 'Token creado', esquema: TokenApiCreado },
        handler: (ctx, { cuerpo }) => new CrearTokenApi().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/tokens/:id/revocar',
        operacion: 'tokensRevocar',
        resumen: 'Revocar token de API',
        etiqueta: 'acl',
        permiso: 'tokens.revocar',
        respuesta: { status: 200, descripcion: 'Token revocado', esquema: TokenApi },
        handler: (ctx, { params }) =>
            new RevocarTokenApi().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
]

const clientes: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/clientes',
        operacion: 'clientesListar',
        resumen: 'Buscar clientes',
        descripcion: 'Busca por nombre, NIT/CUI, teléfono, user_ppp o IP.',
        etiqueta: 'clientes',
        permiso: 'clientes.ver',
        query: v.listarClientesValidator,
        respuesta: { status: 200, descripcion: 'Página de clientes', esquema: pagina(Cliente) },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/clientes',
        operacion: 'clientesCrear',
        resumen: 'Crear cliente',
        etiqueta: 'clientes',
        permiso: 'clientes.crear',
        cuerpo: v.crearClienteValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Cliente creado', esquema: Cliente },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/clientes/:id',
        operacion: 'clientesVer',
        resumen: 'Ver cliente',
        etiqueta: 'clientes',
        permiso: 'clientes.ver',
        respuesta: { status: 200, descripcion: 'Cliente', esquema: Cliente },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/clientes/:id',
        operacion: 'clientesEditar',
        resumen: 'Editar cliente',
        etiqueta: 'clientes',
        permiso: 'clientes.editar',
        cuerpo: v.editarClienteValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Cliente actualizado', esquema: Cliente },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/zonas',
        operacion: 'zonasListar',
        resumen: 'Listar zonas',
        etiqueta: 'clientes',
        permiso: 'zonas.ver',
        respuesta: { status: 200, descripcion: 'Zonas', esquema: { type: 'array', items: Zona } },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/zonas',
        operacion: 'zonasCrear',
        resumen: 'Crear zona',
        etiqueta: 'clientes',
        permiso: 'zonas.crear',
        cuerpo: v.crearZonaValidator,
        respuesta: { status: 201, descripcion: 'Zona creada', esquema: Zona },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/zonas/:id',
        operacion: 'zonasEditar',
        resumen: 'Editar zona',
        etiqueta: 'clientes',
        permiso: 'zonas.editar',
        cuerpo: v.editarZonaValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Zona actualizada', esquema: Zona },
    }),
]

/** Acciones de estado: `POST /servicios/:id/<accion>` con `{ motivo }`. Nunca PATCH de estado. */
function accionServicio(
    accion: string,
    operacion: string,
    permiso:
        | 'servicios.suspender'
        | 'servicios.reactivar'
        | 'servicios.limitar'
        | 'servicios.quitar_limite'
        | 'servicios.retirar'
        | 'servicios.desconectar',
    resumen: string,
): Ruta {
    return definirRuta({
        metodo: 'post',
        ruta: `/servicios/:id/${accion}`,
        operacion,
        resumen,
        etiqueta: 'servicios',
        permiso,
        cuerpo: v.motivoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Servicio después de la acción', esquema: Servicio },
    })
}

const servicios: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/servicios',
        operacion: 'serviciosListar',
        resumen: 'Listar servicios',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        query: v.listarServiciosValidator,
        respuesta: { status: 200, descripcion: 'Página de servicios', esquema: pagina(Servicio) },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios',
        operacion: 'serviciosCrear',
        resumen: 'Crear servicio PPPoE (asigna IPv4/IPv6, genera user_ppp)',
        etiqueta: 'servicios',
        permiso: 'servicios.crear',
        cuerpo: v.crearServicioValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Servicio creado', esquema: Servicio },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id',
        operacion: 'serviciosVer',
        resumen: 'Ver servicio',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        respuesta: { status: 200, descripcion: 'Servicio', esquema: Servicio },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/servicios/:id',
        operacion: 'serviciosEditar',
        resumen: 'Editar servicio (plan, router, IPs, datos)',
        etiqueta: 'servicios',
        permiso: 'servicios.editar',
        cuerpo: v.editarServicioValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Servicio actualizado', esquema: Servicio },
    }),
    accionServicio('suspender', 'serviciosSuspender', 'servicios.suspender', 'Suspender servicio'),
    accionServicio('reactivar', 'serviciosReactivar', 'servicios.reactivar', 'Reactivar servicio'),
    accionServicio('limitar', 'serviciosLimitar', 'servicios.limitar', 'Limitar velocidad del servicio'),
    accionServicio(
        'quitar-limite',
        'serviciosQuitarLimite',
        'servicios.quitar_limite',
        'Quitar límite de velocidad',
    ),
    accionServicio('retirar', 'serviciosRetirar', 'servicios.retirar', 'Retirar servicio (libera IPs)'),
    accionServicio(
        'desconectar',
        'serviciosDesconectar',
        'servicios.desconectar',
        'Desconectar la sesión PPPoE',
    ),
]

const bitacora: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/bitacora/acciones',
        operacion: 'bitacoraAcciones',
        resumen: 'Bitácora de acciones (actor, canal, resultado)',
        etiqueta: 'bitacora',
        permiso: 'bitacora.ver',
        query: v.listarAccionesValidator,
        respuesta: { status: 200, descripcion: 'Página de acciones', esquema: pagina(AccionAuditoria) },
        handler: (_ctx, { query }) => listarAcciones(query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bitacora/cambios',
        operacion: 'bitacoraCambios',
        resumen: 'Cambios por campo de una entidad',
        etiqueta: 'bitacora',
        permiso: 'bitacora.ver',
        query: v.listarCambiosValidator,
        respuesta: { status: 200, descripcion: 'Página de cambios', esquema: pagina(CambioAuditoria) },
        handler: (_ctx, { query }) => listarCambios(query),
    }),
]

const ip: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/ip/:ip',
        operacion: 'ipResolver',
        resumen: 'Resolver IPv4 o IPv6 a su servicio (prefijo más largo)',
        etiqueta: 'red',
        permiso: 'ip.resolver',
        parametros: { ip: { type: 'string', description: 'IPv4 o IPv6' } },
        respuesta: { status: 200, descripcion: 'Servicio dueño de la IP', esquema: ResolucionIp },
    }),
]

const interno: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/internal/aaa/servicio',
        operacion: 'internoAaaServicio',
        resumen: 'Datos de autorización RADIUS de un user_ppp (servicio aaa)',
        etiqueta: 'interno',
        seguridad: 'interno',
        permiso: null,
        query: v.aaaServicioValidator,
        respuesta: { status: 200, descripcion: 'Configuración efectiva para RADIUS', esquema: AaaServicio },
    }),
]

export default [...auth, ...usuarios, ...clientes, ...servicios, ...bitacora, ...ip, ...interno]
