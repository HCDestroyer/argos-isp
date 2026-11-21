import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import {
    categoriasArchivos,
    medicionDeFila,
    memoriaRedis,
    tamanoBaseDatos,
    volumenDatos,
    type Medicion,
} from '#monitoreo/almacenamiento'

export interface EntradaRecalcularAlmacenamiento {
    /** presupuesto del recorrido de carpetas (ms); lo que no alcance queda `parcial` */
    presupuesto_ms?: number
    origen?: 'manual' | 'cron'
}

/** Presupuesto del botón (la petición HTTP espera) y del cron diario. */
export const PRESUPUESTO_MANUAL_MS = 15_000
export const PRESUPUESTO_CRON_MS = 5 * 60_000

/**
 * Calcula el almacenamiento (carpetas, base de datos, Redis, volumen de datos) y guarda una fila en
 * `core.almacenamiento_mediciones` (`sistema.recalcular_almacenamiento`, contrato `salud.md` §6).
 *
 * - Un solo cálculo a la vez: advisory lock de la transacción; si otro está corriendo → 409
 *   `calculo_en_curso` (el cron y el botón no se pisan).
 * - Solo lee y suma: nunca borra archivos ni filas.
 * - La fila guarda `estado_disco`: con `degradado` o `caido` (≥ 80 % / ≥ 95 % usado) el registro del
 *   sistema muestra un aviso de disco (`GET /sistema/registro`, origen `almacenamiento`).
 */
export default class RecalcularAlmacenamiento extends DomainAction<
    EntradaRecalcularAlmacenamiento,
    Medicion
> {
    readonly nombre = 'sistema.recalcular_almacenamiento'

    protected async handle(input: EntradaRecalcularAlmacenamiento, t: Transaccion): Promise<Medicion> {
        const { rows } = (await t.trx.rawQuery(`SELECT pg_try_advisory_xact_lock(hashtext(?)) AS ok`, [
            'monitoreo:almacenamiento',
        ])) as { rows: Array<{ ok: boolean }> }
        if (!rows[0]?.ok) {
            throw new Conflicto(
                'Ya se está calculando el almacenamiento; espera a que termine y vuelve a consultar',
                'calculo_en_curso',
                'Cálculo en curso',
            )
        }
        const inicio = Date.now()
        const limite = inicio + (input.presupuesto_ms ?? PRESUPUESTO_MANUAL_MS)
        const [baseDatos, memoria, volumenDatosActual] = await Promise.all([
            tamanoBaseDatos(t.trx),
            memoriaRedis(),
            volumenDatos(),
        ])
        const categorias = await categoriasArchivos(limite)
        const parcial = categorias.some((c) => c.estado === 'parcial')
        const [fila] = (await t.trx
            .table('core.almacenamiento_mediciones')
            .insert({
                duracion_ms: Date.now() - inicio,
                origen: input.origen ?? 'manual',
                parcial,
                estado_disco: volumenDatosActual.estado,
                porcentaje_disco: volumenDatosActual.porcentaje_usado,
                resultado: JSON.stringify({
                    categorias,
                    base_datos: baseDatos,
                    redis: memoria,
                    volumen_datos: volumenDatosActual,
                }),
            })
            .returning('*')) as Parameters<typeof medicionDeFila>[0][]
        t.fijarEntidad('almacenamiento_medicion', Number(fila!.id))
        return medicionDeFila(fila!)
    }
}
