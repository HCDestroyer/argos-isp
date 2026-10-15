import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'

export interface EntradaParticiones {
    /** fecha ISO (UTC) del primer mes; por defecto, hoy */
    desde?: string
    /** meses siguientes al de `desde` que deben existir (por defecto 12) */
    meses?: number
}

export interface ResultadoParticiones {
    desde: string
    meses: number
    /** particiones nuevas (`audit.acciones_2027_01`, …), vacío si ya existían todas */
    creadas: string[]
}

export const MESES_PARTICIONES = 12

/**
 * Asegura las particiones mensuales de `audit.acciones`, `audit.cambios` y `audit.red` para el
 * mes de `desde` y los `meses` siguientes, llamando a `audit.crear_particiones` (SECURITY DEFINER:
 * funciona con el usuario de la aplicación). Idempotente: solo crea las que faltan.
 *
 * La corre el cron mensual de `notify:worker` (`app/notify/particiones.ts`). Si el cron deja de
 * correr, las filas caen en la partición DEFAULT y no se pierde nada, pero crear después la
 * partición de un mes con filas en DEFAULT falla: por eso se crean con 12 meses de adelanto.
 */
export default class CrearParticionesAuditoria extends DomainAction<
    EntradaParticiones,
    ResultadoParticiones
> {
    readonly nombre = 'auditoria.crear_particiones'

    protected async handle(input: EntradaParticiones, t: Transaccion): Promise<ResultadoParticiones> {
        const desde = (input.desde ? DateTime.fromISO(input.desde, { zone: 'utc' }) : DateTime.utc())
            .startOf('month')
            .toISODate()!
        const meses = input.meses ?? MESES_PARTICIONES
        if (!Number.isInteger(meses) || meses < 0 || meses > 120) {
            throw new Error(`meses fuera de rango (0 a 120): ${meses}`)
        }

        const antes = new Set(await particiones(t))
        await t.trx.rawQuery('SELECT audit.crear_particiones(?::date, ?::integer)', [desde, meses])
        const despues = await particiones(t)
        const creadas = despues.filter((nombre) => !antes.has(nombre))
        return { desde, meses, creadas }
    }
}

/** Particiones mensuales existentes de las tablas de auditoría (`audit.<tabla>_YYYY_MM`). */
async function particiones(t: Transaccion): Promise<string[]> {
    const { rows } = (await t.trx.rawQuery(
        `SELECT n.nspname || '.' || c.relname AS nombre
           FROM pg_inherits i
           JOIN pg_class c ON c.oid = i.inhrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_class p ON p.oid = i.inhparent
           JOIN pg_namespace pn ON pn.oid = p.relnamespace
          WHERE pn.nspname = 'audit'
            AND p.relname IN ('acciones', 'cambios', 'red')
            AND c.relname ~ '_[0-9]{4}_[0-9]{2}$'
          ORDER BY 1`,
    )) as { rows: Array<{ nombre: string }> }
    return rows.map((fila) => fila.nombre)
}
