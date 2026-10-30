import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Router sin RADIUS (bug del PM, Argos 1.4.0): un router en `modo_seguridad = 'api'` solo maneja
 * servicios `ip_estatica` y `dhcp_fija` por la API REST de RouterOS, así que no tiene `nas_ip` ni
 * `radius_secret`.
 *
 * - `nas_ip` deja de ser NOT NULL. El UNIQUE se queda: en Postgres dos NULL no chocan.
 * - `routers_nas_ip_radius_check`: un router `radius` sigue necesitando su `nas_ip` (FreeRADIUS lo
 *   reconoce por esa IP y el CoA va a ella).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.routers
                ALTER COLUMN nas_ip DROP NOT NULL,
                ADD CONSTRAINT routers_nas_ip_radius_check
                    CHECK (modo_seguridad <> 'radius' OR nas_ip IS NOT NULL);
        `)
    }

    async down() {
        // Solo vuelve a NOT NULL si ningún router quedó sin nas_ip (un rollback no inventa IPs).
        this.schema.raw(`
            ALTER TABLE network.routers DROP CONSTRAINT IF EXISTS routers_nas_ip_radius_check;
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM network.routers WHERE nas_ip IS NULL) THEN
                    ALTER TABLE network.routers ALTER COLUMN nas_ip SET NOT NULL;
                END IF;
            END
            $$;
        `)
    }
}
