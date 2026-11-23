/**
 * Resumen legible de una corrida («24 facturas emitidas, 3 moras aplicadas») a partir de lo que
 * devolvió el cron. Cada cron del catálogo declara sus `contadores` (qué cuenta como cambio) y sus
 * `errores` (errores parciales); aquí no se conoce el tipo exacto de cada resultado, solo rutas.
 *
 * Rutas:
 * - `campo` o `campo.sub`: un número, el largo de una lista, 1 si es un texto no vacío u objeto, 0 si es null.
 * - `$`: el resultado mismo (1 si no es null).
 * - `[]`: el resultado es una lista y cuenta sus elementos; `[].campo` suma `campo` de cada elemento.
 */

export interface Contador {
    ruta: string
    uno: string
    varios: string
}

export type EstadoCorrida = 'ok' | 'sin_cambios' | 'error'

export interface Resumen {
    estado: EstadoCorrida
    resumen: string
    error: string | null
    detalle: Record<string, number>
}

function contar(valor: unknown): number {
    if (valor === null || valor === undefined || valor === false) return 0
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0
    if (Array.isArray(valor)) return valor.length
    if (typeof valor === 'string') return valor.trim() === '' ? 0 : 1
    return 1
}

function leer(objeto: unknown, partes: string[]): unknown {
    let actual: unknown = objeto
    for (const parte of partes) {
        if (actual === null || typeof actual !== 'object') return undefined
        actual = (actual as Record<string, unknown>)[parte]
    }
    return actual
}

export function valorRuta(resultado: unknown, ruta: string): number {
    if (ruta === '$') return contar(resultado)
    if (ruta === '[]') return Array.isArray(resultado) ? resultado.length : 0
    if (ruta.startsWith('[].')) {
        if (!Array.isArray(resultado)) return 0
        const partes = ruta.slice(3).split('.')
        return resultado.reduce((suma: number, item) => suma + contar(leer(item, partes)), 0)
    }
    return contar(leer(resultado, ruta.split('.')))
}

const formato = new Intl.NumberFormat('es-GT')

/**
 * `{ omitido, resultado }` de los `conLock` de los módulos → el resultado. `omitido: true` en el nivel
 * de arriba es siempre «no corrió»: otra instancia tenía el lock (o, en `conciliar`, no hay pasarela).
 */
export function desenvolver(salida: unknown): { omitido: boolean; resultado: unknown } {
    if (salida && typeof salida === 'object' && !Array.isArray(salida) && 'omitido' in salida) {
        const s = salida as { omitido: unknown; resultado?: unknown }
        if (s.omitido === true) return { omitido: true, resultado: null }
        // solo el sobre de `conLock`; otros resultados (colgadas) traen `omitido: false` como dato
        if (Object.keys(salida).every((k) => k === 'omitido' || k === 'resultado')) {
            return { omitido: false, resultado: s.resultado }
        }
    }
    return { omitido: false, resultado: salida }
}

export function resumir(resultado: unknown, spec: { contadores?: Contador[]; errores?: string[] }): Resumen {
    const detalle: Record<string, number> = {}
    const partes: string[] = []
    let cambios = 0
    for (const contador of spec.contadores ?? []) {
        const n = valorRuta(resultado, contador.ruta)
        detalle[contador.ruta] = n
        if (n > 0) {
            cambios += n
            partes.push(`${formato.format(n)} ${n === 1 ? contador.uno : contador.varios}`)
        }
    }
    const errores = (spec.errores ?? []).reduce((suma, ruta) => suma + valorRuta(resultado, ruta), 0)
    if (errores > 0) detalle.errores = errores

    if (!spec.contadores) {
        return { estado: errores > 0 ? 'error' : 'ok', resumen: 'Corrida completada', error: null, detalle }
    }
    const resumen = partes.length > 0 ? partes.join(', ') : 'Nada pendiente'
    if (errores > 0) {
        return {
            estado: 'error',
            resumen,
            error: errores === 1 ? '1 elemento falló' : `${formato.format(errores)} elementos fallaron`,
            detalle,
        }
    }
    return { estado: cambios > 0 ? 'ok' : 'sin_cambios', resumen, error: null, detalle }
}
