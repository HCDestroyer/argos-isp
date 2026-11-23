import * as z from 'zod'

/**
 * Espejo de `editarAjustesCobroValidator` (A3, `billing/validators_cobro.ts`): aprobación de los
 * asientos manuales y tope de la pausa sin cobro de 1 a 365 días. La `version` la pone la pantalla.
 */
export const esquemaAjustesCobro = z.object({
    asientos_requieren_aprobacion: z.boolean(),
    pausa_tope_dias: z.number('Escribe los días').int('Solo números enteros').min(1, 'De 1 a 365 días').max(365, 'De 1 a 365 días'),
})

export type EntradaAjustesCobro = z.input<typeof esquemaAjustesCobro>
export type SalidaAjustesCobro = z.output<typeof esquemaAjustesCobro>

/** Formatos de impresión de una caja (decisión 20): `Caja.formato_recibo` y `formato_factura`. */
export const FORMATOS_IMPRESION_CAJA: { label: string, value: 'pos_80' | 'carta' }[] = [
    { label: 'Ticket 80 mm', value: 'pos_80' },
    { label: 'Hoja carta', value: 'carta' },
]

/** Espejo de `POST`/`PUT /bancos-origen` (A3): nombre de 2 a 100 caracteres y si sale en las listas. */
export const esquemaBancoOrigen = z.object({
    nombre: z.string().trim().min(2, 'De 2 a 100 caracteres').max(100, 'De 2 a 100 caracteres'),
    activo: z.boolean(),
})

export type DatosFormBancoOrigen = z.output<typeof esquemaBancoOrigen>

/** Espejo de `POST /reportes/correos-externos` (A3): correo de hasta 254 y nombre de 1 a 120. */
export const esquemaCorreoExterno = z.object({
    correo: z.email('Escribe un correo válido').trim().toLowerCase().max(254, 'Máximo 254 caracteres'),
    nombre: z.string().trim().min(1, 'Escribe de quién es').max(120, 'Máximo 120 caracteres'),
})

export type DatosFormCorreoExterno = z.output<typeof esquemaCorreoExterno>

/** Espejo de `PUT /panel-financiero/ajustes` (A3): días de suspensión para contar una baja, 1 a 365. */
export const esquemaPanelFinanciero = z.object({
    dias_baja: z.number('Escribe los días').int('Solo números enteros').min(1, 'De 1 a 365 días').max(365, 'De 1 a 365 días'),
})

export type DatosFormPanelFinanciero = z.output<typeof esquemaPanelFinanciero>

/**
 * Espejo de `aviso_pc_umbrales` y `motivo` de `PUT /panel-financiero/ajustes` (A3, decisión 12): de
 * 1 a 5 porcentajes del límite anual, mayores que 0 y hasta 100, con dos decimales y sin repetir; el
 * motivo, opcional, de 3 a 500 caracteres.
 */
export const esquemaUmbralesPc = z.object({
    umbrales: z.array(z.number('Escribe el porcentaje').gt(0, 'Mayor que 0 %').max(100, 'Hasta 100 %').multipleOf(0.01, 'Hasta dos decimales'))
        .min(1, 'Deja al menos un umbral')
        .max(5, 'Hasta 5 umbrales')
        .refine(lista => new Set(lista.map(u => u.toFixed(2))).size === lista.length, 'Hay un umbral repetido'),
    motivo: z.string().trim().max(500, 'Máximo 500 caracteres').refine(m => m === '' || m.length >= 3, 'Escribe al menos 3 caracteres'),
})

export type DatosFormUmbralesPc = z.output<typeof esquemaUmbralesPc>

/** Umbrales como los guarda la API: dos decimales, sin repetir y de menor a mayor (`"80.00"`). */
export function normalizarUmbralesPc(umbrales: readonly number[]): string[] {
    return [...new Set(umbrales.map(u => u.toFixed(2)))].sort((a, b) => Number(a) - Number(b))
}

/** «80 %», «92.5 %»: un umbral de `pc_alertas` para leer. */
export function etiquetaUmbralPc(umbral: string): string {
    return `${Number(umbral).toLocaleString('es-GT', { maximumFractionDigits: 2 })} %`
}
