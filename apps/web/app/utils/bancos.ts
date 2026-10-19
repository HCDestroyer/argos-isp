import type { Schema, paths } from '@argosisp/contracts'
import type { BadgeProps, SelectItem } from '@nuxt/ui'
import Decimal from 'decimal.js'
import { z } from 'zod'

/**
 * Bancos de la fase 4 (A3, §10.3 del contrato de localización fiscal): cuentas del libro, depósitos
 * y traslados en tránsito, importación de extractos, conciliación y reglas. Espejos de
 * `validators_bancos.ts` y las sumas que el panel muestra antes de enviar (la API recalcula).
 */

type CuentaPropia = Schema<'CuentaBancaria'>
type BancoDelLibro = Schema<'BancoLibro'>
type DepositoApi = Schema<'Deposito'>
type LineaApi = Schema<'LineaExtracto'>
type ReglaApi = Schema<'ReglaConciliacion'>
type CuerpoExtracto = paths['/api/v1/bancos/extractos']['post']['requestBody']['content']['application/json']
type CuerpoRegla = paths['/api/v1/bancos/reglas']['post']['requestBody']['content']['application/json']
type CuerpoTraslado = paths['/api/v1/bancos/trasladar']['post']['requestBody']['content']['application/json']
type CuerpoDeposito = paths['/api/v1/cajas/{id}/depositar']['post']['requestBody']['content']['application/json']

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const MONTO_CON_SIGNO = /^-?\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/* Cuentas bancarias del libro (1.1.02.NN). */

/**
 * Una cuenta del libro a la que puede ir dinero: la API acepta `cuenta_bancaria_id`, `banco_id` o
 * `cuenta_id`; el panel manda siempre `cuenta_id` (la subcuenta, única) para no duplicar opciones.
 */
export interface CuentaBanco {
    cuenta_id: number
    codigo: string
    etiqueta: string
    descripcion: string
    empresa_id: number | null
}

/**
 * Une las cuentas propias (`GET /cuentas-bancarias`, en quetzales y activas) y los bancos del libro
 * (`GET /libro/bancos`, como el banco principal 1.1.02.01) sin repetir subcuenta.
 */
export function cuentasBanco(propias: readonly CuentaPropia[], delLibro: readonly BancoDelLibro[]): CuentaBanco[] {
    const vistas = new Set<number>()
    const resultado: CuentaBanco[] = []
    for (const cuenta of propias) {
        if (!cuenta.activa || cuenta.moneda !== 'GTQ' || vistas.has(cuenta.cuenta_id)) {
            continue
        }
        vistas.add(cuenta.cuenta_id)
        resultado.push({
            cuenta_id: cuenta.cuenta_id,
            codigo: cuenta.cuenta_codigo,
            etiqueta: `${cuenta.banco_nombre} · ${cuenta.alias}`,
            descripcion: `${cuenta.cuenta_codigo} · ${cuenta.numero}`,
            empresa_id: cuenta.empresa_id ?? null,
        })
    }
    for (const banco of delLibro) {
        if (vistas.has(banco.cuenta_id)) {
            continue
        }
        vistas.add(banco.cuenta_id)
        resultado.push({
            cuenta_id: banco.cuenta_id,
            codigo: banco.cuenta_codigo,
            etiqueta: banco.nombre,
            descripcion: [banco.cuenta_codigo, banco.numero_enmascarado].filter(Boolean).join(' · '),
            empresa_id: banco.empresa_id ?? null,
        })
    }
    return resultado.sort((a, b) => a.codigo.localeCompare(b.codigo))
}

export function itemsCuentasBanco(cuentas: readonly CuentaBanco[]): SelectItem[] {
    return cuentas.map(c => ({ label: c.etiqueta, value: c.cuenta_id, description: c.descripcion }))
}

/** Nombre de una subcuenta para mostrar: la etiqueta conocida o el código que trae la API. */
export function nombreCuentaBanco(cuentas: readonly CuentaBanco[], cuentaId: number, codigo?: string | null, nombre?: string | null): string {
    const conocida = cuentas.find(c => c.cuenta_id === cuentaId)
    if (conocida) {
        return conocida.etiqueta
    }
    return [codigo, nombre].filter(Boolean).join(' · ') || `Cuenta ${cuentaId}`
}

/* Depósitos y traslados (1.1.11 Fondos en tránsito). */

export const ESTADOS_TRANSITO: Record<DepositoApi['estado'], { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    en_transito: { etiqueta: 'En tránsito', color: 'warning', icono: 'i-lucide-truck' },
    acreditado: { etiqueta: 'Acreditado', color: 'success', icono: 'i-lucide-circle-check' },
}

/**
 * Espejo de `depositarCajaValidator` y `DepositarCaja`: monto > 0 con hasta 2 decimales, boleta de
 * 1 a 80, fecha no futura (vacía = hoy) y la cuenta que recibe. Con el efectivo del turno conocido,
 * no lo supera (la API responde 422 `deposito_excede_efectivo` igual).
 */
export function esquemaDeposito(hoy: string, efectivo: Decimal | null) {
    return z.object({
        monto: z.string()
            .trim()
            .regex(MONTO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 600.00)')
            .refine(valor => !MONTO.test(valor) || new Decimal(valor).gt(0), 'El monto debe ser mayor que cero')
            .refine(valor => !MONTO.test(valor) || efectivo === null || new Decimal(valor).lte(efectivo), `No puede superar el efectivo del turno${efectivo ? ` (${formatearQuetzales(efectivo)})` : ''}`),
        boleta: z.string().trim().min(1, 'El número de boleta es obligatorio').max(80, 'Máximo 80 caracteres'),
        fecha: z.string()
            .trim()
            .refine(valor => valor === '' || FECHA.test(valor), 'Fecha inválida')
            .refine(valor => valor === '' || valor <= hoy, 'La fecha del depósito no puede ser futura'),
        cuenta_id: z.number().int().positive().nullable().refine(valor => valor !== null, 'Elige la cuenta que recibe el depósito'),
    })
}

export type EntradaDeposito = z.input<ReturnType<typeof esquemaDeposito>>
export type SalidaDeposito = z.output<ReturnType<typeof esquemaDeposito>>

export function cuerpoDeposito(datos: SalidaDeposito): CuerpoDeposito {
    const cuerpo: CuerpoDeposito = { monto: new Decimal(datos.monto).toFixed(2), boleta: datos.boleta, cuenta_id: datos.cuenta_id }
    if (datos.fecha) {
        cuerpo.fecha = datos.fecha
    }
    return cuerpo
}

/**
 * Depósitos de un turno (`Deposito.turno_id`): bajan el efectivo esperado igual que un egreso.
 * Hasta que exista el filtro por turno (pedido a A3), se filtran de `GET /bancos/depositos`.
 */
export function depositosDelTurno<T extends Pick<DepositoApi, 'turno_id'>>(depositos: readonly T[], turnoId: number): T[] {
    return depositos.filter(d => d.turno_id === turnoId)
}

/** Espejo de `trasladarValidator`: monto > 0, referencia de 1 a 120 y dos cuentas distintas. */
export function esquemaTraslado(hoy: string) {
    return z.object({
        monto: z.string()
            .trim()
            .regex(MONTO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 1000.00)')
            .refine(valor => !MONTO.test(valor) || new Decimal(valor).gt(0), 'El monto debe ser mayor que cero'),
        referencia: z.string().trim().min(1, 'La referencia es obligatoria').max(120, 'Máximo 120 caracteres'),
        fecha: z.string()
            .trim()
            .refine(valor => valor === '' || FECHA.test(valor), 'Fecha inválida')
            .refine(valor => valor === '' || valor <= hoy, 'La fecha no puede ser futura'),
        origen: z.number().int().positive().nullable().refine(valor => valor !== null, 'Elige la cuenta de la que sale'),
        destino: z.number().int().positive().nullable().refine(valor => valor !== null, 'Elige la cuenta a la que llega'),
    }).superRefine((datos, ctx) => {
        if (datos.origen !== null && datos.origen === datos.destino) {
            ctx.addIssue({ code: 'custom', path: ['destino'], message: 'El destino debe ser otra cuenta' })
        }
    })
}

export type EntradaTraslado = z.input<ReturnType<typeof esquemaTraslado>>
export type SalidaTraslado = z.output<ReturnType<typeof esquemaTraslado>>

export function cuerpoTraslado(datos: SalidaTraslado): CuerpoTraslado {
    const cuerpo: CuerpoTraslado = {
        monto: new Decimal(datos.monto).toFixed(2),
        referencia: datos.referencia,
        origen: { cuenta_id: datos.origen },
        destino: { cuenta_id: datos.destino },
    }
    if (datos.fecha) {
        cuerpo.fecha = datos.fecha
    }
    return cuerpo
}

/* Extractos: lectura del archivo (formato neutral) y huella. */

export interface LineaLeida {
    fecha: string
    descripcion: string
    referencia: string | null
    monto: string
    saldo: string | null
}

export interface ExtractoLeido {
    lineas: LineaLeida[]
    /** Errores por fila del archivo (1 = primera fila de datos). */
    errores: { fila: number, mensaje: string }[]
    desde: string | null
    hasta: string | null
    /** Saldo antes de la primera línea, si el archivo trae la columna `saldo`. */
    saldoInicial: string | null
    /** Saldo de la última línea, si el archivo trae la columna `saldo`. */
    saldoFinal: string | null
}

const COLUMNAS = ['fecha', 'descripcion', 'referencia', 'monto', 'saldo'] as const

function sinAcentos(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Separa una fila CSV (comillas dobles, `,` o `;`). */
function celdas(fila: string, separador: string): string[] {
    const resultado: string[] = []
    let actual = ''
    let entreComillas = false
    for (let i = 0; i < fila.length; i++) {
        const caracter = fila[i]
        if (caracter === '"') {
            if (entreComillas && fila[i + 1] === '"') {
                actual += '"'
                i++
            }
            else {
                entreComillas = !entreComillas
            }
        }
        else if (caracter === separador && !entreComillas) {
            resultado.push(actual.trim())
            actual = ''
        }
        else {
            actual += caracter
        }
    }
    resultado.push(actual.trim())
    return resultado
}

/** `18/10/2026` o `2026-10-18` → `2026-10-18`; `null` si no es una fecha. */
function fechaIso(texto: string): string | null {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto)
    if (iso) {
        return texto
    }
    const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto)
    if (local) {
        const [, dia = '', mes = '', anio = ''] = local
        return `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
    }
    return null
}

/** `-1,250.50` o `Q 15.00` → `-1250.50`; `null` si no es un monto con hasta 2 decimales. */
function montoIso(texto: string): string | null {
    const limpio = texto.replace(/q/gi, '').replace(/\s/g, '').replace(/,/g, '')
    return MONTO_CON_SIGNO.test(limpio) ? new Decimal(limpio).toFixed(2) : null
}

/**
 * Lee un extracto en el formato neutral del panel: CSV con encabezado `fecha, descripcion,
 * referencia, monto, saldo` (referencia y saldo opcionales; separador `,` o `;`; fecha
 * `AAAA-MM-DD` o `DD/MM/AAAA`; monto con signo: + entra a la cuenta). Los formatos de cada banco
 * los convierten los adaptadores de A6 (`contratos/importacion.md`).
 */
export function leerExtractoCsv(texto: string): ExtractoLeido {
    const filas = texto.replace(/^\uFEFF/, '').split(/\r?\n/).filter(f => f.trim() !== '')
    const errores: ExtractoLeido['errores'] = []
    const vacio: ExtractoLeido = { lineas: [], errores, desde: null, hasta: null, saldoInicial: null, saldoFinal: null }
    const [encabezado, ...datos] = filas
    if (!encabezado) {
        errores.push({ fila: 0, mensaje: 'El archivo está vacío' })
        return vacio
    }
    const separador = (encabezado.match(/;/g)?.length ?? 0) > (encabezado.match(/,/g)?.length ?? 0) ? ';' : ','
    const nombres = celdas(encabezado, separador).map(sinAcentos)
    const indice = Object.fromEntries(COLUMNAS.map(c => [c, nombres.indexOf(c)])) as Record<typeof COLUMNAS[number], number>
    const faltan = (['fecha', 'descripcion', 'monto'] as const).filter(c => indice[c] < 0)
    if (faltan.length) {
        errores.push({ fila: 0, mensaje: `Faltan las columnas ${faltan.join(', ')} en el encabezado` })
        return vacio
    }
    const lineas: LineaLeida[] = []
    datos.forEach((fila, posicion) => {
        const valores = celdas(fila, separador)
        const numero = posicion + 1
        const valor = (columna: typeof COLUMNAS[number]) => (indice[columna] >= 0 ? valores[indice[columna]] ?? '' : '')
        const fecha = fechaIso(valor('fecha'))
        const monto = montoIso(valor('monto'))
        const descripcion = valor('descripcion')
        const saldoTexto = valor('saldo')
        const saldo = saldoTexto ? montoIso(saldoTexto) : null
        if (!fecha) {
            errores.push({ fila: numero, mensaje: `Fecha inválida: "${valor('fecha')}"` })
        }
        if (!monto) {
            errores.push({ fila: numero, mensaje: `Monto inválido: "${valor('monto')}"` })
        }
        if (!descripcion) {
            errores.push({ fila: numero, mensaje: 'Falta la descripción' })
        }
        if (saldoTexto && !saldo) {
            errores.push({ fila: numero, mensaje: `Saldo inválido: "${saldoTexto}"` })
        }
        if (fecha && monto && descripcion) {
            lineas.push({ fecha, descripcion: descripcion.slice(0, 300), referencia: valor('referencia') || null, monto, saldo })
        }
    })
    const fechas = lineas.map(l => l.fecha).sort()
    const primera = lineas[0]
    const ultima = lineas.at(-1)
    return {
        lineas,
        errores,
        desde: fechas[0] ?? null,
        hasta: fechas.at(-1) ?? null,
        saldoInicial: primera?.saldo ? new Decimal(primera.saldo).minus(primera.monto).toFixed(2) : null,
        saldoFinal: ultima?.saldo ?? null,
    }
}

/** sha256 del archivo original en hexadecimal (el panel hace de adaptador: §18 del contrato). */
export async function sha256Archivo(contenido: ArrayBuffer): Promise<string> {
    const huella = await crypto.subtle.digest('SHA-256', contenido)
    return [...new Uint8Array(huella)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Σ montos de las líneas leídas. */
export function sumaLineas(lineas: readonly Pick<LineaLeida, 'monto'>[]): Decimal {
    return lineas.reduce((suma, l) => suma.plus(l.monto), new Decimal(0))
}

/** Lo mismo que revisa la API (422 `extracto_descuadrado`): Σ líneas = saldo final − saldo inicial. */
export function extractoCuadra(lineas: readonly Pick<LineaLeida, 'monto'>[], saldoInicial: string, saldoFinal: string): boolean {
    if (!MONTO_CON_SIGNO.test(saldoInicial.trim()) || !MONTO_CON_SIGNO.test(saldoFinal.trim())) {
        return false
    }
    return sumaLineas(lineas).equals(new Decimal(saldoFinal.trim()).minus(saldoInicial.trim()))
}

/** Espejo de `importarExtractoValidator` (saldos con signo; el motivo solo para forzar el encadenamiento). */
export function esquemaExtracto() {
    return z.object({
        cuenta_id: z.number().int().positive().nullable().refine(valor => valor !== null, 'Elige la cuenta del extracto'),
        desde: z.string().trim().regex(FECHA, 'Fecha inválida'),
        hasta: z.string().trim().regex(FECHA, 'Fecha inválida'),
        saldo_inicial: z.string().trim().regex(MONTO_CON_SIGNO, 'Saldo con signo y hasta 2 decimales (ej. 1250.00)'),
        saldo_final: z.string().trim().regex(MONTO_CON_SIGNO, 'Saldo con signo y hasta 2 decimales (ej. 1250.00)'),
        motivo_no_encadena: z.string().trim().max(500, 'Máximo 500 caracteres')
            .refine(valor => valor === '' || valor.length >= 3, 'El motivo lleva al menos 3 caracteres'),
    }).superRefine((datos, ctx) => {
        if (FECHA.test(datos.desde) && FECHA.test(datos.hasta) && datos.hasta < datos.desde) {
            ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Hasta no puede ser anterior a desde' })
        }
    })
}

export type EntradaExtracto = z.input<ReturnType<typeof esquemaExtracto>>
export type SalidaExtracto = z.output<ReturnType<typeof esquemaExtracto>>

export function cuerpoExtracto(datos: SalidaExtracto, lineas: readonly LineaLeida[], archivo: string | null, sha256: string | null): CuerpoExtracto {
    const cuerpo: CuerpoExtracto = {
        cuenta_id: datos.cuenta_id,
        desde: datos.desde,
        hasta: datos.hasta,
        saldo_inicial: new Decimal(datos.saldo_inicial).toFixed(2),
        saldo_final: new Decimal(datos.saldo_final).toFixed(2),
        lineas: lineas.map(l => ({ fecha: l.fecha, descripcion: l.descripcion, referencia: l.referencia, monto: l.monto, saldo: l.saldo })),
    }
    if (archivo) {
        cuerpo.archivo = archivo.slice(0, 200)
    }
    if (sha256) {
        cuerpo.sha256 = sha256
    }
    if (datos.motivo_no_encadena) {
        cuerpo.motivo_no_encadena = datos.motivo_no_encadena
    }
    return cuerpo
}

/* Conciliación. */

/** Un candidato a conciliar con una línea: movimiento del libro, depósito o traslado en tránsito. */
export interface PartidaConciliable {
    clave: string
    tipo: 'movimiento' | 'deposito' | 'traslado'
    id: number
    fecha: string
    descripcion: string
    /** Neto con signo en la cuenta del extracto (+ entra). */
    monto: string
}

/** Σ de lo elegido contra el monto de la línea (la API exige que cuadre: 422 `conciliacion_descuadrada`). */
export function diferenciaConciliacion(linea: Pick<LineaApi, 'monto'>, elegidas: readonly Pick<PartidaConciliable, 'monto'>[]): Decimal {
    return new Decimal(linea.monto).minus(elegidas.reduce((suma, p) => suma.plus(p.monto), new Decimal(0)))
}

/** Candidatos que suman exactamente el monto de la línea: el primero de igual monto, o `[]`. */
export function sugerenciaConciliacion(linea: Pick<LineaApi, 'monto' | 'referencia'>, partidas: readonly PartidaConciliable[]): PartidaConciliable[] {
    const iguales = partidas.filter(p => new Decimal(p.monto).equals(linea.monto))
    const porReferencia = linea.referencia ? iguales.find(p => p.descripcion.includes(linea.referencia ?? '')) : undefined
    const elegida = porReferencia ?? iguales[0]
    return elegida ? [elegida] : []
}

/** Cuerpo de `POST /bancos/conciliaciones` agrupando lo elegido por tipo. */
export function cuerpoConciliacion(lineaId: number, elegidas: readonly PartidaConciliable[]): paths['/api/v1/bancos/conciliaciones']['post']['requestBody']['content']['application/json'] {
    const de = (tipo: PartidaConciliable['tipo']) => elegidas.filter(p => p.tipo === tipo).map(p => p.id)
    const cuerpo: paths['/api/v1/bancos/conciliaciones']['post']['requestBody']['content']['application/json'] = { linea_id: lineaId }
    if (de('movimiento').length) {
        cuerpo.movimientos = de('movimiento')
    }
    if (de('deposito').length) {
        cuerpo.depositos = de('deposito')
    }
    if (de('traslado').length) {
        cuerpo.traslados = de('traslado')
    }
    return cuerpo
}

/** Espejo de `registrarDesdeExtractoValidator`: en un abono la contrapartida es obligatoria. */
export function esquemaRegistrarLinea(monto: string) {
    const abono = new Decimal(monto).gt(0)
    return z.object({
        cuenta: z.string().trim().max(40, 'Máximo 40 caracteres')
            .refine(valor => !abono || valor !== '', 'Un abono del banco necesita su contrapartida (interés, otro ingreso…)'),
        descripcion: z.string().trim().max(300, 'Máximo 300 caracteres'),
    })
}

export type EntradaRegistrarLinea = z.input<ReturnType<typeof esquemaRegistrarLinea>>

/* Reglas de conciliación. */

export const ACCIONES_REGLA: Record<ReglaApi['accion'], { etiqueta: string, descripcion: string }> = {
    contrapartida: { etiqueta: 'Registrar contra una cuenta', descripcion: 'Crea el asiento de la línea contra la cuenta indicada y la concilia (comisiones, intereses).' },
    cliente: { etiqueta: 'Pago de cliente', descripcion: 'Concilia con el único pago bancario vigente de esa referencia y ese monto en la cuenta.' },
}

export const CONDICIONES_REGLA: Record<ReglaApi['tipo_condicion'], string> = {
    contiene: 'La descripción contiene',
    regex: 'Expresión regular',
}

/**
 * Espejo de `condicionRegla` (A3): nombre de 2 a 80, patrón de 1 a 200 (regex válida), montos con
 * signo, prioridad 0 a 1000 y la contrapartida obligatoria con la acción `contrapartida`.
 */
export function esquemaRegla() {
    return z.object({
        nombre: z.string().trim().min(2, 'El nombre lleva al menos 2 caracteres').max(80, 'Máximo 80 caracteres'),
        cuenta_id: z.number().int().positive().nullable(),
        tipo_condicion: z.enum(['contiene', 'regex']),
        patron: z.string().trim().min(1, 'El patrón es obligatorio').max(200, 'Máximo 200 caracteres'),
        monto_min: z.string().trim().refine(valor => valor === '' || MONTO_CON_SIGNO.test(valor), 'Monto con signo y hasta 2 decimales'),
        monto_max: z.string().trim().refine(valor => valor === '' || MONTO_CON_SIGNO.test(valor), 'Monto con signo y hasta 2 decimales'),
        accion: z.enum(['contrapartida', 'cliente']),
        contrapartida: z.string().trim().max(40, 'Máximo 40 caracteres'),
        prioridad: z.number({ message: 'Prioridad de 0 a 1000' }).int('Prioridad entera').min(0, 'Prioridad de 0 a 1000').max(1000, 'Prioridad de 0 a 1000'),
        activa: z.boolean(),
    }).superRefine((datos, ctx) => {
        if (datos.tipo_condicion === 'regex') {
            try {
                new RegExp(datos.patron)
            }
            catch {
                ctx.addIssue({ code: 'custom', path: ['patron'], message: 'La expresión regular no es válida' })
            }
        }
        if (datos.accion === 'contrapartida' && !datos.contrapartida) {
            ctx.addIssue({ code: 'custom', path: ['contrapartida'], message: 'Indica el código de la cuenta (ej. 5.3.07)' })
        }
        if (MONTO_CON_SIGNO.test(datos.monto_min) && MONTO_CON_SIGNO.test(datos.monto_max) && new Decimal(datos.monto_max).lt(datos.monto_min)) {
            ctx.addIssue({ code: 'custom', path: ['monto_max'], message: 'El máximo no puede ser menor que el mínimo' })
        }
    })
}

export type EntradaRegla = z.input<ReturnType<typeof esquemaRegla>>
export type SalidaRegla = z.output<ReturnType<typeof esquemaRegla>>

export function entradaReglaVacia(): EntradaRegla {
    return { nombre: '', cuenta_id: null, tipo_condicion: 'contiene', patron: '', monto_min: '', monto_max: '', accion: 'contrapartida', contrapartida: '5.3.07', prioridad: 100, activa: true }
}

export function entradaDeRegla(regla: ReglaApi): EntradaRegla {
    return {
        nombre: regla.nombre,
        cuenta_id: regla.cuenta_id,
        tipo_condicion: regla.tipo_condicion,
        patron: regla.patron,
        monto_min: regla.monto_min ?? '',
        monto_max: regla.monto_max ?? '',
        accion: regla.accion,
        contrapartida: regla.contrapartida ?? '',
        prioridad: regla.prioridad,
        activa: regla.activa,
    }
}

/** Cuerpo de `POST /bancos/reglas` (y de `PUT`, más `version`): la contrapartida solo con su acción. */
export function cuerpoRegla(datos: SalidaRegla): CuerpoRegla {
    return {
        nombre: datos.nombre,
        cuenta_id: datos.cuenta_id,
        tipo_condicion: datos.tipo_condicion,
        patron: datos.patron,
        monto_min: datos.monto_min ? new Decimal(datos.monto_min).toFixed(2) : null,
        monto_max: datos.monto_max ? new Decimal(datos.monto_max).toFixed(2) : null,
        accion: datos.accion,
        contrapartida: datos.accion === 'contrapartida' ? datos.contrapartida : null,
        prioridad: datos.prioridad,
        activa: datos.activa,
    }
}

/** Condición de una regla en una frase: `Contiene "comision" · hasta Q 0.00`. */
export function condicionRegla(regla: Pick<ReglaApi, 'tipo_condicion' | 'patron' | 'monto_min' | 'monto_max'>): string {
    const texto = regla.tipo_condicion === 'contiene' ? `Contiene "${regla.patron}"` : `Regex /${regla.patron}/`
    const rango = regla.monto_min && regla.monto_max
        ? `de ${formatearQuetzales(regla.monto_min)} a ${formatearQuetzales(regla.monto_max)}`
        : regla.monto_min ? `desde ${formatearQuetzales(regla.monto_min)}` : regla.monto_max ? `hasta ${formatearQuetzales(regla.monto_max)}` : ''
    return [texto, rango].filter(Boolean).join(' · ')
}

/** Monto con signo de una línea: `+Q 600.00` (entra) o `-Q 15.00` (sale). */
export function montoConSigno(monto: string): string {
    const valor = new Decimal(monto)
    return valor.gt(0) ? `+${formatearQuetzales(valor)}` : formatearQuetzales(valor)
}
