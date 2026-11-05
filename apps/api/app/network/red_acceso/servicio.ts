import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'

/**
 * Servicio PPPoE → servidor PPPoE (`contratos/red-acceso.md` §3). Lo usan `servicios.crear` y
 * `servicios.editar` dentro de su transacción.
 */

export interface ServidorDelServicio {
    id: number
    nombre: string
    estado: 'administrado' | 'adoptado'
    red_ipv4_id: number | null
    ipv6_pool_enlace_id: number | null
    ipv6_pool_delegacion_id: number | null
}

const COLUMNAS = [
    'id',
    'nombre',
    'estado',
    'red_ipv4_id',
    'ipv6_pool_enlace_id',
    'ipv6_pool_delegacion_id',
    'empresa_id',
    'router_id',
    'activo',
]

type Fila = ServidorDelServicio & { empresa_id: number | null; router_id: number; activo: boolean }

function aServidor(f: Fila): ServidorDelServicio {
    return {
        id: Number(f.id),
        nombre: f.nombre,
        estado: f.estado,
        red_ipv4_id: f.red_ipv4_id === null ? null : Number(f.red_ipv4_id),
        ipv6_pool_enlace_id: f.ipv6_pool_enlace_id === null ? null : Number(f.ipv6_pool_enlace_id),
        ipv6_pool_delegacion_id:
            f.ipv6_pool_delegacion_id === null ? null : Number(f.ipv6_pool_delegacion_id),
    }
}

const error = (message: string, rule: string, field = 'servidor_pppoe_id') =>
    new ValidacionFallida([{ field, message, rule }], message)

/** Red IPv4 del router que contiene la IP pedida (o null). */
async function redDeIp(trx: TransactionClientContract, routerId: number, ip: string): Promise<number | null> {
    const fila = (await trx
        .from('network.redes_ipv4')
        .where('router_id', routerId)
        .whereRaw('cidr >>= ?::inet', [ip])
        .select('id')
        .first()) as { id: number } | null
    return fila ? Number(fila.id) : null
}

/**
 * El servidor PPPoE del servicio:
 * - `tipo` distinto de `pppoe`: siempre null (422 `servidor_pppoe` si se pidió uno).
 * - `servidorId` (número): ese, si es del router y está activo (422).
 * - `servidorId` undefined o null: se deriva. Candidatos = servidores activos del router; si se
 *   pidió `ipv4` o `redIpv4Id`, los que tienen esa red (si ninguno, todos). Uno → ese; ninguno →
 *   null (router sin servidores); varios → 422 `servidor_pppoe_requerido`.
 * - Un servidor de otra empresa (no compartido) → 422 `servidor_de_otra_empresa`.
 */
export async function resolverServidorServicio(
    trx: TransactionClientContract,
    entrada: {
        routerId: number
        tipo: string
        empresaId: number
        servidorId?: number | null
        ipv4?: string | null
        redIpv4Id?: number | null
    },
): Promise<ServidorDelServicio | null> {
    if (entrada.tipo !== 'pppoe') {
        if (entrada.servidorId) {
            throw error('Solo un servicio PPPoE tiene servidor PPPoE', 'servidor_pppoe')
        }
        return null
    }
    let elegido: Fila | null = null
    if (entrada.servidorId) {
        elegido = (await trx
            .from('network.servidores_pppoe')
            .where('id', entrada.servidorId)
            .select(COLUMNAS)
            .first()) as Fila | null
        if (!elegido || Number(elegido.router_id) !== entrada.routerId) {
            throw error(
                elegido ? 'El servidor PPPoE no es del router del servicio' : 'El servidor PPPoE no existe',
                'servidor_pppoe',
            )
        }
        if (!elegido.activo) {
            throw error(`El servidor PPPoE «${elegido.nombre}» está inactivo`, 'servidor_inactivo')
        }
    } else {
        const candidatos = (await trx
            .from('network.servidores_pppoe')
            .where('router_id', entrada.routerId)
            .where('activo', true)
            .orderBy('id')
            .select(COLUMNAS)) as Fila[]
        if (candidatos.length === 0) return null
        const redId =
            entrada.redIpv4Id ?? (entrada.ipv4 ? await redDeIp(trx, entrada.routerId, entrada.ipv4) : null)
        const deLaRed = redId ? candidatos.filter((c) => Number(c.red_ipv4_id) === redId) : []
        const opciones = deLaRed.length > 0 ? deLaRed : candidatos
        if (opciones.length > 1) {
            throw new ReglaNegocio(
                `El router tiene ${opciones.length} servidores PPPoE (${opciones.map((c) => `${c.id} «${c.nombre}»`).join(', ')}): ` +
                    'elige uno en servidor_pppoe_id',
                'servidor_pppoe_requerido',
                [
                    {
                        field: 'servidor_pppoe_id',
                        rule: 'servidor_pppoe_requerido',
                        message: 'Elige el servidor PPPoE del servicio',
                    },
                ],
            )
        }
        elegido = opciones[0]!
    }
    if (elegido.empresa_id !== null && Number(elegido.empresa_id) !== entrada.empresaId) {
        throw error(`El servidor PPPoE «${elegido.nombre}» es de otra empresa`, 'servidor_de_otra_empresa')
    }
    return aServidor(elegido)
}

/** El servidor que ya tiene el servicio, sin volver a validarlo (se conserva tal cual). */
export async function leerServidorServicio(
    trx: TransactionClientContract,
    servidorId: number | null,
): Promise<ServidorDelServicio | null> {
    if (!servidorId) return null
    const fila = (await trx
        .from('network.servidores_pppoe')
        .where('id', servidorId)
        .select(COLUMNAS)
        .first()) as Fila | null
    return fila ? aServidor(fila) : null
}
