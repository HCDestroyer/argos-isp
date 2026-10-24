import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'

/**
 * Último contacto de un router (`network.routers_contacto`), para `Router.en_linea` y
 * `Router.ultimo_contacto` (pedido de A4).
 *
 * Fuentes:
 * - **Periódicas** (`registrarContactoRouter`): accounting RADIUS del NAS (Start, Interim-Update,
 *   Stop, Accounting-On/Off) y sondeo de la API REST de RouterOS. Las escribe A2 desde sus acciones.
 *   Solo con una fuente periódica se puede decir si el router está en línea.
 * - **Ocasional** (lectura, sin escribir nada): la última respuesta buena del router en `audit.red`
 *   (CoA/Disconnect con ACK, comando de RouterOS con `ok`). Cuenta para `ultimo_contacto`, no para
 *   `en_linea`: que hoy no haya habido un CoA no dice nada.
 *
 * Reglas de la vista (`columnasContactoRouter`):
 * - `ultimo_contacto` = el más reciente de las dos fuentes; null si nunca respondió.
 * - `en_linea` = null si ninguna fuente periódica lo mide (sin fila); si no, `ultimo_contacto` dentro
 *   del umbral: `SESIONES_COLGADAS_INTERVALOS` × `AAA_INTERIM_SEGUNDOS` (15 min por defecto, el
 *   mismo con el que una sesión se da por colgada).
 */

export const FUENTES_CONTACTO = ['accounting', 'routeros', 'sondeo'] as const
export type FuenteContacto = (typeof FUENTES_CONTACTO)[number]

/** Un mismo router no se reescribe más de una vez por este intervalo (Interim-Update de cada sesión). */
const INTERVALO_MINIMO_S = 30

/**
 * Registra que el router respondió o mandó accounting (`en`, por defecto ahora). Para llamar
 * dentro de la transacción de la acción de accounting o de RouterOS, con su `trx`; no audita
 * (telemetría, regla 9). Se identifica por `router_id` o, desde el accounting, por `nas_ip`
 * (un NAS desconocido no hace nada). Nunca retrocede: un paquete atrasado no pisa uno más nuevo.
 */
export async function registrarContactoRouter(
    cliente: QueryClientContract,
    router: { routerId: number } | { nasIp: string },
    fuente: FuenteContacto,
    en: Date = new Date(),
): Promise<void> {
    const destino =
        'routerId' in router
            ? { sql: 'SELECT id FROM network.routers WHERE id = ?', valor: router.routerId }
            : { sql: 'SELECT id FROM network.routers WHERE nas_ip = ?::inet', valor: router.nasIp }
    await cliente.rawQuery(
        `INSERT INTO network.routers_contacto AS rc (router_id, ultimo_contacto, fuente)
         SELECT r.id, ?::timestamptz, ? FROM (${destino.sql}) r
         ON CONFLICT (router_id) DO UPDATE
            SET ultimo_contacto = EXCLUDED.ultimo_contacto, fuente = EXCLUDED.fuente, updated_at = now()
          WHERE rc.ultimo_contacto < EXCLUDED.ultimo_contacto - make_interval(secs => ?)`,
        [en.toISOString(), fuente, destino.valor, INTERVALO_MINIMO_S],
    )
}

/** Segundos sin contacto periódico tras los que un router se da por fuera de línea. */
export function umbralEnLineaS(): number {
    // las mismas variables que `configColgadas` (`network/sesiones/colgadas.ts`, A2)
    const intervalos = env.get('SESIONES_COLGADAS_INTERVALOS') ?? 3
    const interim = env.get('AAA_INTERIM_SEGUNDOS') ?? 300
    return Math.max(1, intervalos) * Math.max(1, interim)
}

/**
 * Expresiones SQL de `ultimo_contacto` y `en_linea` para `network.routers` (sin alias): subconsultas
 * escalares, así sirven igual en la lista y en la ficha.
 */
export function sqlContactoRouter(tabla = 'network.routers'): { ultimoContacto: string; enLinea: string } {
    const periodico = `(SELECT rc.ultimo_contacto FROM network.routers_contacto rc WHERE rc.router_id = ${tabla}.id)`
    const ocasional = `(SELECT ar.created_at FROM audit.red ar WHERE ar.router_id = ${tabla}.id AND ar.ok ORDER BY ar.created_at DESC LIMIT 1)`
    const ultimo = `GREATEST(${periodico}, ${ocasional})`
    return {
        ultimoContacto: ultimo,
        enLinea: `CASE WHEN ${periodico} IS NULL THEN NULL ELSE ${ultimo} >= now() - make_interval(secs => ${Math.max(1, Math.floor(umbralEnLineaS()))}) END`,
    }
}
