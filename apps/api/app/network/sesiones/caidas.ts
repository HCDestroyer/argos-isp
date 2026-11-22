import env from '#start/env'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import type { FilaSesion } from '#network/sesiones/sesiones'
import { verAjustesOperacion } from '#core/ajustes_operacion'
import { sqlEnIncidenteAbierto } from '#network/incidentes_red'

/**
 * Caídas repetidas de un servicio (pedido A6 de Iris, `contratos/eventos.md`): al cerrarse una
 * sesión, si el servicio acumula `umbral` sesiones terminadas dentro de la ventana, emite
 * `servicio.caidas_repetidas` por outbox en la misma transacción. A6 lo reenvía por webhook a Iris
 * para abrir un ticket proactivo.
 *
 * - **Qué cuenta:** sesiones del servicio con `fin` en `(hasta − ventana, hasta]`, donde `hasta` es el
 *   fin de la sesión que se acaba de cerrar, salvo las causas ignoradas: las que provoca Argos
 *   (`Admin-Reset`: CoA/Disconnect por corte, reactivación o desconexión manual) o el router entero
 *   (`Admin-Reboot`, `NAS-Reboot`), `NAS-Request` y `sin_interim` (cierre del cron sin dato del NAS:
 *   si el NAS manda su Stop después, la sesión se corrige y cuenta con su causa real; y no se
 *   repite). `Sesion-Reemplazada` sí cuenta: el CPE volvió a entrar sin que llegara el Stop.
 * - **Una vez por ventana:** cada emisión deja fila en `network.caidas_repetidas`. No se emite otra
 *   si la última del servicio terminó (`hasta`) dentro de la ventana actual, así que las sesiones
 *   contadas por la siguiente son siempre posteriores a la anterior.
 * - **Concurrencia:** dos Stop del mismo servicio en workers distintos se ordenan con
 *   `pg_advisory_xact_lock(4107, servicio_id)`, tomado solo cuando se alcanzó el umbral.
 * - No decide estados ni toca la red: es un aviso.
 * - **Umbral** (decisión del PM 31, contrato Iris 0.13.0): ajustes de operación por empresa
 *   (`caidas.activo`, `caidas.umbral`, `caidas.ventana_min`; 3 caídas en 60 minutos de fábrica). Iris decide
 *   con su propio umbral si abre ticket; en Argos queda la alerta (`GET /red/caidas-repetidas`).
 * - **Falla general**: si el servicio está en un incidente abierto o en el alcance de uno
 *   (`network.incidentes_red`), no se emite: el ticket es el general del incidente.
 */

// 4105 es `LOCK_SONDEO_PPP` (por router): con el mismo espacio, servicio 7 y router 7 se bloqueaban entre sí.
const LOCK_CAIDAS = 4107

export const CAUSAS_IGNORADAS_POR_DEFECTO = [
    'Admin-Reset',
    'Admin-Reboot',
    'NAS-Reboot',
    'NAS-Request',
    'sin_interim',
] as const

export interface ConfigCaidas {
    /** Sesiones terminadas que disparan el aviso; 0 lo apaga */
    umbral: number
    ventanaMinutos: number
    causasIgnoradas: string[]
}

/**
 * Configuración de la empresa: `caidas.*` de los ajustes de operación (empresa → global → fábrica: 3 en
 * 60 min); `caidas.activo` apagado da `umbral: 0`. Las causas ignoradas siguen en
 * `CAIDAS_REPETIDAS_CAUSAS_IGNORADAS`.
 */
export async function configCaidas(
    empresaId: number | null = null,
    cliente?: QueryClientContract,
): Promise<ConfigCaidas> {
    const { efectivo } = await verAjustesOperacion(empresaId, cliente)
    const lista = env.get('CAIDAS_REPETIDAS_CAUSAS_IGNORADAS')
    return {
        umbral: efectivo['caidas.activo'] ? Number(efectivo['caidas.umbral']) : 0,
        ventanaMinutos: Number(efectivo['caidas.ventana_min']),
        causasIgnoradas:
            lista === undefined
                ? [...CAUSAS_IGNORADAS_POR_DEFECTO]
                : lista
                      .split(',')
                      .map((c) => c.trim())
                      .filter((c) => c !== ''),
    }
}

/** `rawQuery` con valores que pueden ser null o arreglos (knex los acepta; sus tipos no). */
function consulta(t: Transaccion, sql: string, valores: unknown[]): Promise<unknown> {
    return t.trx.rawQuery(sql, valores as never)
}

/**
 * Revisa el servicio de una sesión recién cerrada y emite `servicio.caidas_repetidas` si
 * corresponde. Devuelve true si lo emitió. `config` es para las pruebas.
 */
export async function detectarCaidasRepetidas(
    t: Transaccion,
    sesion: FilaSesion,
    configFija?: ConfigCaidas,
): Promise<boolean> {
    if (sesion.servicio_id === null || !sesion.fin) return false
    const { rows: datos } = (await consulta(
        t,
        `SELECT s.empresa_id, ${sqlEnIncidenteAbierto('s', 'cl')} AS en_incidente
           FROM core.servicios s JOIN core.clientes cl ON cl.id = s.cliente_id WHERE s.id = ?`,
        [sesion.servicio_id],
    )) as { rows: Array<{ empresa_id: number; en_incidente: boolean }> }
    if (!datos[0] || datos[0].en_incidente) return false
    const config = configFija ?? (await configCaidas(Number(datos[0].empresa_id), t.trx))
    if (config.umbral === 0) return false
    const causa = sesion.causa_fin ?? 'Desconocida'
    if (config.causasIgnoradas.includes(causa)) return false

    const hasta = new Date(sesion.fin)
    const inicioVentana = new Date(hasta.getTime() - config.ventanaMinutos * 60_000)
    const contar = async () =>
        (
            (await consulta(
                t,
                `SELECT COALESCE(causa_fin, 'Desconocida') AS causa, count(*)::int AS n, min(fin) AS desde
                 FROM network.sesiones
                 WHERE servicio_id = ? AND fin > ?::timestamptz AND fin <= ?::timestamptz
                   AND NOT (COALESCE(causa_fin, 'Desconocida') = ANY (?::text[]))
                 GROUP BY 1`,
                [sesion.servicio_id, inicioVentana, hasta, config.causasIgnoradas],
            )) as { rows: Array<{ causa: string; n: number; desde: Date }> }
        ).rows

    let filas = await contar()
    if (filas.reduce((s, f) => s + f.n, 0) < config.umbral) return false

    await consulta(t, 'SELECT pg_advisory_xact_lock(?, ?::int)', [LOCK_CAIDAS, sesion.servicio_id])
    const { rows: previas } = (await consulta(
        t,
        `SELECT 1 FROM network.caidas_repetidas WHERE servicio_id = ? AND hasta > ?::timestamptz LIMIT 1`,
        [sesion.servicio_id, inicioVentana],
    )) as { rows: unknown[] }
    if (previas.length > 0) return false
    // Con el lock: otro worker pudo cerrar otra sesión del servicio mientras se esperaba.
    filas = await contar()
    const total = filas.reduce((s, f) => s + f.n, 0)
    if (total < config.umbral) return false

    const servicio = (await t.trx
        .from('core.servicios')
        .where('id', sesion.servicio_id)
        .select('empresa_id', 'cliente_id', 'router_id')
        .first()) as {
        empresa_id: number | string
        cliente_id: number | string
        router_id: number | string
    } | null
    if (!servicio) return false

    const desde = new Date(Math.min(...filas.map((f) => new Date(f.desde).getTime())))
    const causas = Object.fromEntries(
        [...filas].sort((a, b) => a.causa.localeCompare(b.causa)).map((f) => [f.causa, f.n]),
    )
    await consulta(
        t,
        `INSERT INTO network.caidas_repetidas
             (servicio_id, empresa_id, sesion_id, desde, hasta, sesiones, umbral, ventana_minutos, causas)
         VALUES (?, ?, ?, ?::timestamptz, ?::timestamptz, ?, ?, ?, ?::jsonb)`,
        [
            sesion.servicio_id,
            servicio.empresa_id,
            sesion.id,
            desde,
            hasta,
            total,
            config.umbral,
            config.ventanaMinutos,
            JSON.stringify(causas),
        ],
    )
    await t.emit('servicio.caidas_repetidas', {
        servicio_id: sesion.servicio_id,
        empresa_id: Number(servicio.empresa_id),
        cliente_id: Number(servicio.cliente_id),
        router_id: Number(servicio.router_id),
        sesion_id: sesion.id,
        sesiones: total,
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        umbral: config.umbral,
        ventana_minutos: config.ventanaMinutos,
        causas,
    })
    return true
}
