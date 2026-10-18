import type { Schema } from '@argosisp/contracts'
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

const TELEFONO = /^\+?[\d\s()-]{7,30}$/

/** Texto opcional: vacío = `null` (la API borra el dato). */
function opcional(maximo: number) {
    return z.string().trim().max(maximo, `Máximo ${maximo} caracteres`).transform(v => (v === '' ? null : v))
}

function telefonoOpcional() {
    return z.string().trim().max(30, 'Máximo 30 caracteres')
        .refine(v => v === '' || TELEFONO.test(v), 'Solo dígitos, espacios, guiones y paréntesis (7 a 30), p. ej. 5555-1234')
        .transform(v => (v === '' ? null : v))
}

/**
 * Espejo de `editarEmpresaValidator` (A5, `apps/api/app/portal/validators.ts`). En el formulario
 * cada campo es texto; vacío se manda como `null`.
 */
export const esquemaEmpresa = z.object({
    nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(200, 'Máximo 200 caracteres'),
    nit: opcional(20),
    direccion: opcional(300),
    telefono: telefonoOpcional(),
    telefono_alterno: telefonoOpcional(),
    whatsapp: telefonoOpcional(),
    correo: z.string().trim().max(200, 'Máximo 200 caracteres')
        .refine(v => v === '' || z.email().safeParse(v).success, 'Escribe un correo válido')
        .transform(v => (v === '' ? null : v)),
    horario: opcional(200),
    instrucciones_pago: opcional(1000),
})

export type EntradaEmpresa = z.input<typeof esquemaEmpresa>
export type SalidaEmpresa = z.output<typeof esquemaEmpresa>

/** Datos de la API → estado del formulario (los `null` como texto vacío). */
export function entradaDesdeEmpresa(empresa: Schema<'Empresa'>): EntradaEmpresa {
    return {
        nombre: empresa.nombre,
        nit: empresa.nit ?? '',
        direccion: empresa.direccion ?? '',
        telefono: empresa.telefono ?? '',
        telefono_alterno: empresa.telefono_alterno ?? '',
        whatsapp: empresa.whatsapp ?? '',
        correo: empresa.correo ?? '',
        horario: empresa.horario ?? '',
        instrucciones_pago: empresa.instrucciones_pago ?? '',
    }
}

/** Espejo de `editarPlantillaDocumentoValidator` (A5): HTML de 1 a 100 000 caracteres, sin triple bigote. */
export const esquemaPlantillaDocumento = z.object({
    html: z.string()
        .min(1, 'La plantilla no puede quedar vacía')
        .max(100_000, 'Máximo 100 000 caracteres')
        .refine(v => !/\{\{\{|\{\{\s*&/.test(v), 'No se permite {{{ }}} ni {{& }}: usa {{variable}}'),
})

export type SalidaPlantillaDocumento = z.output<typeof esquemaPlantillaDocumento>

/** Grupo de una variable del aviso por su prefijo (`empresa.nombre` → `empresa`). */
export const GRUPOS_VARIABLES: Record<string, string> = {
    empresa: 'Empresa',
    cliente: 'Cliente',
    servicio: 'Servicio',
    factura: 'Factura',
    nota: 'Nota de crédito',
}

/**
 * Texto que inserta el editor para una variable: `{{nombre}}`, o una sección
 * `{{#nombre}}…{{/nombre}}` para las listas y condiciones (descripción "Sección…" o `lineas`).
 */
export function marcaVariable(variable: Schema<'VariableDocumento'>): { texto: string, cursor: number } {
    const seccion = variable.nombre === 'lineas' || variable.descripcion.startsWith('Sección')
    if (!seccion) {
        const texto = `{{${variable.nombre}}}`
        return { texto, cursor: texto.length }
    }
    const apertura = `{{#${variable.nombre}}}`
    return { texto: `${apertura}{{/${variable.nombre}}}`, cursor: apertura.length }
}
