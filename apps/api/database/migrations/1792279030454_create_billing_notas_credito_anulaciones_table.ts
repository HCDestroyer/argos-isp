import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 3 (FEL), condición del líder para la NCRE inmediata en `obligatoria`: una nota cuya
 * NCRE la SAT rechazó en definitivo se anula con el reverso de su asiento. `billing.notas_credito`
 * no admite UPDATE, así que la anulación es una fila aparte (como `egresos_anulaciones`), una sola
 * por nota y solo inserción.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.notas_credito_anulaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                nota_id bigint NOT NULL REFERENCES billing.notas_credito (id),
                asiento_id bigint NOT NULL REFERENCES ledger.asientos (id),
                dte_id bigint NOT NULL REFERENCES fiscal.dte (id),
                motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
                anulado_por bigint REFERENCES core.usuarios (id),
                anulado_en timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT notas_credito_anulaciones_nota UNIQUE (nota_id)
            );
            CREATE TRIGGER notas_credito_anulaciones_inmutable BEFORE UPDATE OR DELETE ON billing.notas_credito_anulaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER notas_credito_anulaciones_sin_truncate BEFORE TRUNCATE ON billing.notas_credito_anulaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON billing.notas_credito_anulaciones TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON billing.notas_credito_anulaciones FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS billing.notas_credito_anulaciones`)
    }
}
