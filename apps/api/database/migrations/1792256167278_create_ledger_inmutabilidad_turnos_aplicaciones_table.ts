import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · hallazgo H3 del auditor contable (regla 4: lo que mueve dinero no se edita).
 *
 *  - `ledger.cajas_turnos`: el turno se abre con INSERT y se cierra con **un** UPDATE. El trigger
 *    `cajas_turnos_inmutable` rechaza DELETE, cualquier UPDATE de un turno ya cerrado (contado,
 *    diferencia, motivo, cierre…) y, sobre el turno abierto, todo lo que no sea cerrarlo sin tocar
 *    sus datos de apertura. `argosisp_app` pierde DELETE y TRUNCATE, y su UPDATE queda limitado a
 *    las columnas del cierre.
 *  - `billing.pagos_aplicaciones` y `billing.saldos_iniciales_aplicaciones`: solo inserción
 *    (trigger y REVOKE). Una aplicación de un pago anulado queda como historia del pago.
 *  - TRUNCATE rechazado por trigger en `cierres_mensuales`, `reaperturas_mensuales`, `egresos` y
 *    `egresos_anulaciones`, igual que `ledger.asientos`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION ledger.proteger_turno_caja() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'El turno de caja % no se puede borrar', OLD.id
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                IF OLD.cerrado_en IS NOT NULL THEN
                    RAISE EXCEPTION 'El turno de caja % ya está cerrado: no se puede modificar', OLD.id
                        USING ERRCODE = 'insufficient_privilege',
                              HINT = 'Una diferencia se corrige con un asiento, nunca editando el cierre.';
                END IF;
                IF NEW.cerrado_en IS NULL THEN
                    RAISE EXCEPTION 'El turno de caja % solo admite su cierre', OLD.id
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                IF NEW.id IS DISTINCT FROM OLD.id
                   OR NEW.caja_id IS DISTINCT FROM OLD.caja_id
                   OR NEW.abierto_en IS DISTINCT FROM OLD.abierto_en
                   OR NEW.abierto_por IS DISTINCT FROM OLD.abierto_por
                   OR NEW.fondo_inicial IS DISTINCT FROM OLD.fondo_inicial
                   OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                    RAISE EXCEPTION 'El cierre del turno de caja % no puede cambiar los datos de apertura', OLD.id
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                RETURN NEW;
            END
            $fn$;

            CREATE TRIGGER cajas_turnos_inmutable BEFORE UPDATE OR DELETE ON ledger.cajas_turnos
                FOR EACH ROW EXECUTE FUNCTION ledger.proteger_turno_caja();
            CREATE TRIGGER cajas_turnos_sin_truncate BEFORE TRUNCATE ON ledger.cajas_turnos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TRIGGER pagos_aplicaciones_inmutable BEFORE UPDATE OR DELETE ON billing.pagos_aplicaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER pagos_aplicaciones_sin_truncate BEFORE TRUNCATE ON billing.pagos_aplicaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER saldos_iniciales_aplicaciones_inmutable
                BEFORE UPDATE OR DELETE ON billing.saldos_iniciales_aplicaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER saldos_iniciales_aplicaciones_sin_truncate
                BEFORE TRUNCATE ON billing.saldos_iniciales_aplicaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TRIGGER cierres_mensuales_sin_truncate BEFORE TRUNCATE ON ledger.cierres_mensuales
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER reaperturas_mensuales_sin_truncate BEFORE TRUNCATE ON ledger.reaperturas_mensuales
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER egresos_sin_truncate BEFORE TRUNCATE ON ledger.egresos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER egresos_anulaciones_sin_truncate BEFORE TRUNCATE ON ledger.egresos_anulaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.cajas_turnos FROM argosisp_app;
                    GRANT UPDATE (cerrado_en, esperado, contado, diferencia, motivo, cerrado_por, version, updated_at)
                        ON ledger.cajas_turnos TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE
                        ON billing.pagos_aplicaciones, billing.saldos_iniciales_aplicaciones FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    REVOKE UPDATE (cerrado_en, esperado, contado, diferencia, motivo, cerrado_por, version, updated_at)
                        ON ledger.cajas_turnos FROM argosisp_app;
                    GRANT UPDATE, DELETE ON ledger.cajas_turnos TO argosisp_app;
                    GRANT UPDATE, DELETE
                        ON billing.pagos_aplicaciones, billing.saldos_iniciales_aplicaciones TO argosisp_app;
                END IF;
            END
            $do$;
            DROP TRIGGER IF EXISTS egresos_anulaciones_sin_truncate ON ledger.egresos_anulaciones;
            DROP TRIGGER IF EXISTS egresos_sin_truncate ON ledger.egresos;
            DROP TRIGGER IF EXISTS reaperturas_mensuales_sin_truncate ON ledger.reaperturas_mensuales;
            DROP TRIGGER IF EXISTS cierres_mensuales_sin_truncate ON ledger.cierres_mensuales;
            DROP TRIGGER IF EXISTS saldos_iniciales_aplicaciones_sin_truncate ON billing.saldos_iniciales_aplicaciones;
            DROP TRIGGER IF EXISTS saldos_iniciales_aplicaciones_inmutable ON billing.saldos_iniciales_aplicaciones;
            DROP TRIGGER IF EXISTS pagos_aplicaciones_sin_truncate ON billing.pagos_aplicaciones;
            DROP TRIGGER IF EXISTS pagos_aplicaciones_inmutable ON billing.pagos_aplicaciones;
            DROP TRIGGER IF EXISTS cajas_turnos_sin_truncate ON ledger.cajas_turnos;
            DROP TRIGGER IF EXISTS cajas_turnos_inmutable ON ledger.cajas_turnos;
            DROP FUNCTION IF EXISTS ledger.proteger_turno_caja();
        `)
    }
}
