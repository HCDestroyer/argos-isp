import type { Problem, Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import * as z from 'zod'

type EventoRedApi = Schema<'EventoRed'>

/**
 * Pantalla "Migración de router" (piloto): lo que el operador vigila mientras un router pasa al
 * nuevo `aaa`. Los números salen de `GET /routers/:id/resumen-sesiones` y los fallos de
 * `GET /red/eventos` (A2); la fecha del cambio se guarda en la API (`marcar-migrado`).
 */

/** Estado de un dato de la pantalla: nunca se muestra el valor salvo en `ok`. */
export type LecturaMigracion<T>
    = | { estado: 'sin_permiso', permiso: string }
        | { estado: 'cargando' }
        | { estado: 'error', problema: Problem }
        | { estado: 'incompleta' }
        | { estado: 'ok', valor: T }

/** Páginas como máximo por lista (200 filas cada una). */
export const MAXIMO_PAGINAS = 25

/** Lee todas las páginas de una lista con cursor, hasta `maximo`. `completa: false` si quedaron más. */
export async function leerTodas<T>(
    pedir: (cursor?: string) => Promise<Resultado<Pagina<T>>>,
    maximo = MAXIMO_PAGINAS,
): Promise<Resultado<{ filas: T[], completa: boolean }>> {
    const filas: T[] = []
    let cursor: string | undefined
    for (let pagina = 0; pagina < maximo; pagina++) {
        const resultado = await pedir(cursor)
        if (!resultado.ok) {
            return resultado
        }
        filas.push(...resultado.data.data)
        if (!resultado.data.nextCursor) {
            return { ok: true, data: { filas, completa: true } }
        }
        cursor = resultado.data.nextCursor
    }
    return { ok: true, data: { filas, completa: false } }
}

/** `2026-10-16T08:30` en hora de Guatemala (UTC−6, sin horario de verano) → instante UTC, o `null`. */
export function instanteGuatemala(local: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) {
        return null
    }
    const fecha = new Date(`${local}:00-06:00`)
    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString()
}

/** Instante UTC → `2026-10-16T08:30` en hora de Guatemala (para un `datetime-local`). */
export function localGuatemala(instante: string): string {
    return new Date(new Date(instante).getTime() - 6 * 3_600_000).toISOString().slice(0, 16)
}

/** Espejo de `marcarMigradoValidator` (A2): motivo de 3 a 500; fecha opcional (vacía = ahora), no futura. */
export function esquemaMarcarMigrado(ahora: Date = new Date()) {
    return z.object({
        desde: z.string().refine(valor => valor === '' || instanteGuatemala(valor) !== null, 'Fecha y hora no válidas')
            .refine(valor => valor === '' || new Date(instanteGuatemala(valor) ?? 0).getTime() <= ahora.getTime(), 'No puede ser futura'),
        motivo: z.string().trim().min(3, 'Al menos 3 caracteres').max(500, 'Máximo 500 caracteres'),
    })
}

export type EntradaMarcarMigrado = z.input<ReturnType<typeof esquemaMarcarMigrado>>

export const TIPOS_EVENTO_RED: Record<EventoRedApi['tipo'], { etiqueta: string, icono: string }> = {
    coa: { etiqueta: 'CoA', icono: 'i-lucide-gauge' },
    disconnect: { etiqueta: 'Disconnect', icono: 'i-lucide-unplug' },
    routeros: { etiqueta: 'RouterOS', icono: 'i-lucide-router' },
}

export function colorEventoRed(evento: Pick<EventoRedApi, 'ok'>): NonNullable<BadgeProps['color']> {
    return evento.ok ? 'success' : 'error'
}

function texto(valor: unknown): string | null {
    if (typeof valor === 'string' && valor.trim()) {
        return valor.trim()
    }
    return typeof valor === 'number' ? String(valor) : null
}

/** Qué se mandó, en una línea: `PUT /ppp/secret · id *1A` o `disconnect · sesión 81A00001`. */
export function resumenComando(evento: Pick<EventoRedApi, 'tipo' | 'comando'>): string {
    const c = evento.comando
    if (evento.tipo === 'routeros') {
        const partes = [[texto(c.metodo), texto(c.ruta)].filter(Boolean).join(' '), texto(c.operacion), texto(c.id) ? `id ${texto(c.id)}` : null]
        return partes.filter(Boolean).join(' · ') || 'Comando a RouterOS'
    }
    const partes = [texto(c.evento) ?? texto(c.razon), texto(c.sesion_id) ? `sesión ${texto(c.sesion_id)}` : null, texto(c.intento) ? `intento ${texto(c.intento)}` : null]
    return partes.filter(Boolean).join(' · ') || TIPOS_EVENTO_RED[evento.tipo].etiqueta
}

/** Qué respondió el equipo: el error si falló; si no, el resultado o el status. */
export function resumenRespuesta(evento: Pick<EventoRedApi, 'respuesta' | 'ok'>): string {
    const r = evento.respuesta
    if (!r) {
        return evento.ok ? 'Sin respuesta registrada' : 'Sin respuesta del equipo'
    }
    const error = texto(r.error) ?? texto(r.tipo_error)
    const resultado = texto(r.resultado) ?? (texto(r.status) ? `HTTP ${texto(r.status)}` : null)
    const rtt = texto(r.rtt_ms) ? `${texto(r.rtt_ms)} ms` : null
    return [resultado, error, rtt].filter(Boolean).join(' · ') || (evento.ok ? 'Aceptado' : 'Falló')
}
