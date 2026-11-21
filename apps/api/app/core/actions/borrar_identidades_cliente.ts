import db from '@adonisjs/lucid/services/db'
import { DomainAction, type Transaccion } from '#shared/domain_action'

/** Meses después del retiro del cliente en que se borra su identidad (§3.4.3). */
export const MESES_RETENCION_IDENTIDAD = 12

export interface EntradaBorrarIdentidades {
    cliente_id: number
    ahora?: Date
}

/** SQL: el cliente ya no tiene servicios vivos y el último se retiró antes de `?` (límite). */
const SQL_RETIRADO_ANTES = `
    EXISTS (SELECT 1 FROM core.servicios s WHERE s.cliente_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM core.servicios s WHERE s.cliente_id = c.id AND s.estado <> 'retirado')
    AND (SELECT max(s.updated_at) FROM core.servicios s WHERE s.cliente_id = c.id) <= ?`

function limite(ahora: Date): Date {
    const fecha = new Date(ahora)
    fecha.setUTCMonth(fecha.getUTCMonth() - MESES_RETENCION_IDENTIDAD)
    return fecha
}

/**
 * `clientes.borrar_identidades` (cron `identidades_vencidas`, contrato Iris 0.10.0 §3.4.3, A41):
 * borra las identidades de un cliente retirado hace más de 12 meses (todos sus servicios
 * `retirado`; la fecha es la última actualización de esos servicios, que ya no se editan). Vuelve a
 * revisar la condición dentro de la transacción; si no aplica, no hace nada ni deja fila.
 */
export default class BorrarIdentidadesCliente extends DomainAction<
    EntradaBorrarIdentidades,
    { borradas: number }
> {
    readonly nombre = 'clientes.borrar_identidades'

    protected auditarExito(salida: { borradas: number }): boolean {
        return salida.borradas > 0
    }

    protected async handle(input: EntradaBorrarIdentidades, t: Transaccion): Promise<{ borradas: number }> {
        t.fijarEntidad('cliente', input.cliente_id)
        const aplica = await t.trx
            .from('core.clientes as c')
            .where('c.id', input.cliente_id)
            .whereRaw(SQL_RETIRADO_ANTES, [limite(input.ahora ?? new Date())])
            .select('c.id')
            .first()
        if (!aplica) return { borradas: 0 }
        const filas = (await t.trx
            .from('core.clientes_identidades')
            .where('cliente_id', input.cliente_id)
            .delete()
            .returning('id')) as Array<{ id: number }>
        for (const fila of filas) {
            await t.registrarCambios(
                { tipo: 'cliente_identidad', id: Number(fila.id) },
                { existe: true },
                { existe: false },
            )
        }
        return { borradas: filas.length }
    }
}

/** Clientes con identidades cuyo retiro tiene más de 12 meses hasta `ahora`. */
export async function clientesConIdentidadVencida(ahora: Date): Promise<number[]> {
    const filas = (await db
        .from('core.clientes as c')
        .whereExists((q) => q.from('core.clientes_identidades as i').whereRaw('i.cliente_id = c.id'))
        .whereRaw(SQL_RETIRADO_ANTES, [limite(ahora)])
        .orderBy('c.id')
        .select('c.id')) as Array<{ id: number }>
    return filas.map((f) => Number(f.id))
}
