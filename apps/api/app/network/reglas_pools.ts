import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { Conflicto, ReglaNegocio, ValidacionFallida, type ErrorCampo } from '#shared/errores'

/**
 * Reglas comunes de crear y editar pools (`contratos/pools.md`): forma de una red IPv4 y qué
 * direcciones asignadas quedarían fuera al achicarla. Todo dentro de la transacción de la acción.
 */

/** Máximo de elementos que se listan en `errors[]` (el `detail` dice el total). */
export const MAXIMO_LISTA = 100

export interface DatosRedIpv4 {
    cidr: string
    gateway: string | null
    rango_inicio: string | null
    rango_fin: string | null
}

/**
 * 422 por campo si la red no viene normalizada, si el gateway no es de la red (o es la dirección
 * de red o el broadcast), o si el rango está incompleto, invertido o fuera de la red.
 * Devuelve el CIDR normalizado.
 */
export async function validarRedIpv4(trx: TransactionClientContract, datos: DatosRedIpv4): Promise<string> {
    const { rows } = (await trx.rawQuery(
        `SELECT network(?::inet)::text AS red,
                masklen(?::inet) < 31 AS con_broadcast,
                host(network(?::inet)) AS direccion_red,
                host(broadcast(?::inet)) AS broadcast`,
        [datos.cidr, datos.cidr, datos.cidr, datos.cidr],
    )) as { rows: Array<{ red: string; con_broadcast: boolean; direccion_red: string; broadcast: string }> }
    const red = rows[0]!
    if (red.red !== datos.cidr) {
        throw new ValidacionFallida([
            {
                field: 'cidr',
                message: `Escribe la red como ${red.red} (sin bits de host)`,
                rule: 'cidr',
            },
        ])
    }

    const errores: ErrorCampo[] = []
    const dentro = async (ip: string) => {
        const { rows: r } = (await trx.rawQuery(`SELECT ?::cidr >>= ?::inet AS dentro`, [red.red, ip])) as {
            rows: Array<{ dentro: boolean }>
        }
        return r[0]!.dentro
    }
    const esExtremo = (ip: string) => red.con_broadcast && (ip === red.direccion_red || ip === red.broadcast)

    if (datos.gateway) {
        if (!(await dentro(datos.gateway))) {
            errores.push({
                field: 'gateway',
                message: `El gateway debe ser una IP de la red ${red.red}`,
                rule: 'gateway',
            })
        } else if (esExtremo(datos.gateway)) {
            errores.push({
                field: 'gateway',
                message: 'El gateway no puede ser la dirección de red ni el broadcast',
                rule: 'gateway',
            })
        }
    }

    if ((datos.rango_inicio === null) !== (datos.rango_fin === null)) {
        const falta = datos.rango_inicio === null ? 'rango_inicio' : 'rango_fin'
        errores.push({
            field: falta,
            message: 'Indica el inicio y el fin del rango, o deja los dos vacíos para usar toda la red',
            rule: 'rango',
        })
    } else if (datos.rango_inicio && datos.rango_fin) {
        for (const campo of ['rango_inicio', 'rango_fin'] as const) {
            if (!(await dentro(datos[campo]!))) {
                errores.push({
                    field: campo,
                    message: `El rango debe estar dentro de la red ${red.red}`,
                    rule: 'rango',
                })
            }
        }
        const { rows: orden } = (await trx.rawQuery(`SELECT ?::inet <= ?::inet AS ordenado`, [
            datos.rango_inicio,
            datos.rango_fin,
        ])) as { rows: Array<{ ordenado: boolean }> }
        if (!orden[0]!.ordenado) {
            errores.push({
                field: 'rango_fin',
                message: 'El fin del rango debe ser igual o posterior al inicio',
                rule: 'rango',
            })
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores, errores[0]!.message)
    return red.red
}

/** 409 si la red se traslapa con otra (de cualquier router), sin contar `excluirId`. */
export async function exigirRedSinTraslape(trx: TransactionClientContract, cidr: string, excluirId?: number) {
    const consulta = trx
        .from('network.redes_ipv4')
        .whereRaw('cidr && ?::cidr', [cidr])
        .select(trx.raw('cidr::text AS cidr'))
    if (excluirId) consulta.whereNot('id', excluirId)
    const traslape = (await consulta.first()) as { cidr: string } | null
    if (traslape) throw new Conflicto(`La red se traslapa con ${traslape.cidr}`, 'red_traslapada')
}

interface IpFuera {
    ip: string
    servicio_id: number
    user_ppp: string | null
    motivo: 'fuera_de_red' | 'extremo' | 'gateway' | 'fuera_de_rango'
}

const CAMPO_POR_MOTIVO: Record<IpFuera['motivo'], string> = {
    fuera_de_red: 'cidr',
    extremo: 'cidr',
    gateway: 'gateway',
    fuera_de_rango: 'rango_inicio',
}

const TEXTO_POR_MOTIVO: Record<IpFuera['motivo'], string> = {
    fuera_de_red: 'quedaría fuera de la red',
    extremo: 'sería la dirección de red o el broadcast',
    gateway: 'sería el gateway',
    fuera_de_rango: 'quedaría fuera del rango',
}

/**
 * 422 `ips_asignadas_fuera` con la lista (una entrada por IP: `field` = el campo que la deja
 * fuera) si alguna IP vigente de la red quedaría inválida con los datos nuevos.
 */
export async function exigirIpsAsignadasDentro(
    trx: TransactionClientContract,
    redId: number,
    datos: DatosRedIpv4,
) {
    const { rows } = (await trx.rawQuery(
        `SELECT host(a.ip) AS ip, a.servicio_id, s.user_ppp,
                CASE WHEN NOT (?::cidr >>= a.ip) THEN 'fuera_de_red'
                     WHEN masklen(?::cidr) < 31
                          AND a.ip IN (set_masklen(network(?::cidr)::inet, 32), set_masklen(broadcast(?::cidr), 32))
                          THEN 'extremo'
                     WHEN NULLIF(?, '')::inet IS NOT NULL AND host(a.ip) = host(NULLIF(?, '')::inet) THEN 'gateway'
                     WHEN NULLIF(?, '')::inet IS NOT NULL
                          AND NOT (a.ip BETWEEN NULLIF(?, '')::inet AND NULLIF(?, '')::inet) THEN 'fuera_de_rango'
                END AS motivo
           FROM network.ipv4_asignaciones a
           JOIN core.servicios s ON s.id = a.servicio_id
          WHERE a.red_id = ? AND a.fin IS NULL
          ORDER BY a.ip`,
        [
            datos.cidr,
            datos.cidr,
            datos.cidr,
            datos.cidr,
            // null viaja como '' (NULLIF lo vuelve NULL)
            datos.gateway ?? '',
            datos.gateway ?? '',
            datos.rango_inicio ?? '',
            datos.rango_inicio ?? '',
            datos.rango_fin ?? '',
            redId,
        ],
    )) as { rows: Array<IpFuera | (Omit<IpFuera, 'motivo'> & { motivo: null })> }
    const fuera = rows.filter((f): f is IpFuera => f.motivo !== null)
    if (fuera.length === 0) return
    throw new ReglaNegocio(
        `${fuera.length} IP asignadas quedarían fuera de la red con este cambio: libéralas o muévelas antes`,
        'ips_asignadas_fuera',
        fuera.slice(0, MAXIMO_LISTA).map((f) => ({
            field: CAMPO_POR_MOTIVO[f.motivo],
            message: `${f.ip} (servicio ${f.servicio_id}${f.user_ppp ? `, ${f.user_ppp}` : ''}) ${TEXTO_POR_MOTIVO[f.motivo]}`,
            rule: f.motivo,
        })),
    )
}
