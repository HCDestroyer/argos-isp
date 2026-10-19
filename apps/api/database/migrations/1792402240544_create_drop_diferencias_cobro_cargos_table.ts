import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · B (decisión del líder): el auditor ya no consulta `billing.diferencias_cobro_cargos` ni
 * `billing.diferencias_cobro.nota_credito_id` (commit 22b725a). Se borran.
 *
 * - Aborta si la tabla tiene filas o alguna diferencia tiene nota (no debería: la migración
 *   1792386158266 las cerró a inserción y exige `nota_credito_id IS NULL`).
 * - `down()` recrea la tabla cerrada y la columna opcional, como las dejó 1792386158266.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM billing.diferencias_cobro_cargos)
                   OR EXISTS (SELECT 1 FROM billing.diferencias_cobro WHERE nota_credito_id IS NOT NULL) THEN
                    RAISE EXCEPTION 'Hay cargos H18 o diferencias con nota: migrarlos antes de borrar el esquema anterior';
                END IF;
            END $$;

            DROP TABLE billing.diferencias_cobro_cargos;
            DROP FUNCTION IF EXISTS billing.rechazar_cargo_diferencia();
            ALTER TABLE billing.diferencias_cobro DROP CONSTRAINT IF EXISTS diferencias_cobro_sin_nota;
            ALTER TABLE billing.diferencias_cobro DROP COLUMN nota_credito_id;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.diferencias_cobro
                ADD COLUMN nota_credito_id bigint UNIQUE REFERENCES billing.notas_credito (id),
                ADD CONSTRAINT diferencias_cobro_sin_nota CHECK (nota_credito_id IS NULL);

            CREATE TABLE billing.diferencias_cobro_cargos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                diferencia_id bigint NOT NULL UNIQUE REFERENCES billing.diferencias_cobro (id),
                pago_id bigint NOT NULL REFERENCES billing.pagos (id),
                factura_id bigint NOT NULL UNIQUE REFERENCES billing.facturas (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE TRIGGER diferencias_cobro_cargos_inmutable BEFORE UPDATE OR DELETE ON billing.diferencias_cobro_cargos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER diferencias_cobro_cargos_sin_truncate BEFORE TRUNCATE ON billing.diferencias_cobro_cargos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE FUNCTION billing.rechazar_cargo_diferencia() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION 'billing.diferencias_cobro_cargos ya no se usa: la diferencia de cobro es un gasto (5.3.05)';
            END $$;
            CREATE TRIGGER diferencias_cobro_cargos_cerrada BEFORE INSERT ON billing.diferencias_cobro_cargos
                FOR EACH ROW EXECUTE FUNCTION billing.rechazar_cargo_diferencia();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT ON billing.diferencias_cobro_cargos TO argosisp_app;
                    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON billing.diferencias_cobro_cargos FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }
}
