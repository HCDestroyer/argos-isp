import { SoporteNoDisponible } from '#portal/soporte/iris_portal'

/**
 * Lo que el portal devuelve de Iris (contrato 0.9.0 §11.3 y §11.7), campo por campo: solo lo que
 * el contrato dice que ve el cliente. Un campo que Iris agregue después no pasa al navegador hasta
 * que se agregue aquí (y al OpenAPI). Una respuesta sin la forma esperada es «soporte no
 * disponible», nunca datos a medias.
 */

export const ESTADOS_TICKET = ['nuevo', 'abierto', 'en_espera', 'resuelto', 'cerrado'] as const
export type EstadoTicket = (typeof ESTADOS_TICKET)[number]

export const TIPOS_SOLICITUD = ['alta', 'cambio_plan', 'traslado', 'otro'] as const
export type TipoSolicitud = (typeof TIPOS_SOLICITUD)[number]

export const ESTADOS_SOLICITUD = [
    'recibida',
    'en_revision',
    'cotizada',
    'en_proceso',
    'completada',
    'no_procede',
] as const
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number]

export interface CategoriaSoporte {
    id: number
    codigo: string
    nombre: string
}

export interface TicketSoporte {
    id: number
    numero: string
    /** null en la lista de una sesión `ip` (§11.2: sin asunto) */
    asunto: string | null
    estado: EstadoTicket
    categoria: CategoriaSoporte | null
    servicio_id: number | null
    origen: string | null
    afectado_por_incidente: boolean
    puede_confirmar: boolean
    resuelto_en: string | null
    cerrado_en: string | null
    version: number | null
    creado_en: string
    actualizado_en: string
}

export interface AdjuntoSoporte {
    id: string
    nombre: string
    mime: string
    tamano: number
}

export interface MensajeSoporte {
    id: number
    autor_tipo: 'cliente' | 'agente' | 'sistema'
    autor_nombre: string
    cuerpo: string
    adjuntos: AdjuntoSoporte[]
    creado_en: string
}

export interface SolicitudSoporte {
    id: number
    numero: string
    tipo: TipoSolicitud
    servicio_id: number | null
    estado_cliente: EstadoSolicitud
    comentario: string | null
    creado_en: string
    actualizado_en: string
}

type Obj = Record<string, unknown>

function obj(valor: unknown): Obj {
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new SoporteNoDisponible()
    return valor as Obj
}
function entero(valor: unknown): number {
    const n = Number(valor)
    if (!Number.isSafeInteger(n)) throw new SoporteNoDisponible()
    return n
}
function enteroONulo(valor: unknown): number | null {
    return valor === null || valor === undefined ? null : entero(valor)
}
function textoONulo(valor: unknown): string | null {
    return typeof valor === 'string' ? valor : null
}
function texto(valor: unknown): string {
    if (typeof valor !== 'string') throw new SoporteNoDisponible()
    return valor
}
function uno<T extends string>(valor: unknown, valores: readonly T[]): T {
    if (typeof valor !== 'string' || !(valores as readonly string[]).includes(valor)) {
        throw new SoporteNoDisponible()
    }
    return valor as T
}

export function categoriaSoporte(valor: unknown): CategoriaSoporte {
    const c = obj(valor)
    return { id: entero(c.id), codigo: texto(c.codigo), nombre: texto(c.nombre) }
}

export function ticketSoporte(valor: unknown): TicketSoporte {
    const t = obj(valor)
    return {
        id: entero(t.id),
        numero: texto(t.numero),
        asunto: textoONulo(t.asunto),
        estado: uno(t.estado, ESTADOS_TICKET),
        categoria: t.categoria === null || t.categoria === undefined ? null : categoriaSoporte(t.categoria),
        servicio_id: enteroONulo(t.servicio_id),
        origen: textoONulo(t.origen),
        afectado_por_incidente: t.afectado_por_incidente === true,
        puede_confirmar: t.puede_confirmar === true,
        resuelto_en: textoONulo(t.resuelto_en),
        cerrado_en: textoONulo(t.cerrado_en),
        version: enteroONulo(t.version),
        creado_en: texto(t.creado_en),
        actualizado_en: texto(t.actualizado_en),
    }
}

export function mensajeSoporte(valor: unknown): MensajeSoporte {
    const m = obj(valor)
    return {
        id: entero(m.id),
        autor_tipo: uno(m.autor_tipo, ['cliente', 'agente', 'sistema'] as const),
        autor_nombre: textoONulo(m.autor_nombre) ?? 'Soporte',
        cuerpo: texto(m.cuerpo),
        adjuntos: Array.isArray(m.adjuntos)
            ? m.adjuntos.map((a) => {
                  const x = obj(a)
                  return {
                      id: texto(x.id),
                      nombre: texto(x.nombre),
                      mime: texto(x.mime),
                      tamano: entero(x.tamano),
                  }
              })
            : [],
        creado_en: texto(m.creado_en),
    }
}

export function solicitudSoporte(valor: unknown): SolicitudSoporte {
    const s = obj(valor)
    return {
        id: entero(s.id),
        numero: texto(s.numero),
        tipo: uno(s.tipo, TIPOS_SOLICITUD),
        servicio_id: enteroONulo(s.servicio_id),
        estado_cliente: uno(s.estado_cliente, ESTADOS_SOLICITUD),
        comentario: textoONulo(s.comentario),
        creado_en: texto(s.creado_en),
        actualizado_en: texto(s.actualizado_en),
    }
}

export interface PaginaSoporte<T> {
    data: T[]
    nextCursor: string | null
}

export function paginaSoporte<T>(valor: unknown, item: (v: unknown) => T): PaginaSoporte<T> {
    const p = obj(valor)
    if (!Array.isArray(p.data)) throw new SoporteNoDisponible()
    return { data: p.data.map(item), nextCursor: textoONulo(p.nextCursor) }
}
