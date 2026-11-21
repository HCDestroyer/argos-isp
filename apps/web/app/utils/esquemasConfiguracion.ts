import type { Schema } from '@argosisp/contracts'
import * as z from 'zod'

/**
 * Espejo de `crearCuentaBancariaValidator` / `editarCuentaBancariaValidator` (A3,
 * `apps/api/app/billing/validators.ts`): banco del catálogo, número de 3 a 40 y alias de 2 a 80
 * caracteres, titular de 2 a 120, tipo monetaria o ahorro, moneda GTQ o USD y si está activa.
 * Titular y tipo son opcionales en la API (cuentas anteriores a Argos 1.18.0) pero el panel los
 * exige (contrato Iris 0.8.0).
 */
export const esquemaCuentaBancaria = z.object({
    banco_id: z.number('Elige el banco').int().positive('Elige el banco'),
    numero: z.string().trim().min(3, 'Mínimo 3 caracteres').max(40, 'Máximo 40 caracteres'),
    alias: z.string().trim().min(2, 'Mínimo 2 caracteres').max(80, 'Máximo 80 caracteres'),
    titular: z.string().trim().min(2, 'Escribe el nombre del titular (mínimo 2 caracteres)').max(120, 'Máximo 120 caracteres'),
    tipo: z.enum(['monetaria', 'ahorro'], 'Elige si es monetaria o de ahorro'),
    moneda: z.enum(['GTQ', 'USD']),
    activa: z.boolean(),
})

export type EntradaCuentaBancaria = z.input<typeof esquemaCuentaBancaria>
export type SalidaCuentaBancaria = z.output<typeof esquemaCuentaBancaria>

export const TIPOS_CUENTA_BANCARIA: Record<SalidaCuentaBancaria['tipo'], string> = {
    monetaria: 'Monetaria',
    ahorro: 'Ahorro',
}

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
    nombre: z.string().trim().min(1, 'Escribe el nombre').max(200, 'Máximo 200 caracteres'),
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
    cobro: 'Cobro',
}

/** Variables que son listas: se insertan como sección `{{#x}}…{{/x}}`. */
const VARIABLES_LISTA = new Set(['lineas', 'secciones', 'aplicaciones'])

/** Documentos con plantilla (A5), en el orden de las pestañas. */
export const TIPOS_DOCUMENTO: { value: Schema<'PlantillaDocumento'>['tipo'], label: string, icon: string, descripcion: string }[] = [
    { value: 'aviso_cobro', label: 'Aviso de cobro y factura', icon: 'i-lucide-receipt-text', descripcion: 'El PDF de cada factura (o factura FEL), en el portal, el correo y el panel.' },
    { value: 'recibo_cobro', label: 'Recibo de cobro', icon: 'i-lucide-ticket', descripcion: 'El recibo que se entrega al cobrar en caja.' },
    { value: 'nota_credito', label: 'Nota de crédito', icon: 'i-lucide-file-minus', descripcion: 'El PDF de cada nota de crédito (o NCRE).' },
]

/** Formatos de página de una plantilla. */
export const FORMATOS_DOCUMENTO: { value: Schema<'PlantillaDocumento'>['formato'], label: string, descripcion: string }[] = [
    { value: 'carta', label: 'Carta', descripcion: 'Hoja carta, para impresora normal o para enviar.' },
    { value: 'pos_80', label: 'POS 80 mm', descripcion: 'Rollo de impresora térmica de 80 mm; el largo sigue al contenido.' },
]

export function etiquetaFormato(formato: Schema<'PlantillaDocumento'>['formato']): string {
    return FORMATOS_DOCUMENTO.find(f => f.value === formato)?.label ?? formato
}

export function etiquetaTipoDocumento(tipo: Schema<'PlantillaDocumento'>['tipo']): string {
    return TIPOS_DOCUMENTO.find(t => t.value === tipo)?.label ?? tipo
}

const nombrePlantilla = z.string().trim()
    .min(1, 'Escribe un nombre')
    .max(80, 'Máximo 80 caracteres')

/** Espejo de `editarPlantillaPorIdValidator` (A5): nombre, formato y HTML de una plantilla. */
export const esquemaEditarPlantilla = esquemaPlantillaDocumento.extend({
    nombre: nombrePlantilla,
    formato: z.enum(['carta', 'pos_80']),
})

export type SalidaEditarPlantilla = z.output<typeof esquemaEditarPlantilla>

/** Espejo de `crearPlantillaDocumentoValidator` (A5); `copiar_de_id` 0 = desde la de fábrica. */
export const esquemaNuevaPlantilla = z.object({
    tipo: z.enum(['aviso_cobro', 'nota_credito', 'recibo_cobro']),
    nombre: nombrePlantilla,
    formato: z.enum(['carta', 'pos_80']),
    copiar_de_id: z.number().int().min(0),
})

export type SalidaNuevaPlantilla = z.output<typeof esquemaNuevaPlantilla>

/**
 * Texto que inserta el editor para una variable: `{{nombre}}`, o una sección
 * `{{#nombre}}…{{/nombre}}` para las listas y condiciones (descripción "Sección…" o `lineas`).
 */
export function marcaVariable(variable: Schema<'VariableDocumento'>): { texto: string, cursor: number } {
    const seccion = VARIABLES_LISTA.has(variable.nombre) || variable.descripcion.startsWith('Sección')
    if (!seccion) {
        const texto = `{{${variable.nombre}}}`
        return { texto, cursor: texto.length }
    }
    const apertura = `{{#${variable.nombre}}}`
    return { texto: `${apertura}{{/${variable.nombre}}}`, cursor: apertura.length }
}
