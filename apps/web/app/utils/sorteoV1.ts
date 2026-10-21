/**
 * `argos-sorteo-v1` (`contratos/lealtad.md` §7.3) con Web Crypto: el mismo cálculo que
 * `apps/api/app/lealtad/sorteo_v1.ts` y `scripts/verificar-sorteo.mjs`. El panel lo usa para
 * comprobar, con los datos públicos de `GET /lealtad/sorteos/:id/verificacion`, que el resultado se
 * reproduce. Nunca elige: el resultado lo calcula la API (la ruleta solo lo muestra).
 */

export const ALGORITMO_SORTEO_V1 = 'argos-sorteo-v1'

export interface BoletosSorteo {
    codigo: string
    boletos: number
}

const codificador = new TextEncoder()

function aHex(bytes: ArrayBuffer | Uint8Array): string {
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Bytes de un texto hexadecimal (la semilla revelada). */
export function bytesDeHex(hex: string): Uint8Array<ArrayBuffer> {
    const limpio = hex.trim().toLowerCase()
    if (!/^(?:[0-9a-f]{2})*$/.test(limpio)) {
        throw new Error('Hexadecimal inválido')
    }
    const bytes = new Uint8Array(limpio.length / 2)
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number.parseInt(limpio.slice(i * 2, i * 2 + 2), 16)
    }
    return bytes
}

/** SHA-256 en hexadecimal de un texto (UTF-8) o de unos bytes. */
export async function sha256SorteoHex(datos: string | Uint8Array<ArrayBuffer>): Promise<string> {
    const bytes = typeof datos === 'string' ? codificador.encode(datos) : datos
    return aHex(await crypto.subtle.digest('SHA-256', bytes))
}

async function hmacSorteo(clave: Uint8Array<ArrayBuffer>, mensaje: string): Promise<Uint8Array<ArrayBuffer>> {
    const llave = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return new Uint8Array(await crypto.subtle.sign('HMAC', llave, codificador.encode(mensaje)))
}

/** `lista_hash` = SHA-256 de las líneas `codigo|boletos\n`, en el orden de la lista (`codigo_publico`). */
export function hashListaSorteo(lista: readonly BoletosSorteo[]): Promise<string> {
    return sha256SorteoHex(lista.map(p => `${p.codigo}|${p.boletos}\n`).join(''))
}

/** `semilla_final = HMAC-SHA256(s, lista_hash ‖ bases_hash ‖ valor_publico)`, en hexadecimal. */
export async function semillaFinalSorteo(semilla: Uint8Array<ArrayBuffer>, listaHash: string, basesHash: string, valorPublico: string): Promise<string> {
    return aHex(await hmacSorteo(semilla, `${listaHash}${basesHash}${valorPublico}`))
}

/** Códigos elegidos en orden (titulares y luego suplentes), `cuantos` como máximo. */
export async function sortearV1(
    semilla: Uint8Array<ArrayBuffer>,
    listaHash: string,
    basesHash: string,
    valorPublico: string,
    lista: readonly BoletosSorteo[],
    cuantos: number,
): Promise<string[]> {
    const final = await hmacSorteo(semilla, `${listaHash}${basesHash}${valorPublico}`)
    const restantes = [...lista]
    const elegidos: string[] = []
    for (let i = 0; elegidos.length < cuantos && restantes.length > 0; i++) {
        const total = BigInt(restantes.reduce((n, p) => n + p.boletos, 0))
        const r = BigInt(`0x${aHex(await hmacSorteo(final, `${ALGORITMO_SORTEO_V1}:${i}`))}`)
        const limite = (2n ** 256n / total) * total
        if (r >= limite) {
            continue // rechazo: sin sesgo de módulo
        }
        let boleto = r % total
        const k = restantes.findIndex(p => (boleto -= BigInt(p.boletos)) < 0n)
        const elegido = restantes[k]
        if (!elegido) {
            break
        }
        elegidos.push(elegido.codigo)
        restantes.splice(k, 1) // sale con todos sus boletos
    }
    return elegidos
}

/** JSON canónico: claves ordenadas en cada objeto, sin espacios (para `bases_hash`). */
export function jsonCanonicoSorteo(valor: unknown): string {
    if (valor === null || valor === undefined || typeof valor !== 'object') {
        return JSON.stringify(valor ?? null)
    }
    if (Array.isArray(valor)) {
        return `[${valor.map(jsonCanonicoSorteo).join(',')}]`
    }
    const objeto = valor as Record<string, unknown>
    const claves = Object.keys(objeto).filter(k => objeto[k] !== undefined).sort()
    return `{${claves.map(k => `${JSON.stringify(k)}:${jsonCanonicoSorteo(objeto[k])}`).join(',')}}`
}

export interface ComprobacionSorteo {
    /** SHA-256 de la semilla revelada = compromiso publicado con las bases. */
    compromiso: boolean
    /** SHA-256 de la lista publicada = `lista_hash`. */
    lista: boolean
    /** SHA-256 del documento de bases = `bases_hash`. */
    bases: boolean
    /** Los elegidos que salen al recalcular = los ganadores publicados, en el mismo orden. */
    ganadores: boolean
    elegidos: string[]
}

/**
 * Recalcula el sorteo con los datos públicos de la verificación, como `scripts/verificar-sorteo.mjs`:
 * compromiso, hash de la lista, hash de las bases y los elegidos.
 */
export async function comprobarSorteo(v: {
    bases_hash: string
    bases: Record<string, unknown>
    compromiso: string
    semilla: string
    valor_publico: string
    lista_hash: string
    lista: readonly BoletosSorteo[]
    titulares: number
    suplentes: number
    ganadores: readonly { posicion: number, codigo: string }[]
}): Promise<ComprobacionSorteo> {
    const semilla = bytesDeHex(v.semilla)
    const [compromiso, lista, bases] = await Promise.all([
        sha256SorteoHex(semilla),
        hashListaSorteo(v.lista),
        sha256SorteoHex(jsonCanonicoSorteo(v.bases)),
    ])
    const elegidos = await sortearV1(semilla, v.lista_hash, v.bases_hash, v.valor_publico, v.lista, v.titulares + v.suplentes)
    const publicados = [...v.ganadores].sort((a, b) => a.posicion - b.posicion).map(g => g.codigo)
    return {
        compromiso: compromiso === v.compromiso,
        lista: lista === v.lista_hash,
        bases: bases === v.bases_hash,
        ganadores: elegidos.length === publicados.length && elegidos.every((c, i) => c === publicados[i]),
        elegidos,
    }
}
