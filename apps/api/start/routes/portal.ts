/*
|--------------------------------------------------------------------------
| Rutas del portal del cliente (A5)
|--------------------------------------------------------------------------
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import { ValidacionFallida } from '#shared/errores'
import { pagina } from '#shared/openapi/esquemas'
import {
    EstadoPortal,
    PortalContacto,
    PortalCuenta,
    PortalFactura,
    PortalFacturaDetalle,
    PortalPago,
    PortalPromesa,
    PortalSesion,
    PortalSolicitudCodigo,
    QuienSoy,
} from '#portal/esquemas'
import {
    editarContactoValidator,
    paginaPortalValidator,
    solicitarCodigoValidator,
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

const portal: Ruta[] = [...publicas, ...autenticadas]

export default portal
