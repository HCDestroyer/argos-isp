import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * De la venta a la instalación (contrato Iris 0.10.0 §3.4).
 *
 * - `core.servicios.ip_reservada_en` (A38): un servicio `pendiente_instalacion` ya no recibe IP al
 *   crearse; `POST /servicios/:id/reservar-ip` la reserva en sitio y marca este instante. La reserva
 *   vence a los 30 días sin activar (cron `reservas_ip_vencidas`). Activar la borra.
 * - `core.servicios.ip_al_activar`: el pendiente nació sin IP (A38) y la activación debe asignarla.
 *   Solo lo marca `servicios.crear` desde la 0.10.0; los pendientes anteriores (o insertados a mano)
 *   se activan como antes, sin tocar sus IPs. Reservar en sitio lo apaga; vencer la reserva lo enciende.
 * - `core.servicios_sin_pppoe_exigir_ipv4`: un servicio sin PPPoE `pendiente_instalacion` ya no
 *   necesita IPv4 (la recibe al activar); al pasar a activo la exige como siempre.
 * - `core.servicios_origenes_iris`: las órdenes de Iris (`origen_tipo`, `origen_id`) que Argos ya
 *   aceptó para cada servicio en una ruta de §3.4 o en `activar-instalacion`. Es el «alcance» de
 *   §3.4: Iris solo opera sobre servicios creados por Iris (cliente `codigo_externo` `iris:*`) o con
 *   una orden ya registrada para ese mismo servicio (`403 servicio_no_de_iris`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.servicios
                ADD COLUMN ip_reservada_en timestamptz,
                ADD COLUMN ip_al_activar boolean NOT NULL DEFAULT false;

            CREATE OR REPLACE FUNCTION core.servicios_sin_pppoe_exigir_ipv4(p_servicio_id bigint) RETURNS void
            LANGUAGE plpgsql AS $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM core.servicios s
                     WHERE s.id = p_servicio_id
                       AND s.tipo_conexion <> 'pppoe'
                       AND s.estado NOT IN ('retirado', 'pendiente_instalacion')
                       AND NOT EXISTS (
                           SELECT 1 FROM network.ipv4_asignaciones a
                            WHERE a.servicio_id = s.id AND a.fin IS NULL
                       )
                ) THEN
                    RAISE EXCEPTION 'El servicio % no es PPPoE y no tiene IPv4 asignada', p_servicio_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'servicios_sin_pppoe_ipv4';
                END IF;
            END;
            $$;
            CREATE INDEX servicios_ip_reservada ON core.servicios (ip_reservada_en)
                WHERE ip_reservada_en IS NOT NULL;

            CREATE TABLE core.servicios_origenes_iris (
                servicio_id bigint NOT NULL REFERENCES core.servicios (id) ON DELETE CASCADE,
                origen_tipo text NOT NULL CHECK (origen_tipo ~ '^[a-z][a-z0-9_]{1,39}$'),
                origen_id text NOT NULL CHECK (length(origen_id) BETWEEN 1 AND 100),
                created_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (servicio_id, origen_tipo, origen_id)
            );

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON core.servicios_origenes_iris TO argosisp_app;
                END IF;
            END
            $$;
        `)
    }

    async down() {
        this.schema.raw(`
            -- sin A38, un pendiente sin PPPoE necesita IPv4: los que no la tienen quedan retirados
            UPDATE core.servicios s SET estado = 'retirado'
             WHERE s.estado = 'pendiente_instalacion' AND s.tipo_conexion <> 'pppoe'
               AND NOT EXISTS (SELECT 1 FROM network.ipv4_asignaciones a WHERE a.servicio_id = s.id AND a.fin IS NULL);
            SET CONSTRAINTS ALL IMMEDIATE;
            DROP TABLE IF EXISTS core.servicios_origenes_iris;
            DROP INDEX IF EXISTS core.servicios_ip_reservada;
            ALTER TABLE core.servicios DROP COLUMN IF EXISTS ip_reservada_en, DROP COLUMN IF EXISTS ip_al_activar;
            CREATE OR REPLACE FUNCTION core.servicios_sin_pppoe_exigir_ipv4(p_servicio_id bigint) RETURNS void
            LANGUAGE plpgsql AS $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM core.servicios s
                     WHERE s.id = p_servicio_id
                       AND s.tipo_conexion <> 'pppoe'
                       AND s.estado <> 'retirado'
                       AND NOT EXISTS (
                           SELECT 1 FROM network.ipv4_asignaciones a
                            WHERE a.servicio_id = s.id AND a.fin IS NULL
                       )
                ) THEN
                    RAISE EXCEPTION 'El servicio % no es PPPoE y no tiene IPv4 asignada', p_servicio_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'servicios_sin_pppoe_ipv4';
                END IF;
            END;
            $$;
        `)
    }
}
