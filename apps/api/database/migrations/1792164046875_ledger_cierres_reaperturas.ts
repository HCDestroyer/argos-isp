import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · semana 2: cierre mensual del libro con reapertura auditada, sin UPDATE ni DELETE.
 *
 *  - `ledger.cierres_mensuales`: un cierre por vez (puede haber varios del mismo mes en la
 *    historia: cerrar, reabrir, volver a cerrar). Guarda quién, cuándo y el resumen del mes al
 *    cerrarlo (asientos, debe, haber y saldo por cuenta).
 *  - `ledger.reaperturas_mensuales`: reabrir = una fila que apunta al cierre, con motivo.
 *  - `ledger.periodo_cerrado(fecha)`: hay un cierre del mes sin reapertura. La usan los triggers
 *    de asientos y movimientos (ningún asiento, ni siquiera un reverso, con fecha en un mes
 *    cerrado) y la acción `registrarAsiento`.
 *  - Trigger: no se cierra un mes que ya está cerrado. Ambas tablas son inmutables.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.cierres_mensuales
                DROP CONSTRAINT IF EXISTS cierres_mensuales_periodo_key,
                ADD COLUMN resumen jsonb;
            CREATE INDEX cierres_mensuales_periodo ON ledger.cierres_mensuales (periodo);

            CREATE TABLE ledger.reaperturas_mensuales (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cierre_id bigint NOT NULL UNIQUE REFERENCES ledger.cierres_mensuales (id),
                motivo text NOT NULL CHECK (length(trim(motivo)) > 0),
                reabierto_por bigint REFERENCES core.usuarios (id),
                reabierto_en timestamptz NOT NULL DEFAULT now()
            );

            CREATE OR REPLACE FUNCTION ledger.periodo_cerrado(p_fecha date) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.cierres_mensuales c
                     WHERE c.periodo = date_trunc('month', p_fecha)::date
                       AND NOT EXISTS (SELECT 1 FROM ledger.reaperturas_mensuales r WHERE r.cierre_id = c.id)
                );
            $fn$;

            CREATE OR REPLACE FUNCTION ledger.validar_cierre() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF ledger.periodo_cerrado(NEW.periodo) THEN
                    RAISE EXCEPTION 'El periodo % ya está cerrado', to_char(NEW.periodo, 'YYYY-MM')
                        USING ERRCODE = 'unique_violation', CONSTRAINT = 'periodo_ya_cerrado';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER cierres_mensuales_validar
                BEFORE INSERT ON ledger.cierres_mensuales
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_cierre();

            CREATE TRIGGER cierres_mensuales_inmutable
                BEFORE UPDATE OR DELETE ON ledger.cierres_mensuales
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER reaperturas_mensuales_inmutable
                BEFORE UPDATE OR DELETE ON ledger.reaperturas_mensuales
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    REVOKE UPDATE, DELETE, TRUNCATE
                        ON ledger.cierres_mensuales, ledger.reaperturas_mensuales FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS cierres_mensuales_inmutable ON ledger.cierres_mensuales;
            DROP TRIGGER IF EXISTS cierres_mensuales_validar ON ledger.cierres_mensuales;
            DROP FUNCTION IF EXISTS ledger.validar_cierre();
            CREATE OR REPLACE FUNCTION ledger.periodo_cerrado(p_fecha date) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.cierres_mensuales
                     WHERE periodo = date_trunc('month', p_fecha)::date
                );
            $fn$;
            DROP TABLE IF EXISTS ledger.reaperturas_mensuales;
            DROP INDEX IF EXISTS ledger.cierres_mensuales_periodo;
            ALTER TABLE ledger.cierres_mensuales DROP COLUMN IF EXISTS resumen;
        `)
    }
}
