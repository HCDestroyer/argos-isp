import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import { rutaEntidad } from './bitacora'

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
export function formatearTamano(bytes: number | null | undefined): string {
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
