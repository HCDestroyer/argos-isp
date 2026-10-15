/**
 * Aritmética IPv6 con BigInt para el IPAM (Postgres no suma más de 64 bits a un `inet`).
 * El texto que sale de aquí se normaliza al guardarlo como `cidr` en Postgres.
 */

export function aBigInt(direccion: string): bigint {
    let texto = direccion.trim().toLowerCase()
    // IPv4 embebida al final (::ffff:1.2.3.4)
    const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(texto)
    if (v4) {
        const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number]
        texto = texto.slice(0, v4.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
    }
    const [izq, der] = texto.split('::') as [string, string | undefined]
    const grupos = (s: string | undefined) => (s ? s.split(':') : [])
    const a = grupos(izq)
    const b = der === undefined ? [] : grupos(der)
    const faltan = der === undefined ? 0 : 8 - a.length - b.length
    const todos = [...a, ...Array.from({ length: faltan }, () => '0'), ...b]
    if (todos.length !== 8 || todos.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) {
        throw new Error(`Dirección IPv6 inválida: ${direccion}`)
    }
    return todos.reduce((acc, g) => (acc << 16n) | BigInt(Number.parseInt(g, 16)), 0n)
}

export function deBigInt(valor: bigint): string {
    const grupos: string[] = []
    for (let i = 7; i >= 0; i--) grupos.push(((valor >> BigInt(i * 16)) & 0xffffn).toString(16))
    return grupos.join(':')
}

export function separarPrefijo(prefijo: string): { red: bigint; largo: number } {
    const [direccion, largo] = prefijo.split('/') as [string, string]
    const n = Number(largo)
    const mascara = n === 0 ? 0n : ((1n << BigInt(n)) - 1n) << BigInt(128 - n)
    return { red: aBigInt(direccion) & mascara, largo: n }
}

/** i-ésimo subprefijo de tamaño `tamano` dentro de `pool`. */
export function subprefijo(pool: string, tamano: number, indice: bigint): string {
    const { red } = separarPrefijo(pool)
    return `${deBigInt(red + (indice << BigInt(128 - tamano)))}/${tamano}`
}

/** Índice de `prefijo` como subprefijo de `pool` (asume que está dentro). */
export function indiceEnPool(pool: string, prefijo: string, tamano: number): bigint {
    return (separarPrefijo(prefijo).red - separarPrefijo(pool).red) >> BigInt(128 - tamano)
}

/** Cantidad de subprefijos de tamaño `tamano` en `pool`. */
export function capacidad(pool: string, tamano: number): bigint {
    return 1n << BigInt(tamano - separarPrefijo(pool).largo)
}
