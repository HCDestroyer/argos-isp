import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 4, revisión del auditor (H13, H14 y desvío c del contrato §18). Solo DDL: ninguna fila
 * del libro se toca.
 *
 * - H13: una nota interna (sin DTE) se anula cuando se anula el pago cuya diferencia cerró:
 *   `billing.notas_credito_anulaciones.dte_id` deja de ser obligatoria y se agrega `pago_id` (una de
 *   las dos causas, nunca ninguna).
 * - H14: una liquidación puede tener bruto ≤ 0 (solo contracargos: el proveedor debita el banco).
 * - Desvío (c): `bancos.reatribuir_llegada`. La llegada de un depósito o traslado se corrige con el
 *   reverso de su asiento y una fila en `ledger.transitos_reatribuciones`; el documento vuelve a estar
 *   en tránsito y puede llegar otra vez (la unicidad pasa a «una llegada vigente por documento», por
 *   trigger).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.notas_credito_anulaciones ALTER COLUMN dte_id DROP NOT NULL;
            ALTER TABLE billing.notas_credito_anulaciones ADD COLUMN pago_id bigint REFERENCES billing.pagos (id);
            ALTER TABLE billing.notas_credito_anulaciones ADD CONSTRAINT notas_credito_anulaciones_causa
                CHECK (dte_id IS NOT NULL OR pago_id IS NOT NULL);

            ALTER TABLE ledger.liquidaciones_cobro DROP CONSTRAINT liquidaciones_cobro_bruto_check;
            ALTER TABLE ledger.liquidaciones_cobro DROP CONSTRAINT liquidaciones_cobro_neto_check;
            ALTER TABLE ledger.liquidaciones_cobro ADD CONSTRAINT liquidaciones_cobro_no_vacia
                CHECK (bruto <> 0 OR comision <> 0);

            CREATE TABLE ledger.transitos_reatribuciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                acreditado_id bigint NOT NULL UNIQUE REFERENCES ledger.transitos_acreditados (id),
                asiento_reverso_id bigint NOT NULL REFERENCES ledger.asientos (id),
                motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE TRIGGER transitos_reatribuciones_inmutable BEFORE UPDATE OR DELETE ON ledger.transitos_reatribuciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER transitos_reatribuciones_sin_truncate BEFORE TRUNCATE ON ledger.transitos_reatribuciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            ALTER TABLE ledger.transitos_acreditados DROP CONSTRAINT transitos_acreditados_unico;
            CREATE INDEX transitos_acreditados_documento ON ledger.transitos_acreditados (tipo, documento_id);
            CREATE OR REPLACE FUNCTION ledger.una_llegada_vigente() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                PERFORM pg_advisory_xact_lock(3013, NEW.documento_id::int);
                IF EXISTS (SELECT 1 FROM ledger.transitos_acreditados x
                            WHERE x.tipo = NEW.tipo AND x.documento_id = NEW.documento_id
                              AND NOT EXISTS (SELECT 1 FROM ledger.transitos_reatribuciones r WHERE r.acreditado_id = x.id)) THEN
                    RAISE EXCEPTION 'El % % ya llegó al banco', NEW.tipo, NEW.documento_id
                        USING ERRCODE = 'unique_violation', CONSTRAINT = 'transitos_acreditados_unico';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER transitos_acreditados_una_vigente BEFORE INSERT ON ledger.transitos_acreditados
                FOR EACH ROW EXECUTE FUNCTION ledger.una_llegada_vigente();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON ledger.transitos_reatribuciones TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.transitos_reatribuciones FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS transitos_acreditados_una_vigente ON ledger.transitos_acreditados;
            DROP FUNCTION IF EXISTS ledger.una_llegada_vigente();
            DROP INDEX IF EXISTS ledger.transitos_acreditados_documento;
            DROP TABLE IF EXISTS ledger.transitos_reatribuciones;
            -- sin volver al UNIQUE: con reatribuciones hay dos llegadas de un documento (la tabla la borra la
            -- migración que la creó)
            ALTER TABLE ledger.liquidaciones_cobro DROP CONSTRAINT IF EXISTS liquidaciones_cobro_no_vacia;
            ALTER TABLE ledger.liquidaciones_cobro ADD CONSTRAINT liquidaciones_cobro_bruto_check CHECK (bruto > 0) NOT VALID;
            ALTER TABLE ledger.liquidaciones_cobro ADD CONSTRAINT liquidaciones_cobro_neto_check CHECK (neto >= 0) NOT VALID;
            ALTER TABLE billing.notas_credito_anulaciones DROP CONSTRAINT IF EXISTS notas_credito_anulaciones_causa;
            ALTER TABLE billing.notas_credito_anulaciones DROP COLUMN IF EXISTS pago_id;
        `)
    }
}
