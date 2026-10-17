/*
|--------------------------------------------------------------------------
| Rutas de integraciones (A6): conector Horus Flow (`contratos/horus.md`)
|--------------------------------------------------------------------------
*/
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { definirRuta, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { SolicitudInvalida, ValidacionFallida } from '#shared/errores'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirCliente, exigirServicio } from '#core/acceso_empresa'
import {
    CanjeConexionHorus,
    ConectorHorus,
    ConectorHorusGuardado,
    ConsumoHorus,
    EnlaceConexionHorus,
    EnvioHorus,
    Horus360Servicio,
    ResultadoPruebaHorus,
    ResultadoWebhookHorus,
    SeguridadHorus,
    TicketHorus,
    WebhookHorusRecibido,
} from '#integraciones/horus/esquemas'
import * as v from '#integraciones/horus/validators'
import { verConector, urlPublicaApi } from '#integraciones/horus/panel'
import {
    ZONA,
    consumoServicios,
    periodoDeMes,
    seguridadServicios,
    servicio360,
    type Granularidad,
} from '#integraciones/horus/consultas'
import { listarEnviosHorus, listarRecibidosHorus } from '#integraciones/horus/listados'
import { autenticarWebhook } from '#integraciones/horus/receptor'
import ConfigurarHorus from '#integraciones/horus/actions/configurar_horus'
import ProbarHorus from '#integraciones/horus/actions/probar_horus'
import RecibirWebhookHorus from '#integraciones/horus/actions/recibir_webhook_horus'
import GenerarEnlaceHorus, { hashCodigo } from '#integraciones/horus/actions/generar_enlace_horus'
import CanjearEnlaceHorus from '#integraciones/horus/actions/canjear_enlace_horus'
import ConectarConEnlaceHorus, { partirEnlace } from '#integraciones/horus/actions/conectar_con_enlace_horus'
import AbrirEnHorus from '#integraciones/horus/actions/abrir_en_horus'

const DESCRIPCION_CONECTOR =
    'Una configuración por instalación, apagada por defecto. Los secretos (`hf_pat_`, secretos de ' +
    'los receptores) salen siempre como `***` y en la auditoría también. Contrato: ' +
    '`.claude/integration/contratos/horus.md`; pantallas en `.claude/integration/a6.md`.'

const DESCRIPCION_LECTURA =
    'Nunca bloquea: si Horus no responde (o está en pausa por la espera exponencial, máx. 15 min) ' +
    'devuelve el último dato conocido con `stale: true`, `actualizado_en` y `error`. Con el ' +
    'conector apagado responde `conector: apagado` sin llamar a Horus.'

/** URL pública de Argos: `API_PUBLIC_URL`/`NOTIFY_API_URL` o, si no hay, la de la petición. */
function baseArgos(ctx: HttpContext): string {
    return urlPublicaApi() ?? `${ctx.request.protocol()}://${ctx.request.host()}`
}

function periodo(query: { mes?: string; granularidad?: Granularidad }) {
    const mes = query.mes ?? DateTime.now().setZone(ZONA).toFormat('yyyy-MM')
    return { ...periodoDeMes(mes), granularidad: query.granularidad ?? 'total' }
}

async function exigirServicios(ctx: HttpContext, ids: number[]) {
    for (const id of new Set(ids)) await exigirServicio(ctx, id)
}

const integraciones: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/horus',
        operacion: 'horusConectorVer',
        resumen: 'Conector con Horus Flow: configuración (secretos como ***) y salud de la conexión',
        descripcion: DESCRIPCION_CONECTOR,
        etiqueta: 'integraciones',
        permiso: 'horus.ver',
        respuesta: { status: 200, descripcion: 'Conector', esquema: ConectorHorus },
        handler: () => verConector(),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/integraciones/horus',
        operacion: 'horusConectorGuardar',
        resumen: 'Guardar el conector con Horus: URL, código hf_pat_, receptor de Horus e interruptor',
        descripcion:
            DESCRIPCION_CONECTOR +
            ' `version: 0` lo crea. El primer guardado (o `regenerar_secreto_entrada`) genera el ' +
            'secreto del receptor de Argos y lo devuelve **una sola vez** en `webhook_entrada_secreto_nuevo`. ' +
            'Emite `horus.config_cambiada`.',
        etiqueta: 'integraciones',
        permiso: 'horus.configurar',
        cuerpo: v.configurarHorusValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Conector guardado', esquema: ConectorHorusGuardado },
        handler: (ctx, { cuerpo }) => new ConfigurarHorus().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/probar',
        operacion: 'horusConectorProbar',
        resumen: 'Probar la conexión con Horus (lectura autenticada y ping firmado al receptor)',
        descripcion:
            'Con la configuración guardada, encendida o no. Responde 200 aunque falle: `ok: false` y el ' +
            'error real (`ECONNREFUSED`, `Horus respondió 401: …`).',
        etiqueta: 'integraciones',
        permiso: 'horus.probar',
        respuesta: { status: 200, descripcion: 'Resultado de la prueba', esquema: ResultadoPruebaHorus },
        handler: (ctx) => new ProbarHorus().execute({}, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/enlace',
        operacion: 'horusEnlaceGenerar',
        resumen: 'Generar enlace de conexión para pegar en Horus (15 min, un solo uso)',
        descripcion:
            '§1.4. El enlace `https://<argos>/conectar#<codigo>` se muestra una sola vez; Argos guarda ' +
            'solo el SHA-256 del código. Horus lo canjea en `POST /integraciones/horus/conexion/canjear`.',
        etiqueta: 'integraciones',
        permiso: 'horus.configurar',
        respuesta: { status: 201, descripcion: 'Enlace', esquema: EnlaceConexionHorus },
        handler: (ctx) =>
            new GenerarEnlaceHorus().execute({ base_url: baseArgos(ctx) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/conexion/canjear',
        operacion: 'horusEnlaceCanjear',
        resumen: 'Canje del enlace de conexión de Argos (lo llama Horus, servidor a servidor)',
        descripcion:
            '§1.4. Sin sesión: lo autentica el código del enlace. Guarda cifrados el `hf_pat_`, la URL ' +
            'de Horus y su receptor; emite el token `atk_` del usuario técnico Horus y genera el ' +
            'secreto del receptor de Argos. El conector queda apagado. 410 si el código venció, se ' +
            'usó o no existe.',
        etiqueta: 'integraciones',
        seguridad: 'publico',
        permiso: null,
        cuerpo: v.canjearEnlaceValidator,
        respuesta: {
            status: 200,
            descripcion: 'Credenciales de Argos para Horus',
            esquema: CanjeConexionHorus,
        },
        handler: (ctx, { cuerpo }) =>
            new CanjearEnlaceHorus().execute(
                {
                    codigo_sha256: hashCodigo(cuerpo.codigo),
                    sistema: cuerpo.sistema,
                    base_url: cuerpo.base_url,
                    token: cuerpo.token,
                    webhook: cuerpo.webhook,
                },
                ctx.contextoAccion('webhook'),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/conexion/conectar',
        operacion: 'horusEnlaceConectar',
        resumen: 'Conectar con un enlace de conexión generado en Horus',
        descripcion:
            '§1.4 (Argos canjea el enlace de Horus). Emite el token `atk_` y el secreto del receptor de ' +
            'Argos, llama a `POST <horus>/api/v1/integrations/argosisp/conexion/canjear` y guarda lo ' +
            'que devuelve. El conector queda apagado. 422 `enlace_vencido` si Horus responde 410; 502 ' +
            '`horus_error` con el error real si Horus falla (no queda nada guardado).',
        etiqueta: 'integraciones',
        permiso: 'horus.configurar',
        cuerpo: v.conectarConEnlaceValidator,
        respuesta: { status: 200, descripcion: 'Conector', esquema: ConectorHorus },
        handler: (ctx, { cuerpo }) => {
            const partes = partirEnlace(cuerpo.enlace)
            if (!partes) {
                throw new ValidacionFallida([
                    {
                        field: 'enlace',
                        message: 'Se espera https://<horus>/conectar#<código>',
                        rule: 'formato',
                    },
                ])
            }
            return new ConectarConEnlaceHorus().execute(
                { url_horus: partes.url_horus, codigo_secreto: partes.codigo, base_url: baseArgos(ctx) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/abrir',
        operacion: 'horusAbrir',
        resumen: 'Ver en Horus: URL de autologin con ticket de un solo uso',
        descripcion:
            '§1.5. El servidor de Argos pide el ticket a Horus con el `hf_pat_` y devuelve solo la URL ' +
            '(el navegador nunca pide el ticket). 422 `horus_apagado` con el conector apagado; 502 ' +
            '`horus_error` si Horus falla. Para `servicio` y `cliente` se revisa el acceso del usuario.',
        etiqueta: 'integraciones',
        permiso: 'horus.abrir',
        cuerpo: v.abrirEnHorusValidator,
        respuesta: { status: 200, descripcion: 'URL de Horus', esquema: TicketHorus },
        handler: async (ctx, { cuerpo }) => {
            const { tipo, id_externo: idExterno } = cuerpo.destino
            if (tipo === 'servicio' || tipo === 'cliente') {
                const idNumero = Number(idExterno)
                if (!Number.isInteger(idNumero) || idNumero <= 0) {
                    throw new SolicitudInvalida(`id_externo de ${tipo} debe ser un id de Argos`)
                }
                if (tipo === 'servicio') await exigirServicio(ctx, idNumero)
                else await exigirCliente(ctx, idNumero)
            }
            return new AbrirEnHorus().execute({ destino: cuerpo.destino }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/webhook',
        operacion: 'horusWebhook',
        resumen: 'Receptor de webhooks de Horus (firmados con HMAC, lo llama Horus)',
        descripcion:
            '§1.3 y §3.4. Sin sesión: `X-Webhook-Signature: v1=<hex(HMAC-SHA256(secreto, timestamp.cuerpo))>` ' +
            'con el secreto que generó Argos (401 `firma_invalida`), `X-Webhook-Timestamp` a menos de 5 ' +
            'min (401 `timestamp_fuera_de_ventana`), 503 `horus_apagado` con el conector apagado. ' +
            'Cuerpo `{ id, event, occurred_at, tenant, data }`. Deduplica por `id`; responde 202 y lo ' +
            'demás pasa por el bus (`horus.*`). `ping` y `test` solo se registran; eventos y campos ' +
            'desconocidos se ignoran.',
        etiqueta: 'integraciones',
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 202, descripcion: 'Webhook recibido', esquema: ResultadoWebhookHorus },
        handler: async (ctx) => {
            const entrada = await autenticarWebhook(ctx.request.raw() ?? '', {
                id: ctx.request.header('x-webhook-id'),
                timestamp: ctx.request.header('x-webhook-timestamp'),
                firma: ctx.request.header('x-webhook-signature'),
            })
            const resultado = await new RecibirWebhookHorus().execute(entrada, ctx.contextoAccion('webhook'))
            return { recibido: true, ...resultado }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/horus/envios',
        operacion: 'horusEnviosListar',
        resumen: 'Webhooks enviados a Horus: estado, intentos y próximo reintento',
        descripcion: 'Reintentos a 1 min, 5 min, 30 min, 2 h y 12 h; después `fallido`.',
        etiqueta: 'integraciones',
        permiso: 'horus.ver',
        query: v.listarEnviosHorusValidator,
        respuesta: { status: 200, descripcion: 'Página de envíos', esquema: pagina(EnvioHorus) },
        handler: (ctx, { query }) => listarEnviosHorus(query, empresasDeLaLista(ctx.empresa)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/horus/recibidos',
        operacion: 'horusRecibidosListar',
        resumen: 'Webhooks recibidos de Horus',
        etiqueta: 'integraciones',
        permiso: 'horus.ver',
        query: v.listarRecibidosHorusValidator,
        respuesta: { status: 200, descripcion: 'Página de webhooks', esquema: pagina(WebhookHorusRecibido) },
        handler: (ctx, { query }) => listarRecibidosHorus(query, empresasDeLaLista(ctx.empresa)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/horus',
        operacion: 'horusServicio360',
        resumen: 'Consumo, salud y seguridad del servicio según Horus (consulta 360)',
        descripcion:
            DESCRIPCION_LECTURA +
            ' Pregunta por `external_service_id` (1.2.0); si Horus no lo acepta o no conoce el ' +
            'servicio, por la IP actual (`consulta: address`). Incluye los últimos webhooks de Horus ' +
            'del servicio (`eventos_recientes`).',
        etiqueta: 'integraciones',
        permiso: 'horus.ver',
        respuesta: { status: 200, descripcion: 'Consulta 360', esquema: Horus360Servicio },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return servicio360(id)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/horus/consumo',
        operacion: 'horusServicioConsumo',
        resumen: 'Consumo mensual del servicio según Horus (por día o total)',
        descripcion: DESCRIPCION_LECTURA,
        etiqueta: 'integraciones',
        permiso: 'horus.ver',
        query: v.consumoServicioValidator,
        respuesta: { status: 200, descripcion: 'Consumo', esquema: ConsumoHorus },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return consumoServicios([id], periodo(query))
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/consumo',
        operacion: 'horusConsumoLotes',
        resumen: 'Consumo mensual de varios servicios (hasta 500) según Horus',
        descripcion: DESCRIPCION_LECTURA + ' Es una lectura (POST por el tamaño de la lista).',
        etiqueta: 'integraciones',
        permiso: 'horus.ver',
        cuerpo: v.consumoLotesValidator,
        respuesta: { status: 200, descripcion: 'Consumo', esquema: ConsumoHorus },
        handler: async (ctx, { cuerpo }) => {
            await exigirServicios(ctx, cuerpo.servicio_ids)
            return consumoServicios(cuerpo.servicio_ids, periodo(cuerpo))
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/horus/seguridad',
        operacion: 'horusSeguridadLotes',
        resumen: 'Estado de seguridad de varios servicios (hasta 500) para la columna "Seguridad"',
        descripcion:
            DESCRIPCION_LECTURA +
            ' Usa §3.5 de Horus; mientras Horus no lo tenga (H9) responde `modo: alternativa` con el ' +
            'último dato de la consulta 360 o de los webhooks, sin una llamada por servicio.',
        etiqueta: 'integraciones',
        permiso: 'horus.ver',
        cuerpo: v.seguridadLotesValidator,
        respuesta: { status: 200, descripcion: 'Seguridad', esquema: SeguridadHorus },
        handler: async (ctx, { cuerpo }) => {
            await exigirServicios(ctx, cuerpo.servicio_ids)
            return seguridadServicios(cuerpo.servicio_ids)
        },
    }),
]

export default integraciones
