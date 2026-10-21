import { createHash, createHmac } from 'node:crypto'

/**
 * Algoritmo `argos-sorteo-v1` (`contratos/lealtad.md` §7.3). Nunca cambia: una versión nueva es
 * `argos-sorteo-v2` y los sorteos viejos se verifican con la que registraron. El script
 * `scripts/verificar-sorteo.mjs` es una copia sin dependencias de este cálculo.
 *
 * - `semilla_final = HMAC-SHA256(clave = s, mensaje = lista_hash ‖ bases_hash ‖ valor_publico)`.
 * - `r_i = HMAC-SHA256(semilla_final, "argos-sorteo-v1:" ‖ i)` como entero de 256 bits; con `T` boletos
 *   restantes se descarta `r_i ≥ ⌊2²⁵⁶ / T⌋ · T` (sin sesgo de módulo) y el boleto es `r_i mod T`,
 *   ubicado en la lista (orden de `codigo_publico`) por boletos acumulados.
 * - El elegido sale con todos sus boletos; primero titulares, luego suplentes.
 */

export const ALGORITMO_SORTEO = 'argos-sorteo-v1'

export interface Boletos {
    codigo: string
    boletos: number
}

function hmac(clave: Buffer, mensaje: string): Buffer {
    return createHmac('sha256', clave).update(mensaje, 'utf8').digest()
}

export function sha256Hex(datos: string | Buffer): string {
    return createHash('sha256').update(datos).digest('hex')
}

/** `lista_hash` = SHA-256 de las líneas `codigo_publico|boletos\n` en orden de `codigo_publico`. */
export function hashLista(lista: Boletos[]): string {
    return sha256Hex(lista.map((p) => `${p.codigo}|${p.boletos}\n`).join(''))
}

export function semillaFinal(s: Buffer, listaHash: string, basesHash: string, valorPublico: string): Buffer {
    return hmac(s, `${listaHash}${basesHash}${valorPublico}`)
}

/** Códigos elegidos en orden (titulares y luego suplentes), `cuantos` como máximo. */
export function sortear(
    s: Buffer,
    listaHash: string,
    basesHash: string,
    valorPublico: string,
    lista: Boletos[],
    cuantos: number,
): string[] {
    const final = semillaFinal(s, listaHash, basesHash, valorPublico)
    const restantes = [...lista]
    const elegidos: string[] = []
    for (let i = 0; elegidos.length < cuantos && restantes.length > 0; i++) {
        const total = BigInt(restantes.reduce((n, p) => n + p.boletos, 0))
        const r = BigInt('0x' + hmac(final, `${ALGORITMO_SORTEO}:${i}`).toString('hex'))
        const limite = (2n ** 256n / total) * total
        if (r >= limite) continue // rechazo: sin sesgo de módulo
        let boleto = r % total
        const k = restantes.findIndex((p) => (boleto -= BigInt(p.boletos)) < 0n)
        elegidos.push(restantes[k]!.codigo)
        restantes.splice(k, 1)
    }
    return elegidos
}

/** JSON canónico: claves ordenadas en cada objeto, sin espacios (para `bases_hash`). */
export function jsonCanonico(valor: unknown): string {
    if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null)
    if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`
    const objeto = valor as Record<string, unknown>
    const claves = Object.keys(objeto)
        .filter((k) => objeto[k] !== undefined)
        .sort()
    return `{${claves.map((k) => `${JSON.stringify(k)}:${jsonCanonico(objeto[k])}`).join(',')}}`
}
