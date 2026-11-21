import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * De la venta a la instalación (contrato Iris 0.10.0 §3.4).
 *
 * - `core.servicios.ip_reservada_en` (A38): un servicio `pendiente_instalacion` ya no recibe IP al
 *   crearse; `POST /servicios/:id/reservar-ip` la reserva en sitio y marca este instante. La reserva
 *   vence a los 30 días sin activar (cron `reservas_ip_vencidas`). Activar la borra.
 * - `core.servicios_origenes_iris`: las órdenes de Iris (`origen_tipo`, `origen_id`) que Argos ya
 *   aceptó para cada servicio en una ruta de §3.4 o en `activar-instalacion`. Es el «alcance» de
 *   §3.4: Iris solo opera sobre servicios creados por Iris (cliente `codigo_externo` `iris:*`) o con
 *   una orden ya registrada para ese mismo servicio (`403 servicio_no_de_iris`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.servicios ADD COLUMN ip_reservada_en timestamptz;
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
            DROP TABLE IF EXISTS core.servicios_origenes_iris;
            DROP INDEX IF EXISTS core.servicios_ip_reservada;
            ALTER TABLE core.servicios DROP COLUMN IF EXISTS ip_reservada_en;
        `)
    }
}
