/*
|--------------------------------------------------------------------------
| Rutas del portal del cliente (A5)
|--------------------------------------------------------------------------
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { lista, pagina } from '#shared/openapi/esquemas'
import {
    ArchivoPdf,
    Empresa,
    EmpresaPublica,
    EstadoPortal,
    PlantillaDocumento,
    PortalContacto,
    PortalCondicionesPromesa,
    PortalBanco,
    PortalComprobante,
    PortalCuenta,
    PortalFactura,
    PortalFacturaDetalle,
    PortalPago,
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
    editarContactoValidator,
    editarEmpresaValidator,
    editarPlantillaDocumentoValidator,
    paginaPortalValidator,
    vistaPreviaDocumentoValidator,
    solicitarCodigoValidator,
    solicitarPromesaValidator,
    subirComprobanteValidator,
    verificarCodigoValidator,
} from '#portal/validators'
import { ipOrigenDeLaPeticion } from '#portal/ip_origen'
import { DemasiadasPeticiones, limitarPorIp } from '#portal/limite_peticiones'
import {
    borrarCookieSesion,
    clienteDeLaSesion,
    exigirSesionPortal,
    ponerCookieSesion,
} from '#portal/acceso/sesion'
import { cuentaPortal, facturaPortal, facturasPortal, pagosPortal, promesasPortal } from '#portal/cuenta'
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
import {
    avisoCobroPdf,
    pdfDesdePlantilla,
    plantillaVigente,
    type DocumentoPdf,
} from '#portal/documentos/render'
import { VARIABLES_AVISO_COBRO, vistaDeEjemplo } from '#portal/documentos/variables'
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
import { exigirAlcance } from '#core/acl'
import { dimensionesDeFactura } from '#billing/facturas'

/** Responde un PDF en línea (se abre en el navegador; el usuario lo guarda si quiere). */
function enviarPdf(ctx: HttpContext, documento: DocumentoPdf): void {
    ctx.response.header('Content-Type', 'application/pdf')
    ctx.response.header('Content-Disposition', `inline; filename="${documento.nombreArchivo}"`)
    ctx.response.header('Cache-Control', 'private, no-store')
    ctx.response.send(documento.pdf)
}

const PARAMETRO_TIPO = { tipo: { type: 'string', enum: ['aviso_cobro'] } }

function tipoDocumento(valor: unknown): 'aviso_cobro' {
    if (valor !== 'aviso_cobro') throw new NoEncontrado(`No hay plantilla de documento "${String(valor)}"`)
    return valor
}

const SOBRE_LA_IP =
    'La IP de origen sale del socket, o de `X-Forwarded-For` (`PORTAL_CABECERA_IP`) solo si la conexión ' +
    'viene de un proxy listado en `PORTAL_PROXIES_CONFIABLES`. Límite por IP (IPv6: por /64): ' +
    '`PORTAL_LIMITE_PETICIONES` por `PORTAL_LIMITE_VENTANA_S` (30 por minuto por defecto, contador propio ' +
    'de cada endpoint); al pasarse responde 429 problem+json con `Retry-After`.'

const SOBRE_LA_SESION =
    'Requiere la sesión del portal: cookie httpOnly `argos_portal` que pone `POST /portal/verificar` ' +
    '(sin ella o vencida responde 401). Solo devuelve datos del cliente de la sesión.'

/** IP de origen ya resuelta y con el límite de peticiones aplicado. */
async function ipDelCliente(ctx: HttpContext, endpoint: string): Promise<string> {
    ctx.response.header('Cache-Control', 'no-store')
    const ip = ipOrigenDeLaPeticion(ctx)
    if (!ip) throw new Error('La conexión no trae una IP de origen válida')
    await limitarPorIp(ctx, endpoint, ip)
    return ip
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
            'Pone la cookie httpOnly `argos_portal` (SameSite=Lax, ruta /api/v1/portal). El token nunca ' +
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
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 204, descripcion: 'Sesión cerrada' },
        handler: async (ctx) => {
            const sesion = await exigirSesionPortal(ctx)
            await new CerrarSesionPortal().execute(
                { sesionId: sesion.id, clienteId: sesion.clienteId },
                ctx.contextoAccion('portal'),
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
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Cuenta del cliente', esquema: PortalCuenta },
        handler: async (ctx) => cuentaPortal(await clienteDeLaSesion(ctx)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/facturas',
        operacion: 'portalFacturas',
        resumen: 'Facturas (avisos de cobro) del cliente de la sesión',
        descripcion: SOBRE_LA_SESION,
        etiqueta: 'portal',
        seguridad: 'publico',
        permiso: null,
        query: paginaPortalValidator,
        respuesta: { status: 200, descripcion: 'Página de facturas', esquema: pagina(PortalFactura) },
        handler: async (ctx, { query }) => facturasPortal(await clienteDeLaSesion(ctx), query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/facturas/:id',
        operacion: 'portalFactura',
        resumen: 'Detalle de una factura del cliente de la sesión',
        descripcion: `${SOBRE_LA_SESION} Una factura de otro cliente responde 404.`,
        etiqueta: 'portal',
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Factura con líneas', esquema: PortalFacturaDetalle },
        handler: async (ctx, { params }) => facturaPortal(await clienteDeLaSesion(ctx), Number(params.id)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/pagos',
        operacion: 'portalPagos',
        resumen: 'Pagos del cliente de la sesión',
        descripcion: SOBRE_LA_SESION,
        etiqueta: 'portal',
        seguridad: 'publico',
        permiso: null,
        query: paginaPortalValidator,
        respuesta: { status: 200, descripcion: 'Página de pagos', esquema: pagina(PortalPago) },
        handler: async (ctx, { query }) => pagosPortal(await clienteDeLaSesion(ctx), query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/promesas',
        operacion: 'portalPromesas',
        resumen: 'Promesas de pago del cliente de la sesión (solo lectura)',
        descripcion: SOBRE_LA_SESION,
        etiqueta: 'portal',
        seguridad: 'publico',
        permiso: null,
        query: paginaPortalValidator,
        respuesta: { status: 200, descripcion: 'Página de promesas', esquema: pagina(PortalPromesa) },
        handler: async (ctx, { query }) => promesasPortal(await clienteDeLaSesion(ctx), query),
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
        seguridad: 'publico',
        permiso: null,
        versionada: true,
        cuerpo: editarContactoValidator,
        respuesta: { status: 200, descripcion: 'Contacto actualizado', esquema: PortalContacto },
        handler: async (ctx, { cuerpo }) => {
            const sesion = await exigirSesionPortal(ctx)
            return new EditarContactoPortal().execute(
                { ...cuerpo, clienteId: sesion.clienteId },
                ctx.contextoAccion('portal'),
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
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Estado de Telegram', esquema: PortalTelegram },
        handler: async (ctx) => estadoTelegram(await clienteDeLaSesion(ctx)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/telegram/vincular',
        operacion: 'portalVincularTelegram',
        resumen: 'Genera el código de un solo uso y el enlace al bot para vincular Telegram',
        descripcion:
            `${SOBRE_LA_SESION} Llama \`GenerarCodigoTelegram\` de A6 (\`notificaciones.telegram_codigo\`, canal ` +
            'portal): vence a los `TELEGRAM_CODIGO_VIGENCIA_S` y reemplaza el código pendiente anterior. 503 ' +
            `\`telegram_no_configurado\` sin bot. ${SOBRE_LA_IP} ${SOBRE_TELEGRAM}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        permiso: null,
        respuesta: { status: 201, descripcion: 'Enlace al bot', esquema: PortalVinculoTelegram },
        handler: async (ctx) => {
            await ipDelCliente(ctx, 'telegram-vincular')
            const sesion = await exigirSesionPortal(ctx)
            return new GenerarCodigoTelegram().execute(
                { cliente_id: sesion.clienteId },
                ctx.contextoAccion('portal'),
            )
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
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Estado de Telegram', esquema: PortalTelegram },
        handler: async (ctx) => {
            const sesion = await exigirSesionPortal(ctx)
            return new DesvincularTelegramPortal().execute(
                { clienteId: sesion.clienteId },
                ctx.contextoAccion('portal'),
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
        descripcion: `${SOBRE_LA_SESION} Una factura de otro cliente responde 404. Responde application/pdf.`,
        etiqueta: 'portal',
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'PDF', esquema: ArchivoPdf },
        handler: async (ctx, { params }) => {
            const clienteId = await clienteDeLaSesion(ctx)
            enviarPdf(ctx, await avisoCobroPdf(Number(params.id), { clienteId }))
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
        respuesta: { status: 200, descripcion: 'PDF', esquema: ArchivoPdf },
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
        handler: async (_ctx, { params }) => ({
            ...(await plantillaVigente(tipoDocumento(params.tipo))),
            variables: VARIABLES_AVISO_COBRO,
        }),
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
            const plantilla = await new EditarPlantillaDocumento().execute(
                { tipo: tipoDocumento(params.tipo), html: cuerpo.html, version: cuerpo.version },
                ctx.contextoAccion(),
            )
            return { ...plantilla, variables: VARIABLES_AVISO_COBRO }
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
        respuesta: { status: 200, descripcion: 'PDF', esquema: ArchivoPdf },
        handler: async (ctx, { cuerpo, params }) => {
            tipoDocumento(params.tipo)
            const pdf = await pdfDesdePlantilla(cuerpo.html, await vistaDeEjemplo())
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
            'Llama `promesas.crear` (`CrearPromesaPago` de A3) con canal `portal` y actor sistema: la promesa ' +
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
            const servicioId = await servicioDeLaPeticion(ctx, ip, cuerpo.servicio_id)
            try {
                const promesa = await new CrearPromesaPago().execute(
                    {
                        servicio_id: servicioId,
                        vence_en: venceAlFinalDelDia(cuerpo.vence_el),
                        monto: cuerpo.monto,
                        canal: 'portal',
                    },
                    ctx.contextoAccion('portal'),
                )
                return promesaParaCliente(promesa)
            } catch (error) {
                throw errorParaCliente(error)
            }
        },
    }),
]

const empresa: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/portal/empresa',
        operacion: 'portalEmpresa',
        resumen: 'Datos de contacto, instrucciones de pago y cuentas para depósito (página de corte)',
        descripcion: `Sin login: es información pública de la empresa. ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        permiso: null,
        respuesta: { status: 200, descripcion: 'Empresa', esquema: EmpresaPublica },
        handler: async (ctx) => {
            await ipDelCliente(ctx, 'empresa')
            const datos = await leerEmpresa()
            return { ...datos, cuentas_deposito: await fuenteCuentasDeposito().activas() }
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
            '**`multipart/form-data`**: los campos del cuerpo más el archivo `archivo` (foto JPG, PNG o WebP, o ' +
            'PDF, hasta 5 MB; el tipo se decide por el contenido). Llama `comprobantes.registrar` ' +
            '(`RegistrarComprobante` de A3) con canal `portal` y actor sistema: queda `pendiente` hasta que ' +
            'el panel lo revise; no cambia el estado del servicio. 422 por campo con el texto para el cliente ' +
            '(`archivo` con `rule` `required`, `tipo` o `tamano`); 409 `referencia_duplicada`. ' +
            `${SOBRE_LA_IDENTIFICACION} ${SOBRE_LA_IP}`,
        etiqueta: 'portal',
        seguridad: 'publico',
        limitada: true,
        idempotente: true,
        permiso: null,
        cuerpo: subirComprobanteValidator,
        respuesta: { status: 201, descripcion: 'Comprobante recibido', esquema: PortalComprobante },
        handler: async (ctx, { cuerpo }) => {
            const ip = await ipDelCliente(ctx, 'comprobantes')
            const titular = await titularDeLaPeticion(ctx, ip, cuerpo.servicio_id)
            const archivo = await archivoDeLaPeticion(ctx)
            try {
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
        seguridad: 'publico',
        permiso: null,
        query: paginaPortalValidator,
        respuesta: { status: 200, descripcion: 'Página de comprobantes', esquema: pagina(PortalComprobante) },
        handler: async (ctx, { query }) => comprobantesPortal(await clienteDeLaSesion(ctx), query),
    }),
]

const portal: Ruta[] = [
    ...publicas,
    ...autenticadas,
    ...telegram,
    ...promesas,
    ...comprobantes,
    ...documentos,
    ...empresa,
]

export default portal
