import {
    Dinero,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    id,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { EstadoServicio } from '#core/esquemas'
import { PortalMarcaEmpresa } from '#portal/esquemas'
import { RELACIONES_CONTACTO } from '#core/contactos'
import { ESTADOS_SOLICITUD, ESTADOS_TICKET, TIPOS_SOLICITUD } from '#portal/soporte/vistas'

/** Esquemas OpenAPI de soporte, solicitudes, contactos y «a cargo» del portal. */

export const PortalCapacidadesSoporte = definirEsquema(
    'PortalCapacidadesSoporte',
    objeto({ portal_argos: booleano, solicitudes_servicio: booleano, adjuntos_ticket: booleano }),
)

export const PortalSoporte = definirEsquema(
    'PortalSoporte',
    objeto({
        estado: {
            ...enumerado(['disponible', 'sin_iris', 'apagado', 'version', 'sin_token', 'sin_respuesta']),
            description:
                '`disponible`; `sin_iris`: no hay conector (el portal no muestra Soporte); los demás: Soporte con el error y «Reintentar»',
        },
        detalle: { ...nulable(texto), description: 'Texto para el cliente cuando no está disponible' },
        capacidades: nulable(PortalCapacidadesSoporte),
        sesion: {
            ...enumerado(['documento', 'ip']),
            description:
                '`ip` («Ver mi cuenta» en /corte): solo abrir ticket sin adjuntos y ver la lista reducida',
        },
        empresas: { ...lista(id), description: 'Empresas en que puede pedir soporte (las de sus servicios)' },
    }),
)

export const PortalCategoriaSoporte = definirEsquema(
    'PortalCategoriaSoporte',
    objeto({ id, codigo: texto, nombre: texto }),
)

export const PortalTicket = definirEsquema(
    'PortalTicket',
    objeto({
        id,
        numero: texto,
        asunto: { ...nulable(texto), description: 'null en la lista de una sesión `ip`' },
        estado: enumerado(ESTADOS_TICKET),
        categoria: nulable(PortalCategoriaSoporte),
        servicio_id: nulable(id),
        origen: {
            ...nulable(texto),
            description: 'portal_argos, portal, panel, correo, telegram, horus, argos, api',
        },
        afectado_por_incidente: { ...booleano, description: 'Ligado a una falla general abierta' },
        puede_confirmar: { ...booleano, description: 'Resuelto: el cliente puede confirmar o responder' },
        resuelto_en: nulable(instante),
        cerrado_en: nulable(instante),
        version: { ...nulable(entero), description: 'Para responder y confirmar' },
        creado_en: instante,
        actualizado_en: instante,
    }),
)

export const PortalAdjuntoTicket = definirEsquema(
    'PortalAdjuntoTicket',
    objeto({ id: texto, nombre: texto, mime: texto, tamano: entero }),
)

export const PortalMensajeTicket = definirEsquema(
    'PortalMensajeTicket',
    objeto({
        id,
        autor_tipo: enumerado(['cliente', 'agente', 'sistema']),
        autor_nombre: { ...texto, description: 'Nombre de pila del agente o «Soporte»' },
        cuerpo: texto,
        adjuntos: lista(PortalAdjuntoTicket),
        creado_en: instante,
    }),
)

export const PortalRespuestaTicket = definirEsquema(
    'PortalRespuestaTicket',
    objeto({ ticket: PortalTicket, mensaje: PortalMensajeTicket }),
)

export const PortalSolicitudServicio = definirEsquema(
    'PortalSolicitudServicio',
    objeto({
        id,
        numero: texto,
        tipo: enumerado(TIPOS_SOLICITUD),
        servicio_id: nulable(id),
        estado_cliente: enumerado(ESTADOS_SOLICITUD),
        comentario: nulable(texto),
        creado_en: instante,
        actualizado_en: instante,
    }),
)

export const PortalPlanInteres = definirEsquema(
    'PortalPlanInteres',
    objeto({ id, nombre: texto, bajada_kbps: entero, subida_kbps: entero, precio: Dinero }),
)

const Permisos = objeto({ consultar: booleano, reportar: booleano, pagar: booleano, avisos: booleano })

export const PortalContactoCliente = definirEsquema(
    'PortalContactoCliente',
    objeto({
        contacto_id: id,
        nombre: texto,
        relacion: enumerado(RELACIONES_CONTACTO),
        es_titular: booleano,
        servicios: { ...nulable(lista(id)), description: 'Servicios a los que aplica; null = todos' },
        permisos: Permisos,
        telefonos: lista(objeto({ numero: texto, whatsapp: booleano, principal: booleano })),
        vinculado: {
            ...booleano,
            description: 'También es cliente y ve estos servicios desde su cuenta (A46)',
        },
        version: entero,
    }),
)

export const PortalServicioACargo = definirEsquema(
    'PortalServicioACargo',
    objeto({
        id,
        codigo: nulable(texto),
        nombre: nulable(texto),
        estado: EstadoServicio,
        empresa: PortalMarcaEmpresa,
        monto_adeudado: { ...nulable(Dinero), description: 'Solo con el permiso `consultar`' },
    }),
)

export const PortalACargo = definirEsquema(
    'PortalACargo',
    objeto({ contacto_id: id, permisos: Permisos, servicios: lista(PortalServicioACargo) }),
)
