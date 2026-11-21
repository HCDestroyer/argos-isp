import { CERO, D, aTexto, type Dec } from '#ledger/dinero'
import { leerMonto } from '#importacion/montos'
import type { Celda } from '#importacion/extractos/hoja'
import { leerFecha, normalizarTitulo, type MapeoExtracto } from '#importacion/extractos/formatos'

/**
 * Convierte las filas del banco a la forma neutral de `bancos.importar_extracto` con un mapeo:
 * líneas `{ fecha, descripcion, referencia, monto (+ entra, − sale), saldo }` en orden cronológico.
 *
 * - Débito y crédito: `monto = crédito − |débito|`. Un monto con signo se toma tal cual; `(1,250.00)`
 *   y `1,250.00-` son negativos.
 * - Filas sin fecha: «Saldo anterior / inicial» y «Saldo final / actual / al …» (antes o después de
 *   la tabla) dan los saldos del extracto; «Total…» y las demás se ignoran (se cuentan).
 * - Una fila con fecha y un monto ilegible es un error (con su número de fila); un movimiento en 0
 *   se ignora.
 * - Si el banco lista del más reciente al más antiguo, se invierte.
 * - Saldos: los de las etiquetas; si no, con la columna de saldo (`inicial = saldo₁ − monto₁`,
 *   `final = saldoₙ`). Sin ninguno, quedan null (los decide quien importa o el extracto anterior).
 */

export interface LineaInterpretada {
    /** fila del archivo (desde 1) */
    fila: number
    fecha: string
    descripcion: string
    referencia: string | null
    monto: string
    saldo: string | null
}

export interface ErrorFila {
    fila: number
    campo: string
    mensaje: string
}

export interface Interpretacion {
    lineas: LineaInterpretada[]
    errores: ErrorFila[]
    ignoradas: number
    /** el banco los listó del más reciente al más antiguo (se invirtieron) */
    invertido: boolean
    saldo_inicial: string | null
    saldo_final: string | null
    /** de dónde salieron los saldos */
    origen_saldos: 'etiquetas' | 'columna_saldo' | null
    /** filas donde la columna de saldo no encadena con el movimiento (saldoᵢ ≠ saldoᵢ₋₁ + montoᵢ) */
    saldos_que_no_encadenan: number[]
}

export function leerImporte(celda: Celda, decimal: 'punto' | 'coma'): Dec | null | 'ilegible' {
    if (celda === null) return null
    let t = celda
        .trim()
        .replace(/^(gtq|q)\s*/i, '')
        .replace(/\s+/g, '')
    if (t === '' || t === '-' || t === '--') return null
    let negativo = false
    if (/^\(.*\)$/.test(t)) {
        negativo = true
        t = t.slice(1, -1)
    }
    if (/-$/.test(t)) {
        negativo = true
        t = t.slice(0, -1)
    }
    t = t.replace(/^(gtq|q)/i, '')
    // Un número de Excel ya viene con punto decimal y sin miles («1250.5»): no es ambiguo
    if (/^[-+]?\d+(\.\d+)?$/.test(t)) {
        const v = new D(t)
        return negativo ? v.negated() : v
    }
    const leido = leerMonto(t, decimal)
    if (!leido.ok) return 'ilegible'
    return negativo ? leido.valor.negated() : leido.valor
}

const SALDO_INICIAL = /saldo (inicial|anterior|al inicio|de apertura|apertura)/
const SALDO_FINAL = /saldo (final|actual|al cierre|de cierre|cierre)|saldo al \d/

/** Primer importe legible de la fila a partir de la columna `desde`. */
function importeDeFila(fila: Celda[], decimal: 'punto' | 'coma', desde = 0): Dec | null {
    for (let c = desde; c < fila.length; c++) {
        const v = leerImporte(fila[c] ?? null, decimal)
        if (v !== null && v !== 'ilegible') return v
    }
    return null
}

/** Saldos con etiqueta en las filas fuera de la tabla (`antes` de los datos o filas sin fecha). */
function saldoEtiquetado(
    fila: Celda[],
    decimal: 'punto' | 'coma',
): { tipo: 'inicial' | 'final'; valor: Dec } | null {
    for (let c = 0; c < fila.length; c++) {
        const t = normalizarTitulo(fila[c] ?? null)
        const tipo = SALDO_INICIAL.test(t) ? 'inicial' : SALDO_FINAL.test(t) ? 'final' : null
        if (!tipo) continue
        // el importe puede venir en la misma celda («Saldo anterior: Q 1,000.00») o en las siguientes
        const enCelda = /[:]\s*(.+)$/.exec(fila[c] ?? '')
        const propio = enCelda ? leerImporte(enCelda[1]!, decimal) : null
        const valor = propio && propio !== 'ilegible' ? propio : importeDeFila(fila, decimal, c + 1)
        if (valor !== null) return { tipo, valor }
    }
    return null
}

export function interpretarFilas(filas: Celda[][], mapeo: MapeoExtracto): Interpretacion {
    const { columnas: col, decimal } = mapeo
    const errores: ErrorFila[] = []
    const lineas: LineaInterpretada[] = []
    let ignoradas = 0
    let inicialEtiqueta: Dec | null = null
    let finalEtiqueta: Dec | null = null

    // Saldos con etiqueta antes de la tabla
    for (let r = 0; r < Math.max(0, mapeo.fila_datos - 1) && r < filas.length; r++) {
        const s = saldoEtiquetado(filas[r]!, decimal)
        if (s?.tipo === 'inicial') inicialEtiqueta = s.valor
        if (s?.tipo === 'final') finalEtiqueta = s.valor
    }

    for (let r = Math.max(0, mapeo.fila_datos - 1); r < filas.length; r++) {
        const fila = filas[r]!
        const numero = r + 1
        if (fila.every((c) => c === null)) continue
        const fecha = leerFecha(fila[col.fecha] ?? null, mapeo.formato_fecha)
        if (!fecha) {
            const s = saldoEtiquetado(fila, decimal)
            if (s?.tipo === 'inicial') inicialEtiqueta = s.valor
            else if (s?.tipo === 'final') finalEtiqueta = s.valor
            else {
                const texto = fila[col.fecha]
                if (texto && /\d/.test(texto) && lineas.length > 0 && !/total/i.test(fila.join(' '))) {
                    errores.push({
                        fila: numero,
                        campo: 'fecha',
                        mensaje: `«${texto.slice(0, 40)}» no es una fecha`,
                    })
                }
            }
            ignoradas++
            continue
        }
        let monto: Dec
        if (col.monto !== null) {
            const v = leerImporte(fila[col.monto] ?? null, decimal)
            if (v === 'ilegible') {
                errores.push({ fila: numero, campo: 'monto', mensaje: 'El monto no es legible' })
                continue
            }
            monto = v ?? CERO
        } else {
            const deb = leerImporte(col.debito === null ? null : (fila[col.debito] ?? null), decimal)
            const cre = leerImporte(col.credito === null ? null : (fila[col.credito] ?? null), decimal)
            if (deb === 'ilegible' || cre === 'ilegible') {
                errores.push({
                    fila: numero,
                    campo: deb === 'ilegible' ? 'debito' : 'credito',
                    mensaje: `El ${deb === 'ilegible' ? 'débito' : 'crédito'} no es legible`,
                })
                continue
            }
            monto = (cre ?? CERO).abs().minus((deb ?? CERO).abs())
        }
        if (monto.isZero()) {
            ignoradas++
            continue
        }
        if (monto.decimalPlaces() > 2) {
            errores.push({ fila: numero, campo: 'monto', mensaje: 'El monto tiene más de 2 decimales' })
            continue
        }
        let saldo: string | null = null
        if (col.saldo !== null) {
            const s = leerImporte(fila[col.saldo] ?? null, decimal)
            if (s === 'ilegible') {
                errores.push({ fila: numero, campo: 'saldo', mensaje: 'El saldo no es legible' })
                continue
            }
            saldo = s === null ? null : aTexto(s)
        }
        const descripcion = (fila[col.descripcion] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
        if (!descripcion) {
            errores.push({ fila: numero, campo: 'descripcion', mensaje: 'La fila no tiene descripción' })
            continue
        }
        const referencia = col.referencia === null ? null : (fila[col.referencia] ?? null)
        lineas.push({
            fila: numero,
            fecha,
            descripcion,
            referencia: referencia ? referencia.replace(/\s+/g, ' ').trim().slice(0, 120) : null,
            monto: aTexto(monto),
            saldo,
        })
    }

    // Orden cronológico: del más reciente al más antiguo se invierte
    let invertido = false
    if (lineas.length > 1 && lineas[0]!.fecha > lineas[lineas.length - 1]!.fecha) {
        lineas.reverse()
        invertido = true
    }

    const saldosQueNoEncadenan: number[] = []
    let inicialColumna: Dec | null = null
    let finalColumna: Dec | null = null
    if (col.saldo !== null && lineas.length > 0 && lineas.every((l) => l.saldo !== null)) {
        inicialColumna = new D(lineas[0]!.saldo!).minus(lineas[0]!.monto)
        finalColumna = new D(lineas[lineas.length - 1]!.saldo!)
        let corriente = inicialColumna
        for (const l of lineas) {
            corriente = corriente.plus(l.monto)
            if (!corriente.equals(l.saldo!)) {
                saldosQueNoEncadenan.push(l.fila)
                corriente = new D(l.saldo!)
            }
        }
    }
    const conEtiquetas = inicialEtiqueta !== null || finalEtiqueta !== null
    const inicial = inicialEtiqueta ?? inicialColumna
    const final = finalEtiqueta ?? finalColumna
    return {
        lineas,
        errores,
        ignoradas,
        invertido,
        saldo_inicial: inicial === null ? null : aTexto(inicial),
        saldo_final: final === null ? null : aTexto(final),
        origen_saldos: conEtiquetas ? 'etiquetas' : inicialColumna !== null ? 'columna_saldo' : null,
        saldos_que_no_encadenan: saldosQueNoEncadenan,
    }
}
