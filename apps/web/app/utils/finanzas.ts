import type { Schema } from '@argosisp/contracts'

/**
 * Piezas comunes de las pantallas de Finanzas (rediseño, tableros Conta*): tramos de antigüedad y
 * cifras redondeadas para los titulares.
 */

/** Tramo de antigüedad de `ContaAntiguedad`. */
export interface TramoAntiguedad {
    clave: string
    etiqueta: string
    monto: string
}

/** Pestaña de `ContaPestanas`. */
export interface PestanaConta {
    label: string
    value: string
    icon?: string
    /** Contador junto a la etiqueta (nunca inventado: sin dato, sin contador). */
    contador?: number | null
    /** Tono del contador: `error` para lo que pide atención (rechazados, borradores). */
    tono?: 'neutral' | 'error'
    to?: string
}

type FilaCartera = Schema<'ReporteCarteraVencida'>['filas'][number]

export const TRAMOS_ANTIGUEDAD = [
    { clave: 'por_vencer', etiqueta: 'Por vencer' },
    { clave: 'dias_0_30', etiqueta: '0–30 días' },
    { clave: 'dias_31_60', etiqueta: '31–60 días' },
    { clave: 'dias_61_90', etiqueta: '61–90 días' },
    { clave: 'dias_mas_90', etiqueta: 'Más de 90 días' },
] as const

/** Tramos de una fila (o los totales) del reporte de cartera vencida; sin «por vencer» si se pide. */
export function tramosCartera(fila: Pick<FilaCartera, 'por_vencer' | 'dias_0_30' | 'dias_31_60' | 'dias_61_90' | 'dias_mas_90'>, conPorVencer = true): TramoAntiguedad[] {
    return TRAMOS_ANTIGUEDAD
        .filter(t => conPorVencer || t.clave !== 'por_vencer')
        .map(t => ({ clave: t.clave, etiqueta: t.etiqueta, monto: fila[t.clave] }))
}

/** Miles de quetzales sin decimales («Q 231 mil»), para titulares de gráficas. */
export function milesQuetzales(monto: string | number): string {
    const miles = Math.round(Number(monto) / 1000)
    return `Q ${miles.toLocaleString('es-GT')} mil`
}

/** Porcentaje entero de `parte` sobre `total` (null si el total es cero: nunca un 0 % inventado). */
export function partePorcentual(parte: string | number, total: string | number): number | null {
    const t = Number(total)
    return t > 0 ? Math.round((Number(parte) / t) * 100) : null
}

/** Número de un asiento en su diario y año (`COB-2026-009341`), o `#id` si aún no tiene diario. */
export function numeroAsientoConta(asiento: { id: number, fecha: string, diario?: string | null, numero?: number | null }): string {
    if (asiento.diario && asiento.numero) {
        return `${asiento.diario}-${asiento.fecha.slice(0, 4)}-${String(asiento.numero).padStart(6, '0')}`
    }
    return asiento.diario ? `${asiento.diario} · #${asiento.id}` : `#${asiento.id}`
}

/** Primera letra en mayúscula («octubre 2026» → «Octubre 2026»). */
export function capitalizarConta(texto: string): string {
    return texto.charAt(0).toUpperCase() + texto.slice(1)
}
