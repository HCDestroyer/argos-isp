import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import type { ContextoAccion } from '#shared/contexto'
import type { CatalogoEventos } from '#shared/eventos'

/**
 * Reglas comunes de la red de acceso (`contratos/red-acceso.md`): unicidad con código propio,
 * referencias del mismo router, gateway obligatorio, empresa y el evento `red_acceso.cambiada`.
 */

export const MAX_VLANS_POR_PUERTO = 2

/** 409 con `codigo` si ya hay una fila que cumple `donde` (salvo `exceptoId`). */
export async function exigirUnico(
    trx: TransactionClientContract,
    tabla: string,
    donde: (q: any) => void,
    codigo: string,
    mensaje: string,
    exceptoId?: number,
) {
    const q = trx.from(tabla).select('id')
    donde(q)
    if (exceptoId) q.whereNot('id', exceptoId)
    if (await q.first()) throw new Conflicto(mensaje, codigo)
}

export const campo = (field: string, message: string, rule: string) =>
    new ValidacionFallida([{ field, message, rule }], message)

/** La empresa explícita exige acceso (403); null = compartida. */
export function exigirEmpresa(ctx: ContextoAccion, empresaId: number | null | undefined) {
    if (empresaId !== null && empresaId !== undefined) exigirAccesoEmpresa(ctx, empresaId)
}

/** Un recurso con empresa se abre si es de cualquier empresa del alcance (403 si no). */
export function exigirVisible(ctx: ContextoAccion, empresaId: number | null) {
    if (empresaId !== null) exigirAccesoEmpresa(ctx, empresaId)
}

export async function exigirRouter(trx: TransactionClientContract, routerId: number) {
    const router = (await trx.from('network.routers').where('id', routerId).select('id').first()) as {
        id: number
    } | null
    if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
}

/** Red IPv4 del router con gateway (la única fuente del `local-address`, §2). */
export async function exigirRedConGateway(
    trx: TransactionClientContract,
    redId: number,
    routerId: number,
    field = 'red_ipv4_id',
): Promise<{ id: number; gateway: string }> {
    const red = (await trx
        .from('network.redes_ipv4')
        .where('id', redId)
        .select('id', 'router_id', 'cidr', trx.raw('host(gateway) AS gateway'))
        .first()) as { id: number; router_id: number; cidr: string; gateway: string | null } | null
    if (!red || Number(red.router_id) !== routerId) {
        throw campo(field, red ? 'La red IPv4 no es de este router' : 'La red IPv4 no existe', 'red')
    }
    if (!red.gateway) {
        throw campo(
            field,
            `La red ${red.cidr} no tiene gateway: el local-address del PPPoE sale del gateway de la red. ` +
                'Defínelo en la red IPv4 (PUT /redes-ipv4/:id) antes de usarla',
            'red_sin_gateway',
        )
    }
    return { id: Number(red.id), gateway: red.gateway }
}

/** Pool IPv6 de un bloque del router y del tipo pedido. */
export async function exigirPoolIpv6(
    trx: TransactionClientContract,
    poolId: number,
    routerId: number,
    tipo: 'enlace' | 'delegacion',
    field: string,
) {
    const pool = (await trx
        .from('network.ipv6_pools as p')
        .join('network.ipv6_bloques as b', 'b.id', 'p.bloque_id')
        .where('p.id', poolId)
        .select('b.router_id', 'p.tipo')
        .first()) as { router_id: number; tipo: string } | null
    if (!pool || Number(pool.router_id) !== routerId || pool.tipo !== tipo) {
        const nombre = tipo === 'enlace' ? 'de enlace' : 'de delegación'
        throw campo(field, `El pool IPv6 no existe, no es de este router o no es ${nombre}`, 'pool_ipv6')
    }
}

/** Un adoptado no se edita en lo que es de RouterOS (Argos nunca lo toca en el router). */
export function exigirCamposArgos(
    estado: string,
    cambios: Record<string, unknown>,
    camposArgos: readonly string[],
) {
    if (estado !== 'adoptado') return
    const ajenos = Object.keys(cambios).filter((c) => cambios[c] !== undefined && !camposArgos.includes(c))
    if (ajenos.length === 0) return
    throw new ValidacionFallida(
        ajenos.map((c) => ({
            field: c,
            rule: 'adoptado_solo_lectura',
            message: 'Es un objeto adoptado: este campo vive en el router y Argos no lo cambia',
        })),
        `Es un objeto adoptado del router: solo se editan ${camposArgos.join(', ')}`,
    )
}

/** Columnas con valor distinto entre dos filas (para `campos[]` del evento). */
export function camposCambiados(antes: Record<string, unknown> | null, despues: Record<string, unknown>) {
    return Object.keys(despues)
        .filter((c) => !['version', 'created_at', 'updated_at', 'id'].includes(c))
        .filter((c) => JSON.stringify(antes?.[c] ?? null) !== JSON.stringify(despues[c] ?? null))
}

export async function emitirRedAcceso(t: Transaccion, payload: CatalogoEventos['red_acceso.cambiada']) {
    await t.emit('red_acceso.cambiada', payload)
}

/** 422 si quitar el gateway dejaría a un servidor PPPoE sin `local-address`. */
export async function exigirRedSinServidores(trx: TransactionClientContract, redId: number) {
    const servidores = (await trx
        .from('network.servidores_pppoe')
        .where('red_ipv4_id', redId)
        .select('nombre')) as Array<{ nombre: string }>
    if (servidores.length === 0) return
    throw campo(
        'gateway',
        `La red la usan los servidores PPPoE ${servidores.map((s) => `«${s.nombre}»`).join(', ')}: ` +
            'su local-address es el gateway, no se puede quitar',
        'red_con_servidor_pppoe',
    )
}
