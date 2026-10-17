/**
 * Generador pseudoaleatorio con semilla (mulberry32): la misma semilla da la misma secuencia de
 * pasos, así un hallazgo del escenario generativo se reproduce con su número.
 */
export class Azar {
    private estado: number

    constructor(readonly semilla: number) {
        this.estado = semilla >>> 0
    }

    /** [0, 1) */
    siguiente(): number {
        this.estado = (this.estado + 0x6d2b79f5) >>> 0
        let t = this.estado
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    /** Entero en [min, max] */
    entero(min: number, max: number): number {
        return min + Math.floor(this.siguiente() * (max - min + 1))
    }

    elegir<T>(lista: readonly T[]): T {
        if (lista.length === 0) throw new Error('elegir de una lista vacía')
        return lista[this.entero(0, lista.length - 1)]!
    }

    /** true con probabilidad p */
    moneda(p = 0.5): boolean {
        return this.siguiente() < p
    }

    /** Elige una clave según su peso. */
    ponderado<K extends string>(pesos: Record<K, number>): K {
        const claves = Object.keys(pesos) as K[]
        const total = claves.reduce((s, k) => s + pesos[k], 0)
        let r = this.siguiente() * total
        for (const k of claves) {
            r -= pesos[k]
            if (r < 0) return k
        }
        return claves[claves.length - 1]!
    }

    /**
     * Centavos enteros en [min, max] (los montos se arman como texto "123.45": nunca `number` con
     * decimales para dinero).
     */
    centavos(min: number, max: number): bigint {
        return BigInt(this.entero(min, max))
    }
}

/** Texto "Q.CC" a partir de centavos enteros. */
export function texto(centavos: bigint): string {
    const negativo = centavos < 0n
    const abs = negativo ? -centavos : centavos
    const entero = abs / 100n
    const resto = (abs % 100n).toString().padStart(2, '0')
    return `${negativo ? '-' : ''}${entero}.${resto}`
}

/** Centavos enteros desde un texto decimal con 2 decimales como mucho ("150.5" → 15050n). */
export function centavosDe(valor: string): bigint {
    const negativo = valor.trim().startsWith('-')
    const [entero, decimales = ''] = valor.trim().replace('-', '').split('.')
    const c = BigInt(entero || '0') * 100n + BigInt((decimales + '00').slice(0, 2))
    return negativo ? -c : c
}
