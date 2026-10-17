/*
|--------------------------------------------------------------------------
| Rutas de notificaciones (A6): plantillas y registro de envíos
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import {
    ConfiguracionNotificaciones,
    EnvioNotificacion,
    PlantillaNotificacion,
    RecordatorioPago,
    ResultadoPruebaCanal,
    TelegramWebhookRespuesta,
} from '#notify/esquemas'
import { listarEnvios, listarPlantillas, listarRecordatorios } from '#notify/consultas'
import EditarPlantillaNotificacion from '#notify/actions/editar_plantilla_notificacion'
import EditarRecordatorio from '#notify/actions/editar_recordatorio'
import * as v from '#notify/validators'
import { NoAutenticado } from '#shared/errores'
import { configBotGlobal, secretoCoincide } from '#notify/telegram/config'
import { procesarActualizacion } from '#notify/telegram/bot'
import { configuracionesDelBot, construirCanal } from '#notify/configuracion'
import {
    listarConfiguracionesEmpresas,
    verConfiguracionEmpresa,
    verConfiguracionGlobal,
} from '#notify/configuracion_panel'
import ConfigurarNotificaciones from '#notify/actions/configurar_notificaciones'
import ProbarCanalNotificacion from '#notify/actions/probar_canal_notificacion'

const DESCRIPCION_CONFIGURACION =
    'Global (`empresa_id` null) o de una empresa (`hereda` = usa la global). Los secretos ' +
    '(contraseña SMTP, token del bot, secreto del webhook) salen siempre como `***` y en la ' +
    'auditoría también; solo se reemplazan (texto) o se borran (null). Contrato en ' +
    '`.claude/integration/a6.md` (pantallas de A4).'

const notify: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/notificaciones/plantillas',
        operacion: 'notificacionesPlantillasListar',
        resumen: 'Listar plantillas de notificación (por evento y canal)',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.ver',
        respuesta: { status: 200, descripcion: 'Plantillas', esquema: lista(PlantillaNotificacion) },
        handler: () => listarPlantillas(),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/notificaciones/plantillas/:id',
        operacion: 'notificacionesPlantillasEditar',
        resumen: 'Editar asunto, cuerpo o activación de una plantilla de notificación',
        descripcion: 'Valida la sintaxis Mustache (422). Variables en apps/api/app/notify/README.md.',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.editar',
        cuerpo: v.editarPlantillaNotificacionValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Plantilla actualizada', esquema: PlantillaNotificacion },
        handler: (ctx, { cuerpo, params }) =>
            new EditarPlantillaNotificacion().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/notificaciones/envios',
        operacion: 'notificacionesEnviosListar',
        resumen: 'Registro de envíos (por cliente, evento, canal o estado)',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.ver',
        query: v.listarEnviosValidator,
        respuesta: { status: 200, descripcion: 'Página de envíos', esquema: pagina(EnvioNotificacion) },
        handler: (_ctx, { query }) => listarEnvios(query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/notificaciones/recordatorios',
        operacion: 'notificacionesRecordatoriosListar',
        resumen: 'Recordatorios de pago configurados (hasta tres)',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.ver',
        respuesta: { status: 200, descripcion: 'Recordatorios', esquema: lista(RecordatorioPago) },
        handler: () => listarRecordatorios(),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/notificaciones/recordatorios/:id',
        operacion: 'notificacionesRecordatoriosEditar',
        resumen: 'Configurar un recordatorio de pago: días respecto al vencimiento, hora y activo',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.editar',
        cuerpo: v.editarRecordatorioValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Recordatorio actualizado', esquema: RecordatorioPago },
        handler: (ctx, { cuerpo, params }) =>
            new EditarRecordatorio().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/notificaciones/configuracion',
        operacion: 'notificacionesConfiguracionVer',
        resumen: 'Configuración global de los canales de notificación (correo y Telegram)',
        descripcion:
            DESCRIPCION_CONFIGURACION +
            ' Sin configuración guardada (`origen: entorno`) muestra lo que rige: las variables de entorno.',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.ver',
        respuesta: { status: 200, descripcion: 'Configuración global', esquema: ConfiguracionNotificaciones },
        handler: () => verConfiguracionGlobal(),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/notificaciones/configuracion',
        operacion: 'notificacionesConfiguracionGuardar',
        resumen: 'Guardar la configuración global de los canales (servidor, credenciales, interruptores)',
        descripcion:
            DESCRIPCION_CONFIGURACION +
            ' `version: 0` la crea si no existe. Emite `notificaciones.config_cambiada`: el worker la ' +
            'recarga sin reiniciarse.',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.configurar',
        cuerpo: v.configurarNotificacionesGlobalValidator,
        versionada: true,
        respuesta: {
            status: 200,
            descripcion: 'Configuración guardada',
            esquema: ConfiguracionNotificaciones,
        },
        handler: (ctx, { cuerpo }) =>
            new ConfigurarNotificaciones().execute({ ...cuerpo, empresa_id: null }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/notificaciones/configuracion/probar',
        operacion: 'notificacionesConfiguracionProbar',
        resumen: 'Enviar una prueba por correo o Telegram con la configuración global guardada',
        descripcion:
            'No mira los interruptores. Responde 200 aunque falle: `estado: fallido` y `error` con el ' +
            'mensaje real del servidor SMTP o de la Bot API. Queda en `notify.envios`.',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.probar',
        cuerpo: v.probarCanalValidator,
        respuesta: { status: 200, descripcion: 'Resultado de la prueba', esquema: ResultadoPruebaCanal },
        handler: (ctx, { cuerpo }) =>
            new ProbarCanalNotificacion().execute({ ...cuerpo, empresa_id: null }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/notificaciones/configuracion/empresas',
        operacion: 'notificacionesConfiguracionEmpresasListar',
        resumen: 'Empresas con configuración de canales guardada (propia o marcada para heredar)',
        descripcion: DESCRIPCION_CONFIGURACION,
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.ver',
        respuesta: {
            status: 200,
            descripcion: 'Configuraciones por empresa',
            esquema: lista(ConfiguracionNotificaciones),
        },
        handler: () => listarConfiguracionesEmpresas(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/notificaciones/configuracion/empresas/:empresaId',
        operacion: 'notificacionesConfiguracionEmpresaVer',
        resumen: 'Configuración de canales de una empresa (o `hereda` si no tiene la suya)',
        descripcion: DESCRIPCION_CONFIGURACION,
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.ver',
        respuesta: {
            status: 200,
            descripcion: 'Configuración de la empresa',
            esquema: ConfiguracionNotificaciones,
        },
        handler: (_ctx, { params }) => verConfiguracionEmpresa(Number(params.empresaId)),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/notificaciones/configuracion/empresas/:empresaId',
        operacion: 'notificacionesConfiguracionEmpresaGuardar',
        resumen: 'Guardar la configuración de canales de una empresa (o volver a heredar la global)',
        descripcion: DESCRIPCION_CONFIGURACION + ' `version: 0` la crea si no existe.',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.configurar',
        cuerpo: v.configurarNotificacionesEmpresaValidator,
        versionada: true,
        respuesta: {
            status: 200,
            descripcion: 'Configuración guardada',
            esquema: ConfiguracionNotificaciones,
        },
        handler: (ctx, { cuerpo, params }) =>
            new ConfigurarNotificaciones().execute(
                { ...cuerpo, empresa_id: Number(params.empresaId) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/notificaciones/configuracion/empresas/:empresaId/probar',
        operacion: 'notificacionesConfiguracionEmpresaProbar',
        resumen: 'Enviar una prueba con la configuración de la empresa (o la global si hereda)',
        descripcion: 'Igual que `POST /notificaciones/configuracion/probar`.',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.probar',
        cuerpo: v.probarCanalValidator,
        respuesta: { status: 200, descripcion: 'Resultado de la prueba', esquema: ResultadoPruebaCanal },
        handler: (ctx, { cuerpo, params }) =>
            new ProbarCanalNotificacion().execute(
                { ...cuerpo, empresa_id: Number(params.empresaId) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/telegram/webhook/:bot',
        operacion: 'telegramWebhookBot',
        resumen: 'Webhook de un bot de Telegram por su id (lo llama Telegram, no el panel)',
        descripcion:
            'Una URL por bot: `:bot` es el id público del bot (parte numérica del token, ' +
            '`telegram.bot_id` de la configuración). Autenticado con ' +
            '`X-Telegram-Bot-Api-Secret-Token` = el secreto del webhook de ese bot (401 si falta, no ' +
            'coincide o el bot no está configurado). Responde por el mismo bot. Mismos comandos que ' +
            '`POST /telegram/webhook`.',
        etiqueta: 'notificaciones',
        seguridad: 'publico',
        permiso: null,
        parametros: { bot: { type: 'string', pattern: '^\\d{1,20}$', description: 'Id del bot' } },
        cuerpo: v.telegramActualizacionValidator,
        respuesta: { status: 200, descripcion: 'Actualización procesada', esquema: TelegramWebhookRespuesta },
        handler: async (ctx, { cuerpo, params }) => {
            const secreto = ctx.request.header('x-telegram-bot-api-secret-token')
            const candidatas = await configuracionesDelBot(String(params.bot))
            const config = candidatas.find((c) => secretoCoincide(secreto, c.telegram.webhookSecreto))
            if (!config) throw new NoAutenticado('Secreto del webhook de Telegram inválido')
            await procesarActualizacion(cuerpo, ctx.contextoAccion('webhook'), {
                canal: construirCanal(config, 'telegram'),
                botId: String(params.bot),
            })
            return { ok: true }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/telegram/webhook',
        operacion: 'telegramWebhook',
        resumen: 'Webhook del bot de Telegram (lo llama Telegram, no el panel)',
        descripcion:
            'Bot de la configuración global (ruta anterior a `/telegram/webhook/:bot`). Autenticado ' +
            'con el header `X-Telegram-Bot-Api-Secret-Token` = el secreto del webhook global ' +
            '(401 si falta o no coincide; sin secreto configurado rechaza todo). Comandos: ' +
            '`/start <código>` vincula el chat (código de `GenerarCodigoTelegram`), `/estado`, ' +
            '`/desvincular`, `/ayuda`. Responde por la Bot API; contrato en ' +
            '`.claude/integration/contratos/telegram.md`.',
        etiqueta: 'notificaciones',
        seguridad: 'publico',
        permiso: null,
        cuerpo: v.telegramActualizacionValidator,
        respuesta: { status: 200, descripcion: 'Actualización procesada', esquema: TelegramWebhookRespuesta },
        handler: async (ctx, { cuerpo }) => {
            const secreto = ctx.request.header('x-telegram-bot-api-secret-token')
            const bot = await configBotGlobal()
            if (!secretoCoincide(secreto, bot.secreto)) {
                throw new NoAutenticado('Secreto del webhook de Telegram inválido')
            }
            await procesarActualizacion(cuerpo, ctx.contextoAccion('webhook'))
            return { ok: true }
        },
    }),
]

export default notify
