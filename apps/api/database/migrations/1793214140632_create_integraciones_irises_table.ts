import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Conector Iris (pedidos A2 y A8 de Iris, `contratos/iris.md` §1): mismo patrón que el de Horus
 * (`1792246830055_create_integraciones_horuses_table`), con sus propias tablas.
 *
 * - `iris_conector`: una sola fila (`id = 1`), apagada por defecto. URL base de Iris, token
 *   `iris_pat_` cifrado (de solo escritura), receptor de webhooks de Iris (Argos → Iris, §2.3) con
 *   su secreto, secreto del receptor de Argos (Iris → Argos, reservado), id opaco del conector y el
 *   `atk_` del último canje (se revoca en el siguiente).
 * - `iris_enlaces`: enlaces de conexión de un solo uso (§1.3 → Horus §1.4): SHA-256 del código,
 *   vencimiento (15 min), anulación al generar otro y la respuesta del canje cifrada (idempotencia).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE SCHEMA IF NOT EXISTS integraciones;

            CREATE TABLE integraciones.iris_conector (
                id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                activo boolean NOT NULL DEFAULT false,
                url_base text,
                token_cifrado text,
                webhook_salida_url text,
                webhook_salida_secreto_cifrado text,
                webhook_entrada_secreto_cifrado text,
                conector_id text NOT NULL DEFAULT ('argos_' || md5(random()::text || clock_timestamp()::text)),
                token_argos_id bigint REFERENCES core.tokens_api (id),
                conectado_por_enlace_en timestamptz,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                -- encendido exige lo mínimo para hablar con Iris
                CHECK (NOT activo OR (url_base IS NOT NULL AND token_cifrado IS NOT NULL))
            );

            CREATE TABLE integraciones.iris_enlaces (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                codigo_sha256 text NOT NULL UNIQUE,
                base_url text NOT NULL,
                vence_en timestamptz NOT NULL,
                usado_en timestamptz,
                anulado_en timestamptz,
                peticion_sha256 text,
                respuesta_cifrada text,
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON integraciones.iris_conector, integraciones.iris_enlaces
                        TO argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA integraciones TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS integraciones.iris_enlaces;
            DROP TABLE IF EXISTS integraciones.iris_conector;
        `)
    }
}
