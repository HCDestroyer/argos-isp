import * as z from 'zod'

type Color = 'success' | 'error' | 'warning' | 'neutral' | 'info'
export interface Presentacion { etiqueta: string, color: Color, icono: string }

/**
 * SmartOLT con varias instancias (tableros `PendSmartolt*`): estados con icono, texto y color, el
 * subdominio de una URL y el esquema del formulario (espejo de `crearInstanciaSmartOltValidator` y
 * `editarInstanciaSmartOltValidator`).
 */

/** Probada, Falla o Sin probar (la prueba guardada); «Apagada» va aparte. */
export function estadoInstancia(instancia: Pick<InstanciaSmartOlt, 'prueba_ok'>): Presentacion {
    if (instancia.prueba_ok === true) {
        return { etiqueta: 'Probada', color: 'success', icono: 'i-lucide-check' }
    }
    if (instancia.prueba_ok === false) {
        return { etiqueta: 'Falla', color: 'error', icono: 'i-lucide-triangle-alert' }
    }
    return { etiqueta: 'Sin probar', color: 'neutral', icono: 'i-lucide-clock' }
}

/** Fila de la lista de integraciones: «2 de 4 operativas», la única o «Sin instancias». */
export function resumenSmartOlt(instancias: InstanciaSmartOlt[]): Presentacion {
    if (!instancias.length) {
        return { etiqueta: 'Sin instancias', color: 'neutral', icono: 'i-lucide-plug' }
    }
    const operativas = instancias.filter(i => i.operativa).length
    if (instancias.length === 1) {
        const una = instancias[0]!
        return una.activo ? estadoInstancia(una) : { etiqueta: 'Apagada', color: 'neutral', icono: 'i-lucide-power' }
    }
    return {
        etiqueta: `${operativas} de ${instancias.length} operativas`,
        color: operativas === instancias.length ? 'success' : 'warning',
        icono: operativas === instancias.length ? 'i-lucide-check' : 'i-lucide-triangle-alert',
    }
}

/** `https://zonanorte.smartolt.com` → `zonanorte.smartolt.com` (lo que se muestra). */
export function hostDe(url: string): string {
    try {
        return new URL(url).host
    }
    catch {
        return url
    }
}

/** `https://zonanorte.smartolt.com` → `zonanorte` (lo que se edita); otra URL (laboratorio) tal cual. */
export function subdominioDe(url: string): string {
    const host = hostDe(url)
    return host.endsWith('.smartolt.com') ? host.slice(0, -'.smartolt.com'.length) : url
}

/** Lo que escribió la persona → la URL de la API: un subdominio solo, o una URL completa (laboratorio). */
export function urlDeSubdominio(valor: string): string {
    const limpio = valor.trim()
    return /^https?:\/\//.test(limpio) ? limpio : `https://${limpio.replace(/\.smartolt\.com$/i, '')}.smartolt.com`
}

export const esquemaInstancia = z.object({
    nombre: z.string().trim().min(1, 'Ponle un nombre').max(100, 'Máximo 100 caracteres'),
    subdominio: z.string().trim().min(1, 'Escribe el subdominio').max(500, 'Máximo 500 caracteres')
        .refine(v => /^https?:\/\//.test(v) || /^[a-z0-9-]+(\.smartolt\.com)?$/i.test(v), 'Solo la parte antes de «.smartolt.com»: letras, números y guiones'),
    compartida: z.boolean(),
    empresa_id: z.number().int().positive().nullable(),
    nota: z.string().trim().max(1000, 'Máximo 1000 caracteres'),
    activo: z.boolean(),
})

export type EntradaInstancia = z.input<typeof esquemaInstancia>
export type SalidaInstancia = z.output<typeof esquemaInstancia>

/** Perfiles de una OLT: «4 perfiles», «1 perfil» o «Sin perfiles». */
export function textoPerfiles(n: number): string {
    return n === 0 ? 'Sin perfiles' : n === 1 ? '1 perfil' : `${n} perfiles`
}

export const esquemaPerfil = z.object({
    plan_id: z.number().int().positive().nullable(),
    authorization_preset_id: z.number('Escribe el preset').int('Solo números enteros').min(1, 'Desde 1'),
    pon_type: z.enum(['gpon', 'epon']),
})
