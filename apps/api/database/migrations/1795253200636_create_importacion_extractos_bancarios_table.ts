import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A6 · estados de cuenta tal como los descarga el banco (`app/importacion/extractos`).
 *
 *  - `importacion.extractos_mapeos`: el mapeo de columnas que el panel confirmó para una cuenta
 *    bancaria propia (`billing.cuentas_bancarias`), para reconocer el mismo archivo la próxima vez.
 *    Uno por cuenta, con `version` (409 si cambió). Lo escribe solo `bancos.guardar_mapeo_extracto`.
 *  - `importacion.extractos_archivos`: el archivo original (.xlsx, .xls o .csv) con su sha256, guardado
 *    en la misma transacción que el extracto que produjo (`ledger.extractos`). Solo inserción.
 *
 * No viven en `ledger`: el mapeo se edita (regla 4: nada de UPDATE en `ledger.*`) y el archivo es
 * insumo de la importación, no un registro contable.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE SCHEMA IF NOT EXISTS importacion;

            CREATE TABLE importacion.extractos_mapeos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cuenta_bancaria_id bigint NOT NULL UNIQUE REFERENCES billing.cuentas_bancarias (id),
                empresa_id bigint REFERENCES core.empresas (id),
                formato text NOT NULL CHECK (formato ~ '^[a-z0-9_]{1,40}$'),
                mapeo jsonb NOT NULL CHECK (jsonb_typeof(mapeo) = 'object'),
                version integer NOT NULL DEFAULT 1,
                actualizado_por bigint,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE importacion.extractos_archivos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                extracto_id bigint NOT NULL UNIQUE REFERENCES ledger.extractos (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                cuenta_bancaria_id bigint REFERENCES billing.cuentas_bancarias (id),
                nombre text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 200),
                tipo text NOT NULL CHECK (tipo IN ('xlsx', 'xls', 'csv')),
                tamano integer NOT NULL CHECK (tamano > 0),
                sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
                formato text NOT NULL,
                mapeo jsonb NOT NULL,
                contenido bytea NOT NULL,
                importado_por bigint,
                request_id text,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX extractos_archivos_sha256 ON importacion.extractos_archivos (sha256);

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT USAGE ON SCHEMA importacion TO argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON importacion.extractos_mapeos TO argosisp_app;
                    GRANT SELECT, INSERT ON importacion.extractos_archivos TO argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA importacion TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS importacion.extractos_archivos;
            DROP TABLE IF EXISTS importacion.extractos_mapeos;
        `)
    }
}
