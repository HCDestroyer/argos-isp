/**
 * Soporte con Iris (contrato Iris 0.9.0 §11), «Mis contactos» (§3.5) y «Está a cargo de» (§3.8) en
 * el modo fixtures. Escenario `?soporte=disponible|apagado|sin_iris|ip` en desarrollo o
 * `fijarSoporteFixture` en pruebas. Por defecto `sin_iris` (una instalación sin Iris: la sección no
 * aparece), así las demás pantallas se ven como siempre. Los valores son los que devuelve la API.
 */
import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { MARCA_FIXTURE } from './empresa'

export type EscenarioSoporte = 'disponible' | 'apagado' | 'sin_iris' | 'ip'
const ESCENARIOS: readonly EscenarioSoporte[] = ['disponible', 'apagado', 'sin_iris', 'ip']

const estado: { escenario: EscenarioSoporte | null, tickets: Schema<'PortalTicket'>[], contactos: Schema<'PortalContactoCliente'>[] } = {
    escenario: null,
    tickets: [],
    contactos: [],
}

export const TICKETS_FIXTURE: Schema<'PortalTicket'>[] = [
    {
        id: 1042,
        numero: 'TK-001042',
        asunto: 'Internet lento en la noche',
        estado: 'abierto',
        categoria: { id: 4, codigo: 'lentitud', nombre: 'Lentitud' },
        servicio_id: 41,
        origen: 'portal_argos',
        afectado_por_incidente: false,
        puede_confirmar: false,
        resuelto_en: null,
        cerrado_en: null,
        version: 3,
        creado_en: '2026-11-21T14:03:11Z',
        actualizado_en: '2026-11-21T15:20:40Z',
    },
    {
        id: 998,
        numero: 'TK-000998',
        asunto: 'Cambio de contraseña del router',
        estado: 'resuelto',
        categoria: { id: 6, codigo: 'equipo', nombre: 'Equipo' },
        servicio_id: 41,
        origen: 'panel',
        afectado_por_incidente: false,
        puede_confirmar: true,
        resuelto_en: '2026-11-02T18:00:00Z',
        cerrado_en: null,
        version: 7,
        creado_en: '2026-11-02T13:00:00Z',
        actualizado_en: '2026-11-02T18:00:00Z',
    },
]

/**
 * Tickets del servicio a cargo (S-000412, §11.10): el que abrió la persona, completo; otro del
 * servicio que abrió el titular, sin asunto.
 */
export const TICKETS_A_CARGO_FIXTURE: Schema<'PortalTicket'>[] = [
    { ...TICKETS_FIXTURE[0]!, id: 2001, numero: 'TK-002001', asunto: 'Sin internet en casa de mamá', servicio_id: 88, estado: 'en_espera' },
    { ...TICKETS_FIXTURE[1]!, id: 2002, numero: 'TK-002002', asunto: null, servicio_id: 88, puede_confirmar: false, estado: 'cerrado' },
]

export const MENSAJES_FIXTURE: Schema<'PortalMensajeTicket'>[] = [
    {
        id: 51200,
        autor_tipo: 'cliente',
        autor_nombre: 'María José',
        cuerpo: 'Desde las 7 de la noche el internet va muy lento.',
        adjuntos: [],
        creado_en: '2026-11-21T14:03:11Z',
    },
    {
        id: 51230,
        autor_tipo: 'agente',
        autor_nombre: 'Ana',
        cuerpo: 'Revisamos tu señal: un técnico te llamará hoy.',
        adjuntos: [],
        creado_en: '2026-11-21T15:20:40Z',
    },
]

export const SOLICITUDES_FIXTURE: Schema<'PortalSolicitudServicio'>[] = [
    {
        id: 731,
        numero: 'PR-000731',
        tipo: 'cambio_plan',
        servicio_id: 41,
        estado_cliente: 'en_revision',
        comentario: 'Quiero 50 Mbps',
        creado_en: '2026-11-20T16:02:00Z',
        actualizado_en: '2026-11-21T09:40:12Z',
    },
]

export const CATEGORIAS_FIXTURE: Schema<'PortalCategoriaSoporte'>[] = [
    { id: 3, codigo: 'sin_servicio', nombre: 'Sin servicio' },
    { id: 4, codigo: 'lentitud', nombre: 'Lentitud' },
    { id: 6, codigo: 'equipo', nombre: 'Equipo' },
]

export const PLANES_FIXTURE: Schema<'PortalPlanInteres'>[] = [
    { id: 7, nombre: 'Hogar 20 Mbps', bajada_kbps: 20000, subida_kbps: 5000, precio: '150.00' },
    { id: 12, nombre: 'Hogar 50 Mbps', bajada_kbps: 50000, subida_kbps: 10000, precio: '250.00' },
]

const PERMISOS_TODOS = { consultar: true, reportar: true, pagar: true, avisos: true }

export const CONTACTOS_FIXTURE: Schema<'PortalContactoCliente'>[] = [
    {
        contacto_id: 500,
        nombre: 'María José García López',
        relacion: 'titular',
        es_titular: true,
        servicios: null,
        permisos: PERMISOS_TODOS,
        telefonos: [],
        vinculado: false,
        version: 1,
    },
    {
        contacto_id: 501,
        nombre: 'Luis Pérez',
        relacion: 'inquilino',
        es_titular: false,
        servicios: null,
        permisos: { ...PERMISOS_TODOS, pagar: false },
        telefonos: [{ numero: '+50255123344', whatsapp: true, principal: true }],
        vinculado: false,
        version: 2,
    },
    {
        contacto_id: 502,
        nombre: 'José García',
        relacion: 'familiar',
        es_titular: false,
        servicios: [41],
        permisos: PERMISOS_TODOS,
        telefonos: [{ numero: '+50244556677', whatsapp: true, principal: true }],
        vinculado: true,
        version: 1,
    },
]

export const A_CARGO_FIXTURE: Schema<'PortalACargo'>[] = [
    {
        contacto_id: 777,
        permisos: { ...PERMISOS_TODOS, avisos: false },
        servicios: [
            {
                id: 88,
                codigo: 'S-000412',
                nombre: 'Casa de mamá',
                estado: 'activo',
                empresa: MARCA_FIXTURE,
                monto_adeudado: '150.00',
            },
        ],
    },
]

/** Pruebas: escenario de soporte (null = el de la URL o `disponible`) y listas de fábrica. */
export function fijarSoporteFixture(escenario: EscenarioSoporte | null): void {
    estado.escenario = escenario
    estado.tickets = TICKETS_FIXTURE.map(t => ({ ...t }))
    estado.contactos = CONTACTOS_FIXTURE.map(c => ({ ...c }))
}
fijarSoporteFixture(null)

const CLAVE_ESCENARIO = 'argos:fixture:soporte'

function escenario(): EscenarioSoporte {
    if (estado.escenario) {
        return estado.escenario
    }
    if (typeof window === 'undefined') {
        return 'sin_iris'
    }
    // El escenario de la URL queda para toda la pestaña (la navegación del portal no lo repite).
    const pedido = new URL(window.location.href).searchParams.get('soporte')
    try {
        if (pedido) {
            sessionStorage.setItem(CLAVE_ESCENARIO, pedido)
        }
        const guardado = pedido ?? sessionStorage.getItem(CLAVE_ESCENARIO)
        return ESCENARIOS.find(e => e === guardado) ?? 'sin_iris'
    }
    catch {
        return ESCENARIOS.find(e => e === pedido) ?? 'sin_iris'
    }
}

// Al cargar el portal se guarda el escenario de la URL (p. ej. `/entrar?soporte=disponible`).
escenario()

function problema(status: number, codigo: string, title: string, detail: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title, status, detail }
    return { status, cuerpo }
}

const NO_DISPONIBLE = () => problema(503, 'soporte_no_disponible', 'Soporte no disponible', 'El soporte en línea no está disponible ahora. Intenta de nuevo más tarde.')
const SESION_INSUFICIENTE = () => problema(403, 'sesion_insuficiente', 'Entra a tu cuenta', 'Para esto entra con tu código o tu contraseña.')

/** Rutas del modo fixtures; `conSesion` es el envoltorio de `index.ts` (401 sin sesión). */
export function rutasSoporte(conSesion: (responder: (s: SolicitudFixture) => RespuestaFixture) => (s: SolicitudFixture) => RespuestaFixture): RutasFixture {
    const disponible = (responder: (s: SolicitudFixture) => RespuestaFixture, soloDocumento = false) => conSesion((s) => {
        const e = escenario()
        if (e === 'apagado' || e === 'sin_iris') {
            return NO_DISPONIBLE()
        }
        if (soloDocumento && e === 'ip') {
            return SESION_INSUFICIENTE()
        }
        return responder(s)
    })
    return {
        'GET /api/v1/portal/soporte': conSesion(() => {
            const e = escenario()
            const cuerpo: Schema<'PortalSoporte'> = {
                estado: e === 'ip' ? 'disponible' : e,
                detalle: e === 'apagado' ? 'El soporte en línea no está disponible ahora. Intenta de nuevo más tarde.' : null,
                capacidades: e === 'apagado' || e === 'sin_iris' ? null : { portal_argos: true, solicitudes_servicio: true, adjuntos_ticket: true },
                contactos: e === 'disponible',
                sesion: e === 'ip' ? 'ip' : 'documento',
                empresas: [1],
            }
            return { status: 200, cuerpo }
        }),
        'GET /api/v1/portal/soporte/categorias': disponible(() => ({ status: 200, cuerpo: { data: CATEGORIAS_FIXTURE } })),
        'GET /api/v1/portal/soporte/tickets': disponible(({ query }) => {
            if (query.get('contacto_id')) {
                return { status: 200, cuerpo: { data: TICKETS_A_CARGO_FIXTURE, nextCursor: null } }
            }
            const data = escenario() === 'ip' ? estado.tickets.map(t => ({ ...t, asunto: null })) : estado.tickets
            return { status: 200, cuerpo: { data, nextCursor: null } }
        }),
        'GET /api/v1/portal/soporte/tickets/:ticketId': disponible(({ params }) => {
            const ticket = [...estado.tickets, ...TICKETS_A_CARGO_FIXTURE].find(t => t.id === Number(params.ticketId))
            return ticket ? { status: 200, cuerpo: ticket } : problema(404, 'no_encontrado', 'No encontrado', 'No encontramos ese ticket en tu cuenta.')
        }, true),
        'GET /api/v1/portal/soporte/tickets/:ticketId/mensajes': disponible(() => ({ status: 200, cuerpo: { data: MENSAJES_FIXTURE, nextCursor: null } }), true),
        'POST /api/v1/portal/soporte/tickets': disponible(({ cuerpo }) => {
            const datos = (cuerpo ?? {}) as Record<string, unknown>
            const nuevo: Schema<'PortalTicket'> = {
                ...TICKETS_FIXTURE[0]!,
                id: 1100 + estado.tickets.length,
                numero: `TK-00${1100 + estado.tickets.length}`,
                asunto: String(datos.asunto ?? ''),
                estado: 'nuevo',
                version: 1,
            }
            estado.tickets = [nuevo, ...estado.tickets]
            return { status: 201, cuerpo: nuevo }
        }),
        'POST /api/v1/portal/soporte/tickets/:ticketId/responder': disponible(({ params, cuerpo }) => {
            const ticket = estado.tickets.find(t => t.id === Number(params.ticketId))!
            const actualizado = { ...ticket, estado: 'abierto' as const, puede_confirmar: false, version: (ticket.version ?? 1) + 1 }
            estado.tickets = estado.tickets.map(t => t.id === ticket.id ? actualizado : t)
            const mensaje: Schema<'PortalMensajeTicket'> = {
                id: 52000,
                autor_tipo: 'cliente',
                autor_nombre: 'María José',
                cuerpo: String((cuerpo as Record<string, unknown> | null)?.cuerpo ?? ''),
                adjuntos: [],
                creado_en: '2026-11-21T16:00:00Z',
            }
            return { status: 200, cuerpo: { ticket: actualizado, mensaje } }
        }, true),
        'POST /api/v1/portal/soporte/tickets/:ticketId/confirmar-solucion': disponible(({ params }) => {
            const ticket = estado.tickets.find(t => t.id === Number(params.ticketId))!
            if (ticket.estado !== 'resuelto') {
                return problema(422, 'transicion_invalida', 'No se puede hacer ahora', 'El ticket cambió de estado.')
            }
            const cerrado = { ...ticket, estado: 'cerrado' as const, puede_confirmar: false, cerrado_en: '2026-11-21T16:00:00Z', version: (ticket.version ?? 1) + 1 }
            estado.tickets = estado.tickets.map(t => t.id === ticket.id ? cerrado : t)
            return { status: 200, cuerpo: cerrado }
        }, true),
        'GET /api/v1/portal/soporte/solicitudes': disponible(() => ({ status: 200, cuerpo: { data: SOLICITUDES_FIXTURE, nextCursor: null } }), true),
        'POST /api/v1/portal/soporte/solicitudes': disponible(({ cuerpo }) => {
            const datos = (cuerpo ?? {}) as Record<string, unknown>
            const nueva: Schema<'PortalSolicitudServicio'> = {
                ...SOLICITUDES_FIXTURE[0]!,
                id: 732,
                numero: 'PR-000732',
                tipo: datos.tipo as Schema<'PortalSolicitudServicio'>['tipo'],
                servicio_id: typeof datos.servicio_id === 'number' ? datos.servicio_id : null,
                estado_cliente: 'recibida',
                comentario: typeof datos.comentario === 'string' ? datos.comentario : null,
            }
            return { status: 201, cuerpo: nueva }
        }, true),
        'GET /api/v1/portal/soporte/planes': conSesion(() => ({ status: 200, cuerpo: { data: PLANES_FIXTURE } })),
        'GET /api/v1/portal/contactos': conSesion(() => escenario() === 'ip' ? SESION_INSUFICIENTE() : { status: 200, cuerpo: { data: estado.contactos } }),
        'POST /api/v1/portal/contactos': conSesion(({ cuerpo }) => {
            const datos = cuerpo as Omit<Schema<'PortalContactoCliente'>, 'contacto_id' | 'es_titular' | 'vinculado' | 'version'>
            const nuevo: Schema<'PortalContactoCliente'> = {
                ...datos,
                servicios: datos.servicios ?? null,
                permisos: { ...PERMISOS_TODOS, ...datos.permisos },
                telefonos: datos.telefonos.map(t => ({ numero: t.numero, whatsapp: t.whatsapp, principal: t.principal })),
                contacto_id: 600 + estado.contactos.length,
                es_titular: false,
                vinculado: false,
                version: 1,
            }
            estado.contactos = [...estado.contactos, nuevo]
            return { status: 201, cuerpo: nuevo }
        }),
        'PUT /api/v1/portal/contactos/:contactoId': conSesion(({ params, cuerpo }) => {
            const actual = estado.contactos.find(c => c.contacto_id === Number(params.contactoId) && !c.es_titular)
            if (!actual) {
                return problema(404, 'no_encontrado', 'No encontrado', 'Ese contacto no es de tu cuenta')
            }
            const datos = cuerpo as Partial<Schema<'PortalContactoCliente'>>
            if (datos.version !== actual.version) {
                return problema(409, 'conflicto_version', 'Conflicto de versión', 'El contacto cambió; recarga e intenta de nuevo.')
            }
            const cambiado = { ...actual, ...datos, version: actual.version + 1 } as Schema<'PortalContactoCliente'>
            estado.contactos = estado.contactos.map(c => c.contacto_id === actual.contacto_id ? cambiado : c)
            return { status: 200, cuerpo: cambiado }
        }),
        'POST /api/v1/portal/contactos/:contactoId/quitar': conSesion(({ params }) => {
            estado.contactos = estado.contactos.filter(c => c.contacto_id !== Number(params.contactoId) || c.es_titular)
            return { status: 204 }
        }),
        'GET /api/v1/portal/a-cargo': conSesion(() => ({ status: 200, cuerpo: { data: escenario() === 'ip' ? [] : A_CARGO_FIXTURE } })),
    }
}

export { ESCENARIOS as ESCENARIOS_SOPORTE }
