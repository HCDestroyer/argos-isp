/*
|--------------------------------------------------------------------------
| Rutas del núcleo (A1): auth, ACL, clientes, zonas, servicios, bitácora, IP, interno
|--------------------------------------------------------------------------
|
| Solo validan y llaman acciones. Las que no tienen `handler` responden 501.
|
*/
import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, etagCoincide, sinCambios, type Ruta } from '#shared/rutas'
import { empresasDeLaLista, exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirCliente, exigirServicio } from '#core/acceso_empresa'
import { lista, pagina } from '#shared/openapi/esquemas'
import { listarAcciones, listarCambios } from '#shared/bitacora'
import { construirMe } from '#core/acl'
import IniciarSesion from '#core/actions/iniciar_sesion'
import { conLimiteLogin, contarIpLogin } from '#core/auth/limite_login'
import {
    borrarCookieSesionPanel,
    csrfDeSesion,
    ponerCookieSesionPanel,
    verificarOrigenLogin,
} from '#core/auth/sesion_panel'
import CerrarSesion from '#core/actions/cerrar_sesion'
import CrearUsuario from '#core/actions/crear_usuario'
import EditarUsuario from '#core/actions/editar_usuario'
import AsignarEmpresasUsuario from '#core/actions/asignar_empresas_usuario'
import CrearRol from '#core/actions/crear_rol'
import EditarRol from '#core/actions/editar_rol'
import CrearTokenApi from '#core/actions/crear_token_api'
import RevocarTokenApi from '#core/actions/revocar_token_api'
import { listarPermisos, listarRoles, listarTokens, listarUsuarios, verUsuario } from '#core/consultas/acl'
import { alcancesDelToken } from '#middleware/autorizar_middleware'
import { exigirAlcance } from '#core/acl'
import CrearServicio from '#core/actions/crear_servicio'
import EditarServicio from '#core/actions/editar_servicio'
import RetirarServicio from '#core/actions/retirar_servicio'
import VerCredencialesServicio from '#core/actions/ver_credenciales_servicio'
import CambiarEmpresaServicio from '#core/actions/cambiar_empresa_servicio'
import { configuracionEfectivaPublica } from '#core/actions/obtener_configuracion_efectiva'
import SuspenderServicio from '#core/actions/suspender_servicio'
import ProgramarPlanTemporal from '#core/actions/programar_plan_temporal'
import CancelarPlanTemporal from '#core/actions/cancelar_plan_temporal'
import { listarPlanesTemporales } from '#core/planes_temporales'
import ReactivarServicio from '#core/actions/reactivar_servicio'
import LimitarServicio from '#core/actions/limitar_servicio'
import QuitarLimiteServicio from '#core/actions/quitar_limite_servicio'
import DesconectarServicio from '#network/sesiones/actions/desconectar_servicio'
import { listarServicios, verServicio } from '#core/consultas/servicios'
import CrearCliente from '#core/actions/crear_cliente'
import EditarCliente from '#core/actions/editar_cliente'
import VincularTelegramCliente from '#core/actions/vincular_telegram_cliente'
import DesvincularTelegramCliente from '#core/actions/desvincular_telegram_cliente'
import AsignarResponsablePago from '#core/actions/asignar_responsable_pago'
import QuitarResponsablePago from '#core/actions/quitar_responsable_pago'
import CrearZona from '#core/actions/crear_zona'
import CrearCampoPersonalizado from '#core/actions/crear_campo_personalizado'
import EditarCampoPersonalizado from '#core/actions/editar_campo_personalizado'
import DesactivarCampoPersonalizado from '#core/actions/desactivar_campo_personalizado'
import ActivarCampoPersonalizado from '#core/actions/activar_campo_personalizado'
import { listarCamposPersonalizados } from '#core/campos_personalizados'
import EditarZona from '#core/actions/editar_zona'
import {
    buscarClientes,
    dimensionesDeCliente,
    listarDependientes,
    listarZonas,
    verCliente,
} from '#core/consultas/clientes'
import { NoEncontrado, Problema, Prohibido, ValidacionFallida } from '#shared/errores'
import {
    construirRegistroAaa,
    paginaRegistrosAaa,
    registrosAaaPorServicio,
    registrosAaaPorUserPpp,
} from '#core/aaa'
import { LIMITE_POR_DEFECTO } from '#shared/paginacion'
import { resolverIp } from '#network/consultas/ip'
import ResolverIps from '#core/actions/resolver_ips'
import GenerarTokenHorus from '#core/actions/generar_token_horus'
import RevocarTokenHorus from '#core/actions/revocar_token_horus'
import { listarTokensHorus } from '#core/integraciones_horus'
import EmitirTicketSso from '#core/actions/emitir_ticket_sso'
import CanjearTicketSso from '#core/actions/canjear_ticket_sso'
import VincularCuentaSso from '#core/actions/vincular_cuenta_sso'
import QuitarVinculacion from '#core/actions/quitar_vinculacion'
import RevocarVinculaciones from '#core/actions/revocar_vinculaciones'
import type { SalidaIniciarSesion } from '#core/actions/iniciar_sesion'
import { vinculacionesDeUsuario } from '#core/sso'
import { listarTramos } from '#network/historial'
import { TramoAsignacion } from '#network/esquemas'
import * as v from '#core/validators'
import adicionales from '#start/routes/adicionales'
import CrearEmpresa from '#core/actions/crear_empresa'
import EditarEmpresaGrupo from '#core/actions/editar_empresa'
import DesactivarEmpresa from '#core/actions/desactivar_empresa'
import CambiarLogoEmpresa from '#core/actions/cambiar_logo_empresa'
import CambiarPaisEmpresa from '#core/actions/cambiar_pais_empresa'
import { NOMBRES_PAIS, paisesSoportados } from '#core/localizacion'
import { filaEmpresa, listarEmpresas, verEmpresaCompleta } from '#core/empresas'
import { TAMANO_MAXIMO_LOGO, leerArchivoLogo } from '#core/logos'
import {
    AaaServicio,
    AccionAuditoria,
    CanjeSso,
    RevocacionVinculaciones,
    TicketSsoEmitido,
    VinculacionExterna,
    CambioAuditoria,
    Cliente,
    ConfiguracionEfectivaServicio,
    DependientePago,
    CredencialesPpp,
    EmpresaGrupo,
    PaisLocalizacion,
    PlanTemporal,
    Me,
    Permiso,
    ResolucionIp,
    ResolucionIpsHorus,
    Rol,
    Servicio,
    Sesion,
    SesionPanel,
    TokenApi,
    TokenApiCreado,
    TokenHorusCreado,
    Usuario,
    Zona,
    CampoPersonalizado,
    RolBase,
    rolesBase,
} from '#core/esquemas'

/** Pone la cookie del panel y arma `SesionPanel` (mismo cuerpo que `POST /auth/sesion`). */
function sesionPanel(ctx: HttpContext, sesion: SalidaIniciarSesion) {
    ponerCookieSesionPanel(ctx, sesion.token, sesion.expiraMaxEn)
    const csrf = csrfDeSesion(sesion.token)
    return {
        usuario: { ...sesion.usuario, csrf },
        csrf,
        expira_en: sesion.expiraEn?.toISOString() ?? null,
        expira_max_en: sesion.expiraMaxEn?.toISOString() ?? null,
    }
}

/** Autologin desde Horus (contrato Horus §1.5, lado receptor). */
const sso: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/auth/sso/canjear',
        operacion: 'authSsoCanjear',
        resumen: 'Canjear un ticket de autologin (panel, /sso/entrar#<ticket>)',
        etiqueta: 'auth',
        seguridad: 'publico',
        permiso: null,
        descripcion:
            'Un uso, 60 s, ligado al conector que lo pidió (410 `ticket_invalido` si venció, se usó o el ' +
            'conector ya no está conectado). Con vinculación: cookie del panel como `POST /auth/sesion` ' +
            '(permisos, alcance y límites del usuario local) y `ruta` del destino. Sin vinculación: ' +
            '`vinculacion_requerida` y un token de vinculación para `POST /auth/sso/vincular`. Nunca vincula ' +
            'por correo. Mismo control de `Origin` y límite por IP que el login.',
        cuerpo: v.canjearTicketSsoValidator,
        limitada: true,
        antes: contarIpLogin(),
        respuesta: { status: 200, descripcion: 'Sesión abierta o vinculación requerida', esquema: CanjeSso },
        handler: async (ctx, { cuerpo }) => {
            verificarOrigenLogin(ctx)
            const salida = await new CanjearTicketSso().execute(cuerpo, ctx.contextoAccion('panel'))
            if (salida.resultado === 'sesion') {
                return {
                    resultado: salida.resultado,
                    ruta: salida.ruta,
                    conector: salida.conector,
                    sesion: sesionPanel(ctx, salida.sesion),
                    vinculacion: null,
                }
            }
            return { ...salida, sesion: null }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/auth/sso/vincular',
        operacion: 'authSsoVincular',
        resumen: 'Iniciar sesión y vincular la cuenta del otro sistema (autologin)',
        etiqueta: 'auth',
        seguridad: 'publico',
        permiso: null,
        descripcion:
            'Login normal (mismas credenciales, límite de intentos y cookie que `POST /auth/sesion`) con el ' +
            'token de `vinculacion_requerida` (10 min, un uso; 410 `vinculacion_invalida`). Si entra, guarda ' +
            'la vinculación y devuelve la `ruta` del destino.',
        cuerpo: v.vincularCuentaSsoValidator,
        limitada: true,
        antes: contarIpLogin(),
        respuesta: { status: 200, descripcion: 'Sesión abierta y cuenta vinculada', esquema: CanjeSso },
        handler: async (ctx, { cuerpo }) => {
            verificarOrigenLogin(ctx)
            const salida = await conLimiteLogin(ctx, cuerpo.email, () =>
                new VincularCuentaSso().execute(cuerpo, ctx.contextoAccion('panel')),
            )
            return {
                resultado: salida.resultado,
                ruta: salida.ruta,
                conector: salida.conector,
                sesion: sesionPanel(ctx, salida.sesion),
                vinculacion: null,
            }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/me/vinculaciones',
        operacion: 'meVinculaciones',
        resumen: 'Mis vinculaciones de autologin con otros sistemas',
        etiqueta: 'auth',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Vinculaciones vigentes', esquema: lista(VinculacionExterna) },
        handler: (ctx) => vinculacionesDeUsuario(ctx.auth.getUserOrFail().id),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/me/vinculaciones/:id/quitar',
        operacion: 'meVinculacionesQuitar',
        resumen: 'Quitar una de mis vinculaciones de autologin',
        etiqueta: 'auth',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Vinculación revocada', esquema: VinculacionExterna },
        handler: (ctx, { params }) =>
            new QuitarVinculacion().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/vinculaciones/revocar',
        operacion: 'vinculacionesRevocar',
        resumen: 'Revocar vinculaciones de autologin (todas, de un usuario o de un conector)',
        etiqueta: 'acl',
        permiso: 'vinculaciones.revocar',
        cuerpo: v.revocarVinculacionesValidator,
        respuesta: { status: 200, descripcion: 'Cuántas se revocaron', esquema: RevocacionVinculaciones },
        handler: (ctx, { cuerpo }) => new RevocarVinculaciones().execute(cuerpo, ctx.contextoAccion()),
    }),
]

const auth: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/auth/login',
        operacion: 'authLogin',
        resumen: 'Iniciar sesión',
        etiqueta: 'auth',
        seguridad: 'publico',
        permiso: null,
        descripcion:
            'Límite de intentos por IP (todos, también los de cuerpo inválido) y por usuario (fallidos): ' +
            '429 `demasiados_intentos` con ' +
            '`Retry-After`. Variables `LOGIN_LIMITE_IP`, `LOGIN_LIMITE_USUARIO`, `LOGIN_LIMITE_VENTANA_S`.',
        cuerpo: v.loginValidator,
        limitada: true,
        antes: contarIpLogin(),
        respuesta: { status: 200, descripcion: 'Sesión iniciada', esquema: Sesion },
        handler: async (ctx, { cuerpo }) => {
            const sesion = await conLimiteLogin(ctx, cuerpo.email, () =>
                new IniciarSesion().execute(cuerpo, ctx.contextoAccion()),
            )
            return { token: sesion.token, usuario: sesion.usuario }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/auth/sesion',
        operacion: 'authSesion',
        resumen: 'Iniciar sesión del panel en cookie HttpOnly',
        etiqueta: 'auth',
        seguridad: 'publico',
        permiso: null,
        descripcion:
            'Igual que `POST /auth/login` (mismas credenciales y límite de intentos), pero el token va en la ' +
            'cookie `argos_sesion` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api`) y nunca en el ' +
            'cuerpo. El cuerpo trae `csrf`: el panel lo manda en `X-CSRF-Token` en POST, PUT y DELETE. ' +
            'Si llega `Origin`, debe ser un origen permitido (`CORS_ORIGINS`): si no, 403 `csrf_invalido`. ' +
            'La sesión se renueva sola mientras se usa (`PANEL_SESION_INACTIVIDAD_H`, 12 h) hasta el tope ' +
            '`PANEL_SESION_MAXIMA_H` (72 h desde el login); vencida, 401 `sesion_expirada`. ' +
            'Contrato: `.claude/integration/contratos/sesion-panel.md`.',
        cuerpo: v.loginValidator,
        limitada: true,
        antes: contarIpLogin(),
        respuesta: { status: 200, descripcion: 'Sesión iniciada; cookie puesta', esquema: SesionPanel },
        handler: async (ctx, { cuerpo }) => {
            verificarOrigenLogin(ctx)
            const sesion = await conLimiteLogin(ctx, cuerpo.email, () =>
                new IniciarSesion().execute({ ...cuerpo, modo: 'cookie' }, ctx.contextoAccion('panel')),
            )
            ponerCookieSesionPanel(ctx, sesion.token, sesion.expiraMaxEn)
            const csrf = csrfDeSesion(sesion.token)
            return {
                usuario: { ...sesion.usuario, csrf },
                csrf,
                expira_en: sesion.expiraEn?.toISOString() ?? null,
                expira_max_en: sesion.expiraMaxEn?.toISOString() ?? null,
            }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/auth/logout',
        operacion: 'authLogout',
        resumen: 'Cerrar la sesión actual',
        descripcion:
            'Revoca el token de login (Bearer o cookie del panel). Con la cookie, la borra ' +
            '(`Set-Cookie` vencida) y exige `X-CSRF-Token` como todo POST.',
        etiqueta: 'auth',
        permiso: null,
        respuesta: { status: 204, descripcion: 'Sesión cerrada' },
        handler: async (ctx) => {
            const guard = ctx.auth.authenticatedViaGuard
            if (guard !== 'api' && guard !== 'panel') {
                throw new Problema(
                    400,
                    'no_es_sesion',
                    'No es una sesión de login',
                    'Un token de API se revoca con POST /tokens/:id/revocar',
                )
            }
            const usuario = ctx.auth.use(guard).getUserOrFail()
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
            if (guard === 'panel') borrarCookieSesionPanel(ctx)
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
        handler: async (ctx) => {
            const me = await construirMe(ctx.auth.getUserOrFail(), alcancesDelToken(ctx))
            // la empresa activa de esta petición (`X-Empresa-Id` o la única del usuario)
            me.empresa_activa_id = ctx.empresa?.activa ?? me.empresa_activa_id
            const guard = ctx.auth.authenticatedViaGuard
            if (guard === 'panel') {
                const panel = ctx.auth.use('panel')
                return {
                    ...me,
                    csrf: csrfDeSesion(panel.tokenSesion!),
                    expira_en: panel.expiraEn?.toISOString() ?? null,
                    expira_max_en: panel.expiraMaxEn?.toISOString() ?? null,
                }
            }
            const expira =
                guard === 'api' ? (ctx.auth.use('api').user?.currentAccessToken.expiresAt ?? null) : null
            return {
                ...me,
                expira_en: expira?.toISOString() ?? null,
                expira_max_en: expira?.toISOString() ?? null,
            }
        },
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
        metodo: 'put',
        ruta: '/usuarios/:id/empresas',
        operacion: 'usuariosAsignarEmpresas',
        resumen: 'Definir las empresas del usuario o su alcance global',
        descripcion:
            'Sin alcance global hace falta al menos una empresa activa (422). Solo quien tiene alcance global ' +
            'puede darlo, y nadie asigna empresas fuera de su alcance (403 `empresa_no_permitida`).',
        etiqueta: 'acl',
        permiso: 'usuarios.asignar_empresas',
        cuerpo: v.asignarEmpresasUsuarioValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Usuario con su alcance por empresa', esquema: Usuario },
        handler: (ctx, { cuerpo, params }) =>
            new AsignarEmpresasUsuario().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
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
        ruta: '/roles/base',
        operacion: 'rolesBase',
        resumen: 'Roles base del seed con sus permisos (definidos en código)',
        descripcion:
            'Los seis roles de `ROLES_BASE` (`app/core/permisos.ts`), tal como los sincroniza el seed. Los mismos ' +
            'datos van en `x-roles-base` del esquema `RolBase`.',
        etiqueta: 'acl',
        permiso: 'roles.ver',
        respuesta: { status: 200, descripcion: 'Roles base', esquema: lista(RolBase) },
        handler: async () => rolesBase(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/permisos',
        operacion: 'permisosListar',
        resumen: 'Catálogo de permisos',
        descripcion:
            'Todos los permisos de `app/core/permisos.ts` con su descripción, también los que ninguna ruta pide ' +
            '(acciones del sistema o anidadas). El mismo catálogo está en el esquema `NombrePermiso` ' +
            '(`enum` y `x-enum-descriptions`).',
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
        handler: (ctx, { query }) =>
            buscarClientes(query, ctx.alcance, empresasDeLaLista(ctx.empresa, query.empresas)),
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
        handler: (ctx, { cuerpo }) => {
            exigirAlcance(ctx.alcance, { zona: [cuerpo.zona_id] })
            return new CrearCliente().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/clientes/:id',
        operacion: 'clientesVer',
        resumen: 'Ver cliente',
        etiqueta: 'clientes',
        permiso: 'clientes.ver',
        respuesta: { status: 200, descripcion: 'Cliente', esquema: Cliente },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            return verCliente(id)
        },
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
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            if (cuerpo.zona_id !== undefined) exigirAlcance(ctx.alcance, { zona: [cuerpo.zona_id] })
            return new EditarCliente().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/clientes/:id/vincular-telegram',
        operacion: 'clientesVincularTelegram',
        resumen: 'Vincular el chat de Telegram del cliente',
        descripcion:
            'Fija `telegram_chat_id`; otro chat reemplaza al anterior. El cambio queda en la bitácora.',
        etiqueta: 'clientes',
        permiso: 'clientes.vincular_telegram',
        cuerpo: v.vincularTelegramValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Cliente con el chat vinculado', esquema: Cliente },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            return new VincularTelegramCliente().execute(
                { id, chat_id: cuerpo.chat_id },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/clientes/:id/desvincular-telegram',
        operacion: 'clientesDesvincularTelegram',
        resumen: 'Quitar el chat de Telegram del cliente',
        etiqueta: 'clientes',
        permiso: 'clientes.desvincular_telegram',
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Cliente sin chat de Telegram', esquema: Cliente },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            return new DesvincularTelegramCliente().execute({ id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/clientes/:id/responsable-pago',
        operacion: 'clientesAsignarResponsablePago',
        resumen: 'Asignar el responsable de pago del cliente',
        descripcion:
            'Fija el cliente que paga por este. Un solo nivel: el responsable no puede tener ' +
            'responsable y un cliente con dependientes no puede tenerlo. 422 si es él mismo, si el ' +
            'responsable no existe o si se formaría un ciclo o un segundo nivel. Solo sugiere en el ' +
            'cobro: cualquiera puede pagar cualquier factura.',
        etiqueta: 'clientes',
        permiso: 'clientes.asignar_responsable_pago',
        cuerpo: v.asignarResponsablePagoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Cliente con su responsable de pago', esquema: Cliente },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            // el responsable también debe estar en el alcance; si no existe, la acción responde 422
            const delResponsable = await dimensionesDeCliente(cuerpo.responsable_id).catch((e: unknown) => {
                if (e instanceof NoEncontrado) return null
                throw e
            })
            if (delResponsable) exigirAlcance(ctx.alcance, delResponsable)
            return new AsignarResponsablePago().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/clientes/:id/quitar-responsable-pago',
        operacion: 'clientesQuitarResponsablePago',
        resumen: 'Quitar el responsable de pago del cliente',
        etiqueta: 'clientes',
        permiso: 'clientes.quitar_responsable_pago',
        cuerpo: v.quitarResponsablePagoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Cliente sin responsable de pago', esquema: Cliente },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            return new QuitarResponsablePago().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/clientes/:id/dependientes',
        operacion: 'clientesDependientes',
        resumen: 'Clientes de los que es responsable de pago',
        descripcion:
            'Dependientes con su número de servicios no retirados y el estado resumido. ' +
            'El cobro (A4) muestra sus facturas debajo del pagador.',
        etiqueta: 'clientes',
        permiso: 'clientes.ver',
        query: v.listarDependientesValidator,
        respuesta: { status: 200, descripcion: 'Página de dependientes', esquema: pagina(DependientePago) },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            return listarDependientes(id, query, ctx.alcance)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/zonas',
        operacion: 'zonasListar',
        resumen: 'Listar zonas',
        etiqueta: 'clientes',
        permiso: 'zonas.ver',
        respuesta: { status: 200, descripcion: 'Zonas', esquema: { type: 'array', items: Zona } },
        handler: () => listarZonas(),
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
        handler: (ctx, { cuerpo }) => new CrearZona().execute(cuerpo, ctx.contextoAccion()),
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
        handler: (ctx, { cuerpo, params }) =>
            new EditarZona().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/campos-personalizados',
        operacion: 'camposPersonalizadosListar',
        resumen: 'Catálogo de campos personalizados del cliente',
        descripcion:
            'Qué claves de `Cliente.campos_personalizados` existen, su etiqueta, tipo, opciones, si son ' +
            'requeridas y su orden en la ficha. `?activo=true` para el formulario.',
        etiqueta: 'clientes',
        permiso: 'clientes.ver',
        query: v.listarCamposPersonalizadosValidator,
        respuesta: { status: 200, descripcion: 'Campos personalizados', esquema: lista(CampoPersonalizado) },
        handler: (_ctx, { query }) => listarCamposPersonalizados(query),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/campos-personalizados',
        operacion: 'camposPersonalizadosCrear',
        resumen: 'Agregar un campo personalizado del cliente',
        descripcion: '409 `campo_duplicado` si la clave ya existe. `clave` y `tipo` no cambian después.',
        etiqueta: 'clientes',
        permiso: 'campos_personalizados.crear',
        cuerpo: v.crearCampoPersonalizadoValidator,
        respuesta: { status: 201, descripcion: 'Campo creado', esquema: CampoPersonalizado },
        handler: (ctx, { cuerpo }) => new CrearCampoPersonalizado().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/campos-personalizados/:id',
        operacion: 'camposPersonalizadosEditar',
        resumen: 'Editar etiqueta, opciones, obligatoriedad u orden de un campo personalizado',
        etiqueta: 'clientes',
        permiso: 'campos_personalizados.editar',
        cuerpo: v.editarCampoPersonalizadoValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Campo actualizado', esquema: CampoPersonalizado },
        handler: (ctx, { cuerpo, params }) =>
            new EditarCampoPersonalizado().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/campos-personalizados/:id/desactivar',
        operacion: 'camposPersonalizadosDesactivar',
        resumen: 'Desactivar un campo personalizado (no se borra; los valores se conservan)',
        etiqueta: 'clientes',
        permiso: 'campos_personalizados.desactivar',
        cuerpo: v.versionCampoPersonalizadoValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Campo desactivado', esquema: CampoPersonalizado },
        handler: (ctx, { cuerpo, params }) =>
            new DesactivarCampoPersonalizado().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/campos-personalizados/:id/activar',
        operacion: 'camposPersonalizadosActivar',
        resumen: 'Volver a activar un campo personalizado',
        etiqueta: 'clientes',
        permiso: 'campos_personalizados.activar',
        cuerpo: v.versionCampoPersonalizadoValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Campo activado', esquema: CampoPersonalizado },
        handler: (ctx, { cuerpo, params }) =>
            new ActivarCampoPersonalizado().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            ),
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
    ejecutar?: (entrada: { id: number; motivo: string }, ctx: HttpContext) => Promise<unknown>,
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
        handler: ejecutar
            ? async (ctx, { cuerpo, params }) => {
                  const id = Number(params.id)
                  await exigirServicio(ctx, id)
                  return ejecutar({ id, motivo: cuerpo.motivo }, ctx)
              }
            : undefined,
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
        handler: (ctx, { query }) =>
            listarServicios(query, ctx.alcance, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios',
        operacion: 'serviciosCrear',
        resumen: 'Crear servicio PPPoE o sin PPPoE (asigna IPv4/IPv6, genera user_ppp en pppoe)',
        etiqueta: 'servicios',
        permiso: 'servicios.crear',
        cuerpo: v.crearServicioValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Servicio creado', esquema: Servicio },
        handler: async (ctx, { cuerpo }) => {
            const cliente = await dimensionesDeCliente(cuerpo.cliente_id).catch(() => ({ zona: [] }))
            exigirAlcance(ctx.alcance, { router: [cuerpo.router_id], zona: cliente.zona ?? [] })
            // sin plantilla_facturacion_id → plantilla por defecto (app/core/plantilla_por_defecto.ts)
            return new CrearServicio().execute({ ...cuerpo, plantillaPorDefecto: true }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id',
        operacion: 'serviciosVer',
        resumen: 'Ver servicio',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        respuesta: { status: 200, descripcion: 'Servicio', esquema: Servicio },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return verServicio(id)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/configuracion-efectiva',
        operacion: 'serviciosConfiguracionEfectiva',
        resumen: 'Configuración efectiva: plan en su router y plantilla con excepciones aplicadas',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        respuesta: {
            status: 200,
            descripcion: 'Plan efectivo y facturación efectiva del servicio',
            esquema: ConfiguracionEfectivaServicio,
        },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return configuracionEfectivaPublica(id)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/asignaciones',
        operacion: 'serviciosAsignaciones',
        resumen: 'Historial de router, plan, IPv4 y prefijos IPv6 del servicio',
        descripcion:
            'Tramos del más reciente al más viejo; el vigente tiene `fin: null`. Cada cambio de router, ' +
            'plan, IPv4 o prefijos cierra un tramo y abre otro.',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        query: v.listarPaginadoValidator,
        respuesta: { status: 200, descripcion: 'Página de tramos', esquema: pagina(TramoAsignacion) },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return listarTramos(id, query)
        },
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
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            if (cuerpo.router_id !== undefined) exigirAlcance(ctx.alcance, { router: [cuerpo.router_id] })
            return new EditarServicio().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    accionServicio(
        'suspender',
        'serviciosSuspender',
        'servicios.suspender',
        'Suspender servicio (desde activo o limitado)',
        (entrada, ctx) => new SuspenderServicio().execute(entrada, ctx.contextoAccion()),
    ),
    accionServicio(
        'reactivar',
        'serviciosReactivar',
        'servicios.reactivar',
        'Reactivar servicio (desde suspendido o limitado, queda activo)',
        (entrada, ctx) => new ReactivarServicio().execute(entrada, ctx.contextoAccion()),
    ),
    accionServicio(
        'limitar',
        'serviciosLimitar',
        'servicios.limitar',
        'Limitar velocidad del servicio (desde activo o suspendido)',
        (entrada, ctx) => new LimitarServicio().execute(entrada, ctx.contextoAccion()),
    ),
    accionServicio(
        'quitar-limite',
        'serviciosQuitarLimite',
        'servicios.quitar_limite',
        'Quitar límite de velocidad (desde limitado, queda activo)',
        (entrada, ctx) => new QuitarLimiteServicio().execute(entrada, ctx.contextoAccion()),
    ),
    accionServicio(
        'retirar',
        'serviciosRetirar',
        'servicios.retirar',
        'Retirar servicio (libera IPs)',
        (entrada, ctx) => new RetirarServicio().execute(entrada, ctx.contextoAccion()),
    ),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/credenciales',
        operacion: 'serviciosCredenciales',
        resumen: 'Ver usuario y contraseña PPPoE (queda auditado)',
        etiqueta: 'servicios',
        permiso: 'servicios.ver_credenciales',
        respuesta: { status: 200, descripcion: 'Credenciales PPPoE', esquema: CredencialesPpp },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new VerCredencialesServicio().execute({ id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/cambiar-empresa',
        operacion: 'serviciosCambiarEmpresa',
        resumen: 'Pasar el servicio a otra empresa (NIT)',
        descripcion:
            'Solo sin saldo pendiente (422 `servicio_con_saldo`). Hace falta acceso a las dos empresas ' +
            '(403 `empresa_no_permitida`); la nueva debe estar activa. Emite `servicio.config_cambiada` ' +
            'con `campos: [empresa]`. Misma empresa: 200 sin cambios.',
        etiqueta: 'servicios',
        permiso: 'servicios.cambiar_empresa',
        cuerpo: v.cambiarEmpresaServicioValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Servicio en su nueva empresa', esquema: Servicio },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new CambiarEmpresaServicio().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/planes-temporales',
        operacion: 'serviciosPlanesTemporales',
        resumen: 'Planes temporales del servicio (mejoras de plan de lealtad o manuales)',
        descripcion:
            'Del más reciente al más viejo. El vigente (programado o activo) viene también en `plan_temporal`.',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        query: v.listarPaginadoValidator,
        respuesta: { status: 200, descripcion: 'Página de planes temporales', esquema: pagina(PlanTemporal) },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return listarPlanesTemporales(id, query)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/planes-temporales',
        operacion: 'serviciosProgramarPlanTemporal',
        resumen: 'Programar un plan temporal (mejora de plan con fecha de fin)',
        descripcion:
            'Con `inicio` ya llegado (o sin él) se inicia en la misma petición: `plan_id` del servicio pasa al ' +
            'temporal y se emite `servicio.config_cambiada` (`motivo: plan_temporal`); al `fin` el cron lo ' +
            'devuelve a su plan base. 409 `plan_temporal_existente` si ya hay uno programado o activo; 422 ' +
            '`plan_temporal_incompatible` si cambia IPv4/IPv6 o el tamaño del prefijo delegado, ' +
            '`plan_temporal_igual`, `plan_no_disponible`, `plan_inactivo` o `servicio_retirado`.',
        etiqueta: 'servicios',
        permiso: 'servicios.programar_plan_temporal',
        cuerpo: v.programarPlanTemporalValidator,
        idempotente: true,
        respuesta: {
            status: 201,
            descripcion: 'Plan temporal programado (o ya activo)',
            esquema: PlanTemporal,
        },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new ProgramarPlanTemporal().execute(
                { ...cuerpo, servicio_id: id, origen: 'manual' },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/planes-temporales/:planTemporalId/cancelar',
        operacion: 'serviciosCancelarPlanTemporal',
        resumen: 'Cancelar un plan temporal (si está activo, el servicio vuelve a su plan base)',
        descripcion: '409 `plan_temporal_cerrado` si ya terminó o se canceló; 409 si `version` cambió.',
        etiqueta: 'servicios',
        permiso: 'servicios.cancelar_plan_temporal',
        cuerpo: v.cancelarPlanTemporalValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Plan temporal cancelado', esquema: PlanTemporal },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new CancelarPlanTemporal().execute(
                { ...cuerpo, id: Number(params.planTemporalId), servicio_id: id },
                ctx.contextoAccion(),
            )
        },
    }),
    accionServicio(
        'desconectar',
        'serviciosDesconectar',
        'servicios.desconectar',
        'Desconectar la sesión PPPoE (Disconnect-Request vía coa; 404 si no hay sesión activa)',
        async (entrada, ctx) => {
            await new DesconectarServicio().execute(entrada, ctx.contextoAccion())
            return verServicio(entrada.id)
        },
    ),
]

/** Archivo `logo` del multipart (vacío si no viene); 422 antes de leerlo si pesa más de 512 KB. */
async function logoDeLaPeticion(ctx: HttpContext): Promise<Uint8Array> {
    const archivos = ctx.request.files('logo')
    if (archivos.length > 1) {
        throw new ValidacionFallida([{ field: 'logo', rule: 'unico', message: 'Más de un archivo' }])
    }
    const archivo = archivos[0]
    if (!archivo?.tmpPath) return new Uint8Array()
    if (archivo.size > TAMANO_MAXIMO_LOGO) {
        throw new ValidacionFallida([
            {
                field: 'logo',
                rule: 'tamano',
                message: `El logo pesa ${Math.ceil(archivo.size / 1024)} KB; el máximo es 512 KB`,
            },
        ])
    }
    return readFile(archivo.tmpPath)
}

const empresas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/empresas',
        operacion: 'empresasListar',
        resumen: 'Empresas (NIT) de la instalación',
        descripcion:
            'La principal (id 1) primero; sin alcance global, solo las del usuario. Contrato: ' +
            '`.claude/integration/contratos/multiempresa.md`.',
        etiqueta: 'empresas',
        permiso: 'empresas.ver',
        query: v.listarEmpresasValidator,
        respuesta: { status: 200, descripcion: 'Empresas', esquema: { type: 'array', items: EmpresaGrupo } },
        handler: (ctx, { query }) =>
            listarEmpresas({ ids: ctx.empresa?.permitidas ?? null, soloActivas: query.activas === true }),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/empresas',
        operacion: 'empresasCrear',
        resumen: 'Crear empresa (NIT)',
        descripcion: '409 `nit_duplicado` si otra empresa activa tiene el mismo NIT. El logo se sube aparte.',
        etiqueta: 'empresas',
        permiso: 'empresas.crear',
        cuerpo: v.crearEmpresaValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Empresa creada', esquema: EmpresaGrupo },
        handler: (ctx, { cuerpo }) => new CrearEmpresa().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/empresas/paises',
        operacion: 'empresasPaises',
        resumen: 'Países con localización fiscal (selector de país)',
        descripcion:
            'Los que se pueden elegir al crear una empresa o en `cambiar-pais`. Hoy solo GT. Contrato: ' +
            '`.claude/integration/contratos/localizacion-fiscal.md`.',
        etiqueta: 'empresas',
        permiso: 'empresas.ver',
        respuesta: {
            status: 200,
            descripcion: 'Países',
            esquema: { type: 'array', items: PaisLocalizacion },
        },
        handler: async () =>
            paisesSoportados().map((codigo) => ({ codigo, nombre: NOMBRES_PAIS[codigo] ?? codigo })),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/empresas/:id',
        operacion: 'empresasVer',
        resumen: 'Ver empresa',
        etiqueta: 'empresas',
        permiso: 'empresas.ver',
        respuesta: { status: 200, descripcion: 'Empresa', esquema: EmpresaGrupo },
        handler: (ctx, { params }) => {
            exigirAccesoEmpresa(ctx.contextoAccion(), Number(params.id))
            return verEmpresaCompleta(Number(params.id))
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/empresas/:id',
        operacion: 'empresasEditar',
        resumen: 'Editar datos fiscales y de contacto de la empresa',
        etiqueta: 'empresas',
        permiso: 'empresas.editar',
        cuerpo: v.editarEmpresaValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Empresa actualizada', esquema: EmpresaGrupo },
        handler: (ctx, { cuerpo, params }) =>
            new EditarEmpresaGrupo().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/empresas/:id/desactivar',
        operacion: 'empresasDesactivar',
        resumen: 'Desactivar empresa (no se borra)',
        descripcion:
            '422 `empresa_principal` (la 1 no se desactiva), `empresa_inactiva` o `empresa_con_servicios` ' +
            '(primero se mueven sus servicios con `POST /servicios/:id/cambiar-empresa`).',
        etiqueta: 'empresas',
        permiso: 'empresas.desactivar',
        cuerpo: v.desactivarEmpresaValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Empresa desactivada', esquema: EmpresaGrupo },
        handler: (ctx, { cuerpo, params }) =>
            new DesactivarEmpresa().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/empresas/:id/cambiar-pais',
        operacion: 'empresasCambiarPais',
        resumen: 'Cambiar el país de la localización fiscal de la empresa',
        descripcion:
            'Instala la localización del país nuevo en la misma transacción. 422 `pais_no_soportado` sin ' +
            'paquete; 409 `empresa_con_documentos` si ya tiene facturas, notas, pagos, asientos, egresos o ' +
            'documentos fiscales; 409 si `version` cambió. Mismo país: 200 sin cambios.',
        etiqueta: 'empresas',
        permiso: 'empresas.cambiar_pais',
        cuerpo: v.cambiarPaisEmpresaValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Empresa con su país', esquema: EmpresaGrupo },
        handler: (ctx, { cuerpo, params }) => {
            exigirAccesoEmpresa(ctx.contextoAccion(), Number(params.id))
            return new CambiarPaisEmpresa().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/empresas/:id/logo',
        operacion: 'empresasCambiarLogo',
        resumen: 'Subir o quitar el logo de la empresa',
        descripcion:
            '`multipart/form-data` con el archivo `logo`: PNG o SVG de hasta 512 KB. El tipo se decide por ' +
            'el contenido. El SVG se sanea: sin scripts, manejadores de eventos, estilos, `foreignObject` ni ' +
            'referencias externas; con DOCTYPE, entidades o mal formado, 422 en `logo`. `quitar=true` sin ' +
            'archivo lo quita.',
        etiqueta: 'empresas',
        permiso: 'empresas.cambiar_logo',
        cuerpo: v.cambiarLogoEmpresaValidator,
        multipart: {
            archivos: { logo: 'PNG o SVG, hasta 512 KB' },
            archivosOpcionales: ['logo'],
        },
        versionada: true,
        respuesta: { status: 200, descripcion: 'Empresa con su logo', esquema: EmpresaGrupo },
        handler: async (ctx, { cuerpo, params }) => {
            const contenido = cuerpo.quitar ? new Uint8Array() : await logoDeLaPeticion(ctx)
            return new CambiarLogoEmpresa().execute(
                { id: Number(params.id), version: cuerpo.version, contenido, quitar: cuerpo.quitar === true },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/empresas/:id/logo',
        operacion: 'empresasLogo',
        resumen: 'Logo de la empresa (público, con ETag)',
        descripcion:
            'Sin login: lo usan el portal, los correos y los PDF. `Content-Type` image/png o image/svg+xml, ' +
            '`ETag` y `Cache-Control`; con `If-None-Match` igual responde 304. 404 si la empresa no tiene logo.',
        etiqueta: 'empresas',
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Imagen del logo', contenido: 'image/*', etag: true },
        handler: async (ctx, { params }) => {
            const empresa = await filaEmpresa(Number(params.id))
            if (!empresa.logo || !empresa.logo_tipo || !empresa.logo_etag) {
                throw new NoEncontrado('La empresa no tiene logo')
            }
            ctx.response.header('ETag', `"${empresa.logo_etag}"`)
            ctx.response.header('Cache-Control', 'public, max-age=300')
            ctx.response.header('X-Content-Type-Options', 'nosniff')
            if (etagCoincide(ctx, empresa.logo_etag)) return sinCambios()
            const contenido = await leerArchivoLogo(empresa.logo)
            ctx.response.header('Content-Type', empresa.logo_tipo)
            if (empresa.logo_tipo === 'image/svg+xml') {
                // defensa extra: aunque esté saneado, un SVG abierto directo no ejecuta nada
                ctx.response.header(
                    'Content-Security-Policy',
                    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
                )
            }
            return contenido
        },
    }),
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
        handler: (ctx, { query }) => listarAcciones(query, empresasDeLaLista(ctx.empresa, query.empresas)),
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
        descripcion:
            'Busca en sesiones activas y asignaciones vigentes (IPv4 exacta, IPv6 dentro del prefijo). ' +
            'Gana el prefijo más largo; a igual longitud, la sesión activa. 404 si nadie la tiene.',
        parametros: { ip: { type: 'string', description: 'IPv4 o IPv6' } },
        respuesta: { status: 200, descripcion: 'Servicio dueño de la IP', esquema: ResolucionIp },
        handler: async (ctx, { params }) => {
            const resolucion = await resolverIp(decodeURIComponent(String(params.ip)))
            if (!resolucion) throw new NoEncontrado(`Ningún servicio tiene la IP ${String(params.ip)}`)
            await exigirServicio(ctx, resolucion.servicio_id)
            return resolucion
        },
    }),
]

/** Integración con Horus Flow (contrato `.claude/integration/contratos/horus.md`). */
const integraciones: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/resolver',
        operacion: 'integracionesHorusResolver',
        resumen: 'Resolver un lote de IPs a servicio, cliente y empresa (Horus)',
        etiqueta: 'integraciones',
        permiso: 'ip.resolver',
        descripcion:
            'De 1 a 500 IPv4 o IPv6 en el cuerpo (nunca en la URL), en una sola consulta. Misma regla que ' +
            '`GET /ip/:ip` (prefijo más largo; la sesión activa sobre la asignación). Una IP de nadie o de ' +
            'un servicio fuera del alcance del token (router, zona, empresas) responde ' +
            '`{ ip, error: "no_encontrada" }`. Cada llamada queda en la bitácora (`ip.resolver`) con los ' +
            'servicios y clientes devueltos.',
        cuerpo: v.resolverIpsValidator,
        respuesta: { status: 200, descripcion: 'Un resultado por IP, en orden', esquema: ResolucionIpsHorus },
        handler: (ctx, { cuerpo }) => new ResolverIps(ctx.alcance).execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/horus/tokens',
        operacion: 'integracionesHorusTokens',
        resumen: 'Tokens de la integración Horus (sin su valor)',
        etiqueta: 'integraciones',
        permiso: 'horus.ver',
        respuesta: { status: 200, descripcion: 'Tokens, los más nuevos primero', esquema: lista(TokenApi) },
        handler: () => listarTokensHorus(),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/tokens',
        operacion: 'integracionesHorusGenerarToken',
        resumen: 'Generar el token atk_ de Horus (se muestra una sola vez)',
        etiqueta: 'integraciones',
        permiso: 'horus.generar_token',
        descripcion:
            'Crea, la primera vez, el usuario técnico "Horus" y su rol `integracion_horus`. El token solo ' +
            'lleva `ip.resolver`, `clientes.ver` y `servicios.ver`, y opcionalmente routers o zonas. No ' +
            'revoca los anteriores.',
        cuerpo: v.generarTokenHorusValidator,
        respuesta: { status: 201, descripcion: 'Token generado', esquema: TokenHorusCreado },
        handler: (ctx, { cuerpo }) => new GenerarTokenHorus().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/tokens/:id/revocar',
        operacion: 'integracionesHorusRevocarToken',
        resumen: 'Revocar un token de la integración Horus',
        etiqueta: 'integraciones',
        permiso: 'horus.revocar_token',
        respuesta: { status: 200, descripcion: 'Token revocado', esquema: TokenApi },
        handler: (ctx, { params }) =>
            new RevocarTokenHorus().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
]

integraciones.push(
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/sso/tickets',
        operacion: 'integracionesHorusSsoTicket',
        resumen: 'Pedir un ticket de autologin para un usuario de Horus (servidor a servidor)',
        etiqueta: 'integraciones',
        permiso: 'sso.emitir',
        descripcion:
            'Solo con el token `atk_` de la integración Horus (403 con cualquier otra credencial; si el ' +
            'conector se preparó con un enlace, solo el `atk_` de ese canje, y 409 `horus_apagado` mientras ' +
            'el conector esté apagado). Destino `cliente` o `servicio` con el id de Argos. Devuelve ' +
            'la URL del panel con el ticket en el fragmento (60 s, un solo uso). No da privilegios: el canje ' +
            'abre la sesión del usuario local vinculado, o pide su login.',
        cuerpo: v.emitirTicketSsoValidator,
        respuesta: { status: 201, descripcion: 'Ticket emitido', esquema: TicketSsoEmitido },
        handler: (ctx, { cuerpo }) => {
            const tokenId =
                ctx.auth.authenticatedViaGuard === 'tokens' ? ctx.auth.use('tokens').token?.id : undefined
            if (!tokenId) {
                throw new Prohibido('Solo el token de la integración Horus puede pedir tickets de autologin')
            }
            return new EmitirTicketSso().execute({ ...cuerpo, atk_id: tokenId }, ctx.contextoAccion())
        },
    }),
)

const interno: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/internal/aaa/servicio',
        operacion: 'internoAaaServicio',
        resumen: 'Datos de autorización RADIUS de un user_ppp (servicio aaa)',
        etiqueta: 'interno',
        seguridad: 'interno',
        permiso: null,
        descripcion:
            'Mismo JSON que `aaa:user:<user_ppp>` en Redis. 404 si el user_ppp no existe; un retirado ' +
            'responde 200 con `estado: retirado`. Lee de Postgres (fuente de verdad); `aaa` repuebla Redis con SET NX.',
        query: v.aaaServicioValidator,
        respuesta: { status: 200, descripcion: 'Configuración efectiva para RADIUS', esquema: AaaServicio },
        handler: async (_ctx, { query }) => {
            const registro = await construirRegistroAaa(query.user_ppp)
            if (!registro) throw new NoEncontrado(`El user_ppp ${query.user_ppp} no existe`)
            return registro
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/internal/aaa/servicios',
        operacion: 'internoAaaServicios',
        resumen: 'Registros de autorización RADIUS por lotes (servicio aaa)',
        etiqueta: 'interno',
        seguridad: 'interno',
        permiso: null,
        descripcion:
            'Mismo JSON que `GET /internal/aaa/servicio`, varios a la vez. Con `user_ppp` o `servicio_ids` ' +
            '(hasta 100, uno de los dos) devuelve los que existen en el orden pedido (`nextCursor: null`). ' +
            'Sin lista, pagina todos los servicios `pppoe` (también retirados) por `servicio_id` ascendente ' +
            `con \`cursor\`/\`limit\` (por defecto ${LIMITE_POR_DEFECTO}). No escribe en Redis.`,
        cuerpo: v.aaaServiciosLoteValidator,
        respuesta: { status: 200, descripcion: 'Registros de autorización', esquema: pagina(AaaServicio) },
        handler: async (_ctx, { cuerpo }) => {
            const listas = (['user_ppp', 'servicio_ids'] as const).filter((c) => cuerpo[c] !== undefined)
            if (listas.length > 1) {
                throw new ValidacionFallida([
                    {
                        field: 'servicio_ids',
                        message: 'Envía user_ppp o servicio_ids, no ambos',
                        rule: 'excluyente',
                    },
                ])
            }
            if (listas.length === 1 && cuerpo.cursor !== undefined) {
                throw new ValidacionFallida([
                    { field: 'cursor', message: 'El cursor solo aplica sin lista', rule: 'excluyente' },
                ])
            }
            if (cuerpo.user_ppp) {
                return { data: await registrosAaaPorUserPpp(cuerpo.user_ppp), nextCursor: null }
            }
            if (cuerpo.servicio_ids) {
                const pedidos = [...new Set(cuerpo.servicio_ids)]
                const registros = await registrosAaaPorServicio(pedidos)
                const porId = new Map(registros.map((r) => [r.servicio_id, r]))
                return { data: pedidos.flatMap((id) => porId.get(id) ?? []), nextCursor: null }
            }
            return paginaRegistrosAaa({ cursor: cuerpo.cursor, limit: cuerpo.limit ?? LIMITE_POR_DEFECTO })
        },
    }),
]

export default [
    ...auth,
    ...sso,
    ...usuarios,
    ...empresas,
    ...clientes,
    ...servicios,
    ...adicionales,
    ...bitacora,
    ...ip,
    ...integraciones,
    ...interno,
]
