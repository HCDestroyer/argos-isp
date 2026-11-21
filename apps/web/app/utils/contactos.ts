import type { Schema } from '@argosisp/contracts'
import * as z from 'zod'

type Contacto = Schema<'ContactoCliente'>

/** Relaciones que se pueden agregar (el titular es el cliente). */
export const RELACIONES_CONTACTO: { value: Exclude<Contacto['relacion'], 'titular'>, label: string }[] = [
    { value: 'familiar', label: 'Familiar' },
    { value: 'inquilino', label: 'Inquilino' },
    { value: 'empleado', label: 'Empleado' },
    { value: 'otro', label: 'Otro' },
]

export const ETIQUETAS_RELACION: Record<Contacto['relacion'], string> = {
    titular: 'Titular',
    familiar: 'Familiar',
    inquilino: 'Inquilino',
    empleado: 'Empleado',
    otro: 'Otro',
}

/** Permisos del contacto con su etiqueta corta (tablero: Consulta, Fallas, Paga, Avisos). */
export const PERMISOS_CONTACTO: { clave: keyof Schema<'PermisosContacto'>, etiqueta: string, detalle: string }[] = [
    { clave: 'consultar', etiqueta: 'Consulta', detalle: 'Saldo, estado y facturas' },
    { clave: 'reportar', etiqueta: 'Fallas', detalle: 'Reportar fallas (tickets)' },
    { clave: 'pagar', etiqueta: 'Paga', detalle: 'Comprobantes y promesas' },
    { clave: 'avisos', etiqueta: 'Avisos', detalle: 'Recibe los avisos de cobro' },
]

/** `+50255123344` → `5512-3344`; otros países, tal cual. */
export function telefonoLegible(numero: string): string {
    const gt = /^\+502(\d{4})(\d{4})$/.exec(numero)
    return gt ? `${gt[1]}-${gt[2]}` : numero
}

/**
 * Espejo de `crearContactoValidator` (A1): nombre de 1 a 120, relación sin titular, un número con
 * la regla de teléfonos, WhatsApp y los cuatro permisos (de fábrica, encendidos).
 */
export const esquemaContacto = z.object({
    nombre: z.string().trim().min(1, 'Escribe el nombre').max(120, 'Máximo 120 caracteres'),
    relacion: z.enum(['familiar', 'inquilino', 'empleado', 'otro'], { error: 'Elige la relación' }),
    numero: z.string().trim().refine(valor => normalizarTelefono(valor) !== null, MENSAJE_TELEFONO),
    whatsapp: z.boolean(),
    consultar: z.boolean(),
    reportar: z.boolean(),
    pagar: z.boolean(),
    avisos: z.boolean(),
})

export type EntradaContacto = z.input<typeof esquemaContacto>
