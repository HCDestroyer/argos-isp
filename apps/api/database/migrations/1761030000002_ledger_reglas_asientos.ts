import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · tarea 2: reglas del libro en base de datos (además del cuadre diferido del día 1).
 *
 *  - `asientos.reversa_de`: el asiento de reverso apunta al original; un asiento se revierte una
 *    sola vez (índice único). Corregir = revertir, nunca UPDATE/DELETE.
 *  - `origen_id` obligatorio salvo en ajustes manuales.
 *  - Periodo cerrado (`ledger.cierres_mensuales`): no se insertan asientos ni movimientos con
 *    fecha dentro de un mes cerrado.
 *  - Movimientos solo en cuentas activas e imputables; en cuentas con auxiliar por cliente
 *    (CxC, anticipos) `cliente_id` es obligatorio.
 *  - El rol `argosisp_app` ya no tiene UPDATE/DELETE/TRUNCATE sobre `ledger.asientos` ni
 *    `ledger.movimientos` (migración del rol); aquí se vuelve a aplicar por si el rol existe.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.asientos
                ADD COLUMN reversa_de bigint REFERENCES ledger.asientos (id),
                ADD CONSTRAINT asientos_origen_obligatorio
                    CHECK (origen_tipo = 'ajuste' OR origen_id IS NOT NULL),
                ADD CONSTRAINT asientos_reversa_distinta CHECK (reversa_de IS NULL OR reversa_de <> id);
            CREATE UNIQUE INDEX asientos_reversa_unica ON ledger.asientos (reversa_de)
                WHERE reversa_de IS NOT NULL;

            CREATE OR REPLACE FUNCTION ledger.periodo_cerrado(p_fecha date) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.cierres_mensuales
                     WHERE periodo = date_trunc('month', p_fecha)::date
                );
            $fn$;

            CREATE OR REPLACE FUNCTION ledger.validar_asiento() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF ledger.periodo_cerrado(NEW.fecha) THEN
                    RAISE EXCEPTION 'Periodo % cerrado: no se registran asientos con fecha %',
                        to_char(NEW.fecha, 'YYYY-MM'), NEW.fecha
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'periodo_abierto';
                END IF;
                RETURN NEW;
            END
            $fn$;

            CREATE TRIGGER asientos_validar
                BEFORE INSERT ON ledger.asientos
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_asiento();

            CREATE OR REPLACE FUNCTION ledger.validar_movimiento() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_cuenta record;
                v_fecha date;
            BEGIN
                SELECT codigo, activa, imputable, auxiliar_cliente INTO v_cuenta
                  FROM ledger.cuentas WHERE id = NEW.cuenta_id;
                IF NOT FOUND THEN
                    RETURN NEW; -- la FK lo rechaza
                END IF;
                IF NOT v_cuenta.activa THEN
                    RAISE EXCEPTION 'La cuenta % está inactiva', v_cuenta.codigo
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'cuenta_activa';
                END IF;
                IF NOT v_cuenta.imputable THEN
                    RAISE EXCEPTION 'La cuenta % es de agrupación y no recibe movimientos', v_cuenta.codigo
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'cuenta_imputable';
                END IF;
                IF v_cuenta.auxiliar_cliente AND NEW.cliente_id IS NULL THEN
                    RAISE EXCEPTION 'La cuenta % lleva auxiliar por cliente: falta cliente_id', v_cuenta.codigo
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'movimiento_cliente';
                END IF;

                SELECT fecha INTO v_fecha FROM ledger.asientos WHERE id = NEW.asiento_id;
                IF FOUND AND ledger.periodo_cerrado(v_fecha) THEN
                    RAISE EXCEPTION 'Periodo % cerrado: el asiento % no admite movimientos',
                        to_char(v_fecha, 'YYYY-MM'), NEW.asiento_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'periodo_abierto';
                END IF;
                RETURN NEW;
            END
            $fn$;

            CREATE TRIGGER movimientos_validar
                BEFORE INSERT ON ledger.movimientos
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_movimiento();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.asientos, ledger.movimientos FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS movimientos_validar ON ledger.movimientos;
            DROP FUNCTION IF EXISTS ledger.validar_movimiento();
            DROP TRIGGER IF EXISTS asientos_validar ON ledger.asientos;
            DROP FUNCTION IF EXISTS ledger.validar_asiento();
            DROP FUNCTION IF EXISTS ledger.periodo_cerrado(date);
            DROP INDEX IF EXISTS ledger.asientos_reversa_unica;
            ALTER TABLE ledger.asientos
                DROP CONSTRAINT IF EXISTS asientos_reversa_distinta,
                DROP CONSTRAINT IF EXISTS asientos_origen_obligatorio,
                DROP COLUMN IF EXISTS reversa_de;
        `)
    }
}
