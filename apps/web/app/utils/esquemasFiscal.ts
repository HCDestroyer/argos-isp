import type { Schema, paths } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import * as z from 'zod'

/**
 * Esquemas de Configuración → Fiscal, espejo de `apps/api/app/fiscal/validators.ts` y de la
 * validación de las acciones (`validarValor`, `CambiarRegimen`, `AgregarFrase`). La API vuelve a
 * validar todo; aquí solo se evita mandar lo que seguro rechaza.
 */

type Parametro = Schema<'ParametroFiscal'>
type CuerpoValor = paths['/api/v1/fiscal/parametros/{clave}/valores']['post']['requestBody']['content']['application/json']
type CuerpoImpuesto = paths['/api/v1/fiscal/impuestos/{codigo}/versiones']['post']['requestBody']['content']['application/json']
type CuerpoRegimen = paths['/api/v1/fiscal/regimen']['post']['requestBody']['content']['application/json']
type CuerpoEstablecimiento = paths['/api/v1/fiscal/establecimientos']['post']['requestBody']['content']['application/json']
type CuerpoFrase = paths['/api/v1/fiscal/frases']['post']['requestBody']['content']['application/json']

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
/** `PORCENTAJE` de la API: hasta 3 enteros y 6 decimales, sin signo. */
export const PATRON_PORCENTAJE = /^\d{1,3}(\.\d{1,6})?$/
/** Monto con hasta 2 decimales; se manda con 2 exactos, como `MONTO` de la API. */
const MONTO_ENTRADA = /^\d{1,12}(\.\d{1,2})?$/
const ENTERO = /^-?\d+$/

const fecha = (mensaje = 'Elige la fecha desde la que rige') => z.string().trim().regex(FECHA, mensaje)
const motivo = z.string().trim().min(3, 'Escribe el motivo (mínimo 3 caracteres)').max(500, 'Máximo 500 caracteres')

/** Valor JSON que acepta `POST /fiscal/parametros/:clave/valores`. */
type ValorJson = CuerpoValor['valor']

function esObjetoJson(valor: unknown): valor is unknown[] | Record<string, unknown> {
    return typeof valor === 'object' && valor !== null
}

function leerJson(texto: string): unknown {
    try {
        return JSON.parse(texto) as unknown
    }
    catch {
        return undefined
    }
}

/**
 * Error del valor según el tipo del parámetro (tipo, opciones, mínimo y máximo), con el mismo
 * texto que `validarValor` de la API. `null` si es válido.
 */
export function errorValorParametro(def: Pick<Parametro, 'tipo' | 'opciones' | 'minimo' | 'maximo'>, texto: string): string | null {
    const valor = texto.trim()
    const fueraDeRango = (numero: Decimal): string | null => {
        if (def.minimo !== null && numero.lt(def.minimo)) {
            return `Mínimo ${new Decimal(def.minimo).toString()}`
        }
        if (def.maximo !== null && numero.gt(def.maximo)) {
            return `Máximo ${new Decimal(def.maximo).toString()}`
        }
        return null
    }
    switch (def.tipo) {
        case 'porcentaje':
            if (!PATRON_PORCENTAJE.test(valor)) {
                return 'Porcentaje positivo con hasta 6 decimales, sin el signo % (ej. 12.00)'
            }
            if (new Decimal(valor).gt(100)) {
                return 'Un porcentaje no pasa de 100'
            }
            return fueraDeRango(new Decimal(valor))
        case 'monto':
            return MONTO_ENTRADA.test(valor) ? fueraDeRango(new Decimal(valor)) : 'Monto con hasta 2 decimales, sin comas (ej. 2500.00)'
        case 'entero':
            return ENTERO.test(valor) ? fueraDeRango(new Decimal(valor)) : 'Número entero'
        case 'fecha':
            return FECHA.test(valor) ? null : 'Fecha YYYY-MM-DD'
        case 'texto':
            return valor ? null : 'Escribe el valor'
        case 'enum':
            return (def.opciones ?? []).includes(valor) ? null : `Una de: ${(def.opciones ?? []).join(', ')}`
        case 'json':
            return esObjetoJson(leerJson(valor)) ? null : 'Objeto o lista JSON válido, con la misma forma que el valor del paquete'
        case 'bool':
            return null
    }
}

/** Valor del formulario convertido al JSON del tipo (monto con 2 decimales, entero como número…). */
export function valorParametroDesdeTexto(def: Pick<Parametro, 'tipo'>, texto: string, booleano: boolean): ValorJson {
    const valor = texto.trim()
    switch (def.tipo) {
        case 'bool':
            return booleano
        case 'monto':
            return new Decimal(valor).toFixed(2)
        case 'entero':
            return Number(valor)
        case 'json': {
            const leido = leerJson(valor)
            // El OpenAPI tipa el objeto como `Record<string, never>` (sin propiedades declaradas): la
            // forma real la valida la API contra el valor del paquete.
            return esObjetoJson(leido) ? leido as ValorJson : valor
        }
        default:
            return valor
    }
}

/** Texto inicial del campo para un valor vigente (vacío si no hay). */
export function textoDesdeValor(def: Pick<Parametro, 'tipo'>, valor: unknown): string {
    if (valor === null || valor === undefined) {
        return ''
    }
    if (def.tipo === 'json') {
        return JSON.stringify(valor, null, 2)
    }
    return String(valor)
}

/**
 * Valor nuevo con vigencia (`POST /fiscal/parametros/:clave/valores`): el valor según el tipo,
 * `vigente_desde`, motivo de 3 a 500 y el ámbito (global solo con alcance global y fuera de alcance E).
 */
export function esquemaValorParametro(def: Pick<Parametro, 'tipo' | 'opciones' | 'minimo' | 'maximo'>) {
    return z.object({
        valor: z.string(),
        booleano: z.boolean(),
        vigente_desde: fecha(),
        motivo,
        global: z.boolean(),
    }).superRefine((datos, ctx) => {
        const error = errorValorParametro(def, datos.valor)
        if (error) {
            ctx.addIssue({ code: 'custom', path: ['valor'], message: error })
        }
    }).transform((datos): CuerpoValor => ({
        valor: valorParametroDesdeTexto(def, datos.valor, datos.booleano),
        vigente_desde: datos.vigente_desde,
        motivo: datos.motivo,
        ...(datos.global ? { ambito: 'global' as const } : {}),
    }))
}

export type EntradaValorParametro = z.input<ReturnType<typeof esquemaValorParametro>>

/**
 * Versión nueva de un impuesto: la tasa **en positivo** (el signo de la retención es del
 * impuesto); de 0 a 100 con hasta 6 decimales, como `TASA` de `EditarImpuesto`.
 */
export const esquemaVersionImpuesto = z.object({
    tasa: z.string()
        .trim()
        .refine(valor => !valor.startsWith('-'), 'Escribe la tasa en positivo: el signo de la retención ya es del impuesto')
        .refine(valor => valor.startsWith('-') || PATRON_PORCENTAJE.test(valor), 'Por ciento con hasta 6 decimales, sin el signo % (ej. 15.00)')
        .refine(valor => !PATRON_PORCENTAJE.test(valor) || new Decimal(valor).lte(100), 'La tasa va de 0 a 100'),
    activo: z.boolean(),
    vigente_desde: fecha(),
    motivo,
    global: z.boolean(),
}).transform((datos): CuerpoImpuesto => ({
    tasa: datos.tasa,
    vigente_desde: datos.vigente_desde,
    motivo: datos.motivo,
    activo: datos.activo,
    ...(datos.global ? { ambito: 'global' as const } : {}),
}))

export type EntradaVersionImpuesto = z.input<typeof esquemaVersionImpuesto>

/**
 * Régimen (`POST /fiscal/regimen`). La primera configuración admite cualquier fecha; un cambio
 * rige el 1 de enero de un año futuro, con aviso a la SAT de diciembre del año anterior, no futuro
 * (`CambiarRegimen`, LAT art. 51).
 */
export function esquemaRegimen(primera: boolean, hoy: string) {
    return z.object({
        regimen: z.enum(['utilidades', 'opcional_simplificado', 'pequeno_contribuyente'], { message: 'Elige el régimen' }),
        vigente_desde: fecha(),
        aviso_numero: z.string().trim().max(60, 'Máximo 60 caracteres'),
        aviso_fecha: z.string().trim(),
        motivo: z.string().trim().max(500, 'Máximo 500 caracteres'),
    }).superRefine((datos, ctx) => {
        if (datos.aviso_fecha && !FECHA.test(datos.aviso_fecha)) {
            ctx.addIssue({ code: 'custom', path: ['aviso_fecha'], message: 'Fecha inválida' })
        }
        if (primera || !FECHA.test(datos.vigente_desde)) {
            return
        }
        const [anio = 0, mes = 0, dia = 0] = datos.vigente_desde.split('-').map(Number)
        if (mes !== 1 || dia !== 1 || anio <= Number(hoy.slice(0, 4))) {
            ctx.addIssue({ code: 'custom', path: ['vigente_desde'], message: `Un cambio rige desde el 1 de enero de un año futuro (p. ej. ${Number(hoy.slice(0, 4)) + 1}-01-01)` })
        }
        if (!datos.aviso_numero) {
            ctx.addIssue({ code: 'custom', path: ['aviso_numero'], message: 'El cambio exige el número del aviso a la SAT' })
        }
        if (!datos.aviso_fecha) {
            ctx.addIssue({ code: 'custom', path: ['aviso_fecha'], message: 'El cambio exige la fecha del aviso a la SAT' })
        }
        else if (FECHA.test(datos.aviso_fecha) && (!datos.aviso_fecha.startsWith(`${anio - 1}-12`) || datos.aviso_fecha > hoy)) {
            ctx.addIssue({ code: 'custom', path: ['aviso_fecha'], message: `El aviso se presenta en diciembre de ${anio - 1} y no puede ser futuro` })
        }
    }).transform((datos): CuerpoRegimen => ({
        regimen: datos.regimen,
        vigente_desde: datos.vigente_desde,
        aviso_sat: datos.aviso_numero && datos.aviso_fecha ? { numero: datos.aviso_numero, fecha: datos.aviso_fecha } : null,
        motivo: datos.motivo || null,
    }))
}

export type EntradaRegimen = z.input<ReturnType<typeof esquemaRegimen>>

const opcional = (maximo: number) => z.string().trim().max(maximo, `Máximo ${maximo} caracteres`).transform(valor => valor || null)

/** Establecimiento: código SAT entero > 0 (solo al crear), nombre 1-150, dirección 300, municipio y departamento 100. */
export const esquemaEstablecimiento = z.object({
    codigo: z.string().trim().regex(/^[1-9]\d{0,5}$/, 'Código de establecimiento de la SAT (número entero mayor que 0)').transform(Number),
    nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(150, 'Máximo 150 caracteres'),
    direccion: opcional(300),
    municipio: opcional(100),
    departamento: opcional(100),
    por_defecto: z.boolean(),
    activo: z.boolean(),
})

export type EntradaEstablecimiento = z.input<typeof esquemaEstablecimiento>
export type SalidaEstablecimiento = z.output<typeof esquemaEstablecimiento>

export function cuerpoEstablecimiento(datos: SalidaEstablecimiento): CuerpoEstablecimiento {
    return { codigo: datos.codigo, nombre: datos.nombre, direccion: datos.direccion, municipio: datos.municipio, departamento: datos.departamento, por_defecto: datos.por_defecto }
}

const entero = (campo: string) => z.string().trim().regex(/^[1-9]\d{0,3}$/, `${campo}: número entero mayor que 0`).transform(Number)

/** Frase manual: tipo y escenario de la SAT, texto 1-500, al menos un tipo de DTE y resolución completa o vacía. */
export const esquemaFrase = z.object({
    tipo_frase: entero('Tipo de frase'),
    escenario: entero('Escenario'),
    texto: z.string().trim().min(1, 'El texto de la frase es obligatorio').max(500, 'Máximo 500 caracteres'),
    tipos_dte: z.array(z.string()).min(1, 'Elige al menos un tipo de DTE'),
    vigente_desde: fecha(),
    resolucion_numero: z.string().trim().max(60, 'Máximo 60 caracteres'),
    resolucion_fecha: z.string().trim(),
    motivo,
}).superRefine((datos, ctx) => {
    if (datos.resolucion_numero && !FECHA.test(datos.resolucion_fecha)) {
        ctx.addIssue({ code: 'custom', path: ['resolucion_fecha'], message: 'Con número de resolución va su fecha' })
    }
    if (!datos.resolucion_numero && datos.resolucion_fecha) {
        ctx.addIssue({ code: 'custom', path: ['resolucion_numero'], message: 'Con fecha de resolución va su número' })
    }
}).transform((datos): CuerpoFrase => ({
    tipo_frase: datos.tipo_frase,
    escenario: datos.escenario,
    texto: datos.texto,
    tipos_dte: datos.tipos_dte,
    vigente_desde: datos.vigente_desde,
    motivo: datos.motivo,
    resolucion: datos.resolucion_numero ? { numero: datos.resolucion_numero, fecha: datos.resolucion_fecha } : null,
}))

export type EntradaFrase = z.input<typeof esquemaFrase>

/** Retiro de una frase manual (`activa: false`): el texto y los DTE se toman de la vigente. */
export const esquemaRetiroFrase = z.object({
    vigente_desde: fecha('Elige desde cuándo deja de aplicar'),
    motivo,
})

type CuerpoFeriado = paths['/api/v1/fiscal/feriados']['post']['requestBody']['content']['application/json']

/**
 * Alta de un feriado (`POST /fiscal/feriados`, validador `agregarFeriadoValidator` y la acción
 * `fiscal.agregar_feriado`): fecha, nombre de 3 a 120 caracteres (la acción exige 3 al agregar) y motivo.
 */
export const esquemaFeriado = z.object({
    fecha: fecha('Elige la fecha del feriado'),
    nombre: z.string().trim().min(3, 'Nombre del feriado (mínimo 3 caracteres)').max(120, 'Máximo 120 caracteres'),
    motivo,
}).transform((datos): CuerpoFeriado => ({ fecha: datos.fecha, nombre: datos.nombre, activo: true, motivo: datos.motivo }))

export type EntradaFeriado = z.input<typeof esquemaFeriado>

/** Retiro de un feriado (`activo: false`): la fecha y el nombre se toman del vigente; solo el motivo. */
export const esquemaRetiroFeriado = z.object({ motivo })

type CuerpoCalcular = paths['/api/v1/declaraciones/calcular']['post']['requestBody']['content']['application/json']
type CuerpoPresentar = paths['/api/v1/declaraciones/{id}/marcar-presentada']['post']['requestBody']['content']['application/json']
type CuerpoPago = paths['/api/v1/declaraciones/{id}/registrar-pago']['post']['requestBody']['content']['application/json']

/** Calcular una declaración (`POST /declaraciones/calcular`): impuesto y mes AAAA-MM, no futuro. */
export function esquemaCalcularDeclaracion(hoy: string) {
    return z.object({
        impuesto: z.enum(['iva_mensual', 'pc_mensual'], { message: 'Elige el impuesto' }),
        periodo: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Elige el mes (AAAA-MM)').refine(p => `${p}-01` <= hoy, 'El mes no puede ser futuro'),
        sustitutiva: z.boolean(),
    }).transform((datos): CuerpoCalcular => ({ impuesto: datos.impuesto, periodo: datos.periodo, ...(datos.sustitutiva ? { sustitutiva: true } : {}) }))
}

export type EntradaCalcularDeclaracion = z.input<ReturnType<typeof esquemaCalcularDeclaracion>>

/** Marcar presentada (validador `marcarPresentadaValidator` y la acción): formulario de 3 a 60, fecha no futura, boleta hasta 60. */
export function esquemaPresentarDeclaracion(hoy: string) {
    return z.object({
        numero_formulario: z.string().trim().min(3, 'Número del formulario presentado (mínimo 3 caracteres)').max(60, 'Máximo 60 caracteres'),
        fecha_presentacion: fecha('Elige la fecha de presentación').refine(f => f <= hoy, 'No puede ser futura'),
        boleta: z.string().trim().max(60, 'Máximo 60 caracteres'),
    }).transform((datos): CuerpoPresentar => ({ numero_formulario: datos.numero_formulario, fecha_presentacion: datos.fecha_presentacion, boleta: datos.boleta || null }))
}

export type EntradaPresentarDeclaracion = z.input<ReturnType<typeof esquemaPresentarDeclaracion>>

/** Pago de una declaración: método con su caja, banco (vacío = el principal) o cuenta bancaria; fecha no futura (vacía = hoy). */
export function esquemaPagoDeclaracion(hoy: string) {
    return z.object({
        metodo: z.enum(['caja', 'banco', 'cuenta_bancaria']),
        caja_id: z.number().int().positive().nullable(),
        banco_id: z.number().int().positive().nullable(),
        cuenta_bancaria_id: z.number().int().positive().nullable(),
        fecha: z.string().trim().refine(f => f === '' || (FECHA.test(f) && f <= hoy), 'Fecha no futura (vacía: hoy)'),
        boleta: z.string().trim().max(60, 'Máximo 60 caracteres'),
    }).superRefine((datos, ctx) => {
        if (datos.metodo === 'caja' && datos.caja_id === null) {
            ctx.addIssue({ code: 'custom', path: ['caja_id'], message: 'Elige la caja' })
        }
        if (datos.metodo === 'cuenta_bancaria' && datos.cuenta_bancaria_id === null) {
            ctx.addIssue({ code: 'custom', path: ['cuenta_bancaria_id'], message: 'Elige la cuenta bancaria' })
        }
    }).transform((datos): CuerpoPago => ({
        metodo: datos.metodo,
        ...(datos.metodo === 'caja' ? { caja_id: datos.caja_id } : {}),
        ...(datos.metodo === 'banco' && datos.banco_id !== null ? { banco_id: datos.banco_id } : {}),
        ...(datos.metodo === 'cuenta_bancaria' ? { cuenta_bancaria_id: datos.cuenta_bancaria_id } : {}),
        ...(datos.fecha ? { fecha: datos.fecha } : {}),
        boleta: datos.boleta || null,
    }))
}

export type EntradaPagoDeclaracion = z.input<ReturnType<typeof esquemaPagoDeclaracion>>
