import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tipo de conexión por router (decisión del PM, 5 nov; `contratos/tipo-conexion-router.md`): todos los
 * servicios de un router usan el mismo `tipo_conexion` (`pppoe`, `ip_estatica` o `dhcp_fija`), igual
 * que el modo de velocidad. Los servicios nuevos toman el del router; un router se cambia con
 * `routers.cambiar_tipo_conexion`.
 *
 * Relleno: cada router existente queda con el tipo que más usan sus servicios no retirados (empate:
 * `pppoe`, luego `ip_estatica`); sin servicios, `pppoe`. Los servicios que no coinciden se quedan como
 * están (la vista previa los muestra con `difiere_del_router`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.routers
                ADD COLUMN tipo_conexion text NOT NULL DEFAULT 'pppoe'
                    CONSTRAINT routers_tipo_conexion
                    CHECK (tipo_conexion IN ('pppoe', 'ip_estatica', 'dhcp_fija'));

            UPDATE network.routers r
               SET tipo_conexion = m.tipo_conexion
              FROM (
                    SELECT DISTINCT ON (s.router_id) s.router_id, s.tipo_conexion
                      FROM core.servicios s
                     WHERE s.estado <> 'retirado'
                     GROUP BY s.router_id, s.tipo_conexion
                     ORDER BY s.router_id, count(*) DESC,
                              CASE s.tipo_conexion WHEN 'pppoe' THEN 0 WHEN 'ip_estatica' THEN 1 ELSE 2 END
                   ) m
             WHERE m.router_id = r.id AND r.tipo_conexion <> m.tipo_conexion;
        `)
    }

    async down() {
        this.schema.raw(`ALTER TABLE network.routers DROP COLUMN IF EXISTS tipo_conexion;`)
    }
}
