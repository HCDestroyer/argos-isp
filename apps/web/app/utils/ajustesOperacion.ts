import type { Schema } from '@argosisp/contracts'
import * as z from 'zod'

export type DefinicionAjuste = Schema<'AjustesOperacion'>['definiciones'][number]
export type ValorAjusteOperacion = boolean | number | string
export type ClaveAjusteOperacion
    = | 'retiro.orden_iris'
        | 'codigo_corte.vigencia_min'
        | 'auth.recuperar_contrasena'
        | 'ip_historial.retencion_dias'
        | 'caidas.activo'
        | 'caidas.umbral'
        | 'caidas.ventana_min'
        | 'falla_general.activo'
        | 'falla_general.modo'
        | 'falla_general.umbral'
        | 'falla_general.minimo_servicios'
        | 'falla_general.ventana_min'

/** Textos del tablero OperConfigRed para cada clave de `AJUSTES_OPERACION` (A1). */
export const TEXTOS_AJUSTES: Record<ClaveAjusteOperacion, { etiqueta: string, ayuda: string, unidad?: string }> = {
    'retiro.orden_iris': { etiqueta: 'Pedir a Iris la orden de retiro', ayuda: 'Y dejar el equipo en comodato «por recuperar». Al retirar se puede omitir si ya se entregó.' },
    'codigo_corte.vigencia_min': { etiqueta: 'El código que da el personal vale', ayuda: 'Desde la ficha del servicio · de 5 a 60 minutos', unidad: 'min' },
    'auth.recuperar_contrasena': { etiqueta: 'Recuperar la contraseña por correo', ayuda: 'Muestra «¿La olvidaste?» en el inicio de sesión y manda un enlace de un solo uso.' },
    'ip_historial.retencion_dias': { etiqueta: 'Buscar hasta', ayuda: 'Días hacia atrás en Red › Direcciones IP (30 a 3,650)', unidad: 'días' },
    'caidas.activo': { etiqueta: 'Avisar las caídas repetidas', ayuda: 'Alerta en Conectados › Caídas repetidas y un ticket en Iris, uno por servicio mientras siga abierto.' },
    'caidas.umbral': { etiqueta: 'Cuántas caídas', ayuda: 'De 2 a 50', unidad: 'caídas' },
    'caidas.ventana_min': { etiqueta: 'En cuánto tiempo', ayuda: 'De 5 a 1,440 minutos', unidad: 'min' },
    'falla_general.activo': { etiqueta: 'Detectar fallas generales', ayuda: 'Muchos servicios del mismo router, OLT, PON o zona caídos a la vez abren un incidente y un solo ticket en Iris.' },
    'falla_general.modo': { etiqueta: 'Cómo se mide', ayuda: 'Porcentaje de los servicios del alcance o una cantidad fija' },
    'falla_general.umbral': { etiqueta: 'Umbral', ayuda: 'Porcentaje de los servicios del router, OLT, PON o zona', unidad: '%' },
    'falla_general.minimo_servicios': { etiqueta: 'Mínimo de servicios', ayuda: 'Aunque el porcentaje se cumpla', unidad: 'serv.' },
    'falla_general.ventana_min': { etiqueta: 'En cuánto tiempo', ayuda: 'De 1 a 60 minutos', unidad: 'min' },
}

/**
 * Espejo de `validarAjuste` (A1): booleano, entero con sus límites u opción de la lista, según la
 * definición que devuelve la API. Con `falla_general.modo = porcentaje`, el umbral va de 1 a 100.
 */
export function esquemaAjustesOperacion(definiciones: readonly DefinicionAjuste[]): z.ZodType<Record<string, ValorAjusteOperacion>> {
    const forma: Record<string, z.ZodType<ValorAjusteOperacion>> = {}
    for (const def of definiciones) {
        if (def.tipo === 'booleano') {
            forma[def.clave] = z.boolean()
        }
        else if (def.tipo === 'entero') {
            const min = def.min ?? 0
            const max = def.max ?? Number.MAX_SAFE_INTEGER
            forma[def.clave] = z.number('Escribe un número').int('Solo números enteros').min(min, `De ${min} a ${max.toLocaleString('en-US')}`).max(max, `De ${min} a ${max.toLocaleString('en-US')}`)
        }
        else {
            forma[def.clave] = z.enum((def.opciones ?? []) as [string, ...string[]])
        }
    }
    return z.object(forma).superRefine((valores, ctx) => {
        if (valores['falla_general.modo'] === 'porcentaje' && typeof valores['falla_general.umbral'] === 'number' && valores['falla_general.umbral'] > 100) {
            ctx.addIssue({ code: 'custom', path: ['falla_general.umbral'], message: 'En porcentaje, de 1 a 100' })
        }
    })
}

/** Lo que cambió respecto de lo leído (solo eso se envía). */
export function cambiosAjustes(antes: Record<string, unknown>, despues: Record<string, ValorAjusteOperacion>): Record<string, ValorAjusteOperacion> {
    return Object.fromEntries(Object.entries(despues).filter(([clave, valor]) => antes[clave] !== valor))
}

/** Valor como el tipo de su definición (la API los da como `unknown`). */
export function valorAjuste(def: DefinicionAjuste, valor: unknown): ValorAjusteOperacion {
    if (def.tipo === 'booleano') {
        return valor === true
    }
    if (def.tipo === 'entero') {
        return typeof valor === 'number' ? valor : Number(valor ?? 0)
    }
    return typeof valor === 'string' ? valor : String(valor ?? '')
}

/** Servicios caídos que abren una falla general con estos ajustes, para un alcance de `total` servicios. */
export function umbralFallaGeneral(total: number, modo: string, umbral: number, minimo: number): number {
    const porUmbral = modo === 'porcentaje' ? Math.ceil((total * umbral) / 100) : umbral
    return Math.max(porUmbral, minimo)
}
