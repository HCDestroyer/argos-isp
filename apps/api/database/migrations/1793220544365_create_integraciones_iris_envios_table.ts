import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Webhooks Argos → Iris (`contratos/iris.md` §2.3, A6): uno por evento del bus, igual que
 * `integraciones.horus_envios` (`1792246830055_create_integraciones_horuses_table`).
 *
 * - `evento_id` único = id estable del webhook (`argos-evt-<id del outbox>`): Iris deduplica por
 *   él y un evento repetido por el bus no crea otro envío.
 * - `cuerpo` es el JSON exacto que se firma y se manda (`{ id, evento, ocurrido_en, payload }`).
 * - Estados: `pendiente` (con `proximo_intento_en`), `enviado`, `fallido` (agotó los reintentos a
 *   1 min, 5 min, 30 min, 2 h y 12 h) y `descartado` (el conector se apagó antes de enviarlo).
 * - No es `ledger` ni `audit`: la bitácora del envío se actualiza (intentos, último error).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE SCHEMA IF NOT EXISTS integraciones;

            CREATE TABLE integraciones.iris_envios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                evento_id text NOT NULL UNIQUE,
                evento text NOT NULL,
                empresa_id bigint REFERENCES core.empresas (id),
                cuerpo text NOT NULL,
                estado text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'enviado', 'fallido', 'descartado')),
                intentos integer NOT NULL DEFAULT 0,
                proximo_intento_en timestamptz,
                ultimo_status integer,
                ultimo_error text,
                enviado_en timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (estado <> 'pendiente' OR proximo_intento_en IS NOT NULL)
            );
            CREATE INDEX iris_envios_pendientes ON integraciones.iris_envios (proximo_intento_en)
                WHERE estado = 'pendiente';
            CREATE INDEX iris_envios_estado ON integraciones.iris_envios (estado, id);

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON integraciones.iris_envios TO argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA integraciones TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS integraciones.iris_envios;`)
    }
}
