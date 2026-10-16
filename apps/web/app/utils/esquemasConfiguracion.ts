import * as z from 'zod'

/**
 * Espejo de `crearCuentaBancariaValidator` / `editarCuentaBancariaValidator` (A3,
 * `apps/api/app/billing/validators.ts`): banco del catálogo, número de 3 a 40 y alias de 2 a 80
 * caracteres, moneda GTQ o USD y si está activa.
 */
export const esquemaCuentaBancaria = z.object({
    banco_id: z.number('Elige el banco').int().positive('Elige el banco'),
    numero: z.string().trim().min(3, 'Mínimo 3 caracteres').max(40, 'Máximo 40 caracteres'),
    alias: z.string().trim().min(2, 'Mínimo 2 caracteres').max(80, 'Máximo 80 caracteres'),
    moneda: z.enum(['GTQ', 'USD']),
    activa: z.boolean(),
})

export type EntradaCuentaBancaria = z.input<typeof esquemaCuentaBancaria>
export type SalidaCuentaBancaria = z.output<typeof esquemaCuentaBancaria>

export const MONEDAS_CUENTA: Record<SalidaCuentaBancaria['moneda'], string> = {
    GTQ: 'Quetzales (GTQ)',
    USD: 'Dólares (USD)',
}
