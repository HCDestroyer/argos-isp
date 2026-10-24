import * as z from 'zod'
import type { Schema } from '@argosisp/contracts'

type Tipo = Schema<'CampoPersonalizado'>['tipo']

/** Tipos de campo personalizado (A1) con su texto y el control que usa la ficha del cliente. */
export const TIPOS_CAMPO_PERSONALIZADO: Record<Tipo, { etiqueta: string, descripcion: string, icono: string }> = {
    texto: { etiqueta: 'Texto', descripcion: 'Hasta 500 caracteres.', icono: 'i-lucide-type' },
    numero: { etiqueta: 'Número', descripcion: 'Un número, con o sin decimales.', icono: 'i-lucide-hash' },
    fecha: { etiqueta: 'Fecha', descripcion: 'Día, mes y año.', icono: 'i-lucide-calendar' },
    booleano: { etiqueta: 'Sí o no', descripcion: 'Un interruptor.', icono: 'i-lucide-toggle-left' },
    opcion: { etiqueta: 'Lista de opciones', descripcion: 'Uno de los valores de la lista.', icono: 'i-lucide-list' },
}

export const OPCIONES_TIPO_CAMPO = (Object.keys(TIPOS_CAMPO_PERSONALIZADO) as Tipo[])
    .map(tipo => ({ label: TIPOS_CAMPO_PERSONALIZADO[tipo].etiqueta, value: tipo }))

/** Clave sugerida desde la etiqueta: minúsculas sin tildes, `_` entre palabras, hasta 40. */
export function claveDesdeEtiqueta(etiqueta: string): string {
    const base = etiqueta
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^[^a-z]+/, '')
        .replace(/_+$/, '')
    return base.slice(0, 40).replace(/_+$/, '')
}

/**
 * Espejo de los validadores de `POST` y `PUT /campos-personalizados` (A1): clave
 * `^[a-z][a-z0-9_]{0,39}$`, etiqueta 1–80, opciones solo con `opcion` (al menos una, sin vacías
 * ni repetidas, hasta 50 de 80 caracteres), orden 0–10000.
 */
export const esquemaCampoPersonalizado = z.object({
    clave: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Empieza con minúscula; solo minúsculas, números y guion bajo (hasta 40)'),
    etiqueta: z.string().trim().min(1, 'Escribe la etiqueta').max(80, 'Máximo 80 caracteres'),
    tipo: z.enum(['texto', 'numero', 'fecha', 'booleano', 'opcion']),
    opciones: z.array(z.string().trim().min(1).max(80, 'Cada opción, máximo 80 caracteres')).max(50, 'Máximo 50 opciones'),
    requerido: z.boolean(),
    orden: z.number({ message: 'Escribe el orden' }).int('Solo enteros').min(0, 'Desde 0').max(10000, 'Hasta 10000'),
}).superRefine((valor, ctx) => {
    if (valor.tipo === 'opcion' && valor.opciones.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['opciones'], message: 'Agrega al menos una opción' })
    }
    if (valor.tipo !== 'opcion' && valor.opciones.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['opciones'], message: 'Solo un campo de tipo lista lleva opciones' })
    }
    if (new Set(valor.opciones.map(o => o.trim())).size !== valor.opciones.length) {
        ctx.addIssue({ code: 'custom', path: ['opciones'], message: 'Hay opciones repetidas' })
    }
})

export type EstadoCampoPersonalizado = z.input<typeof esquemaCampoPersonalizado>
