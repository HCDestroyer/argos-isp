/**
 * Comparación de propiedades entre lo deseado y lo que devuelve RouterOS. El router guarda los
 * valores en su propia forma: `max-limit=5120k/20480k` vuelve como `5120000/20480000`, `yes` como
 * `true`, las MAC en mayúsculas, `16` segundos como `16s`. Sin normalizar, cada reconciliación
 * vería una diferencia y reescribiría el objeto.
 */

const MULTIPLICADOR: Record<string, number> = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, g: 1e9, G: 1e9 }

function token(valor: string): string {
    const t = valor.trim()
    if (t === 'yes' || t === 'true') return 'true'
    if (t === 'no' || t === 'false') return 'false'
    // Velocidades con sufijo (RouterOS usa múltiplos decimales: 1k = 1000).
    const velocidad = /^(\d+(?:\.\d+)?)([kKmMgG])$/.exec(t)
    if (velocidad) return String(Math.round(Number(velocidad[1]) * MULTIPLICADOR[velocidad[2]!]!))
    // Duraciones simples (`16s`, `1m`, `00:00:16`) a segundos.
    const segundos = /^(\d+)s$/.exec(t)
    if (segundos) return String(Number(segundos[1]))
    const hms = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(t)
    if (hms) return String(Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]))
    return t.toLowerCase()
}

/** Forma canónica de un valor para comparar (no para enviar). */
export function normalizarValor(valor: unknown): string {
    if (valor === null || valor === undefined) return ''
    const texto = typeof valor === 'string' ? valor : String(valor)
    // Separa por `/`, `,` y espacios conservando el separador: `5M/20M 10M/40M` → tokens.
    return texto
        .split(/([/,\s]+)/)
        .map((parte, i) => (i % 2 === 1 ? parte.replace(/\s+/g, ' ') : token(parte)))
        .join('')
}

export function mismoValor(a: unknown, b: unknown): boolean {
    return normalizarValor(a) === normalizarValor(b)
}

/** Propiedades de `deseado` que difieren en `actual` (las que el router no tiene también cuentan). */
export function diferencias(
    deseado: Record<string, string>,
    actual: Record<string, unknown>,
): Record<string, string> {
    const salida: Record<string, string> = {}
    for (const [clave, valor] of Object.entries(deseado)) {
        if (!mismoValor(valor, actual[clave])) salida[clave] = valor
    }
    return salida
}
