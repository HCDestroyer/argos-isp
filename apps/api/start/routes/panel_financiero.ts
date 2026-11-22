/*
|--------------------------------------------------------------------------
| Panel financiero, inicio por rol y catálogo y envíos de reportes (A3)
| Decisiones del PM 2, 3, 4, 6, 7, 11 y 12 (21 nov 2026); contrato `contratos/reportes.md`.
|--------------------------------------------------------------------------
*/
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista } from '#shared/openapi/esquemas'
import { Prohibido } from '#shared/errores'
import { empresasDeLaLista, exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { permisosDeUsuario } from '#core/acl'
import { alcancesDelToken } from '#middleware/autorizar_middleware'
import { exigirEmpresaPeticion } from '#billing/empresa'
import * as v from '#billing/panel/validators'
import {
    AjustesPanel,
    AlertasPanel,
    CorreoExterno,
    CorridaEnvio,
    EnvioReporte,
    InicioRol,
    InicioUsuario,
    PanelFinanciero,
    ReporteBajas,
    ReporteCatalogo,
    ReporteIndicadores,
    VistaReporte,
} from '#billing/panel/esquemas'
import { alertasPanel, panelFinanciero, type SeccionPanel } from '#billing/panel/panel'
import { reporteBajas, reporteIndicadores } from '#billing/panel/reportes_panel'
import { inicioDeRoles, inicioDeUsuario } from '#billing/panel/inicio'
import { catalogoDeUsuario, vistasDeUsuario } from '#billing/reportes/catalogo'
import {
    corridasDeEnvio,
    empresaDeEnvio,
    listarCorreosExternos,
    listarEnvios,
    verEnvio,
} from '#billing/reportes/envios'
import { DESCRIPCION_EXPORTACION, responderReporte } from '#billing/reportes/http'
import ConfigurarPanelFinanciero, { verAjustesPanel } from '#billing/actions/configurar_panel_financiero'
import ElegirInicio from '#billing/actions/elegir_inicio'
import ConfigurarInicioUsuario from '#billing/actions/configurar_inicio_usuario'
import ConfigurarInicioRol from '#billing/actions/configurar_inicio_rol'
import MarcarFavoritoReporte from '#billing/actions/marcar_favorito_reporte'
import QuitarFavoritoReporte from '#billing/actions/quitar_favorito_reporte'
import GuardarVistaReporte from '#billing/actions/guardar_vista_reporte'
import EliminarVistaReporte from '#billing/actions/eliminar_vista_reporte'
import AprobarCorreoExterno from '#billing/actions/aprobar_correo_externo'
import RetirarCorreoExterno from '#billing/actions/retirar_correo_externo'
import ProgramarEnvioReporte from '#billing/actions/programar_envio_reporte'
import EditarEnvioReporte from '#billing/actions/editar_envio_reporte'

/** Permisos efectivos de la petición (recortados por el token de API, si lo hay). */
async function permisosPeticion(ctx: HttpContext): Promise<Set<string>> {
    return new Set(await permisosDeUsuario(ctx.auth.getUserOrFail().id, alcancesDelToken(ctx)))
}

/** El panel suma toda la empresa: con el permiso recortado por router, zona o caja, 403. */
function exigirAlcanceTotal(ctx: HttpContext): void {
    const a = ctx.alcance
    if (a && (a.rol !== null || (a.token !== null && Object.keys(a.token).length > 0))) {
        throw new Prohibido(
            'El panel financiero suma toda la empresa: requiere el permiso sin alcance por router, zona o caja',
        )
    }
}

function empresasPanel(ctx: HttpContext, consulta?: 'todas') {
    const empresas = empresasDeLaLista(ctx.empresa, consulta)
    return { empresas, consolidado: consulta === 'todas' || empresas === null || empresas.length > 1 }
}

const DEFINICIONES =
    ' Definiciones: **ingreso mensual recurrente (MRR)** = por cada servicio activo o limitado, el precio efectivo del plan (precio especial o el del plan; con plan temporal, el temporal) − la mejora de lealtad + cargos recurrentes + adicionales cobrados, IVA incluido; **ingreso promedio por servicio (ARPU)** = MRR / servicios; **bajas (churn)** = servicios retirados o suspendidos más de `dias_baja` días (60 de fábrica), con fecha de baja en el mes; un servicio reactivado deja de contar; **tasa de bajas** = bajas / servicios al inicio del mes × 100; **efectivo disponible** = saldo del libro de Cajas (1.1.01.*) y Bancos (1.1.02.*).'

const panel: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/panel-financiero',
        operacion: 'panelFinanciero',
        resumen:
            'Panel financiero: ingreso mensual recurrente, bajas, ingreso promedio y efectivo disponible',
        etiqueta: 'reportes',
        permiso: 'panel_financiero.ver',
        query: v.panelValidator,
        descripcion:
            'Una sección por empresa (la activa; con empresas=todas y alcance global, todas y `total`). Cada sección es un bloque: `ok` con sus cifras o `error` con su problema RFC 9457 y sin cifras (nunca ceros en su lugar). `efectivo` solo viene con libro.ver. 403 si el permiso tiene alcance por router, zona o caja.' +
            DEFINICIONES,
        respuesta: { status: 200, descripcion: 'Panel', esquema: PanelFinanciero },
        handler: async (ctx, { query }) => {
            exigirAlcanceTotal(ctx)
            const permisos = await permisosPeticion(ctx)
            const secciones = new Set<SeccionPanel>(['ingresos', 'bajas'])
            if (permisos.has('libro.ver')) secciones.add('efectivo')
            const op = empresasPanel(ctx, query.empresas)
            return panelFinanciero({
                empresas: op.empresas,
                consolidado: query.empresas === 'todas',
                secciones,
                mes: query.mes,
            })
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/panel-financiero/alertas',
        operacion: 'panelFinancieroAlertas',
        resumen:
            'Alertas del panel: integridad del libro, cierres pendientes, FEL, vencimientos y pequeño contribuyente',
        etiqueta: 'reportes',
        permiso: 'panel_financiero.ver',
        query: v.alertasValidator,
        descripcion:
            'Por empresa. Libro (libro.ver): `integridad_libro` (la cadena de sellos se rompió: libro.integridad_rota) y `cierres_pendientes` (meses terminados con asientos sin cerrar). Fiscal (fiscal.ver): `contingencia_fel`, `fel_desactivada` (FEL obligatoria y apagada), `vencimientos_fiscales` (obligaciones que vencen en 7 días o vencidas) y `limite_pequeno_contribuyente` (facturado del año frente al límite; aviso al primer umbral de pc_alertas, 80 % de fábrica, y crítico desde el siguiente, 95 %). Sin el permiso de un grupo, sus tipos no se revisan ni aparecen. Una revisión que falla va en `errores` con su problema, nunca como «sin alertas».',
        respuesta: { status: 200, descripcion: 'Alertas', esquema: AlertasPanel },
        handler: async (ctx, { query }) => {
            const permisos = await permisosPeticion(ctx)
            const grupos = new Set<'libro.ver' | 'fiscal.ver'>()
            if (permisos.has('libro.ver')) grupos.add('libro.ver')
            if (permisos.has('fiscal.ver')) grupos.add('fiscal.ver')
            return alertasPanel({
                empresas: empresasDeLaLista(ctx.empresa, query.empresas),
                permisos: grupos,
            })
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/panel-financiero/ajustes',
        operacion: 'panelFinancieroAjustes',
        resumen: 'Ajustes del panel financiero de la empresa activa',
        etiqueta: 'reportes',
        permiso: 'panel_financiero.ver',
        respuesta: { status: 200, descripcion: 'Ajustes', esquema: AjustesPanel },
        handler: async (ctx) => {
            const empresaId = exigirEmpresaActivaDelContexto(ctx.contextoAccion())
            exigirEmpresaPeticion(ctx.empresa, empresaId)
            return verAjustesPanel(db.connection(), empresaId)
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/panel-financiero/ajustes',
        operacion: 'panelFinancieroConfigurar',
        resumen: 'Cambiar los ajustes del panel financiero (días de suspensión para contar una baja)',
        etiqueta: 'reportes',
        permiso: 'panel_financiero.configurar',
        cuerpo: v.ajustesPanelValidator,
        versionada: true,
        idempotente: true,
        descripcion: 'De la empresa activa (422 empresa_requerida sin ella). 409 si version cambió.',
        respuesta: { status: 200, descripcion: 'Ajustes', esquema: AjustesPanel },
        handler: (ctx, { cuerpo }) => new ConfigurarPanelFinanciero().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/indicadores-financieros',
        operacion: 'reportesIndicadoresFinancieros',
        resumen: 'Indicadores financieros por empresa: MRR, ARPU, bajas del mes y efectivo',
        etiqueta: 'reportes',
        permiso: 'panel_financiero.ver',
        query: v.reporteIndicadoresValidator,
        descripcion:
            'Una fila por empresa con las cifras del panel. Las columnas de efectivo vienen vacías sin libro.ver. 403 con el permiso recortado por alcance.' +
            DEFINICIONES +
            DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteIndicadores },
        handler: async (ctx, { query }) => {
            exigirAlcanceTotal(ctx)
            const permisos = await permisosPeticion(ctx)
            return responderReporte(
                ctx,
                await reporteIndicadores(query, empresasPanel(ctx, query.empresas), {
                    incluirEfectivo: permisos.has('libro.ver'),
                }),
                query.formato,
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/bajas',
        operacion: 'reportesBajas',
        resumen: 'Bajas de servicios (churn) por mes y tasa de bajas',
        etiqueta: 'reportes',
        permiso: 'panel_financiero.ver',
        query: v.reporteBajasValidator,
        descripcion:
            'Por mes (12 por defecto): altas, bajas (retiros y suspensiones largas), servicios al inicio del mes y tasa. Los meses pasados se recalculan con el estado de hoy: un servicio reactivado deja de contar.' +
            DEFINICIONES +
            DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteBajas },
        handler: async (ctx, { query }) => {
            exigirAlcanceTotal(ctx)
            return responderReporte(
                ctx,
                await reporteBajas(query, empresasPanel(ctx, query.empresas)),
                query.formato,
            )
        },
    }),
]

const inicio: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/inicio',
        operacion: 'inicioVer',
        resumen: 'Pantalla de inicio del usuario (panel financiero o día a día)',
        etiqueta: 'auth',
        permiso: null,
        descripcion:
            'Orden: la elegida por el usuario → la de sus roles (con varios, gana el panel financiero) → la de fábrica (admin y dueño: panel financiero; los demás: día a día). Sin panel_financiero.ver siempre es día a día (motivo sin_permiso).',
        respuesta: { status: 200, descripcion: 'Inicio', esquema: InicioUsuario },
        handler: async (ctx) => inicioDeUsuario(ctx.auth.getUserOrFail().id, await permisosPeticion(ctx)),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/inicio',
        operacion: 'inicioElegir',
        resumen: 'Elegir mi pantalla de inicio (null = la de mi rol)',
        etiqueta: 'auth',
        permiso: null,
        cuerpo: v.elegirInicioValidator,
        idempotente: true,
        descripcion:
            'Solo el propio usuario. 422 inicio_sin_permiso si pide el panel financiero sin panel_financiero.ver.',
        respuesta: { status: 200, descripcion: 'Inicio', esquema: InicioUsuario },
        handler: async (ctx, { cuerpo }) => {
            const usuarioId = ctx.auth.getUserOrFail().id
            await new ElegirInicio().execute(
                { usuario_id: usuarioId, inicio: cuerpo.inicio, version: cuerpo.version },
                ctx.contextoAccion(),
            )
            return inicioDeUsuario(usuarioId, await permisosPeticion(ctx))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inicio/roles',
        operacion: 'inicioRoles',
        resumen: 'Pantalla de inicio de cada rol',
        etiqueta: 'auth',
        permiso: 'inicio.configurar_rol',
        respuesta: { status: 200, descripcion: 'Roles', esquema: lista(InicioRol) },
        handler: () => inicioDeRoles(),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/inicio/roles/:id',
        operacion: 'inicioConfigurarRol',
        resumen: 'Elegir la pantalla de inicio de un rol (null = la de fábrica)',
        etiqueta: 'auth',
        permiso: 'inicio.configurar_rol',
        cuerpo: v.elegirInicioValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Inicio del rol', esquema: InicioRol },
        handler: (ctx, { cuerpo, params }) =>
            new ConfigurarInicioRol().execute(
                { role_id: Number(params.id), inicio: cuerpo.inicio, version: cuerpo.version },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/inicio/usuarios/:id',
        operacion: 'inicioConfigurarUsuario',
        resumen: 'Elegir la pantalla de inicio de otro usuario (null = la de su rol)',
        etiqueta: 'auth',
        permiso: 'inicio.configurar_usuario',
        cuerpo: v.elegirInicioValidator,
        idempotente: true,
        descripcion: '422 inicio_sin_permiso si el usuario no tiene panel_financiero.ver.',
        respuesta: { status: 200, descripcion: 'Inicio del usuario', esquema: InicioUsuario },
        handler: async (ctx, { cuerpo, params }) => {
            const usuarioId = Number(params.id)
            await new ConfigurarInicioUsuario().execute(
                { usuario_id: usuarioId, inicio: cuerpo.inicio, version: cuerpo.version },
                ctx.contextoAccion(),
            )
            return inicioDeUsuario(usuarioId, new Set(await permisosDeUsuario(usuarioId)))
        },
    }),
]

const catalogo: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/catalogo',
        operacion: 'reportesCatalogo',
        resumen: 'Catálogo de reportes que puedo ver, con mis favoritos primero y mis vistas guardadas',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        respuesta: { status: 200, descripcion: 'Catálogo', esquema: lista(ReporteCatalogo) },
        handler: async (ctx) => catalogoDeUsuario(ctx.auth.getUserOrFail().id, await permisosPeticion(ctx)),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/reportes/favoritos/:reporte',
        operacion: 'reportesMarcarFavorito',
        resumen: 'Marcar un reporte como favorito',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        parametros: { reporte: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' } },
        idempotente: true,
        respuesta: {
            status: 200,
            descripcion: 'Favorito',
            esquema: {
                type: 'object',
                properties: { favorito: { type: 'boolean' } },
                required: ['favorito'],
            },
        },
        handler: (ctx, { params }) =>
            new MarcarFavoritoReporte().execute(
                { usuario_id: ctx.auth.getUserOrFail().id, reporte: String(params.reporte) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'delete',
        ruta: '/reportes/favoritos/:reporte',
        operacion: 'reportesQuitarFavorito',
        resumen: 'Quitar un reporte de favoritos',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        parametros: { reporte: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' } },
        idempotente: true,
        respuesta: {
            status: 200,
            descripcion: 'Favorito',
            esquema: {
                type: 'object',
                properties: { favorito: { type: 'boolean' } },
                required: ['favorito'],
            },
        },
        handler: (ctx, { params }) =>
            new QuitarFavoritoReporte().execute(
                { usuario_id: ctx.auth.getUserOrFail().id, reporte: String(params.reporte) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/vistas',
        operacion: 'reportesVistas',
        resumen: 'Mis vistas guardadas de reportes',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        respuesta: { status: 200, descripcion: 'Vistas', esquema: lista(VistaReporte) },
        handler: (ctx) => vistasDeUsuario(ctx.auth.getUserOrFail().id),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/reportes/vistas',
        operacion: 'reportesGuardarVista',
        resumen: 'Guardar una vista de un reporte (filtros y columnas con nombre)',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        cuerpo: v.guardarVistaValidator,
        idempotente: true,
        descripcion:
            'Los filtros se validan con los del reporte (422 en filtros.<campo>); formato y empresas no se guardan. 409 vista_repetida si ya tiene una con ese nombre en el reporte.',
        respuesta: { status: 201, descripcion: 'Vista', esquema: VistaReporte },
        handler: (ctx, { cuerpo }) =>
            new GuardarVistaReporte().execute(
                { ...cuerpo, usuario_id: ctx.auth.getUserOrFail().id },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/reportes/vistas/:id',
        operacion: 'reportesEditarVista',
        resumen: 'Editar una vista guardada propia',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        cuerpo: v.guardarVistaValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Vista', esquema: VistaReporte },
        handler: (ctx, { cuerpo, params }) =>
            new GuardarVistaReporte().execute(
                { ...cuerpo, id: Number(params.id), usuario_id: ctx.auth.getUserOrFail().id },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'delete',
        ruta: '/reportes/vistas/:id',
        operacion: 'reportesEliminarVista',
        resumen: 'Borrar una vista guardada propia',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        respuesta: {
            status: 200,
            descripcion: 'Borrada',
            esquema: {
                type: 'object',
                properties: { eliminada: { type: 'boolean' } },
                required: ['eliminada'],
            },
        },
        handler: (ctx, { params }) =>
            new EliminarVistaReporte().execute(
                { usuario_id: ctx.auth.getUserOrFail().id, id: Number(params.id) },
                ctx.contextoAccion(),
            ),
    }),
]

/** El envío es de una empresa de la petición; los consolidados solo con alcance global. */
async function exigirEnvio(ctx: HttpContext, id: number): Promise<void> {
    const empresaId = await empresaDeEnvio(id)
    if (empresaId === null) {
        if (!ctx.empresa?.alcanceGlobal) throw new Prohibido('El envío consolidado requiere alcance global')
    } else {
        exigirEmpresaPeticion(ctx.empresa, empresaId)
    }
}

const envios: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/correos-externos',
        operacion: 'reportesCorreosExternos',
        resumen: 'Correos externos aprobados por el admin para recibir reportes contables',
        etiqueta: 'reportes',
        permiso: 'reportes.programar_envio',
        query: v.listarEnviosValidator,
        respuesta: {
            status: 200,
            descripcion: 'Correos',
            esquema: { type: 'object', properties: { data: lista(CorreoExterno) }, required: ['data'] },
        },
        handler: (_ctx, { query }) => listarCorreosExternos(query.activo),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/reportes/correos-externos',
        operacion: 'reportesAprobarCorreoExterno',
        resumen: 'Aprobar un correo externo (contador, socio) para reportes contables programados',
        etiqueta: 'reportes',
        permiso: 'reportes.aprobar_correo_externo',
        cuerpo: v.aprobarCorreoValidator,
        idempotente: true,
        descripcion:
            'Solo admin. Si ya existía retirado, se reactiva; si está activo, solo cambia el nombre.',
        respuesta: { status: 201, descripcion: 'Correo', esquema: CorreoExterno },
        handler: (ctx, { cuerpo }) => new AprobarCorreoExterno().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/reportes/correos-externos/:id/retirar',
        operacion: 'reportesRetirarCorreoExterno',
        resumen: 'Retirar un correo externo de la lista aprobada',
        etiqueta: 'reportes',
        permiso: 'reportes.retirar_correo_externo',
        idempotente: true,
        descripcion:
            'Deja de recibir desde el siguiente envío (la corrida lo omite con correo_retirado). No se borra.',
        respuesta: { status: 200, descripcion: 'Correo', esquema: CorreoExterno },
        handler: (ctx, { params }) =>
            new RetirarCorreoExterno().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/envios',
        operacion: 'reportesEnvios',
        resumen: 'Envíos programados de reportes',
        etiqueta: 'reportes',
        permiso: 'reportes.programar_envio',
        query: v.listarEnviosValidator,
        descripcion: 'De las empresas de la petición; los consolidados solo con alcance global.',
        respuesta: {
            status: 200,
            descripcion: 'Envíos',
            esquema: { type: 'object', properties: { data: lista(EnvioReporte) }, required: ['data'] },
        },
        handler: (ctx, { query }) =>
            listarEnvios(query, empresasDeLaLista(ctx.empresa), Boolean(ctx.empresa?.alcanceGlobal)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/reportes/envios',
        operacion: 'reportesProgramarEnvio',
        resumen: 'Programar el envío de un reporte por correo',
        etiqueta: 'reportes',
        permiso: 'reportes.programar_envio',
        cuerpo: v.crearEnvioValidator,
        idempotente: true,
        descripcion:
            'De la empresa activa, o de todas con consolidado=true (alcance global). Destinatarios: usuarios activos o correos de la lista aprobada; a un correo externo solo va un reporte compartible sin datos personales de clientes con esos filtros (422 no_compartible). Quien programa debe poder ver el reporte (403). En cada envío se vuelve a revisar el permiso, el alcance y la empresa de cada destinatario.',
        respuesta: { status: 201, descripcion: 'Envío', esquema: EnvioReporte },
        handler: (ctx, { cuerpo }) => new ProgramarEnvioReporte().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/envios/:id',
        operacion: 'reportesVerEnvio',
        resumen: 'Ver un envío programado',
        etiqueta: 'reportes',
        permiso: 'reportes.programar_envio',
        respuesta: { status: 200, descripcion: 'Envío', esquema: EnvioReporte },
        handler: async (ctx, { params }) => {
            await exigirEnvio(ctx, Number(params.id))
            return verEnvio(Number(params.id))
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/reportes/envios/:id',
        operacion: 'reportesEditarEnvio',
        resumen: 'Editar, pausar o reanudar un envío programado',
        etiqueta: 'reportes',
        permiso: 'reportes.editar_envio',
        cuerpo: v.editarEnvioValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Envío', esquema: EnvioReporte },
        handler: async (ctx, { cuerpo, params }) => {
            await exigirEnvio(ctx, Number(params.id))
            return new EditarEnvioReporte().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/envios/:id/corridas',
        operacion: 'reportesCorridasEnvio',
        resumen: 'Últimas corridas de un envío programado: quién lo recibió y por qué se omitió a los demás',
        etiqueta: 'reportes',
        permiso: 'reportes.programar_envio',
        query: v.corridasValidator,
        respuesta: {
            status: 200,
            descripcion: 'Corridas',
            esquema: { type: 'object', properties: { data: lista(CorridaEnvio) }, required: ['data'] },
        },
        handler: async (ctx, { params, query }) => {
            await exigirEnvio(ctx, Number(params.id))
            return corridasDeEnvio(Number(params.id), query.limit ?? 20)
        },
    }),
]

export default [...panel, ...inicio, ...catalogo, ...envios]
