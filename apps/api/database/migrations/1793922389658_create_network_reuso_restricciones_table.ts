import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Reúso de IPs (pedido del PM, 5 nov): la base hace imposible que una dirección vigente quede en dos
 * servicios, aunque dos transacciones lleguen a la vez y se salten el advisory lock.
 *
 * - `ipv4_asignaciones_servicio_vigente`: a lo sumo una IPv4 vigente por servicio (la IP vigente ya
 *   era única: `ipv4_asignaciones_ip_vigente`).
 * - `ipv6_asignaciones_sin_traslape`: dos prefijos vigentes nunca se traslapan (el índice único solo
 *   impedía el mismo prefijo exacto; un /48 estático podía cubrir el /56 delegado de otro servicio).
 *
 * Antes de crearlas revisa los datos. Si hay filas que no cumplen, la migración falla con la lista
 * (no borra ni corrige nada). Para verlas a mano:
 *
 *   SELECT servicio_id, count(*) FROM network.ipv4_asignaciones WHERE fin IS NULL
 *    GROUP BY servicio_id HAVING count(*) > 1;
 *   SELECT a.servicio_id, a.prefijo, b.servicio_id, b.prefijo FROM network.ipv6_asignaciones a
 *     JOIN network.ipv6_asignaciones b ON a.id < b.id AND a.prefijo && b.prefijo
 *    WHERE a.fin IS NULL AND b.fin IS NULL;
 *
 * Se corrigen cerrando (`fin = now()`) el tramo que sobra desde la ficha del servicio (editar la IP o
 * el prefijo), nunca borrando historial; después se vuelve a correr la migración.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            DO $$
            DECLARE
                detalle text;
            BEGIN
                SELECT string_agg(format('servicio %s: %s IPv4 vigentes (%s)', servicio_id, n, ips), '; ')
                  INTO detalle
                  FROM (SELECT servicio_id, count(*) AS n, string_agg(host(ip), ', ' ORDER BY id) AS ips
                          FROM network.ipv4_asignaciones WHERE fin IS NULL
                         GROUP BY servicio_id HAVING count(*) > 1 ORDER BY servicio_id LIMIT 20) x;
                IF detalle IS NOT NULL THEN
                    RAISE EXCEPTION 'Hay servicios con más de una IPv4 vigente: %', detalle
                        USING HINT = 'Deja una sola por servicio (editar la IP en la ficha) y vuelve a migrar. '
                            'Consulta: SELECT servicio_id, count(*) FROM network.ipv4_asignaciones '
                            'WHERE fin IS NULL GROUP BY servicio_id HAVING count(*) > 1';
                END IF;

                SELECT string_agg(format('servicio %s (%s) con servicio %s (%s)', sa, pa, sb, pb), '; ')
                  INTO detalle
                  FROM (SELECT a.servicio_id AS sa, a.prefijo AS pa, b.servicio_id AS sb, b.prefijo AS pb
                          FROM network.ipv6_asignaciones a
                          JOIN network.ipv6_asignaciones b ON a.id < b.id AND a.prefijo && b.prefijo
                         WHERE a.fin IS NULL AND b.fin IS NULL
                         ORDER BY a.id LIMIT 20) x;
                IF detalle IS NOT NULL THEN
                    RAISE EXCEPTION 'Hay prefijos IPv6 vigentes que se traslapan: %', detalle
                        USING HINT = 'Cambia el prefijo de uno de los dos servicios y vuelve a migrar.';
                END IF;
            END
            $$;

            CREATE UNIQUE INDEX ipv4_asignaciones_servicio_vigente
                ON network.ipv4_asignaciones (servicio_id) WHERE fin IS NULL;

            ALTER TABLE network.ipv6_asignaciones
                ADD CONSTRAINT ipv6_asignaciones_sin_traslape
                EXCLUDE USING gist (prefijo inet_ops WITH &&) WHERE (fin IS NULL);
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE network.ipv6_asignaciones DROP CONSTRAINT IF EXISTS ipv6_asignaciones_sin_traslape;
            DROP INDEX IF EXISTS network.ipv4_asignaciones_servicio_vigente;
        `)
    }
}
