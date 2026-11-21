import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { definirRuta, type Ruta } from '#shared/rutas'
import { Problema, ValidacionFallida } from '#shared/errores'
import { lista, objeto, pagina } from '#shared/openapi/esquemas'
import { ipOrigenDelCliente } from '#portal/ip_origen'
import { limitarPorIp } from '#portal/limite_peticiones'
import { aTexto, dec } from '#ledger/dinero'
import {
    PortalACargo,
    PortalCategoriaSoporte,
    PortalContactoCliente,
    PortalMensajeTicket,
    PortalPlanInteres,
    PortalRespuestaTicket,
    PortalSoporte,
    PortalSolicitudServicio,
    PortalTicket,
} from '#portal/soporte/esquemas'
import {
    abrirTicketValidator,
    agregarContactoValidator,
    cambiarContactoValidator,
    confirmarSolucionValidator,
    empresaSoporteValidator,
    listarMensajesValidator,
    listarSolicitudesValidator,
    listarTicketsValidator,
    quitarContactoValidator,
    responderTicketValidator,
    solicitarServicioValidator,
} from '#portal/soporte/validators'
import { disponibilidadSoporte, llamarIris, llamarIrisJson } from '#portal/soporte/iris_portal'
import {
    empresaDeSoporte,
    empresasDeSoporte,
    exigirDocumento,
    exigirServicioDelCliente,
    servicioACargo,
    sesionSoporte,
    type SesionSoporte,
} from '#portal/soporte/sesion'
import { adjuntosDeLaPeticion } from '#portal/soporte/adjuntos'
import {
    categoriaSoporte,
    mensajeSoporte,
    paginaSoporte,
    solicitudSoporte,
    ticketSoporte,
} from '#portal/soporte/vistas'
import { aCargoPortal, contactoPortal, contactosPortal } from '#portal/contactos'
import AbrirTicketPortal from '#portal/actions/abrir_ticket'
import ResponderTicketPortal from '#portal/actions/responder_ticket'
import ConfirmarSolucionPortal from '#portal/actions/confirmar_solucion'
import SolicitarServicioPortal from '#portal/actions/solicitar_servicio'
import AgregarContactoPortal from '#portal/actions/agregar_contacto'
import CambiarContactoPortal from '#portal/actions/cambiar_contacto'
import QuitarContactoPortal from '#portal/actions/quitar_contacto'
import { exigirSesionPortal } from '#portal/acceso/sesion'

/**
 * Rutas de soporte (tickets y solicitudes en Iris, contrato Iris 0.9.0 §11, A30 y A31), «Mis
 * contactos» (§3.5, A42) y «Está a cargo de» (§3.8, A46) del portal. Todas con la sesión del portal
 * (cookie `argos_portal`) y límite por IP como el resto de `/portal/*`.
 */

const SOBRE_SOPORTE =
    'Requiere la sesión del portal (401 sin ella). Argos llama a Iris servidor a servidor con su `token_portal`; ' +
    '`cliente_id` y `X-Iris-Empresa` salen de la sesión (la empresa pedida solo vale si es la de un servicio del ' +
    'cliente). Con Iris apagado, anterior a 0.9.0, sin token o sin respuesta: 503 `soporte_no_disponible`. Los ' +
    'errores de Iris salen con su código (§4.3) y un texto para el cliente; los 429 llevan `Retry-After`.'

const SOBRE_SESION_IP =
    'Con la sesión de «Ver mi cuenta» en /corte (`ip`) responde 403 `sesion_insuficiente`.'

const SOBRE_CLAVE =
    '`Idempotency-Key` obligatoria: un UUID que el portal genera por envío del formulario y repite en cada ' +
    'reintento (Argos lo manda a Iris como `argos:portal:<operacion>:<uuid>`); otro formato: 400.'

/** Límite por IP (cada endpoint su contador), igual que las demás rutas del portal. */
async function limitar(ctx: HttpContext, endpoint: string): Promise<void> {
    ctx.response.header('Cache-Control', 'no-store')
    const ip = await ipOrigenDelCliente(ctx)
    if (!ip) throw new Error('La conexión no trae una IP de origen válida')
    await limitarPorIp(ctx, endpoint, ip)
}

function limitarAntes(endpoint: string) {
    return (ctx: HttpContext) => limitar(ctx, endpoint)
}

/** Límite y `?estado=a,b` (que el parser de la consulta convierte en lista) otra vez con comas. */
function limitarYUnirEstados(endpoint: string) {
    return async (ctx: HttpContext) => {
        await limitar(ctx, endpoint)
        const qs = ctx.request.qs()
        if (Array.isArray(qs.estado)) ctx.request.updateQs({ ...qs, estado: qs.estado.join(',') })
    }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** El UUID del envío (`Idempotency-Key`), en minúsculas, o 400. */
function claveDelEnvio(ctx: HttpContext): string {
    const valor = ctx.request.header('idempotency-key')?.trim() ?? ''
    if (!UUID.test(valor)) {
        throw new Problema(
            400,
            'idempotency_key_invalida',
            'Idempotency-Key inválida',
            'Idempotency-Key debe ser un UUID generado por envío del formulario',
        )
    }
    return valor.toLowerCase()
}

async function contexto(ctx: HttpContext, endpoint: string): Promise<SesionSoporte> {
    await limitar(ctx, endpoint)
    return sesionSoporte(ctx)
}

function consulta(params: Record<string, string | number | undefined>): string {
    const q = new URLSearchParams()
    for (const [clave, valor] of Object.entries(params)) {
        if (valor !== undefined && valor !== '') q.set(clave, String(valor))
    }
    const texto = q.toString()
    return texto ? `?${texto}` : ''
}

const soporte: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/portal/soporte',
        operacion: 'portalSoporte',
        resumen: 'Si el cliente de la sesión puede usar soporte (tickets y solicitudes en Iris)',
        descripcion:
            'Siempre 200 (con la sesión): `estado` dice si Iris está disponible (conector activo, contrato ≥ 0.9.0, ' +
            '`token_portal` y `capacidades.portal_argos`; se lee en cada consulta) y `capacidades` qué secciones mostrar. ' +
            '`sesion` dice si es `documento` o `ip` (§11.2).',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Disponibilidad', esquema: PortalSoporte },
        handler: async (ctx) => {
            const s = await contexto(ctx, 'soporte')
            const [disponibilidad, empresas] = await Promise.all([
                disponibilidadSoporte(),
                empresasDeSoporte(s),
            ])
            const textos: Record<string, string | null> = {
                disponible: null,
                sin_iris: null,
                apagado: 'El soporte en línea no está disponible ahora. Intenta de nuevo más tarde.',
                version: 'El soporte en línea aún no está disponible. Intenta de nuevo más tarde.',
                sin_token: 'El soporte en línea aún no está disponible. Intenta de nuevo más tarde.',
                sin_respuesta: 'No pudimos contactar al equipo de soporte. Intenta de nuevo en unos minutos.',
            }
            return {
                estado: disponibilidad.estado,
                detalle: textos[disponibilidad.estado] ?? null,
                capacidades: disponibilidad.capacidades,
                sesion: s.iris.metodo,
                empresas,
            }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/soporte/categorias',
        operacion: 'portalSoporteCategorias',
        resumen: 'Categorías que el cliente puede elegir al abrir un ticket',
        descripcion: SOBRE_SOPORTE,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        antes: limitarAntes('soporte_categorias'),
        query: empresaSoporteValidator,
        respuesta: {
            status: 200,
            descripcion: 'Categorías',
            esquema: objeto({ data: lista(PortalCategoriaSoporte) }),
        },
        handler: async (ctx, { query }) => {
            const s = await sesionSoporte(ctx)
            const empresaId = await empresaDeSoporte(s, query.empresa_id)
            const r = await llamarIrisJson<{ data?: unknown }>({
                metodo: 'GET',
                clienteId: s.clienteId,
                empresaId,
                sesion: s.iris,
                ruta: '/categorias',
            })
            if (!Array.isArray(r?.data)) return { data: [] }
            return { data: r.data.map(categoriaSoporte) }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/soporte/tickets',
        operacion: 'portalSoporteTickets',
        resumen: 'Tickets del cliente en la empresa, de cualquier origen, más recientes primero',
        descripcion: `${SOBRE_SOPORTE} Con sesión \`ip\`, la lista reducida (sin \`asunto\`).`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        antes: limitarYUnirEstados('soporte_tickets'),
        query: listarTicketsValidator,
        respuesta: { status: 200, descripcion: 'Página de tickets', esquema: pagina(PortalTicket) },
        handler: async (ctx, { query }) => {
            const s = await sesionSoporte(ctx)
            const empresaId = await empresaDeSoporte(s, query.empresa_id)
            const r = await llamarIrisJson<unknown>({
                metodo: 'GET',
                clienteId: s.clienteId,
                empresaId,
                sesion: s.iris,
                ruta: `/tickets${consulta({ estado: query.estado, cursor: query.cursor, limit: query.limit })}`,
            })
            const p = paginaSoporte(r, ticketSoporte)
            // §11.2: la sesión `ip` nunca ve el asunto, aunque Iris lo mandara
            if (s.iris.metodo === 'ip') p.data = p.data.map((t) => ({ ...t, asunto: null }))
            return p
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/soporte/tickets/:ticketId',
        operacion: 'portalSoporteTicket',
        resumen: 'Un ticket del cliente',
        descripcion: `${SOBRE_SOPORTE} ${SOBRE_SESION_IP} De otro cliente o que no existe: 404.`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        antes: limitarAntes('soporte_ticket'),
        query: empresaSoporteValidator,
        respuesta: { status: 200, descripcion: 'Ticket', esquema: PortalTicket },
        handler: async (ctx, { query, params }) => {
            const s = await sesionSoporte(ctx)
            exigirDocumento(s)
            const empresaId = await empresaDeSoporte(s, query.empresa_id)
            return ticketSoporte(
                await llamarIrisJson<unknown>({
                    metodo: 'GET',
                    clienteId: s.clienteId,
                    empresaId,
                    sesion: s.iris,
                    ruta: `/tickets/${Number(params.ticketId)}`,
                }),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/soporte/tickets/:ticketId/mensajes',
        operacion: 'portalSoporteMensajes',
        resumen: 'Mensajes públicos del ticket, más antiguos primero',
        descripcion: `${SOBRE_SOPORTE} ${SOBRE_SESION_IP} Nunca notas internas ni datos del personal.`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        antes: limitarAntes('soporte_mensajes'),
        query: listarMensajesValidator,
        respuesta: { status: 200, descripcion: 'Página de mensajes', esquema: pagina(PortalMensajeTicket) },
        handler: async (ctx, { query, params }) => {
            const s = await sesionSoporte(ctx)
            exigirDocumento(s)
            const empresaId = await empresaDeSoporte(s, query.empresa_id)
            const r = await llamarIrisJson<unknown>({
                metodo: 'GET',
                clienteId: s.clienteId,
                empresaId,
                sesion: s.iris,
                ruta: `/tickets/${Number(params.ticketId)}/mensajes${consulta({ cursor: query.cursor, limit: query.limit })}`,
            })
            return paginaSoporte(r, mensajeSoporte)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/soporte/tickets/:ticketId/adjuntos/:adjunto',
        operacion: 'portalSoporteAdjunto',
        resumen: 'Descarga un adjunto de un mensaje público del ticket',
        descripcion:
            `${SOBRE_SOPORTE} ${SOBRE_SESION_IP} Se sirve desde Argos con las cabeceras de §11.6: ` +
            '`Content-Disposition: attachment` (nombre saneado), `X-Content-Type-Options: nosniff` y ' +
            '`Content-Security-Policy: sandbox`; un PDF nunca se muestra embebido.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        antes: limitarAntes('soporte_adjunto'),
        query: empresaSoporteValidator,
        parametros: { adjunto: { type: 'string', pattern: '^[A-Za-z0-9-]{1,64}$' } },
        respuesta: { status: 200, descripcion: 'Archivo', contenido: 'application/octet-stream' },
        handler: async (ctx, { query, params }) => {
            const s = await sesionSoporte(ctx)
            exigirDocumento(s)
            const adjunto = String(params.adjunto)
            if (!/^[A-Za-z0-9-]{1,64}$/.test(adjunto)) {
                throw new ValidacionFallida([
                    { field: 'adjunto', rule: 'formato', message: 'Adjunto inválido' },
                ])
            }
            const empresaId = await empresaDeSoporte(s, query.empresa_id)
            const respuesta = await llamarIris({
                metodo: 'GET',
                clienteId: s.clienteId,
                empresaId,
                sesion: s.iris,
                ruta: `/tickets/${Number(params.ticketId)}/adjuntos/${adjunto}`,
            })
            const tipo = respuesta.headers.get('content-type') ?? 'application/octet-stream'
            const disposicion = respuesta.headers.get('content-disposition')
            ctx.response.header('Content-Type', tipo)
            ctx.response.header(
                'Content-Disposition',
                disposicion?.startsWith('attachment') ? disposicion : 'attachment; filename="adjunto"',
            )
            ctx.response.header('X-Content-Type-Options', 'nosniff')
            ctx.response.header('Content-Security-Policy', 'sandbox')
            ctx.response.header('Cache-Control', 'private, no-store')
            ctx.response.send(Buffer.from(await respuesta.arrayBuffer()))
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/soporte/tickets',
        operacion: 'portalSoporteAbrirTicket',
        resumen: 'El cliente abre un ticket de soporte en Iris',
        descripcion:
            `${SOBRE_SOPORTE} ${SOBRE_CLAVE} \`multipart/form-data\`: los campos y hasta 3 \`archivos\` (JPEG, PNG, ` +
            'WebP, HEIC o PDF por el contenido, 10 MB cada uno; 413 `tamano_excedido`, 422 `mime_no_permitido` o ' +
            '`demasiados_adjuntos`). Con sesión `ip`, sin adjuntos (422 `adjuntos_no_permitidos`) y solo con el ' +
            'servicio de la sesión. Acción `portal.abrir_ticket` (actor cliente, canal portal). Con `contacto_id` ' +
            '(A46) reporta la falla de un servicio que tiene a cargo: exige sesión `documento`, `servicio_id` y el ' +
            'permiso `reportar` (403 `permiso_de_contacto`; 404 si no está a su cargo).',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        idempotente: 'obligatoria',
        antes: limitarAntes('soporte_abrir'),
        cuerpo: abrirTicketValidator,
        multipart: { archivos: { archivos: 'Hasta 3 fotos o PDF' }, archivosOpcionales: ['archivos'] },
        respuesta: { status: 201, descripcion: 'Ticket abierto', esquema: PortalTicket },
        handler: async (ctx, { cuerpo }) => {
            const clave = claveDelEnvio(ctx)
            const s = await sesionSoporte(ctx)
            let clienteId = s.clienteId
            let empresaId: number
            let contactoId: number | null = null
            if (cuerpo.contacto_id !== undefined) {
                exigirDocumento(s)
                if (cuerpo.servicio_id === undefined) {
                    throw new ValidacionFallida([
                        {
                            field: 'servicio_id',
                            rule: 'required',
                            message: 'Elige el servicio que tienes a cargo',
                        },
                    ])
                }
                const aCargo = await servicioACargo(
                    s.clienteId,
                    cuerpo.contacto_id,
                    cuerpo.servicio_id,
                    'reportar',
                )
                clienteId = aCargo.clienteId
                empresaId = aCargo.empresaId
                contactoId = aCargo.contacto.contacto_id
            } else {
                empresaId = await empresaDeSoporte(s, cuerpo.empresa_id)
                if (cuerpo.servicio_id !== undefined) {
                    await exigirServicioDelCliente(s, cuerpo.servicio_id, empresaId)
                }
            }
            const archivos = await adjuntosDeLaPeticion(ctx, s.iris.metodo === 'documento')
            return new AbrirTicketPortal().execute(
                {
                    clienteId,
                    contactoId,
                    empresaId,
                    sesion: s.iris,
                    clave,
                    asunto: cuerpo.asunto,
                    descripcion: cuerpo.descripcion,
                    categoria_id: cuerpo.categoria_id ?? null,
                    // con sesión `ip`, el servicio de la sesión aunque no lo elija
                    servicio_id: cuerpo.servicio_id ?? s.servicioDeLaSesion,
                    archivos,
                },
                ctx.contextoCliente(s.clienteId),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/soporte/tickets/:ticketId/responder',
        operacion: 'portalSoporteResponder',
        resumen: 'El cliente responde en su ticket (reanuda o reabre)',
        descripcion:
            `${SOBRE_SOPORTE} ${SOBRE_SESION_IP} ${SOBRE_CLAVE} \`multipart/form-data\` con \`cuerpo\`, \`version\` ` +
            'opcional y hasta 3 `archivos`. Cerrado: 422 `transicion_invalida`; versión vieja: 409 `conflicto_version`. ' +
            'Acción `portal.responder_ticket`.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        idempotente: 'obligatoria',
        antes: limitarAntes('soporte_responder'),
        cuerpo: responderTicketValidator,
        multipart: { archivos: { archivos: 'Hasta 3 fotos o PDF' }, archivosOpcionales: ['archivos'] },
        respuesta: { status: 200, descripcion: 'Ticket y mensaje', esquema: PortalRespuestaTicket },
        handler: async (ctx, { cuerpo, params }) => {
            const clave = claveDelEnvio(ctx)
            const s = await sesionSoporte(ctx)
            exigirDocumento(s)
            const empresaId = await empresaDeSoporte(s, cuerpo.empresa_id)
            const archivos = await adjuntosDeLaPeticion(ctx, true)
            return new ResponderTicketPortal().execute(
                {
                    clienteId: s.clienteId,
                    empresaId,
                    sesion: s.iris,
                    ticketId: Number(params.ticketId),
                    clave,
                    cuerpo: cuerpo.cuerpo,
                    version: cuerpo.version ?? null,
                    archivos,
                },
                ctx.contextoCliente(s.clienteId),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/soporte/tickets/:ticketId/confirmar-solucion',
        operacion: 'portalSoporteConfirmar',
        resumen: 'El cliente confirma que su ticket resuelto quedó bien (lo cierra)',
        descripcion:
            `${SOBRE_SOPORTE} ${SOBRE_SESION_IP} Solo \`resuelto\` → \`cerrado\` (si no, 422 \`transicion_invalida\`). ` +
            'Idempotente por `argos:portal:confirmar:<ticket_id>:<version>`. Acción `portal.confirmar_solucion`.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        antes: limitarAntes('soporte_confirmar'),
        cuerpo: confirmarSolucionValidator,
        respuesta: { status: 200, descripcion: 'Ticket cerrado', esquema: PortalTicket },
        handler: async (ctx, { cuerpo, params }) => {
            const s = await sesionSoporte(ctx)
            exigirDocumento(s)
            const empresaId = await empresaDeSoporte(s, cuerpo.empresa_id)
            return new ConfirmarSolucionPortal().execute(
                {
                    clienteId: s.clienteId,
                    empresaId,
                    sesion: s.iris,
                    ticketId: Number(params.ticketId),
                    version: cuerpo.version,
                },
                ctx.contextoCliente(s.clienteId),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/soporte/solicitudes',
        operacion: 'portalSoporteSolicitudes',
        resumen: 'Solicitudes de servicio del cliente («Mis solicitudes»)',
        descripcion: `${SOBRE_SOPORTE} ${SOBRE_SESION_IP} Solo \`estado_cliente\`; nunca vendedor, cotización ni motivos.`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        antes: limitarYUnirEstados('soporte_solicitudes'),
        query: listarSolicitudesValidator,
        respuesta: {
            status: 200,
            descripcion: 'Página de solicitudes',
            esquema: pagina(PortalSolicitudServicio),
        },
        handler: async (ctx, { query }) => {
            const s = await sesionSoporte(ctx)
            exigirDocumento(s)
            const empresaId = await empresaDeSoporte(s, query.empresa_id)
            const r = await llamarIrisJson<unknown>({
                metodo: 'GET',
                clienteId: s.clienteId,
                empresaId,
                sesion: s.iris,
                ruta: `/solicitudes${consulta({ estado: query.estado, cursor: query.cursor, limit: query.limit })}`,
            })
            return paginaSoporte(r, solicitudSoporte)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/soporte/solicitudes/:solicitudId',
        operacion: 'portalSoporteSolicitud',
        resumen: 'Una solicitud de servicio del cliente',
        descripcion: `${SOBRE_SOPORTE} ${SOBRE_SESION_IP}`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        antes: limitarAntes('soporte_solicitud'),
        query: empresaSoporteValidator,
        respuesta: { status: 200, descripcion: 'Solicitud', esquema: PortalSolicitudServicio },
        handler: async (ctx, { query, params }) => {
            const s = await sesionSoporte(ctx)
            exigirDocumento(s)
            const empresaId = await empresaDeSoporte(s, query.empresa_id)
            return solicitudSoporte(
                await llamarIrisJson<unknown>({
                    metodo: 'GET',
                    clienteId: s.clienteId,
                    empresaId,
                    sesion: s.iris,
                    ruta: `/solicitudes/${Number(params.solicitudId)}`,
                }),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/soporte/solicitudes',
        operacion: 'portalSoporteSolicitar',
        resumen: 'El cliente pide un servicio nuevo, un cambio de plan, un traslado u otra cosa',
        descripcion:
            `${SOBRE_SOPORTE} ${SOBRE_SESION_IP} ${SOBRE_CLAVE} Reglas de §11.7: \`servicio_id\` obligatorio en ` +
            '`cambio_plan` y `traslado` (422 `servicio_requerido`) y no va en `alta`; `direccion` obligatoria en `alta` ' +
            'y `traslado`. Una abierta del mismo tipo y servicio: 409 `solicitud_abierta` con `solicitud_id`. ' +
            'Acción `portal.solicitar_servicio`.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        idempotente: 'obligatoria',
        antes: limitarAntes('soporte_solicitar'),
        cuerpo: solicitarServicioValidator,
        respuesta: { status: 201, descripcion: 'Solicitud recibida', esquema: PortalSolicitudServicio },
        handler: async (ctx, { cuerpo }) => {
            const clave = claveDelEnvio(ctx)
            const s = await sesionSoporte(ctx)
            exigirDocumento(s)
            const empresaId = await empresaDeSoporte(s, cuerpo.empresa_id)
            const conServicio = cuerpo.tipo === 'cambio_plan' || cuerpo.tipo === 'traslado'
            if (conServicio && cuerpo.servicio_id === undefined) {
                throw new Problema(
                    422,
                    'servicio_requerido',
                    'Elige el servicio',
                    'Indica a qué servicio se refiere la solicitud.',
                    [{ field: 'servicio_id', rule: 'required', message: 'Elige el servicio' }],
                )
            }
            const errores = []
            if ((cuerpo.tipo === 'alta' || cuerpo.tipo === 'traslado') && !cuerpo.direccion) {
                errores.push({ field: 'direccion', rule: 'required', message: 'Escribe la dirección' })
            }
            if (cuerpo.tipo === 'alta' && cuerpo.servicio_id !== undefined) {
                errores.push({
                    field: 'servicio_id',
                    rule: 'prohibido',
                    message: 'Un servicio nuevo no lleva servicio',
                })
            }
            if (errores.length > 0) throw new ValidacionFallida(errores)
            if (cuerpo.servicio_id !== undefined) {
                await exigirServicioDelCliente(s, cuerpo.servicio_id, empresaId)
            }
            return new SolicitarServicioPortal().execute(
                {
                    clienteId: s.clienteId,
                    empresaId,
                    sesion: s.iris,
                    clave,
                    tipo: cuerpo.tipo,
                    servicio_id: cuerpo.servicio_id ?? null,
                    // en `cambio_plan` Iris toma la dirección del servicio
                    direccion: cuerpo.tipo === 'cambio_plan' ? null : (cuerpo.direccion ?? null),
                    coordenadas: cuerpo.coordenadas?.replace(/\s/g, '') ?? null,
                    plan_interes_id: cuerpo.plan_interes_id ?? null,
                    comentario: cuerpo.comentario ?? null,
                    telefono_contacto: cuerpo.telefono_contacto ?? null,
                },
                ctx.contextoCliente(s.clienteId),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/soporte/planes',
        operacion: 'portalSoportePlanes',
        resumen: 'Planes activos para «plan de interés» en una solicitud',
        descripcion:
            'Requiere la sesión del portal. Nombre, velocidades y precio; Iris valida el plan al recibirlo.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: {
            status: 200,
            descripcion: 'Planes',
            esquema: objeto({ data: lista(PortalPlanInteres) }),
        },
        handler: async (ctx) => {
            await contexto(ctx, 'soporte_planes')
            const filas = (await db
                .from('network.planes')
                .where('activo', true)
                .orderBy([
                    { column: 'precio', order: 'asc' },
                    { column: 'id', order: 'asc' },
                ])
                .select('id', 'nombre', 'bajada_kbps', 'subida_kbps', 'precio')) as Array<{
                id: number
                nombre: string
                bajada_kbps: number
                subida_kbps: number
                precio: string
            }>
            return {
                data: filas.map((f) => ({
                    id: Number(f.id),
                    nombre: f.nombre,
                    bajada_kbps: Number(f.bajada_kbps),
                    subida_kbps: Number(f.subida_kbps),
                    precio: aTexto(dec(f.precio)),
                })),
            }
        },
    }),
]

const SOBRE_CONTACTOS =
    'Requiere la sesión del portal con código o contraseña (con la de /corte, 403 `sesion_insuficiente`). ' +
    'Solo los contactos de la cuenta del cliente; el titular no se edita ni se quita aquí (404). Delega en ' +
    '`contactos.gestionar` de A1 (diff en audit.cambios, aviso al titular y `cliente.contactos_cambiados`).'

async function titularDocumento(ctx: HttpContext, endpoint: string): Promise<number> {
    const s = await contexto(ctx, endpoint)
    exigirDocumento(s)
    return s.clienteId
}

const contactos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/portal/contactos',
        operacion: 'portalContactos',
        resumen:
            '«Mis contactos»: quién más puede consultar, reportar, pagar o recibir avisos de tus servicios',
        descripcion: `${SOBRE_CONTACTOS} El titular primero.`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: {
            status: 200,
            descripcion: 'Contactos',
            esquema: objeto({ data: lista(PortalContactoCliente) }),
        },
        handler: async (ctx) => ({ data: await contactosPortal(await titularDocumento(ctx, 'contactos')) }),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/contactos',
        operacion: 'portalAgregarContacto',
        resumen: 'El titular agrega un contacto a su cuenta',
        descripcion:
            `${SOBRE_CONTACTOS} Permisos encendidos por defecto; números en E.164 con exactamente un principal (422 ` +
            'por posición, sin repetir el número). Acción `portal.agregar_contacto`.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        idempotente: true,
        antes: limitarAntes('contactos_agregar'),
        cuerpo: agregarContactoValidator,
        respuesta: { status: 201, descripcion: 'Contacto agregado', esquema: PortalContactoCliente },
        handler: async (ctx, { cuerpo }) => {
            const clienteId = await titularDocumento(ctx, 'contactos_agregar')
            const contacto = await new AgregarContactoPortal().execute(
                { ...cuerpo, clienteId },
                ctx.contextoCliente(clienteId),
            )
            return contactoPortal(contacto)
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/portal/contactos/:contactoId',
        operacion: 'portalCambiarContacto',
        resumen: 'El titular cambia un contacto de su cuenta',
        descripcion: `${SOBRE_CONTACTOS} Con \`version\` (409 si cambió). Acción \`portal.cambiar_contacto\`.`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        versionada: true,
        antes: limitarAntes('contactos_cambiar'),
        cuerpo: cambiarContactoValidator,
        respuesta: { status: 200, descripcion: 'Contacto actualizado', esquema: PortalContactoCliente },
        handler: async (ctx, { cuerpo, params }) => {
            const clienteId = await titularDocumento(ctx, 'contactos_cambiar')
            const contacto = await new CambiarContactoPortal().execute(
                { ...cuerpo, clienteId, contactoId: Number(params.contactoId) },
                ctx.contextoCliente(clienteId),
            )
            return contactoPortal(contacto)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/portal/contactos/:contactoId/quitar',
        operacion: 'portalQuitarContacto',
        resumen: 'El titular quita un contacto de su cuenta',
        descripcion: `${SOBRE_CONTACTOS} Con \`version\`. Rompe el vínculo de una persona a cargo (A46). Acción \`portal.quitar_contacto\`.`,
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        versionada: true,
        antes: limitarAntes('contactos_quitar'),
        cuerpo: quitarContactoValidator,
        respuesta: { status: 204, descripcion: 'Quitado' },
        handler: async (ctx, { cuerpo, params }) => {
            const clienteId = await titularDocumento(ctx, 'contactos_quitar')
            await new QuitarContactoPortal().execute(
                { clienteId, contactoId: Number(params.contactoId), version: cuerpo.version },
                ctx.contextoCliente(clienteId),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/a-cargo',
        operacion: 'portalACargo',
        resumen:
            '«Está a cargo de»: servicios de otros clientes que la persona de la sesión tiene a cargo (A46)',
        descripcion:
            'Requiere la sesión del portal con código o contraseña (con la de /corte, lista vacía). Por cada contacto ' +
            'que apunta a este cliente (`persona_cliente_id`): sus permisos y sus servicios con `codigo`, `nombre`, ' +
            'estado y, solo con `consultar`, lo que deben. Nunca el nombre ni el documento del dueño, sus otros ' +
            'servicios ni sus contactos.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: {
            status: 200,
            descripcion: 'Servicios a cargo',
            esquema: objeto({ data: lista(PortalACargo) }),
        },
        handler: async (ctx) => {
            await limitar(ctx, 'a_cargo')
            const sesion = await exigirSesionPortal(ctx)
            // la identificación por la IP de /corte nunca vale para lo de otro cliente
            if (sesion.origen === 'corte') return { data: [] }
            return { data: await aCargoPortal(sesion.clienteId) }
        },
    }),
]

export const rutasSoportePortal: Ruta[] = [...soporte, ...contactos]
