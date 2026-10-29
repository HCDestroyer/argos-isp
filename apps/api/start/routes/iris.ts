/*
|--------------------------------------------------------------------------
| Conector Iris (A1): contrato `.claude/integration/contratos/iris.md` §1
|--------------------------------------------------------------------------
|
| Réplica del conector Horus: configuración, usuario técnico y sus tokens, enlace de conexión,
| autologin en los dos sentidos y resolver de IPs. Solo validan y llaman acciones.
|
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista } from '#shared/openapi/esquemas'
import { Prohibido } from '#shared/errores'
import { urlPublicaApi } from '#integraciones/horus/panel'
import { hashCodigo } from '#integraciones/horus/actions/generar_enlace_horus'
import { canjearEnlaceValidator } from '#integraciones/horus/validators'
import { ResolucionIpsHorus, TicketSsoEmitido, TokenApi } from '#core/esquemas'
import * as v from '#core/validators'
import ResolverIps from '#core/actions/resolver_ips'
import EmitirTicketSso from '#core/actions/emitir_ticket_sso'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import RevocarTokenIris from '#core/actions/revocar_token_iris'
import { listarTokensIris } from '#core/integraciones_iris'
import { definirEsquema, id, objeto } from '#shared/openapi/esquemas'
import ConfigurarIris from '#integraciones/iris/actions/configurar_iris'
import GenerarEnlaceIris from '#integraciones/iris/actions/generar_enlace_iris'
import CanjearEnlaceIris from '#integraciones/iris/actions/canjear_enlace_iris'
import AbrirEnIris from '#integraciones/iris/actions/abrir_en_iris'
import { estadoConectorIris, verConectorIris } from '#integraciones/iris/configuracion'
import * as vi from '#integraciones/iris/validators'
import {
    CanjeConexionIris,
    ConectorIris,
    EnlaceConexionIris,
    EstadoConectorIris,
    TicketIris,
} from '#integraciones/iris/esquemas'

const TokenIrisCreado = definirEsquema(
    'TokenIrisCreado',
    objeto({
        token: { type: 'string', description: 'Valor `atk_…`; se muestra una sola vez' },
        datos: TokenApi,
        usuario_id: { ...id, description: 'Usuario técnico Iris' },
    }),
)

/** URL pública de la API de Argos (donde Iris canjea el enlace). */
function baseArgos(ctx: HttpContext): string {
    return urlPublicaApi() ?? `${ctx.request.protocol()}://${ctx.request.host()}`
}

const iris: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/iris',
        operacion: 'irisVer',
        resumen: 'Conector Iris (secretos como ***)',
        etiqueta: 'integraciones',
        permiso: 'iris.ver',
        respuesta: { status: 200, descripcion: 'Conector', esquema: ConectorIris },
        handler: () => verConectorIris(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/iris/estado',
        operacion: 'irisEstado',
        resumen: 'Si "Ver en Iris" puede funcionar (sin URL ni secretos)',
        etiqueta: 'integraciones',
        permiso: 'iris.abrir',
        respuesta: { status: 200, descripcion: 'Estado', esquema: EstadoConectorIris },
        handler: () => estadoConectorIris(),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/integraciones/iris',
        operacion: 'irisConfigurar',
        resumen: 'Configurar el conector Iris a mano (URL, token iris_pat_, receptor, encendido)',
        descripcion:
            'Alternativa al enlace de conexión. El token y los secretos son de solo escritura (`***`). ' +
            'Encender exige URL y token (422). Solo https:// salvo `IRIS_PERMITIR_HTTP` (laboratorio).',
        etiqueta: 'integraciones',
        permiso: 'iris.configurar',
        cuerpo: vi.configurarIrisValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Conector', esquema: ConectorIris },
        handler: (ctx, { cuerpo }) => new ConfigurarIris().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/iris/enlace',
        operacion: 'irisEnlaceGenerar',
        resumen: 'Generar enlace de conexión para pegar en Iris (15 min, un solo uso)',
        descripcion:
            'Contrato Iris §1.3. `https://<argos>/conectar#<codigo>` se muestra una sola vez; Argos guarda ' +
            'solo el SHA-256. Iris lo canjea en `POST /integraciones/iris/conexion/canjear`. Un enlace nuevo ' +
            'anula los anteriores sin usar.',
        etiqueta: 'integraciones',
        permiso: 'iris.configurar',
        respuesta: { status: 201, descripcion: 'Enlace', esquema: EnlaceConexionIris },
        handler: (ctx) => new GenerarEnlaceIris().execute({ base_url: baseArgos(ctx) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/iris/conexion/canjear',
        operacion: 'irisEnlaceCanjear',
        resumen: 'Canje del enlace de conexión de Argos (lo llama Iris, servidor a servidor)',
        descripcion:
            'Sin sesión: lo autentica el código. `sistema: "iris"`, `base_url` (origen de la API de Iris), ' +
            '`token` (`iris_pat_`) y `webhook` (receptor de Iris para §2.3 con su secreto). Devuelve el ' +
            '`atk_` del usuario técnico Iris (permisos de §1.1; revoca el del canje anterior), el receptor ' +
            'de Argos con su secreto (reservado) y `conector_id`. El conector queda apagado. 410 ' +
            '`enlace_vencido` si el código venció, se usó, se anuló o no existe; la misma petición repetida ' +
            'antes de vencer recibe la misma respuesta.',
        etiqueta: 'integraciones',
        seguridad: 'publico',
        permiso: null,
        cuerpo: canjearEnlaceValidator,
        respuesta: {
            status: 200,
            descripcion: 'Credenciales de Argos para Iris',
            esquema: CanjeConexionIris,
        },
        handler: (ctx, { cuerpo }) =>
            new CanjearEnlaceIris().execute(
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
        ruta: '/integraciones/iris/abrir',
        operacion: 'irisAbrir',
        resumen: 'Ver en Iris: URL de autologin con ticket de un solo uso',
        descripcion:
            'Contrato Iris §1.3. El servidor de Argos pide el ticket a Iris con el `iris_pat_` y devuelve ' +
            'solo la URL. Destinos `ticket`, `orden` y `prospecto` (ids de Iris). 422 `iris_apagado` con el ' +
            'conector apagado o sin configurar; 502 `iris_error` con el error real si Iris falla.',
        etiqueta: 'integraciones',
        permiso: 'iris.abrir',
        cuerpo: vi.abrirEnIrisValidator,
        respuesta: { status: 200, descripcion: 'URL de Iris', esquema: TicketIris },
        handler: (ctx, { cuerpo }) =>
            new AbrirEnIris().execute({ destino: cuerpo.destino }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/iris/sso/tickets',
        operacion: 'irisSsoTicket',
        resumen: 'Pedir un ticket de autologin para un usuario de Iris (servidor a servidor)',
        descripcion:
            'Igual que el de Horus: solo con el token `atk_` del usuario técnico Iris (403 con cualquier ' +
            'otra credencial; si el conector se preparó con un enlace, solo el `atk_` de ese canje, y 409 ' +
            '`iris_apagado` mientras esté apagado). Destino `cliente` o `servicio` con el id de Argos. ' +
            'Devuelve la URL del panel con el ticket en el fragmento (60 s, un solo uso).',
        etiqueta: 'integraciones',
        permiso: 'sso.emitir',
        cuerpo: v.emitirTicketSsoValidator,
        respuesta: { status: 201, descripcion: 'Ticket emitido', esquema: TicketSsoEmitido },
        handler: (ctx, { cuerpo }) => {
            const tokenId =
                ctx.auth.authenticatedViaGuard === 'tokens' ? ctx.auth.use('tokens').token?.id : undefined
            if (!tokenId) {
                throw new Prohibido('Solo el token de la integración Iris puede pedir tickets de autologin')
            }
            return new EmitirTicketSso().execute(
                { ...cuerpo, conector: 'iris', atk_id: tokenId },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/iris/resolver',
        operacion: 'irisResolver',
        resumen: 'Resolver un lote de IPs a servicio, cliente y empresa (Iris)',
        descripcion:
            'Pedido A8 de Iris: igual que `POST /integraciones/horus/resolver` (1 a 500 IPv4 o IPv6 en el ' +
            'cuerpo, nunca en la URL; prefijo más largo; fuera del alcance del token → `no_encontrada`). ' +
            'Cada llamada queda en la bitácora (`ip.resolver`).',
        etiqueta: 'integraciones',
        permiso: 'ip.resolver',
        cuerpo: v.resolverIpsValidator,
        respuesta: { status: 200, descripcion: 'Un resultado por IP, en orden', esquema: ResolucionIpsHorus },
        handler: (ctx, { cuerpo }) => new ResolverIps(ctx.alcance).execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/iris/tokens',
        operacion: 'irisTokens',
        resumen: 'Tokens del usuario técnico Iris (sin su valor)',
        etiqueta: 'integraciones',
        permiso: 'iris.ver',
        respuesta: { status: 200, descripcion: 'Tokens, los más nuevos primero', esquema: lista(TokenApi) },
        handler: () => listarTokensIris(),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/iris/tokens',
        operacion: 'irisGenerarToken',
        resumen: 'Generar un token atk_ del usuario técnico Iris (se muestra una sola vez)',
        descripcion:
            'Crea, la primera vez, el usuario técnico "Iris" y su rol `integracion_iris` con los permisos del ' +
            'contrato Iris §1.1 que existen en Argos. Opcionalmente restringido a routers o zonas. No revoca ' +
            'los anteriores.',
        etiqueta: 'integraciones',
        permiso: 'iris.generar_token',
        cuerpo: v.generarTokenHorusValidator,
        respuesta: { status: 201, descripcion: 'Token generado', esquema: TokenIrisCreado },
        handler: (ctx, { cuerpo }) => new GenerarTokenIris().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/iris/tokens/:id/revocar',
        operacion: 'irisRevocarToken',
        resumen: 'Revocar un token del usuario técnico Iris',
        etiqueta: 'integraciones',
        permiso: 'iris.revocar_token',
        respuesta: { status: 200, descripcion: 'Token revocado', esquema: TokenApi },
        handler: (ctx, { params }) =>
            new RevocarTokenIris().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
]

export default iris
