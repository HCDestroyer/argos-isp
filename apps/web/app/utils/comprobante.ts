import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import * as z from 'zod'
import { formatearFechaHora } from './formato'

type Comprobante = Schema<'Comprobante'>
type Estado = Comprobante['estado']

export const ESTADOS_COMPROBANTE: Record<Estado, { etiqueta: string, plural: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    pendiente: { etiqueta: 'Pendiente', plural: 'Pendientes', color: 'warning', icono: 'i-lucide-hourglass' },
    aprobado: { etiqueta: 'Aprobado', plural: 'Aprobados', color: 'success', icono: 'i-lucide-circle-check' },
    rechazado: { etiqueta: 'Rechazado', plural: 'Rechazados', color: 'neutral', icono: 'i-lucide-circle-x' },
}

export const CANALES_COMPROBANTE: Record<Comprobante['canal'], string> = {
    portal: 'Portal del cliente',
    panel: 'Panel',
    iris: 'Iris (chat o llamada)',
}

/** Quién lo aprobó o rechazó: su nombre (`verificado_por_nombre`), o `usuario #N` si no vino. */
export function revisadoPor(comprobante: Pick<Comprobante, 'verificado_por' | 'verificado_por_nombre'>): string | null {
    if (comprobante.verificado_por_nombre) {
        return comprobante.verificado_por_nombre
    }
    return comprobante.verificado_por ? `usuario #${comprobante.verificado_por}` : null
}

/** Texto de la revisión: `Revisado el 16/10/2026 10:30 por Ana Administradora`. */
export function textoRevision(comprobante: Pick<Comprobante, 'verificado_en' | 'verificado_por' | 'verificado_por_nombre'>): string | null {
    if (!comprobante.verificado_en) {
        return null
    }
    const quien = revisadoPor(comprobante)
    return `Revisado el ${formatearFechaHora(comprobante.verificado_en)}${quien ? ` por ${quien}` : ''}`
}

export function esEstadoComprobante(valor: unknown): valor is Estado {
    return typeof valor === 'string' && valor in ESTADOS_COMPROBANTE
}

/** El archivo se ve como imagen (`<img>`) o como PDF (`<iframe>`). */
export function esPdf(comprobante: Pick<Comprobante, 'archivo_tipo'>): boolean {
    return comprobante.archivo_tipo === 'application/pdf'
}

/** `734` → `734 B`, `51200` → `50 KB`, `1572864` → `1.5 MB`. */
export function formatearTamano(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 409 `comprobante_revisado`: otra persona ya lo aprobó o rechazó; hay que recargar. */
export function esComprobanteRevisado(problema: { status: number, type: string }): boolean {
    return problema.status === 409 && problema.type.endsWith(':comprobante_revisado')
}

/** Espejo de `aprobarComprobanteValidator` (A3): nota opcional de hasta 400 caracteres. */
export const esquemaAprobarComprobante = z.object({
    nota: z.string().trim().max(400, 'Máximo 400 caracteres'),
})

export type EntradaAprobarComprobante = z.input<typeof esquemaAprobarComprobante>
export type SalidaAprobarComprobante = z.output<typeof esquemaAprobarComprobante>

/**
 * Facturas a las que irá el pago si no se elige ninguna: como `AprobarComprobante`, las pendientes
 * del servicio del comprobante (la más antigua primero); sin servicio, ninguna (la API aplica a la
 * más antigua del cliente).
 */
export function facturasPorDefectoComprobante(comprobante: Pick<Comprobante, 'servicio_id'>, pendientes: readonly Schema<'Factura'>[]): number[] {
    if (comprobante.servicio_id === null) {
        return []
    }
    return pendientes
        .filter(f => f.servicio_id === comprobante.servicio_id)
        .sort((a, b) => a.vence_en.localeCompare(b.vence_en) || a.periodo.localeCompare(b.periodo) || a.id - b.id)
        .map(f => f.id)
}

/*
|--------------------------------------------------------------------------
| Comprobantes que llegan por Iris (contrato Iris 0.6.0 §7.2)
|--------------------------------------------------------------------------
*/

export type CausaRechazo = NonNullable<Comprobante['causa_rechazo']>
type LeidoPor = NonNullable<Comprobante['leido_por']>
type CanalContacto = NonNullable<Comprobante['canal_contacto']>

/** Causas de `POST /comprobantes/:id/rechazar` (A3), en el orden del selector. */
export const CAUSAS_RECHAZO: Record<CausaRechazo, { etiqueta: string, descripcion: string }> = {
    no_aparece: { etiqueta: 'No aparece en el banco', descripcion: 'El depósito no está en el estado de cuenta.' },
    monto_distinto: { etiqueta: 'Monto distinto', descripcion: 'El banco muestra otro monto.' },
    ilegible: { etiqueta: 'No se puede leer', descripcion: 'La foto o el PDF no se distinguen.' },
    falta_dato: { etiqueta: 'Falta un dato', descripcion: 'El cliente lo vuelve a mandar completo; la referencia queda libre.' },
    duplicado: { etiqueta: 'Duplicado', descripcion: 'Ya se aplicó con otro comprobante.' },
    otro: { etiqueta: 'Otra causa', descripcion: 'Explícala en el motivo.' },
}

export const LEIDO_POR: Record<LeidoPor, string> = {
    ia: 'Leído por IA',
    persona: 'Leído por una persona',
    cliente_dictado: 'Dictado por el cliente',
}

export const CANALES_CONTACTO: Record<CanalContacto, { etiqueta: string, icono: string }> = {
    whatsapp: { etiqueta: 'WhatsApp', icono: 'i-lucide-message-circle' },
    telegram: { etiqueta: 'Telegram', icono: 'i-lucide-send' },
    correo: { etiqueta: 'Correo', icono: 'i-lucide-mail' },
    llamada: { etiqueta: 'Llamada', icono: 'i-lucide-phone' },
}

export function llegoPorIris(comprobante: Pick<Comprobante, 'canal'>): boolean {
    return comprobante.canal === 'iris'
}

/** `"0.92"` → `92 %`; vacío o fuera de 0–1, `null` (no se inventa una confianza). */
export function textoConfianza(confianza: string | null | undefined): string | null {
    if (confianza === null || confianza === undefined || confianza.trim() === '') {
        return null
    }
    const valor = Number(confianza)
    if (!Number.isFinite(valor) || valor < 0 || valor > 1) {
        return null
    }
    return `${Math.round(valor * 100)} %`
}

/** «Leído por IA · 92 % · WhatsApp»: la lectura de Iris en una línea, o `null` fuera de Iris. */
export function resumenLecturaIris(comprobante: Pick<Comprobante, 'canal' | 'leido_por' | 'confianza' | 'canal_contacto'>): string | null {
    if (!llegoPorIris(comprobante)) {
        return null
    }
    return [
        comprobante.leido_por ? LEIDO_POR[comprobante.leido_por] : null,
        textoConfianza(comprobante.confianza),
        comprobante.canal_contacto ? CANALES_CONTACTO[comprobante.canal_contacto].etiqueta : null,
    ].filter(Boolean).join(' · ') || 'Llegó por Iris'
}

/** Espejo de `rechazarComprobanteValidator` (A3): motivo 3–500 y causa (por defecto `otro`). */
export const esquemaRechazarComprobante = z.object({
    causa: z.enum(['no_aparece', 'monto_distinto', 'ilegible', 'falta_dato', 'duplicado', 'otro']),
    motivo: z.string().trim().min(3, 'Escribe el motivo (al menos 3 caracteres)').max(500, 'Máximo 500 caracteres'),
})

export type EntradaRechazarComprobante = z.input<typeof esquemaRechazarComprobante>
export type SalidaRechazarComprobante = z.output<typeof esquemaRechazarComprobante>

/** Etiqueta de la causa guardada (`causa_rechazo`), o `null` en los rechazados antes de 0.6.0. */
export function etiquetaCausaRechazo(causa: Comprobante['causa_rechazo'] | undefined): string | null {
    return causa ? CAUSAS_RECHAZO[causa].etiqueta : null
}
