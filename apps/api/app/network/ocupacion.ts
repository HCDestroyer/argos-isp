import { capacidad, subprefijoCorto } from '#network/ipv6'

/**
 * Ocupación de los pools (`contratos/pools.md` §2), calculada en SQL sin cargar las IPs: cada
 * fragmento es una subconsulta escalar que devuelve un objeto JSON
 * `{ total, asignadas, libres, reservadas, porcentaje }`.
 *
 * - IPv4 (por red): `total` = hosts utilizables (sin red ni broadcast en redes de /30 o más
 *   grandes). `asignadas` = IPs vigentes de servicios. `libres` = las que el sistema puede entregar
 *   (dentro del rango, sin el gateway). `reservadas` = el resto: el gateway y las que quedan fuera
 *   del rango.
 * - IPv6 (por pool, en unidades de `tamano_entrega`): `total` = prefijos que caben. `asignadas` =
 *   prefijos de ese tamaño entregados desde el pool. `reservadas` = unidades ocupadas por otros
 *   prefijos vigentes que se traslapan (p. ej. un estático manual de otro tamaño). `libres` = el resto.
 * - `porcentaje` = asignadas / (asignadas + libres) × 100, con un decimal (0 si no cabe nadie).
 */

export interface Ocupacion {
    total: number
    asignadas: number
    libres: number
    reservadas: number
    porcentaje: number
}

const PORCENTAJE = `CASE WHEN x.asignadas + x.libres <= 0 THEN 0
    ELSE round((100.0 * x.asignadas / (x.asignadas + x.libres))::numeric, 1) END`

/**
 * Límites de la red `r` como desplazamientos desde la dirección de red: `primero`/`ultimo`
 * utilizables y el rango asignable `ini`/`fin` (el rango configurado recortado a lo utilizable).
 */
export function sqlLimitesRedV4(r: string): string {
    return `(SELECT u.base, u.primero, u.ultimo,
                    GREATEST(u.primero, COALESCE(${r}.rango_inicio - u.base, u.primero)) AS ini,
                    LEAST(u.ultimo, COALESCE(${r}.rango_fin - u.base, u.ultimo)) AS fin
               FROM (SELECT host(network(${r}.cidr))::inet AS base,
                            CASE WHEN masklen(${r}.cidr) >= 31 THEN 0 ELSE 1 END::bigint AS primero,
                            (2::bigint ^ (32 - masklen(${r}.cidr)))::bigint
                                - CASE WHEN masklen(${r}.cidr) >= 31 THEN 1 ELSE 2 END AS ultimo) u)`
}

/** Subconsulta escalar con la ocupación de la red IPv4 de alias `r`. */
export function sqlOcupacionRedV4(r = 'r'): string {
    return `(SELECT json_build_object(
                'total', x.total, 'asignadas', x.asignadas, 'libres', x.libres,
                'reservadas', GREATEST(x.total - x.asignadas - x.libres, 0),
                'porcentaje', ${PORCENTAJE})
               FROM (SELECT k.ultimo - k.primero + 1 AS total,
                            a.asignadas,
                            GREATEST(GREATEST(k.fin - k.ini + 1, 0) - a.en_rango
                                - CASE WHEN ${r}.gateway IS NOT NULL
                                        AND host(${r}.gateway)::inet - k.base BETWEEN k.ini AND k.fin
                                       THEN 1 ELSE 0 END, 0) AS libres
                       FROM ${sqlLimitesRedV4(r)} k,
                            LATERAL (SELECT count(*) AS asignadas,
                                            count(*) FILTER (WHERE a.ip - k.base BETWEEN k.ini AND k.fin) AS en_rango
                                       FROM network.ipv4_asignaciones a
                                      WHERE a.red_id = ${r}.id AND a.fin IS NULL) a) x)`
}

/** Subconsulta escalar con la ocupación del pool IPv6 de alias `p`. */
export function sqlOcupacionPoolV6(p = 'p'): string {
    return `(SELECT json_build_object(
                'total', x.total, 'asignadas', x.asignadas,
                'libres', GREATEST(x.total - x.ocupadas, 0),
                'reservadas', GREATEST(x.ocupadas - x.asignadas, 0),
                'porcentaje', CASE WHEN x.asignadas + GREATEST(x.total - x.ocupadas, 0) <= 0 THEN 0
                    ELSE round((100.0 * x.asignadas / (x.asignadas + GREATEST(x.total - x.ocupadas, 0)))::numeric, 1) END)
               FROM (SELECT power(2::float8, ${p}.tamano_entrega - masklen(${p}.prefijo)) AS total,
                            count(*) FILTER (
                                WHERE a.pool_id = ${p}.id AND masklen(a.prefijo) = ${p}.tamano_entrega
                            )::float8 AS asignadas,
                            COALESCE(sum(power(2::float8, ${p}.tamano_entrega
                                    - GREATEST(masklen(a.prefijo), masklen(${p}.prefijo))))
                                FILTER (WHERE masklen(a.prefijo) <= ${p}.tamano_entrega), 0)
                            + count(DISTINCT set_masklen(a.prefijo, ${p}.tamano_entrega))
                                FILTER (WHERE masklen(a.prefijo) > ${p}.tamano_entrega) AS ocupadas
                       FROM network.ipv6_asignaciones a
                      WHERE a.fin IS NULL AND a.prefijo && ${p}.prefijo) x)`
}

/** Suma ocupaciones (resumen por router); el porcentaje se recalcula. */
export function sumarOcupaciones(lista: Ocupacion[]): Ocupacion {
    const suma = lista.reduce(
        (acc, o) => ({
            total: acc.total + o.total,
            asignadas: acc.asignadas + o.asignadas,
            libres: acc.libres + o.libres,
            reservadas: acc.reservadas + o.reservadas,
        }),
        { total: 0, asignadas: 0, libres: 0, reservadas: 0 },
    )
    const base = suma.asignadas + suma.libres
    return { ...suma, porcentaje: base <= 0 ? 0 : Math.round((1000 * suma.asignadas) / base) / 10 }
}

export type TipoPoolV6 = 'enlace' | 'delegacion'

/** Qué recibe cada servicio de un pool IPv6 (para explicarlo en el panel). */
export interface EntregaPoolV6 {
    /** atributo RADIUS con el que viaja el prefijo */
    atributo_radius: 'Framed-IPv6-Prefix' | 'Delegated-IPv6-Prefix'
    /** /64 que el router del cliente puede repartir en su LAN (1 en un pool de enlace) */
    redes_lan_por_cliente: number
    /** cuántos servicios caben en el pool */
    clientes_maximos: number
    primer_prefijo: string
    segundo_prefijo: string | null
    ultimo_prefijo: string
}

export function entregaPoolV6(prefijo: string, tipo: TipoPoolV6, tamano: number): EntregaPoolV6 {
    const cuantos = capacidad(prefijo, tamano)
    return {
        atributo_radius: tipo === 'enlace' ? 'Framed-IPv6-Prefix' : 'Delegated-IPv6-Prefix',
        redes_lan_por_cliente: tipo === 'enlace' ? 1 : 2 ** (64 - tamano),
        clientes_maximos: Number(cuantos),
        primer_prefijo: subprefijoCorto(prefijo, tamano, 0n),
        segundo_prefijo: cuantos > 1n ? subprefijoCorto(prefijo, tamano, 1n) : null,
        ultimo_prefijo: subprefijoCorto(prefijo, tamano, cuantos - 1n),
    }
}
