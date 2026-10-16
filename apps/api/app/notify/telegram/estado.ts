import db from '@adonisjs/lucid/services/db'
import type { Decimal } from 'decimal.js'
import { saldoCliente } from '#ledger/consultas'
import { saldoAnticipos } from '#billing/cobros'

/**
 * Lo que `/estado` muestra a un chat vinculado: por cada cliente con ese `telegram_chat_id`, su
 * primer nombre, sus servicios no retirados (número, plan, estado, promesa vigente), su saldo
 * (suma del auxiliar de CxC, `saldoCliente`) y su saldo a favor (anticipos sin aplicar,
 * `saldoAnticipos`), igual que `GET /clientes/:id/estado-cuenta`. Nada de NIT, usuario PPPoE, IPs
 * ni direcciones.
 */
export interface ServicioEstado {
    id: number
    plan: string
    estado: 'activo' | 'limitado' | 'suspendido'
    promesa_vence_en: Date | null
}

export interface CuentaChat {
    cliente_id: number
    nombre: string
    servicios: ServicioEstado[]
    saldo: Decimal
    a_favor: Decimal
}

export async function cuentasDelChat(chatId: string): Promise<CuentaChat[]> {
    const clientes = (await db
        .from('core.clientes')
        .where('telegram_chat_id', chatId)
        .orderBy('id')
        .select('id', 'nombre')) as Array<{ id: number; nombre: string }>
    const cuentas: CuentaChat[] = []
    for (const cliente of clientes) {
        const servicios = (await db
            .from('core.servicios as s')
            .join('network.planes as p', 'p.id', 's.plan_id')
            .leftJoin('billing.promesas as pr', (join) => {
                join.on('pr.servicio_id', 's.id').andOnVal('pr.estado', 'activa')
            })
            .where('s.cliente_id', cliente.id)
            .whereNot('s.estado', 'retirado')
            .orderBy('s.id')
            .select(
                's.id',
                'p.nombre as plan',
                's.estado',
                'pr.vence_en as promesa_vence_en',
            )) as ServicioEstado[]
        cuentas.push({
            cliente_id: cliente.id,
            nombre: cliente.nombre.trim().split(/\s+/)[0] ?? '',
            servicios,
            saldo: await saldoCliente(cliente.id),
            a_favor: await saldoAnticipos(db.connection(), cliente.id),
        })
    }
    return cuentas
}
