import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import { rutaEntidad } from './bitacora'
import { formatearFechaHora, formatearHora } from './formato'
import { haceCuanto } from './horus'

type EstadoSalud = Schema<'ComponenteSalud'>['estado']
type NivelRegistro = Schema<'EntradaRegistro'>['nivel']
type OrigenRegistro = Schema<'EntradaRegistro'>['origen']

/** Estado de un componente de salud: color + icono + texto (nunca solo color). */
export const ESTADOS_SALUD: Record<EstadoSalud, { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    ok: { etiqueta: 'Bien', color: 'success', icono: 'i-lucide-circle-check' },
    degradado: { etiqueta: 'Revisar', color: 'warning', icono: 'i-lucide-triangle-alert' },
    caido: { etiqueta: 'Caído', color: 'error', icono: 'i-lucide-circle-x' },
    desconocido: { etiqueta: 'Sin datos', color: 'neutral', icono: 'i-lucide-circle-help' },
}

export const ESTADO_GENERAL: Record<Schema<'SaludSistema'>['estado_general'], { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    ok: { etiqueta: 'Todo bien', color: 'success', icono: 'i-lucide-circle-check' },
    degradado: { etiqueta: 'Hay algo que revisar', color: 'warning', icono: 'i-lucide-triangle-alert' },
    caido: { etiqueta: 'Servicio caído', color: 'error', icono: 'i-lucide-circle-x' },
}

export const NIVELES_REGISTRO: Record<NivelRegistro, { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    error: { etiqueta: 'Error', color: 'error', icono: 'i-lucide-circle-x' },
    advertencia: { etiqueta: 'Advertencia', color: 'warning', icono: 'i-lucide-triangle-alert' },
    info: { etiqueta: 'Información', color: 'info', icono: 'i-lucide-info' },
}

export const ORIGENES_REGISTRO: Record<OrigenRegistro, string> = {
    api: 'API',
    red: 'Red',
    radius: 'RADIUS',
    coa: 'CoA',
    colas: 'Colas',
    contabilidad: 'Contabilidad',
    almacenamiento: 'Almacenamiento',
}

export const GRUPOS_SALUD: Record<Schema<'ComponenteSalud'>['grupo'], string> = {
    nucleo: 'Servidor y base de datos',
    colas: 'Colas',
    eventos: 'Eventos',
    red: 'Red, RADIUS y CoA',
    procesos: 'Procesos automáticos y respaldos',
    host: 'Recursos del servidor',
}

/** 1536 → «1.5 KB»; null → «—». Base 1024, con un decimal desde KB. */
export function formatearTamanoSistema(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
        return '—'
    }
    const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
    let valor = Math.abs(bytes)
    let indice = 0
    while (valor >= 1024 && indice < unidades.length - 1) {
        valor /= 1024
        indice++
    }
    const texto = indice === 0 ? String(Math.round(valor)) : valor.toLocaleString('es-GT', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
    return `${bytes < 0 ? '−' : ''}${texto} ${unidades[indice]}`
}

/** Porcentaje 0–100 de una métrica numérica de un componente (CPU por núcleo, memoria, disco usado). */
export function porcentajeRecurso(componente: Schema<'ComponenteSalud'>): number | null {
    const m = componente.metricas
    const numero = (clave: string) => (typeof m[clave] === 'number' ? m[clave] as number : null)
    if (componente.id === 'host.cpu') {
        const carga = numero('carga_5')
        const nucleos = numero('nucleos')
        return carga !== null && nucleos ? Math.min(100, Math.round((carga / nucleos) * 100)) : null
    }
    if (componente.id === 'host.memoria') {
        return numero('porcentaje')
    }
    if (componente.id === 'host.disco') {
        const libre = numero('porcentaje_libre')
        return libre === null ? null : 100 - libre
    }
    return null
}

/** Ruta del panel para la entidad de una fila del registro (la misma de la bitácora), o `null`. */
export function rutaEntidadRegistro(entidad: Schema<'EntradaRegistro'>['entidad']): string | null {
    return entidad && /^\d+$/.test(entidad.id) ? rutaEntidad(entidad.tipo, Number(entidad.id)) : null
}

/*
 * Tareas programadas (`/sistema/tareas`, tablero `SistemaCrons.dc.html`).
 */
type EstadoTarea = Schema<'TareaProgramada'>['estado']
type EstadoCorrida = Schema<'CorridaCron'>['estado']

/** Estado de una tarea: icono + texto + color; `atencion` hace crecer su punto (atrasada o con error). */
export const ESTADOS_TAREA: Record<EstadoTarea, { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string, atencion: boolean }> = {
    ok: { etiqueta: 'Correcta', color: 'success', icono: 'i-lucide-circle-check', atencion: false },
    sin_cambios: { etiqueta: 'Sin cambios', color: 'neutral', icono: 'i-lucide-circle-minus', atencion: false },
    error: { etiqueta: 'Con error', color: 'error', icono: 'i-lucide-circle-x', atencion: true },
    atrasada: { etiqueta: 'Atrasada', color: 'warning', icono: 'i-lucide-alarm-clock', atencion: true },
    en_curso: { etiqueta: 'En curso', color: 'primary', icono: 'i-lucide-loader-circle', atencion: false },
    sin_datos: { etiqueta: 'Sin datos', color: 'neutral', icono: 'i-lucide-circle-help', atencion: false },
    apagada: { etiqueta: 'Apagada', color: 'neutral', icono: 'i-lucide-power-off', atencion: false },
}

export const ESTADOS_CORRIDA: Record<EstadoCorrida, { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    ok: { etiqueta: 'Correcta', color: 'success', icono: 'i-lucide-circle-check' },
    sin_cambios: { etiqueta: 'Sin cambios', color: 'neutral', icono: 'i-lucide-circle-minus' },
    error: { etiqueta: 'Con error', color: 'error', icono: 'i-lucide-circle-x' },
    en_curso: { etiqueta: 'En curso', color: 'primary', icono: 'i-lucide-loader-circle' },
    omitido: { etiqueta: 'No corrió', color: 'neutral', icono: 'i-lucide-skip-forward' },
}

/** Filtros por estado de la lista (los segmentos del tablero). */
export const FILTROS_TAREA = [
    { id: 'todas', etiqueta: 'Todas' },
    { id: 'error', etiqueta: 'Con error' },
    { id: 'atrasada', etiqueta: 'Atrasadas' },
    { id: 'en_curso', etiqueta: 'En curso' },
    { id: 'al_dia', etiqueta: 'Al día' },
    { id: 'apagada', etiqueta: 'Apagadas' },
] as const
export type FiltroTarea = (typeof FILTROS_TAREA)[number]['id']

export function tareaEnFiltro(estado: EstadoTarea, filtro: FiltroTarea): boolean {
    if (filtro === 'todas') {
        return true
    }
    if (filtro === 'al_dia') {
        return estado === 'ok' || estado === 'sin_cambios' || estado === 'sin_datos'
    }
    return estado === filtro
}

/** `1234` ms → `1.2 s`; `95000` → `1 min 35 s`. */
export function duracionLegible(ms: number | null): string {
    if (ms === null) {
        return '—'
    }
    if (ms < 1000) {
        return `${ms} ms`
    }
    const segundos = ms / 1000
    if (segundos < 60) {
        return `${segundos.toFixed(1)} s`
    }
    const minutos = Math.floor(segundos / 60)
    return `${minutos} min ${Math.round(segundos - minutos * 60)} s`
}

/** «en 40 s», «en 12 min», «10:05» (hora de Guatemala) o «debió 10:05» si ya pasó. */
export function proximaLegible(iso: string | null, ahora: number = Date.now()): string {
    if (!iso) {
        return '—'
    }
    const diferencia = new Date(iso).getTime() - ahora
    if (diferencia < -60_000) {
        return `debió ${formatearHora(iso)}`
    }
    if (diferencia < 60_000) {
        return diferencia <= 0 ? 'ahora' : `en ${Math.max(1, Math.round(diferencia / 1000))} s`
    }
    if (diferencia < 3_600_000) {
        return `en ${Math.round(diferencia / 60_000)} min`
    }
    return diferencia < 86_400_000 ? formatearHora(iso) : formatearFechaHora(iso)
}

/** Lo que se ve de la última corrida en una línea: «hace 3 min · 24 facturas emitidas». */
export function ultimaLegible(tarea: Schema<'TareaProgramada'>, ahora: number = Date.now()): string {
    if (tarea.en_curso) {
        return `desde ${formatearHora(tarea.en_curso.desde)} · en ${tarea.en_curso.instancia}`
    }
    const ultima = tarea.ultima
    if (!ultima) {
        return tarea.nota ?? 'Todavía no ha corrido'
    }
    const texto = ultima.error ?? ultima.resumen
    const repeticiones = ultima.repeticiones > 1 ? ` · ×${ultima.repeticiones}` : ''
    return `${haceCuanto(ultima.fin ?? ultima.inicio, ahora)}${texto ? ` · ${texto}` : ''}${repeticiones}`
}
