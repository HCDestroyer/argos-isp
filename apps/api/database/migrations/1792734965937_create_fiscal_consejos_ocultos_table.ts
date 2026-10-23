import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 8, PR C (contrato de localización fiscal §9.4 y §22): consejos ocultos.
 *
 *  - `fiscal.consejos_ocultos` (solo inserción): ocultar o volver a mostrar un consejo del catálogo
 *    del paquete (`l10n/<pais>/consejos.ts`) para toda la empresa (`usuario_id` null) o solo para un
 *    usuario. La vigente es la última fila de (empresa, clave, usuario); la del usuario manda sobre la
 *    de la empresa. No toca nada contable.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE fiscal.consejos_ocultos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                clave text NOT NULL CHECK (clave ~ '^[a-z0-9_]+$'),
                usuario_id bigint REFERENCES core.usuarios (id),
                oculto boolean NOT NULL,
                motivo text,
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX consejos_ocultos_empresa ON fiscal.consejos_ocultos (empresa_id, clave, usuario_id, id DESC);
            CREATE TRIGGER consejos_ocultos_inmutable BEFORE UPDATE OR DELETE ON fiscal.consejos_ocultos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER consejos_ocultos_sin_truncate BEFORE TRUNCATE ON fiscal.consejos_ocultos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON fiscal.consejos_ocultos TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON fiscal.consejos_ocultos FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS fiscal.consejos_ocultos;`)
    }
}
