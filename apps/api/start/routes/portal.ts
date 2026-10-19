/*
|--------------------------------------------------------------------------
| Rutas del portal del cliente (A5)
|--------------------------------------------------------------------------
*/
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { definirRuta, etagCoincide, sinCambios, type Ruta } from '#shared/rutas'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { lista, pagina } from '#shared/openapi/esquemas'
import {
    Empresa,
    EmpresaPublica,
    EstadoPortal,
    PlantillaDocumento,
    PlantillaDocumentoFabrica,
    PortalContacto,
    PortalCondicionesPromesa,
    NodoPortal,
    NodoPortalCreado,
    NodoPortalInterno,
    NodoPortalInternoCreado,
    NodoPortalInternoRevocado,
    PortalBanco,
    PortalComprobante,
    PortalCuenta,
    PortalFactura,
    PortalFacturaDetalle,
    PortalNotaCredito,
    PortalPago,
    PortalPagoEnLinea,
    PortalPromesa,
    PortalPromesaSolicitada,
    PortalSesion,
    PortalSolicitudCodigo,
    PortalTelegram,
    PortalVinculoTelegram,
    QuienSoy,
} from '#portal/esquemas'
import {
    condicionesPromesaValidator,
    crearNodoPortalValidator,
    editarContactoValidator,
    editarEmpresaValidator,
    editarPlantillaDocumentoValidator,
    empresaPortalValidator,
    iniciarPagoValidator,
    paginaPortalValidator,
    vistaPreviaDocumentoValidator,
    solicitarCodigoValidator,
    solicitarPromesaValidator,
    subirComprobanteValidator,
    verificarCodigoValidator,
    vincularTelegramValidator,
} from '#portal/validators'
import { ipOrigenDelCliente } from '#portal/ip_origen'
import { DemasiadasPeticiones, limitarPorIp } from '#portal/limite_peticiones'
import {
    borrarCookieSesion,
    clienteDeLaSesion,
    clienteDeLaSesionSiHay,
    exigirSesionPortal,
    ponerCookieSesion,
} from '#portal/acceso/sesion'
import { cuentaPortal, facturaPortal, facturasPortal, pagosPortal, promesasPortal } from '#portal/cuenta'
import { notasCreditoPortal, xmlDeFacturaCliente, xmlDeNotaCliente, type XmlDte } from '#portal/fel'
import IdentificarPorIp from '#portal/actions/identificar_por_ip'
import ConsultarEstadoPorIp from '#portal/actions/consultar_estado_por_ip'
import SolicitarCodigoPortal from '#portal/actions/solicitar_codigo'
import VerificarCodigoPortal from '#portal/actions/verificar_codigo'
import CerrarSesionPortal from '#portal/actions/cerrar_sesion'
import EditarContactoPortal from '#portal/actions/editar_contacto'
import GenerarCodigoTelegram from '#notify/actions/generar_codigo_telegram'
import DesvincularTelegramPortal from '#portal/actions/desvincular_telegram'
import { estadoTelegram } from '#portal/acceso/telegram'
import EditarPlantillaDocumento from '#portal/actions/editar_plantilla_documento'
import EditarEmpresa from '#portal/actions/editar_empresa'
import { leerEmpresa, verEmpresa } from '#portal/empresa'
import { fuenteCuentasDeposito } from '#portal/cuentas_deposito'
import { empresaDelServicio, empresaPrincipalDelCliente, urlLogoPortal } from '#portal/marca'
import { resolverServicio } from '#portal/consultas'
import { EMPRESA_PRINCIPAL, filaEmpresa } from '#core/empresas'
import { leerArchivoLogo } from '#core/logos'
import {
    PLANTILLAS_BASE,
    VARIABLES_DOCUMENTO,
    avisoCobroPdf,
    esTipoDocumento,
    notaCreditoPdf,
    pdfDesdePlantilla,
    plantillaVigente,
    vistaEjemplo,
    type DocumentoPdf,
    type TipoDocumento,
} from '#portal/documentos/render'
import {
    condicionesPromesa,
    errorParaCliente,
    promesaParaCliente,
    servicioDeLaPeticion,
    venceAlFinalDelDia,
} from '#portal/promesas'
import CrearPromesaPago from '#billing/actions/crear_promesa_pago'
import RegistrarComprobante from '#billing/actions/registrar_comprobante'
import {
    archivoDeLaPeticion,
    bancosPortal,
    comprobanteParaCliente,
    comprobantesPortal,
    errorComprobanteParaCliente,
    titularDeLaPeticion,
} from '#portal/comprobantes'
import CrearCobroPasarela from '#billing/actions/crear_cobro_pasarela'
import {
    cobroDeLaPeticion,
    cobroParaCliente,
    errorPagoParaCliente,
    facturasAPagar,
    pagadorDeLaPeticion,
    pagoEnLineaDisponible,
    urlRetornoPortal,
} from '#portal/pagos_en_linea'
import { exigirAlcance } from '#core/acl'
import CrearNodoPortal from '#portal/actions/crear_nodo_portal'
import RevocarNodoPortal from '#portal/actions/revocar_nodo_portal'
import { idDeNodoPorNombre, listarNodosPortal, vistaInterna } from '#portal/nodos_portal'
import { dimensionesDeFactura } from '#billing/facturas'

/** Responde un PDF en línea (se abre en el navegador; el usuario lo guarda si quiere). */
function enviarPdf(ctx: HttpContext, documento: DocumentoPdf): void {
    ctx.response.header('Content-Type', 'application/pdf')
    ctx.response.header('Content-Disposition', `inline; filename="${documento.nombreArchivo}"`)
    ctx.response.header('Cache-Control', 'private, no-store')
    ctx.response.send(documento.pdf)
}

/** Responde el XML certificado de un DTE como descarga. */
function enviarXml(ctx: HttpContext, documento: XmlDte): void {
    ctx.response.header('Content-Type', 'application/xml; charset=utf-8')
    ctx.response.header('Content-Disposition', `attachment; filename="${documento.nombreArchivo}"`)
    ctx.response.header('Cache-Control', 'private, no-store')
    ctx.response.header('X-Content-Type-Options', 'nosniff')
    ctx.response.send(documento.xml)
}

const PARAMETRO_TIPO = { tipo: { type: 'string', enum: ['aviso_cobro', 'nota_credito'] } }

function tipoDocumento(valor: unknown): TipoDocumento {
    if (!esTipoDocumento(valor)) throw new NoEncontrado(`No hay plantilla de documento "${String(valor)}"`)
    return valor
}

const SOBRE_LA_IP =
    'La IP de origen sale del socket, o de `X-Forwarded-For` (`PORTAL_CABECERA_IP`) solo si la conexión ' +
    'viene de un proxy listado en `PORTAL_PROXIES_CONFIABLES`. Límite por IP (IPv6: por /64): ' +
    '`PORTAL_LIMITE_PETICIONES` por `PORTAL_LIMITE_VENTANA_S` (30 por minuto por defecto, contador propio ' +
    'de cada endpoint); al pasarse responde 429 problem+json con `Retry-After`.'

const SOBRE_LA_SESION =
    'Requiere la sesión del portal: cookie httpOnly `argos_portal` que pone `POST /portal/verificar` ' +
    '(sin ella o vencida responde 401). Solo devuelve datos del cliente de la sesión. Con límite de ' +
    'peticiones por IP como las rutas sin sesión (429).'

/**
 * IP de origen ya resuelta y con el límite de peticiones aplicado. Todas las rutas `/portal/*` la
 * llaman (también las de la sesión): son públicas en el walled garden. Cada endpoint tiene su contador.
 */
async function ipDelCliente(ctx: HttpContext, endpoint: string): Promise<string> {
    ctx.response.header('Cache-Control', 'no-store')
    const ip = await ipOrigenDelCliente(ctx)
    if (!ip) throw new Error('La conexión no trae una IP de origen válida')
    await limitarPorIp(ctx, endpoint, ip)
    return ip
}

/**
 * Contexto de una acción pedida desde el portal: actor `cliente` si la petición trae la sesión (el
 * cliente se autenticó con su código), actor `sistema` si solo se identificó por la IP de origen
 * (la IP no autentica a nadie). Canal `portal` en los dos casos.
 */
function contextoDelTitular(ctx: HttpContext, titular: { clienteId: number; porSesion: boolean }) {
    return titular.porSesion ? ctx.contextoCliente(titular.clienteId) : ctx.contextoAccion('portal')
}

/** Límite por IP y luego la sesión del portal (401 sin ella). */
async function clienteDeLaSesionLimitada(ctx: HttpContext, endpoint: string): Promise<number> {
    await ipDelCliente(ctx, endpoint)
    return clienteDeLaSesion(ctx)
}

const publicas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/portal/quien-soy',
        operacion: 'portalQuienSoy',
        resumen: 'Identifica al cliente por la IP de origen (página de corte)',
        descripcion: `Sin login. Solo devuelve nombre parcial, estado y montos. ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        permiso: null,
        respuesta: { status: 200, descripcion: 'Identificación mínima', esquema: QuienSoy },
        handler: async (ctx) => {
            const ip = await ipDelCliente(ctx, 'quien-soy')
            return new IdentificarPorIp().execute({ ip }, ctx.contextoAccion('portal'))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/estado',
        operacion: 'portalEstado',
        resumen: 'Estado del servicio de la IP de origen (estado en vivo de la página de corte)',
        descripcion:
            'Sin login. La página de corte lo consulta cada 5 s tras un pago o una promesa hasta ver ' +
            `\`activo\`. Solo devuelve estado y monto adeudado, sin datos personales. ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        permiso: null,
        respuesta: { status: 200, descripcion: 'Estado y monto', esquema: EstadoPortal },
        handler: async (ctx) => {
            const ip = await ipDelCliente(ctx, 'estado')
            return new ConsultarEstadoPorIp().execute({ ip }, ctx.contextoAccion('portal'))
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/codigo',
        operacion: 'portalSolicitarCodigo',
        resumen: 'Pide un código de acceso al portal (correo o Telegram registrado del cliente)',
        descripcion:
            'Con `identificador` (NIT/CUI o usuario PPPoE) o `por_ip: true` (desde /corte). El código ' +
            '(6 dígitos, `PORTAL_CODIGO_VIGENCIA_S`) va SIEMPRE al destino registrado del cliente. Por ' +
            'identificador responde igual exista o no el cliente; por IP responde 422 `no_identificado` ' +
            'o `sin_destino`. Máximo `PORTAL_CODIGO_MAX_HORA` códigos por cliente por hora; 503 si el ' +
            `canal no acepta el mensaje. ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        permiso: null,
        cuerpo: solicitarCodigoValidator,
        respuesta: {
            status: 202,
            descripcion: 'Código enviado (o solicitud ciega)',
            esquema: PortalSolicitudCodigo,
        },
        handler: async (ctx, { cuerpo }) => {
            const ip = await ipDelCliente(ctx, 'codigo')
            if (!cuerpo.identificador && cuerpo.por_ip !== true) {
                throw new ValidacionFallida([
                    {
                        field: 'identificador',
                        message: 'Escribe tu NIT, CUI o usuario de conexión',
                        rule: 'required',
                    },
                ])
            }
            try {
                return await new SolicitarCodigoPortal().execute(
                    { ip, identificador: cuerpo.identificador, por_ip: cuerpo.por_ip },
                    ctx.contextoAccion('portal'),
                )
            } catch (error) {
                if (error instanceof DemasiadasPeticiones) {
                    ctx.response.header('Retry-After', String(error.reintentarEnS))
                }
                throw error
            }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/verificar',
        operacion: 'portalVerificarCodigo',
        resumen: 'Verifica el código y abre la sesión del portal (cookie httpOnly)',
        descripcion:
            'Pone la cookie httpOnly `argos_portal` (SameSite=Strict, ruta /api/v1/portal). El token nunca ' +
            'va en el cuerpo. Código incorrecto, vencido, usado o sin intentos (`PORTAL_CODIGO_INTENTOS`): ' +
            `422 \`codigo_invalido\`. ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        permiso: null,
        cuerpo: verificarCodigoValidator,
        respuesta: { status: 200, descripcion: 'Sesión abierta', esquema: PortalSesion },
        handler: async (ctx, { cuerpo }) => {
            const ip = await ipDelCliente(ctx, 'verificar')
            const { token, sesion } = await new VerificarCodigoPortal().execute(
                { solicitud: cuerpo.solicitud, secreto: cuerpo.codigo, ip },
                ctx.contextoAccion('portal'),
            )
            ponerCookieSesion(ctx, token)
            return sesion
        },
    }),
]

const autenticadas: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/portal/salir',
        operacion: 'portalSalir',
        resumen: 'Cierra la sesión del portal',
        descripcion: SOBRE_LA_SESION,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: { status: 204, descripcion: 'Sesión cerrada' },
        handler: async (ctx) => {
            await ipDelCliente(ctx, 'salir')
            const sesion = await exigirSesionPortal(ctx)
            await new CerrarSesionPortal().execute(
                { sesionId: sesion.id, clienteId: sesion.clienteId },
                ctx.contextoCliente(sesion.clienteId),
            )
            borrarCookieSesion(ctx)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/cuenta',
        operacion: 'portalCuenta',
        resumen: 'Datos de contacto, servicios y saldo del cliente de la sesión',
        descripcion: SOBRE_LA_SESION,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Cuenta del cliente', esquema: PortalCuenta },
        handler: async (ctx) => cuentaPortal(await clienteDeLaSesionLimitada(ctx, 'cuenta')),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/facturas',
        operacion: 'portalFacturas',
        resumen: 'Facturas (avisos de cobro) del cliente de la sesión',
        descripcion: SOBRE_LA_SESION,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        query: paginaPortalValidator,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Página de facturas', esquema: pagina(PortalFactura) },
        handler: async (ctx, { query }) =>
            facturasPortal(await clienteDeLaSesionLimitada(ctx, 'facturas'), query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/facturas/:id',
        operacion: 'portalFactura',
        resumen: 'Detalle de una factura del cliente de la sesión',
        descripcion: `${SOBRE_LA_SESION} Una factura de otro cliente responde 404.`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Factura con líneas', esquema: PortalFacturaDetalle },
        handler: async (ctx, { params }) =>
            facturaPortal(await clienteDeLaSesionLimitada(ctx, 'factura'), Number(params.id)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/notas-credito',
        operacion: 'portalNotasCredito',
        resumen: 'Notas de crédito (internas y NCRE) del cliente de la sesión',
        descripcion: `${SOBRE_LA_SESION} Solo las de sus facturas visibles en el portal; una nota anulada sale como anulada.`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        query: paginaPortalValidator,
        limitada: true,
        respuesta: {
            status: 200,
            descripcion: 'Página de notas de crédito',
            esquema: pagina(PortalNotaCredito),
        },
        handler: async (ctx, { query }) =>
            notasCreditoPortal(await clienteDeLaSesionLimitada(ctx, 'notas-credito'), query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/pagos',
        operacion: 'portalPagos',
        resumen: 'Pagos del cliente de la sesión',
        descripcion: SOBRE_LA_SESION,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        query: paginaPortalValidator,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Página de pagos', esquema: pagina(PortalPago) },
        handler: async (ctx, { query }) => pagosPortal(await clienteDeLaSesionLimitada(ctx, 'pagos'), query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/promesas',
        operacion: 'portalPromesas',
        resumen: 'Promesas de pago del cliente de la sesión (solo lectura)',
        descripcion: SOBRE_LA_SESION,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        query: paginaPortalValidator,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Página de promesas', esquema: pagina(PortalPromesa) },
        handler: async (ctx, { query }) =>
            promesasPortal(await clienteDeLaSesionLimitada(ctx, 'promesas-lista'), query),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/portal/contacto',
        operacion: 'portalEditarContacto',
        resumen: 'El cliente edita su correo, teléfonos y canal preferido',
        descripcion:
            `${SOBRE_LA_SESION} Acción \`portal.editar_contacto\` (canal portal) sobre \`clientes.editar\`: ` +
            'diff en audit.cambios, 409 si `version` cambió, 422 `telegram_no_vinculado`.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        versionada: true,
        cuerpo: editarContactoValidator,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Contacto actualizado', esquema: PortalContacto },
        handler: async (ctx, { cuerpo }) => {
            await ipDelCliente(ctx, 'contacto')
            const sesion = await exigirSesionPortal(ctx)
            return new EditarContactoPortal().execute(
                { ...cuerpo, clienteId: sesion.clienteId },
                ctx.contextoCliente(sesion.clienteId),
            )
        },
    }),
]

const SOBRE_TELEGRAM = 'Contrato con el bot en `.claude/integration/contratos/telegram.md`.'

const telegram: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/portal/telegram',
        operacion: 'portalTelegram',
        resumen: 'Estado de la vinculación de Telegram del cliente de la sesión',
        descripcion: `${SOBRE_LA_SESION} El portal la consulta cada 3 s mientras el código está vigente. ${SOBRE_TELEGRAM}`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Estado de Telegram', esquema: PortalTelegram },
        handler: async (ctx) => estadoTelegram(await clienteDeLaSesionLimitada(ctx, 'telegram')),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/telegram/vincular',
        operacion: 'portalVincularTelegram',
        resumen: 'Genera el código de un solo uso y el enlace al bot para vincular Telegram',
        descripcion:
            `${SOBRE_LA_SESION} Llama \`GenerarCodigoTelegram\` de A6 (\`notificaciones.telegram_codigo\`, canal ` +
            'portal): vence a los `TELEGRAM_CODIGO_VIGENCIA_S` y reemplaza el código pendiente anterior de ese ' +
            'bot. Con `empresa_id` (una de `GET /portal/telegram` → `empresas`), el bot de esa empresa; 404 si ' +
            'el cliente no tiene servicios en ella. 503 ' +
            `\`telegram_no_configurado\` sin bot. ${SOBRE_LA_IP} ${SOBRE_TELEGRAM}`,
        etiqueta: 'portal',
        seguridad: 'portal',
        limitada: true,
        permiso: null,
        cuerpo: vincularTelegramValidator,
        respuesta: { status: 201, descripcion: 'Enlace al bot', esquema: PortalVinculoTelegram },
        handler: async (ctx, { cuerpo }) => {
            await ipDelCliente(ctx, 'telegram-vincular')
            const sesion = await exigirSesionPortal(ctx)
            try {
                return await new GenerarCodigoTelegram().execute(
                    { cliente_id: sesion.clienteId, empresa_id: cuerpo.empresa_id ?? null },
                    ctx.contextoCliente(sesion.clienteId),
                )
            } catch (error) {
                // Una empresa en la que el cliente no tiene servicios: como un recurso ajeno.
                if (
                    error instanceof ValidacionFallida &&
                    error.errores?.some((e) => e.rule === 'servicio_en_empresa')
                ) {
                    throw new NoEncontrado('No tienes servicios con esa empresa')
                }
                throw error
            }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/telegram/desvincular',
        operacion: 'portalDesvincularTelegram',
        resumen: 'Quita el chat de Telegram del cliente de la sesión',
        descripcion:
            `${SOBRE_LA_SESION} Acción \`portal.desvincular_telegram\` sobre \`clientes.desvincular_telegram\`. ` +
            'Si el canal preferido era Telegram pasa a correo. Idempotente.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Estado de Telegram', esquema: PortalTelegram },
        handler: async (ctx) => {
            await ipDelCliente(ctx, 'telegram-desvincular')
            const sesion = await exigirSesionPortal(ctx)
            return new DesvincularTelegramPortal().execute(
                { clienteId: sesion.clienteId },
                ctx.contextoCliente(sesion.clienteId),
            )
        },
    }),
]

const documentos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/portal/facturas/:id/pdf',
        operacion: 'portalFacturaPdf',
        resumen: 'PDF del aviso de cobro (o factura, con FEL) de una factura del cliente de la sesión',
        descripcion:
            `${SOBRE_LA_SESION} Con la marca de la empresa que emite la factura y, si su DTE está certificado, ` +
            'serie, número y autorización. Una factura de otro cliente o por certificar responde 404. ' +
            'Responde application/pdf.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: { status: 200, descripcion: 'PDF', contenido: 'application/pdf' },
        handler: async (ctx, { params }) => {
            const clienteId = await clienteDeLaSesionLimitada(ctx, 'factura-pdf')
            enviarPdf(ctx, await avisoCobroPdf(Number(params.id), { clienteId }))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/facturas/:id/xml',
        operacion: 'portalFacturaXml',
        resumen: 'XML certificado (FEL) de una factura del cliente de la sesión',
        descripcion:
            `${SOBRE_LA_SESION} 404 si la factura es de otro cliente, está por certificar o su DTE no está ` +
            'certificado. Responde application/xml como descarga.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: { status: 200, descripcion: 'XML', contenido: 'application/xml' },
        handler: async (ctx, { params }) => {
            const clienteId = await clienteDeLaSesionLimitada(ctx, 'factura-xml')
            enviarXml(ctx, await xmlDeFacturaCliente(clienteId, Number(params.id)))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/notas-credito/:id/xml',
        operacion: 'portalNotaCreditoXml',
        resumen: 'XML certificado (NCRE) de una nota de crédito del cliente de la sesión',
        descripcion: `${SOBRE_LA_SESION} 404 si la nota es de otro cliente o su NCRE no está certificada.`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: { status: 200, descripcion: 'XML', contenido: 'application/xml' },
        handler: async (ctx, { params }) => {
            const clienteId = await clienteDeLaSesionLimitada(ctx, 'nota-xml')
            enviarXml(ctx, await xmlDeNotaCliente(clienteId, Number(params.id)))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/notas-credito/:id/pdf',
        operacion: 'portalNotaCreditoPdf',
        resumen: 'PDF de una nota de crédito (NCRE) del cliente de la sesión',
        descripcion:
            `${SOBRE_LA_SESION} Representación gráfica con la plantilla \`nota_credito\` y la marca de la empresa ` +
            'de su factura: datos de la NCRE (autorización, serie, número, fecha) y la factura de origen; ' +
            '«ANULADA» si se anuló. Una nota de otro cliente responde 404. Responde application/pdf.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: { status: 200, descripcion: 'PDF', contenido: 'application/pdf' },
        handler: async (ctx, { params }) => {
            const clienteId = await clienteDeLaSesionLimitada(ctx, 'nota-pdf')
            enviarPdf(ctx, await notaCreditoPdf(Number(params.id), { clienteId }))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/documentos/nota-credito/:notaId',
        operacion: 'documentosNotaCreditoPdf',
        resumen: 'PDF de una nota de crédito (panel)',
        descripcion:
            'Mismo PDF que ve el cliente en el portal. Respeta el alcance del usuario sobre la factura de la nota. ' +
            'Responde application/pdf.',
        etiqueta: 'documentos',
        permiso: 'facturas.ver',
        respuesta: { status: 200, descripcion: 'PDF', contenido: 'application/pdf' },
        handler: async (ctx, { params }) => {
            const id = Number(params.notaId)
            const nota = (await db
                .from('billing.notas_credito')
                .where('id', id)
                .select('factura_id')
                .first()) as {
                factura_id: number
            } | null
            if (!nota) throw new NoEncontrado(`La nota de crédito ${id} no existe`)
            exigirAlcance(ctx.alcance, await dimensionesDeFactura(Number(nota.factura_id)))
            enviarPdf(ctx, await notaCreditoPdf(id))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/documentos/aviso-cobro/:facturaId',
        operacion: 'documentosAvisoCobroPdf',
        resumen: 'PDF del aviso de cobro de una factura (panel)',
        descripcion:
            'Mismo PDF que ve el cliente en el portal. Respeta el alcance del usuario. Responde application/pdf.',
        etiqueta: 'documentos',
        permiso: 'facturas.ver',
        respuesta: { status: 200, descripcion: 'PDF', contenido: 'application/pdf' },
        handler: async (ctx, { params }) => {
            const id = Number(params.facturaId)
            exigirAlcance(ctx.alcance, await dimensionesDeFactura(id))
            enviarPdf(ctx, await avisoCobroPdf(id))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/documentos/plantillas/:tipo',
        operacion: 'documentosPlantillaVer',
        resumen: 'Plantilla HTML vigente de un documento y sus variables (editor del panel)',
        etiqueta: 'documentos',
        permiso: 'documentos.ver',
        parametros: PARAMETRO_TIPO,
        respuesta: { status: 200, descripcion: 'Plantilla', esquema: PlantillaDocumento },
        handler: async (_ctx, { params }) => {
            const tipo = tipoDocumento(params.tipo)
            return { ...(await plantillaVigente(tipo)), variables: VARIABLES_DOCUMENTO[tipo] }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/documentos/plantillas/:tipo/fabrica',
        operacion: 'documentosPlantillaFabrica',
        resumen: 'Plantilla HTML de fábrica de un documento (para restaurar o comparar en el editor)',
        descripcion:
            'La plantilla que trae esta versión de ArgosIsp, con el bloque FEL, aunque la empresa haya guardado ' +
            'otra. No guarda nada: para restaurarla se envía este `html` a `PUT /documentos/plantillas/:tipo` ' +
            'con la `version` vigente.',
        etiqueta: 'documentos',
        permiso: 'documentos.ver',
        parametros: PARAMETRO_TIPO,
        respuesta: { status: 200, descripcion: 'Plantilla de fábrica', esquema: PlantillaDocumentoFabrica },
        handler: async (_ctx, { params }) => {
            const tipo = tipoDocumento(params.tipo)
            return { tipo, html: PLANTILLAS_BASE[tipo], variables: VARIABLES_DOCUMENTO[tipo] }
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/documentos/plantillas/:tipo',
        operacion: 'documentosPlantillaEditar',
        resumen: 'Guarda la plantilla HTML de un documento',
        descripcion:
            'Valida Mustache (sin `{{{ }}}`) y que genere el PDF con datos de ejemplo (422). `version` 0 edita la ' +
            'de fábrica. Diff en audit.cambios.',
        etiqueta: 'documentos',
        permiso: 'documentos.editar',
        versionada: true,
        parametros: PARAMETRO_TIPO,
        cuerpo: editarPlantillaDocumentoValidator,
        respuesta: { status: 200, descripcion: 'Plantilla guardada', esquema: PlantillaDocumento },
        handler: async (ctx, { cuerpo, params }) => {
            const tipo = tipoDocumento(params.tipo)
            const plantilla = await new EditarPlantillaDocumento().execute(
                { tipo, html: cuerpo.html, version: cuerpo.version },
                ctx.contextoAccion(),
            )
            return { ...plantilla, variables: VARIABLES_DOCUMENTO[tipo] }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/documentos/plantillas/:tipo/vista-previa',
        operacion: 'documentosPlantillaVistaPrevia',
        resumen: 'PDF de prueba de una plantilla con datos de ejemplo (no guarda nada)',
        descripcion: '422 si la plantilla no es válida. Responde application/pdf.',
        etiqueta: 'documentos',
        permiso: 'documentos.editar',
        parametros: PARAMETRO_TIPO,
        cuerpo: vistaPreviaDocumentoValidator,
        respuesta: { status: 200, descripcion: 'PDF', contenido: 'application/pdf' },
        handler: async (ctx, { cuerpo, params }) => {
            const pdf = await pdfDesdePlantilla(cuerpo.html, await vistaEjemplo(tipoDocumento(params.tipo)))
            enviarPdf(ctx, { pdf, nombreArchivo: 'vista-previa.pdf' })
        },
    }),
]

const SOBRE_LA_IDENTIFICACION =
    'Sin `servicio_id` identifica el servicio por la IP de origen (página de corte; 422 `no_identificado` ' +
    'si la IP no es de ningún servicio). Con `servicio_id` exige la sesión del portal (cookie `argos_portal`, ' +
    '401 sin ella) y que el servicio sea del cliente (404 si no).'

const promesas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/portal/promesas/condiciones',
        operacion: 'portalPromesaCondiciones',
        resumen: 'Límites de una promesa de pago desde el portal (antes de enviarla)',
        descripcion:
            'Solo lectura: plazo y fecha máximos del canal portal, monto máximo (deuda), abono inicial y si ' +
            'requiere aprobación, de las reglas de la plantilla. No adelanta las reglas de historial: esas las ' +
            `dice el resultado de \`POST /portal/promesas\`. ${SOBRE_LA_IDENTIFICACION} ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        permiso: null,
        query: condicionesPromesaValidator,
        respuesta: { status: 200, descripcion: 'Condiciones', esquema: PortalCondicionesPromesa },
        handler: async (ctx, { query }) => {
            const ip = await ipDelCliente(ctx, 'promesas-condiciones')
            return condicionesPromesa(await servicioDeLaPeticion(ctx, ip, query.servicio_id))
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/promesas',
        operacion: 'portalSolicitarPromesa',
        resumen: 'El cliente solicita una promesa de pago (aprobada, rechazada o pendiente de aprobación)',
        descripcion:
            'Llama `promesas.crear` (`CrearPromesaPago` de A3) con canal `portal` (actor `cliente` con la sesión, ' +
            '`sistema` por la IP; con canal `portal` no escribe `aprobada_por`): la promesa ' +
            'se guarda siempre con su evaluación. Aprobada: el servicio se reactiva en la misma transacción ' +
            '(la página lo ve con `GET /portal/estado`). `motivo` va en palabras del cliente. 409 ' +
            '`promesa_abierta` si ya hay una activa o pendiente; 422 si `monto` supera la deuda o la fecha ya ' +
            `pasó. ${SOBRE_LA_IDENTIFICACION} ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        idempotente: true,
        permiso: null,
        cuerpo: solicitarPromesaValidator,
        respuesta: { status: 201, descripcion: 'Promesa evaluada', esquema: PortalPromesaSolicitada },
        handler: async (ctx, { cuerpo }) => {
            const ip = await ipDelCliente(ctx, 'promesas')
            const titular = await titularDeLaPeticion(ctx, ip, cuerpo.servicio_id)
            try {
                const promesa = await new CrearPromesaPago().execute(
                    {
                        servicio_id: titular.servicioId,
                        vence_en: venceAlFinalDelDia(cuerpo.vence_el),
                        monto: cuerpo.monto,
                        canal: 'portal',
                    },
                    contextoDelTitular(ctx, titular),
                )
                return promesaParaCliente(promesa)
            } catch (error) {
                throw errorParaCliente(error)
            }
        },
    }),
]

const SOBRE_EL_PAGO =
    'Contrato en `.claude/integration/contratos/pago-en-linea.md`. El pago lo registra el webhook firmado ' +
    'de la pasarela (A3), que reactiva el servicio: la página de corte lo ve con `GET /portal/estado`.'

const pagosEnLinea: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/portal/pagos/iniciar',
        operacion: 'portalIniciarPago',
        resumen: 'Pagar en línea: crea el cobro en la pasarela y devuelve la url de pago del proveedor',
        descripcion:
            'Llama `pasarela.crear_cobro` (`CrearCobroPasarela` de A3) con canal `portal` y actor sistema. Sin ' +
            '`facturas` cobra las facturas vencidas con saldo del servicio (o todo lo pendiente del servicio si ' +
            'nada está vencido); 422 `sin_deuda` si no debe nada. `facturas` concretas exigen la sesión y deben ' +
            'ser del cliente (404 si no). Un cobro es de una sola empresa: facturas de varias empresas → 422 ' +
            '`pago_de_varias_empresas` (se paga un servicio o las facturas de una empresa a la vez). ' +
            '503 `pasarela_no_configurada` sin pasarela. La pasarela devuelve al ' +
            'cliente a `<PORTAL_URL_PUBLICA>/corte?pago=<id>&estado=<pagado|fallido>` (`url_retorno`). ' +
            `${SOBRE_LA_IDENTIFICACION} ${SOBRE_LA_IP} ${SOBRE_EL_PAGO}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        idempotente: true,
        permiso: null,
        cuerpo: iniciarPagoValidator,
        respuesta: { status: 201, descripcion: 'Cobro creado', esquema: PortalPagoEnLinea },
        handler: async (ctx, { cuerpo }) => {
            const ip = await ipDelCliente(ctx, 'pagos-iniciar')
            const pagador = await pagadorDeLaPeticion(ctx, ip, cuerpo)
            const facturas = await facturasAPagar(ctx, pagador, cuerpo.facturas)
            try {
                // Actor sistema aun con la sesión: `CrearCobroPasarela` guarda `actor.id` en
                // `creado_por` (core.usuarios). Pasa a `contextoDelTitular` cuando A3 use `usuarioDelActor`.
                const cobro = await new CrearCobroPasarela().execute(
                    {
                        cliente_id: pagador.clienteId,
                        servicio_id: pagador.servicioId,
                        facturas,
                        url_retorno: urlRetornoPortal(),
                    },
                    ctx.contextoAccion('portal'),
                )
                return cobroParaCliente(cobro)
            } catch (error) {
                throw errorPagoParaCliente(error)
            }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/pagos/en-linea/:id',
        operacion: 'portalPagoEnLinea',
        resumen: 'Estado de un pago en línea (página de retorno `/corte?pago=<id>`)',
        descripcion:
            'Solo lectura: `pendiente` hasta que llegue el webhook, luego `pagado`, `fallido` o `expirado`. ' +
            'Responde solo si el cobro es del cliente de la sesión del portal o del servicio de la IP de origen; ' +
            `cualquier otro, 404. ${SOBRE_LA_IP} ${SOBRE_EL_PAGO}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        permiso: null,
        respuesta: { status: 200, descripcion: 'Pago en línea', esquema: PortalPagoEnLinea },
        handler: async (ctx, { params }) => {
            const ip = await ipDelCliente(ctx, 'pagos-en-linea')
            const id = Number(params.id)
            if (!Number.isSafeInteger(id) || id < 1) {
                throw new NoEncontrado('No encontramos ese pago en línea')
            }
            return cobroDeLaPeticion(ctx, ip, id)
        },
    }),
]

/**
 * Empresa de `GET /portal/empresa` (multiempresa): `empresa_id` explícito (404 si no existe); con
 * `de=cliente`, la principal del cliente de la sesión (401 sin ella); sin parámetros, la del
 * servicio de la IP de origen, si no la principal del cliente de la sesión, si no la principal.
 */
async function empresaDeLaPeticion(
    ctx: HttpContext,
    ip: string,
    query: { empresa_id?: number; de?: 'cliente' },
): Promise<number> {
    if (query.empresa_id !== undefined) {
        await filaEmpresa(query.empresa_id)
        return query.empresa_id
    }
    if (query.de === 'cliente') return empresaPrincipalDelCliente(await clienteDeLaSesion(ctx))
    const servicioId = await resolverServicio(db.connection(), ip)
    const porIp = servicioId ? await empresaDelServicio(servicioId) : null
    if (porIp !== null) return porIp
    const clienteId = await clienteDeLaSesionSiHay(ctx)
    return clienteId === null ? EMPRESA_PRINCIPAL : empresaPrincipalDelCliente(clienteId)
}

const empresa: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/portal/empresa',
        operacion: 'portalEmpresa',
        resumen: 'Marca, contacto, instrucciones de pago y cuentas para depósito de una empresa',
        descripcion:
            'Sin login: es información pública de la empresa (la de sus avisos de cobro). Multiempresa: con ' +
            '`empresa_id`, esa empresa (404 si no existe); con `de=cliente`, la principal del cliente de la ' +
            'sesión (401 sin sesión); sin parámetros, la del servicio de la IP de origen (página de corte), ' +
            'si no la principal del cliente de la sesión, si no la principal de la instalación. Las cuentas ' +
            `de depósito son solo las de esa empresa. ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        permiso: null,
        query: empresaPortalValidator,
        respuesta: { status: 200, descripcion: 'Empresa', esquema: EmpresaPublica },
        handler: async (ctx, { query }) => {
            const ip = await ipDelCliente(ctx, 'empresa')
            const empresaId = await empresaDeLaPeticion(ctx, ip, query)
            const datos = await leerEmpresa(undefined, empresaId)
            const { logo_etag: etag } = await filaEmpresa(empresaId)
            return {
                id: empresaId,
                logo_url: urlLogoPortal(empresaId, etag),
                ...datos,
                cuentas_deposito: await fuenteCuentasDeposito().activas(empresaId),
                // La pasarela es una sola para la instalación; cada cobro lleva facturas de una empresa.
                pago_en_linea: pagoEnLineaDisponible(),
            }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/empresas/:id/logo',
        operacion: 'portalEmpresaLogo',
        resumen: 'Logo de una empresa por el mismo origen del portal (walled garden)',
        descripcion:
            'El mismo archivo que `GET /empresas/:id/logo`, bajo `/portal` para que el cliente suspendido lo ' +
            'alcance. `ETag` y caché larga (la URL lleva `?v=<etag>`); con `If-None-Match` igual responde ' +
            `304. 404 si la empresa no existe o no tiene logo. ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        permiso: null,
        respuesta: { status: 200, descripcion: 'Imagen del logo', contenido: 'image/*', etag: true },
        handler: async (ctx, { params }) => {
            await ipDelCliente(ctx, 'logo')
            const id = Number(params.id)
            if (!Number.isSafeInteger(id) || id < 1) throw new NoEncontrado('La empresa no existe')
            const fila = await filaEmpresa(id)
            if (!fila.logo || !fila.logo_tipo || !fila.logo_etag) {
                throw new NoEncontrado('La empresa no tiene logo')
            }
            // `ipDelCliente` pone no-store; el logo cambia de URL al cambiar (`?v=`), se puede guardar.
            ctx.response.header('Cache-Control', 'public, max-age=86400')
            ctx.response.header('ETag', `"${fila.logo_etag}"`)
            ctx.response.header('X-Content-Type-Options', 'nosniff')
            if (etagCoincide(ctx, fila.logo_etag)) return sinCambios()
            const contenido = await leerArchivoLogo(fila.logo)
            ctx.response.header('Content-Type', fila.logo_tipo)
            if (fila.logo_tipo === 'image/svg+xml') {
                ctx.response.header(
                    'Content-Security-Policy',
                    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
                )
            }
            return contenido
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/empresa',
        operacion: 'empresaVer',
        resumen: 'Configuración de la empresa (panel)',
        etiqueta: 'empresa',
        permiso: 'empresa.ver',
        respuesta: { status: 200, descripcion: 'Empresa', esquema: Empresa },
        handler: async () => verEmpresa(),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/empresa',
        operacion: 'empresaEditar',
        resumen: 'Edita la configuración de la empresa',
        descripcion:
            'Nombre, NIT, dirección, teléfonos, WhatsApp, correo, horario e instrucciones de pago. `version` 0 ' +
            'la crea. Diff por campo en audit.cambios. Las cuentas bancarias se editan en /cuentas-bancarias (A3).',
        etiqueta: 'empresa',
        permiso: 'empresa.editar',
        versionada: true,
        cuerpo: editarEmpresaValidator,
        respuesta: { status: 200, descripcion: 'Empresa guardada', esquema: Empresa },
        handler: async (ctx, { cuerpo }) => new EditarEmpresa().execute(cuerpo, ctx.contextoAccion()),
    }),
]

const comprobantes: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/portal/bancos',
        operacion: 'portalBancos',
        resumen: 'Bancos de origen para el comprobante (transferencia y ACH)',
        descripcion: `Sin login: catálogo \`billing.bancos\` de A3, solo los activos. ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        permiso: null,
        respuesta: { status: 200, descripcion: 'Bancos', esquema: lista(PortalBanco) },
        handler: async (ctx) => {
            await ipDelCliente(ctx, 'bancos')
            return bancosPortal()
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/comprobantes',
        operacion: 'portalSubirComprobante',
        resumen: 'El cliente sube el comprobante de un depósito, transferencia, ACH o remesa',
        descripcion:
            '`multipart/form-data`: los campos más el archivo `archivo`. Llama `comprobantes.registrar` ' +
            '(`RegistrarComprobante` de A3) con canal `portal` y actor sistema: queda `pendiente` hasta que ' +
            'el panel lo revise; no cambia el estado del servicio. 422 por campo con el texto para el cliente ' +
            '(`archivo` con `rule` `required`, `tipo` o `tamano`); 422 `cuenta_de_otra_empresa` (campo ' +
            '`cuenta_bancaria_id`) si la cuenta es de otra empresa que la del servicio; 409 `referencia_duplicada`. ' +
            `${SOBRE_LA_IDENTIFICACION} ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        idempotente: true,
        permiso: null,
        cuerpo: subirComprobanteValidator,
        multipart: {
            archivos: {
                archivo:
                    'Foto (JPG, PNG o WebP) o PDF del comprobante, hasta 5 MB; el tipo se decide por el contenido',
            },
        },
        respuesta: { status: 201, descripcion: 'Comprobante recibido', esquema: PortalComprobante },
        handler: async (ctx, { cuerpo }) => {
            const ip = await ipDelCliente(ctx, 'comprobantes')
            const titular = await titularDeLaPeticion(ctx, ip, cuerpo.servicio_id)
            const archivo = await archivoDeLaPeticion(ctx)
            try {
                // Actor sistema aun con la sesión: `RegistrarComprobante` guarda `actor.id` en
                // `registrado_por` (core.usuarios). Pasa a `contextoDelTitular` cuando A3 use `usuarioDelActor`.
                const comprobante = await new RegistrarComprobante().execute(
                    {
                        cliente_id: titular.clienteId,
                        servicio_id: titular.servicioId,
                        metodo: cuerpo.metodo,
                        cuenta_bancaria_id: cuerpo.cuenta_bancaria_id,
                        banco_origen_id: cuerpo.banco_origen_id ?? null,
                        referencia: cuerpo.referencia,
                        monto: cuerpo.monto,
                        fecha_deposito: cuerpo.fecha_deposito,
                        nota: cuerpo.nota ?? null,
                        canal: 'portal',
                        archivo,
                    },
                    ctx.contextoAccion('portal'),
                )
                return comprobanteParaCliente(comprobante)
            } catch (error) {
                throw errorComprobanteParaCliente(error)
            }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/comprobantes',
        operacion: 'portalComprobantes',
        resumen: 'Comprobantes de depósito del cliente de la sesión, con su estado (solo lectura)',
        descripcion: `${SOBRE_LA_SESION} Incluye el motivo cuando se rechazó.`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        query: paginaPortalValidator,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Página de comprobantes', esquema: pagina(PortalComprobante) },
        handler: async (ctx, { query }) =>
            comprobantesPortal(await clienteDeLaSesionLimitada(ctx, 'comprobantes-lista'), query),
    }),
]

/** Nodos portal remotos (contrato `nodo-portal.md`): tokens del portal que corre en otro servidor. */
const nodosPortal: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/nodos-portal',
        operacion: 'nodosPortalCrear',
        resumen: 'Dar de alta un nodo portal remoto (el token se muestra una sola vez)',
        descripcion:
            'El token `argn_…` va en `X-Argos-Nodo-Token`. Solo sirve en `/api/v1/portal/**` y ' +
            '`GET /version`; con él la API toma la IP del cliente de `X-Argos-Cliente-Ip`. Mismas acciones ' +
            'que `POST /internal/nodos-portal` (CLI). 409 `nodo_portal_existe` si el nombre ya se usó.',
        etiqueta: 'portal',
        permiso: 'nodos_portal.administrar',
        cuerpo: crearNodoPortalValidator,
        respuesta: { status: 201, descripcion: 'Nodo creado', esquema: NodoPortalCreado },
        handler: (ctx, { cuerpo }) => new CrearNodoPortal().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/nodos-portal',
        operacion: 'nodosPortalListar',
        resumen: 'Listar nodos portal remotos',
        etiqueta: 'portal',
        permiso: 'nodos_portal.administrar',
        query: paginaPortalValidator,
        respuesta: { status: 200, descripcion: 'Página de nodos', esquema: pagina(NodoPortal) },
        handler: (_ctx, { query }) => listarNodosPortal(query),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/nodos-portal/:id/revocar',
        operacion: 'nodosPortalRevocar',
        resumen: 'Revocar el token de un nodo portal (401 desde su siguiente petición)',
        etiqueta: 'portal',
        permiso: 'nodos_portal.administrar',
        respuesta: { status: 200, descripcion: 'Nodo revocado', esquema: NodoPortal },
        handler: (ctx, { params }) =>
            new RevocarNodoPortal().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
]

/**
 * Las mismas acciones para el CLI (`argosisp nodo-portal crear|listar|revocar`), que corre dentro
 * del contenedor de la API con `INTERNAL_TOKEN`. Actor `sistema`, canal `interno`.
 */
const SOBRE_EL_CLI =
    'Token interno (`INTERNAL_TOKEN`); lo usa `argosisp nodo-portal`. Contrato `nodo-portal.md` §4.'
const nodosPortalInternos: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/internal/nodos-portal',
        operacion: 'internoNodosPortalCrear',
        resumen: 'Dar de alta un nodo portal desde el CLI (el token se muestra una sola vez)',
        descripcion: `${SOBRE_EL_CLI} 409 \`nodo_portal_existe\` si el nombre ya se usó.`,
        etiqueta: 'interno',
        seguridad: 'interno',
        permiso: null,
        cuerpo: crearNodoPortalValidator,
        respuesta: { status: 201, descripcion: 'Nodo creado', esquema: NodoPortalInternoCreado },
        handler: async (ctx, { cuerpo }) => {
            const { token, datos } = await new CrearNodoPortal().execute(
                cuerpo,
                ctx.contextoAccion('interno'),
            )
            return { nombre: datos.nombre, token, creado_en: datos.created_at }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/internal/nodos-portal',
        operacion: 'internoNodosPortalListar',
        resumen: 'Listar nodos portal (CLI)',
        descripcion: SOBRE_EL_CLI,
        etiqueta: 'interno',
        seguridad: 'interno',
        permiso: null,
        query: paginaPortalValidator,
        respuesta: { status: 200, descripcion: 'Página de nodos', esquema: pagina(NodoPortalInterno) },
        handler: async (_ctx, { query }) => {
            const resultado = await listarNodosPortal({ ...query, limit: query.limit ?? 200 })
            return { ...resultado, data: resultado.data.map(vistaInterna) }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/internal/nodos-portal/:nombre/revocar',
        operacion: 'internoNodosPortalRevocar',
        resumen: 'Revocar un nodo portal por nombre (CLI)',
        descripcion: SOBRE_EL_CLI,
        etiqueta: 'interno',
        seguridad: 'interno',
        permiso: null,
        parametros: { nombre: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,62}$' } },
        respuesta: { status: 200, descripcion: 'Nodo revocado', esquema: NodoPortalInternoRevocado },
        handler: async (ctx, { params }) => {
            const id = await idDeNodoPorNombre(String(params.nombre))
            const nodo = await new RevocarNodoPortal().execute({ id }, ctx.contextoAccion('interno'))
            return { nombre: nodo.nombre, revocado_en: nodo.revocado_en }
        },
    }),
]

const portal: Ruta[] = [
    ...publicas,
    ...autenticadas,
    ...telegram,
    ...promesas,
    ...comprobantes,
    ...pagosEnLinea,
    ...documentos,
    ...empresa,
    ...nodosPortal,
    ...nodosPortalInternos,
]

export default portal
