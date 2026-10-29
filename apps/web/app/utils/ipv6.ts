/**
 * Aritmética de prefijos para explicar el direccionamiento de un router: cuántas IPv4 tiene una red,
 * cuántos clientes caben en un pool IPv6, qué prefijo recibe cada uno y qué pool sugerir dentro de un
 * bloque sin pisar otro. Solo presentación: la API asigna y valida (un pool fuera de su bloque o
 * solapado responde 422).
 */

const BITS_V6 = 128n
const MAXIMO_V6 = (1n << BITS_V6) - 1n

export interface PrefijoV6 {
    red: bigint
    largo: number
}

/** `2001:db8::1` → número de 128 bits; `null` si no es una IPv6 válida. */
export function numeroIpv6(direccion: string): bigint | null {
    const texto = direccion.trim().toLowerCase()
    if (!/^[0-9a-f:]+$/.test(texto) || (texto.match(/::/g)?.length ?? 0) > 1) {
        return null
    }
    const [izquierda = '', derecha] = texto.split('::')
    const partesIzquierda = izquierda ? izquierda.split(':') : []
    const partesDerecha = derecha ? derecha.split(':') : []
    const faltan = 8 - partesIzquierda.length - partesDerecha.length
    if (derecha === undefined ? faltan !== 0 : faltan < 1) {
        return null
    }
    const grupos = [...partesIzquierda, ...Array<string>(derecha === undefined ? 0 : faltan).fill('0'), ...partesDerecha]
    if (grupos.length !== 8 || grupos.some(g => !/^[0-9a-f]{1,4}$/.test(g))) {
        return null
    }
    return grupos.reduce((total, grupo) => (total << 16n) + BigInt(Number.parseInt(grupo, 16)), 0n)
}

/** Número de 128 bits → IPv6 abreviada (RFC 5952: minúsculas y la racha de ceros más larga como `::`). */
export function textoIpv6(numero: bigint): string {
    const grupos = Array.from({ length: 8 }, (_, i) => Number((numero >> BigInt((7 - i) * 16)) & 0xFFFFn))
    let mejorInicio = -1
    let mejorLargo = 0
    for (let i = 0; i < 8;) {
        if (grupos[i] !== 0) {
            i++
            continue
        }
        let j = i
        while (j < 8 && grupos[j] === 0) {
            j++
        }
        if (j - i > mejorLargo && j - i >= 2) {
            mejorInicio = i
            mejorLargo = j - i
        }
        i = j
    }
    const hex = grupos.map(g => g.toString(16))
    if (mejorInicio === -1) {
        return hex.join(':')
    }
    return `${hex.slice(0, mejorInicio).join(':')}::${hex.slice(mejorInicio + mejorLargo).join(':')}`
}

/** `2001:db8:100::/40` → red (con los bits de host en cero) y largo; `null` si no es válido. */
export function prefijoV6(cidr: string): PrefijoV6 | null {
    const [direccion, largoTexto] = cidr.trim().split('/')
    const largo = Number(largoTexto)
    const numero = direccion ? numeroIpv6(direccion) : null
    if (numero === null || !Number.isInteger(largo) || largo < 0 || largo > 128) {
        return null
    }
    const mascara = largo === 0 ? 0n : (MAXIMO_V6 << (BITS_V6 - BigInt(largo))) & MAXIMO_V6
    return { red: numero & mascara, largo }
}

export function textoPrefijo(prefijo: PrefijoV6): string {
    return `${textoIpv6(prefijo.red)}/${prefijo.largo}`
}

/** Cuántos prefijos de `/tamano` caben en un `/largo` (0 si el tamaño es más grande que el pool). */
export function cuantosCaben(largo: number, tamano: number): bigint {
    return tamano < largo ? 0n : 1n << BigInt(tamano - largo)
}

/** El prefijo número `indice` (desde 0) de tamaño `/tamano` dentro de `prefijo`. */
export function subprefijo(prefijo: PrefijoV6, tamano: number, indice: bigint): PrefijoV6 {
    return { red: prefijo.red + (indice << BigInt(128 - tamano)), largo: tamano }
}

/** Si dos prefijos comparten alguna dirección (uno contiene al otro). */
export function seSolapan(a: PrefijoV6, b: PrefijoV6): boolean {
    const corto = Math.min(a.largo, b.largo)
    const desplazamiento = BigInt(128 - corto)
    return (a.red >> desplazamiento) === (b.red >> desplazamiento)
}

/** Si `interno` cae completo dentro de `externo`. */
export function contiene(externo: PrefijoV6, interno: PrefijoV6): boolean {
    return interno.largo >= externo.largo && seSolapan(externo, interno)
}

/** Cantidad grande en español (`4,096`; `16,777,216`). */
export function cantidadPrefijos(cantidad: bigint): string {
    return cantidad.toLocaleString('es-GT')
}

/** Parte del bloque que ocupa un pool (0 a 1), para dibujarlo a escala. */
export function fraccionDelBloque(bloque: PrefijoV6, pool: PrefijoV6): number {
    return pool.largo < bloque.largo ? 1 : 1 / 2 ** (pool.largo - bloque.largo)
}

interface PoolV6 {
    prefijo: string
    tipo: 'enlace' | 'delegacion'
    tamano_entrega: number
}

export interface ResumenIpv6 {
    /** Prefijos /64 de enlace que se pueden entregar (suma de los pools de enlace). */
    enlaces: bigint
    /** Prefijos delegados que se pueden entregar (suma de los pools de delegación). */
    delegados: bigint
    /** Clientes con IPv6 completa: cada uno necesita un enlace y un delegado. */
    clientes: bigint
    /** Tamaño del prefijo delegado (el del primer pool de delegación). */
    tamanoDelegado: number | null
    /** El primer y el segundo cliente: qué prefijos reciben. */
    ejemplos: { enlace: string | null, delegado: string | null }[]
    faltaEnlace: boolean
    faltaDelegacion: boolean
}

/** Resumen de los pools de uno o varios bloques: capacidad y ejemplo de lo que recibe cada cliente. */
export function resumenIpv6(pools: PoolV6[]): ResumenIpv6 {
    const enlace = pools.filter(p => p.tipo === 'enlace')
    const delegacion = pools.filter(p => p.tipo === 'delegacion')
    const suma = (lista: PoolV6[]) => lista.reduce((total, p) => {
        const prefijo = prefijoV6(p.prefijo)
        return prefijo ? total + cuantosCaben(prefijo.largo, p.tamano_entrega) : total
    }, 0n)
    const enlaces = suma(enlace)
    const delegados = suma(delegacion)
    const primeroEnlace = enlace[0] ? prefijoV6(enlace[0].prefijo) : null
    const primeroDelegado = delegacion[0] ? prefijoV6(delegacion[0].prefijo) : null
    const tamanoDelegado = delegacion[0]?.tamano_entrega ?? null
    const ejemplos = [0n, 1n].map(indice => ({
        enlace: primeroEnlace && enlace[0] && indice < cuantosCaben(primeroEnlace.largo, enlace[0].tamano_entrega) ? textoPrefijo(subprefijo(primeroEnlace, enlace[0].tamano_entrega, indice)) : null,
        delegado: primeroDelegado && tamanoDelegado && indice < cuantosCaben(primeroDelegado.largo, tamanoDelegado) ? textoPrefijo(subprefijo(primeroDelegado, tamanoDelegado, indice)) : null,
    }))
    return {
        enlaces,
        delegados,
        clientes: enlaces < delegados ? enlaces : delegados,
        tamanoDelegado,
        ejemplos,
        faltaEnlace: enlace.length === 0,
        faltaDelegacion: delegacion.length === 0,
    }
}

/**
 * Un prefijo libre dentro del bloque para un pool nuevo: para delegación, la primera mitad libre
 * del bloque (o el tamaño más grande que no pise otro pool); para enlace, un dieciseisavo al final.
 * `null` si el bloque está lleno o el tamaño no alcanza para lo que entrega.
 */
export function sugerirPool(bloqueCidr: string, ocupados: string[], tipo: 'enlace' | 'delegacion', tamanoEntrega: number): string | null {
    const bloque = prefijoV6(bloqueCidr)
    if (!bloque) {
        return null
    }
    const usados = ocupados.map(prefijoV6).filter((p): p is PrefijoV6 => p !== null)
    const preferido = Math.min(bloque.largo + (tipo === 'enlace' ? 4 : 1), tamanoEntrega)
    for (let tamano = preferido; tamano <= tamanoEntrega; tamano++) {
        const total = cuantosCaben(bloque.largo, tamano)
        // Se prueban como máximo 4096 posiciones: de sobra para un bloque real.
        const limite = total < 4096n ? total : 4096n
        for (let i = 0n; i < limite; i++) {
            const indice = tipo === 'enlace' ? total - 1n - i : i
            const candidato = subprefijo(bloque, tamano, indice)
            if (!usados.some(u => seSolapan(u, candidato))) {
                return textoPrefijo(candidato)
            }
        }
    }
    return null
}

/** Direcciones IPv4 utilizables de una red (sin red ni broadcast, ni el gateway si tiene). */
export function capacidadIpv4(cidr: string, conGateway: boolean): number | null {
    const largo = Number(cidr.split('/')[1])
    if (!Number.isInteger(largo) || largo < 0 || largo > 32) {
        return null
    }
    const total = 2 ** (32 - largo)
    const utiles = largo >= 31 ? total : total - 2
    return Math.max(0, utiles - (conGateway ? 1 : 0))
}

/** Estado de ocupación de una red o un pool: icono + texto + color. */
export function estadoOcupacion(porcentaje: number): { etiqueta: string, color: 'success' | 'warning' | 'error', icono: string } {
    if (porcentaje >= 90) {
        return { etiqueta: 'Casi lleno', color: 'error', icono: 'i-lucide-circle-alert' }
    }
    if (porcentaje >= 75) {
        return { etiqueta: 'Se está llenando', color: 'warning', icono: 'i-lucide-triangle-alert' }
    }
    return { etiqueta: 'Con espacio', color: 'success', icono: 'i-lucide-circle-check' }
}

/** Título en lenguaje simple de los rechazos de pools (`contratos/pools.md`), con qué hacer. */
export const RECHAZOS_POOLS: Record<string, { titulo: string, ayuda: string }> = {
    ips_asignadas_fuera: { titulo: 'Hay IPs en uso que quedarían fuera', ayuda: 'Estos servicios usan una IP que ya no estaría en la red o en su rango. Cambia su IP o amplía el rango.' },
    prefijos_asignados_fuera: { titulo: 'Hay prefijos en uso que quedarían fuera del pool', ayuda: 'Estos servicios usan un prefijo que ya no cabría en el pool. Agranda el pool o cámbiales el prefijo antes.' },
    pools_fuera_del_bloque: { titulo: 'Hay pools que quedarían fuera del bloque', ayuda: 'Achica o borra esos pools antes de achicar el bloque.' },
    pool_con_asignaciones: { titulo: 'El pool tiene prefijos en uso', ayuda: 'El tipo y el tamaño que entrega solo se cambian cuando ningún servicio usa el pool.' },
    pool_con_servicios: { titulo: 'Hay servicios usando estas direcciones', ayuda: 'Marca «Mover también los servicios» para que pasen al otro router conservando sus direcciones.' },
    servicio_no_migrable: { titulo: 'Un servicio no puede pasar al otro router', ayuda: 'Revisa que su plan esté disponible en el router de destino y que este tenga pools con espacio.' },
    red_traslapada: { titulo: 'La red se cruza con otra', ayuda: 'Elige un rango que no use otra red registrada.' },
    bloque_traslapado: { titulo: 'El bloque se cruza con otro', ayuda: 'Revisa el prefijo: ya hay un bloque que usa parte de ese rango.' },
    pool_traslapado: { titulo: 'El pool se cruza con otro', ayuda: 'Usa «Sugerir» para tomar un prefijo libre del bloque.' },
    router_inactivo: { titulo: 'El router de destino está inactivo', ayuda: 'Actívalo en «Editar» o elige otro router.' },
}
