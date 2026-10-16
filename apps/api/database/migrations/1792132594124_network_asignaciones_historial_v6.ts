import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Historial de asignaciones de un servicio (tarea 12 de A1): `network.asignaciones_historial`
 * guarda tramos `inicio`/`fin` de (router, plan, IPv4, prefijo de enlace, prefijo delegado).
 *
 * - `prefijo_v6` es el prefijo delegado; se agrega `prefijo_enlace_v6` (/64 de enlace).
 * - Un solo tramo abierto (`fin IS NULL`) por servicio.
 * - Se siembra un tramo abierto con lo vigente de cada servicio no retirado (`motivo = inicial`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.asignaciones_historial
                ADD COLUMN prefijo_enlace_v6 cidr CHECK (prefijo_enlace_v6 IS NULL OR family(prefijo_enlace_v6) = 6),
                ADD CONSTRAINT asignaciones_historial_fin CHECK (fin IS NULL OR fin >= inicio);
            CREATE UNIQUE INDEX asignaciones_historial_abierto
                ON network.asignaciones_historial (servicio_id) WHERE fin IS NULL;

            INSERT INTO network.asignaciones_historial
                (servicio_id, router_id, plan_id, ipv4, prefijo_enlace_v6, prefijo_v6, motivo)
            SELECT s.id, s.router_id, s.plan_id,
                   (SELECT a.ip FROM network.ipv4_asignaciones a WHERE a.servicio_id = s.id AND a.fin IS NULL LIMIT 1),
                   (SELECT a.prefijo FROM network.ipv6_asignaciones a
                     WHERE a.servicio_id = s.id AND a.fin IS NULL AND a.tipo = 'enlace' LIMIT 1),
                   (SELECT a.prefijo FROM network.ipv6_asignaciones a
                     WHERE a.servicio_id = s.id AND a.fin IS NULL AND a.tipo = 'delegacion' LIMIT 1),
                   'inicial'
              FROM core.servicios s
             WHERE s.estado <> 'retirado'
               AND NOT EXISTS (
                   SELECT 1 FROM network.asignaciones_historial h WHERE h.servicio_id = s.id AND h.fin IS NULL
               );
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS network.asignaciones_historial_abierto;
            ALTER TABLE network.asignaciones_historial
                DROP CONSTRAINT IF EXISTS asignaciones_historial_fin,
                DROP COLUMN IF EXISTS prefijo_enlace_v6;
        `)
    }
}
