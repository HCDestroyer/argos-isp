import * as z from 'zod'

/**
 * Textos y esquema del comparador de regímenes (A3, fase 8 PR B). Las cifras salen tal cual de la API;
 * aquí solo se nombran los bloques, los regímenes y los supuestos, y se valida el crecimiento como el
 * validador de la API (`^-?\d{1,3}(\.\d{1,2})?$`, mayor que −100).
 */

export type NombreBloqueComparador = keyof ComparadorEmpresa['bloques']

export const BLOQUES_COMPARADOR: Record<NombreBloqueComparador, { titulo: string, icono: string }> = {
    datos: { titulo: 'Datos del libro', icono: 'i-lucide-book-open' },
    opcional: { titulo: 'Régimen opcional simplificado', icono: 'i-lucide-percent' },
    utilidades: { titulo: 'Régimen sobre utilidades', icono: 'i-lucide-landmark' },
    iso_piso: { titulo: 'ISO como piso', icono: 'i-lucide-hand-heart' },
    comparacion: { titulo: 'Comparación anual', icono: 'i-lucide-scale' },
    proyeccion: { titulo: 'Proyección a 12 meses', icono: 'i-lucide-trending-up' },
}

/** Nombre de cada bloque para el motivo de un `bloque_dependiente`. */
export const ETIQUETAS_BLOQUES_COMPARADOR: Record<string, string> = {
    datos: 'los datos del libro',
    opcional: 'el régimen opcional',
    utilidades: 'el régimen sobre utilidades',
    iso_piso: 'el ISO como piso',
    comparacion: 'la comparación anual',
    proyeccion: 'la proyección',
}

export const SUPUESTOS_COMPARADOR: Record<string, string> = {
    isr_opcional_tramos: 'Escala del régimen opcional (art. 44)',
    isr_opcional_directo: 'ISR opcional plano sobre lo no retenido (art. 46)',
    isr_utilidades_tasa: 'Tasa del ISR sobre utilidades',
    iso_tasa: 'Tasa del ISO',
    iso_base: 'Base del ISO',
}

/** Valor de un supuesto en palabras: porcentajes, tramos de la escala o la regla. */
export function valorSupuesto(clave: string, valor: unknown): string {
    if (valor === null || valor === undefined) {
        return 'Sin valor vigente'
    }
    if (typeof valor === 'string') {
        return /tasa|directo/.test(clave) ? `${valor} %` : valor
    }
    if (typeof valor === 'object' && 'tramos' in valor && Array.isArray(valor.tramos)) {
        return valor.tramos
            .map((t: { desde?: string, hasta?: string | null, porcentaje?: string, fijo?: string }) => (t.hasta
                ? `${t.porcentaje} % hasta ${formatearQuetzales(t.hasta)}`
                : `${formatearQuetzales(t.fijo ?? '0')} + ${t.porcentaje} % desde ${formatearQuetzales(t.desde ?? '0')}`))
            .join('; ')
    }
    if (typeof valor === 'object' && 'regla' in valor && valor.regla === 'mayor_cuarto_activo_neto_o_cuarto_ingresos_brutos') {
        return 'La mayor entre ¼ del activo neto y ¼ de los ingresos brutos'
    }
    return JSON.stringify(valor)
}

export const REGIMEN_MENOR: Record<'opcional_simplificado' | 'utilidades' | 'iguales', string> = {
    opcional_simplificado: 'El régimen opcional simplificado pagaría menos',
    utilidades: 'El régimen sobre utilidades pagaría menos',
    iguales: 'Los dos regímenes pagarían lo mismo',
}

/** «AAAA-MM» → «oct 2025». */
export function mesComparador(mes: string): string {
    const [anio = 0, numero = 1] = mes.split('-').map(Number)
    const nombre = new Intl.DateTimeFormat('es-GT', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(anio, numero - 1, 1)))
    return `${nombre.replace('.', '')} ${anio}`
}

/** Espejo de `comparadorValidator`: vacío = la tendencia de los meses leídos. */
export const esquemaCrecimiento = z.object({
    crecimiento: z.string().trim()
        .refine(v => v === '' || /^-?\d{1,3}(\.\d{1,2})?$/.test(v), 'Por ciento mensual con hasta 2 decimales (p. ej. 1.50)')
        .refine(v => v === '' || Number(v) > -100, 'Debe ser mayor que −100 %'),
})

export type EstadoCrecimiento = z.infer<typeof esquemaCrecimiento>
