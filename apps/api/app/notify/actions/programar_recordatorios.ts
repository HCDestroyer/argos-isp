import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import ProgramarNotificacion from '#notify/actions/programar_notificacion'
import { ZONA } from '#notify/formato'
import { ESTADOS_PENDIENTES } from '#billing/facturas'

export interface EntradaRecordatorios {
    /** instante ISO de referencia (por defecto, ahora) */
    ahora?: string
    /** facturas por ejecución (lote) */
    limite?: number
    /** no se envían recordatorios cuyo momento quedó más atrás que esto (días) */
    ventanaDias?: number
}

export interface ResultadoRecordatorios {
    /** facturas candidatas en este lote */
    procesadas: number
    /** envíos nuevos registrados */
    nuevos: number
    errores: number
    /** ids a poner en la cola de envíos */
    encolar: number[]
}

interface Candidato {
    factura_id: number
    cliente_id: number
    servicio_id: number | null
    total: string
    vence: string
    orden: number
    dias: number
}

export const LIMITE_LOTE = 200
export const VENTANA_DIAS = 7

/**
 * Programa los recordatorios de pago pendientes hasta `ahora` (no "los de hoy").
 *
 * Solo recuerda deuda cobrable, con la misma regla que el saldo pendiente de A3
 * (`ESTADOS_PENDIENTES` y `pendienteDe` de `#billing/facturas`): estado `emitida`, `parcial` o
 * `vencida` y `total > pagado` (`pagado` ya incluye lo acreditado por notas). Quedan fuera
 * `por_certificar` (aún no es un documento cobrable), `pagada`, `anulada`, `castigada` (su `pagado`
 * es solo lo cobrado: el resto se dio por incobrable), `acreditada` (cubierta por notas internas) y
 * cualquier factura sustituida (`billing.sustituciones`), aunque su fila siguiera viva.
 *
 * Para cada factura así toma el recordatorio activo más reciente cuyo momento ya pasó: `(vence_en + dias) a la hora del recordatorio` en America/Guatemala.
 * Así, si el cron se detuvo, al volver no manda tres avisos atrasados: manda el último que toca.
 * Solo cuentan momentos posteriores a la emisión de la factura y dentro de `ventanaDias` (evita
 * avisar facturas viejas importadas o después de una caída larga).
 *
 * Cada recordatorio es un envío con origen `recordatorio:<orden>:factura:<id>` (único): correr
 * el cron dos veces no duplica. La notificación pasa por `ProgramarNotificacion` (todos
 * los canales disponibles del cliente) con el evento de plantilla `recordatorio.<orden>`.
 */
export default class ProgramarRecordatorios extends DomainAction<
    EntradaRecordatorios,
    ResultadoRecordatorios
> {
    readonly nombre = 'notificaciones.recordatorios'

    protected async handle(input: EntradaRecordatorios, t: Transaccion): Promise<ResultadoRecordatorios> {
        const ahora = input.ahora ? DateTime.fromISO(input.ahora, { zone: 'utc' }) : DateTime.utc()
        const ahoraIso = ahora.toISO()!
        const limite = input.limite ?? LIMITE_LOTE
        const ventana = input.ventanaDias ?? VENTANA_DIAS

        const { rows } = (await t.trx.rawQuery(
            `
            WITH candidatos AS (
                SELECT DISTINCT ON (f.id)
                    f.id AS factura_id,
                    f.cliente_id,
                    f.servicio_id,
                    f.total::text AS total,
                    f.vence_en::text AS vence,
                    r.orden,
                    r.dias
                FROM billing.facturas f
                JOIN notify.recordatorios r ON r.activo
                CROSS JOIN LATERAL (
                    SELECT (((f.vence_en + r.dias) + r.hora) AT TIME ZONE '${ZONA}') AS momento
                ) m
                WHERE f.estado IN (${ESTADOS_PENDIENTES.map(() => '?').join(', ')})
                    AND f.total > f.pagado
                    AND NOT EXISTS (
                        SELECT 1 FROM billing.sustituciones su WHERE su.original_id = f.id
                    )
                    AND m.momento <= ?::timestamptz
                    AND m.momento >= f.emitida_en
                    AND m.momento >= ?::timestamptz - make_interval(days => ?)
                    AND EXISTS (
                        SELECT 1 FROM notify.plantillas p
                        WHERE p.evento = 'recordatorio.' || r.orden AND p.activa
                    )
                ORDER BY f.id, r.dias DESC
            )
            SELECT c.*
            FROM candidatos c
            WHERE NOT EXISTS (
                SELECT 1 FROM notify.envios e
                WHERE e.origen = 'recordatorio:' || c.orden || ':factura:' || c.factura_id
            )
            ORDER BY c.factura_id
            LIMIT ?
            `,
            [...ESTADOS_PENDIENTES, ahoraIso, ahoraIso, ventana, limite],
        )) as { rows: Candidato[] }

        const resultado: ResultadoRecordatorios = {
            procesadas: rows.length,
            nuevos: 0,
            errores: 0,
            encolar: [],
        }
        for (const c of rows) {
            try {
                const programado = await new ProgramarNotificacion().execute(
                    {
                        origen: `recordatorio:${c.orden}:factura:${c.factura_id}`,
                        evento: `recordatorio.${c.orden}`,
                        payload: {
                            factura_id: c.factura_id,
                            cliente_id: c.cliente_id,
                            servicio_id: c.servicio_id,
                            total: c.total,
                            vence: c.vence,
                            orden: c.orden,
                            dias: c.dias,
                        },
                        ahora: ahoraIso,
                    },
                    t.ctx,
                    { trx: t.trx },
                )
                resultado.nuevos += programado.envios.filter((e) => e.nuevo).length
                resultado.encolar.push(...programado.encolar)
            } catch (error) {
                // El savepoint de la acción anidada ya se revirtió y su error quedó auditado.
                resultado.errores++
                logger.error({ err: error, facturaId: c.factura_id }, 'No se pudo programar el recordatorio')
            }
        }
        return resultado
    }
}
