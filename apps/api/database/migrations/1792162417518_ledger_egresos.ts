import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · semana 2: egresos. La tabla `ledger.egresos` existía desde el día 1 sin uso.
 *
 *  - `egresos_categorias.clave`: identificador estable de la categoría (`energia`, `transito`,
 *    `nomina`, `vehiculos`, `alquileres`, `otros`), el que manda la API.
 *  - `forma_pago` pasa a `metodo` (`caja`, `banco`, `cuenta_bancaria`) con la caja (y su turno
 *    abierto: el efectivo que sale baja el esperado del cierre), el banco del libro o la cuenta
 *    bancaria propia de donde sale el dinero.
 *  - Inmutable como el libro: un egreso no se edita ni se borra (trigger). Anular = una fila en
 *    `ledger.egresos_anulaciones` (una por egreso) con el asiento de reverso.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.egresos_categorias ADD COLUMN clave text;
            UPDATE ledger.egresos_categorias SET clave = CASE nombre
                WHEN 'Energía' THEN 'energia'
                WHEN 'Tránsito' THEN 'transito'
                WHEN 'Nómina' THEN 'nomina'
                WHEN 'Vehículos' THEN 'vehiculos'
                WHEN 'Alquileres' THEN 'alquileres'
                WHEN 'Otros' THEN 'otros'
                ELSE lower(nombre) END;
            CREATE UNIQUE INDEX egresos_categorias_clave ON ledger.egresos_categorias (clave);

            ALTER TABLE ledger.egresos RENAME COLUMN forma_pago TO metodo;
            ALTER TABLE ledger.egresos
                ADD CONSTRAINT egresos_metodo CHECK (metodo IN ('caja', 'banco', 'cuenta_bancaria')),
                ADD COLUMN descripcion text,
                ADD COLUMN caja_id bigint REFERENCES ledger.cajas (id),
                ADD COLUMN turno_id bigint REFERENCES ledger.cajas_turnos (id),
                ADD COLUMN banco_id bigint REFERENCES ledger.bancos (id),
                ADD COLUMN cuenta_bancaria_id bigint REFERENCES billing.cuentas_bancarias (id),
                ADD COLUMN registrado_por bigint REFERENCES core.usuarios (id),
                ADD CONSTRAINT egresos_origen CHECK (
                    (metodo = 'caja' AND caja_id IS NOT NULL AND banco_id IS NULL AND cuenta_bancaria_id IS NULL)
                    OR (metodo = 'banco' AND banco_id IS NOT NULL AND caja_id IS NULL AND cuenta_bancaria_id IS NULL)
                    OR (metodo = 'cuenta_bancaria' AND cuenta_bancaria_id IS NOT NULL AND caja_id IS NULL AND banco_id IS NULL)
                );
            CREATE INDEX egresos_categoria ON ledger.egresos (categoria_id);
            CREATE INDEX egresos_turno ON ledger.egresos (turno_id) WHERE turno_id IS NOT NULL;
            CREATE TRIGGER egresos_inmutable BEFORE UPDATE OR DELETE ON ledger.egresos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TABLE ledger.egresos_anulaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                egreso_id bigint NOT NULL UNIQUE REFERENCES ledger.egresos (id),
                asiento_id bigint NOT NULL REFERENCES ledger.asientos (id),
                motivo text NOT NULL CHECK (length(motivo) > 0),
                anulado_por bigint REFERENCES core.usuarios (id),
                anulado_en timestamptz NOT NULL DEFAULT now()
            );
            CREATE TRIGGER egresos_anulaciones_inmutable BEFORE UPDATE OR DELETE ON ledger.egresos_anulaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.egresos, ledger.egresos_anulaciones FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS ledger.egresos_anulaciones;
            DROP TRIGGER IF EXISTS egresos_inmutable ON ledger.egresos;
            DROP INDEX IF EXISTS ledger.egresos_turno;
            DROP INDEX IF EXISTS ledger.egresos_categoria;
            ALTER TABLE ledger.egresos
                DROP CONSTRAINT IF EXISTS egresos_origen,
                DROP CONSTRAINT IF EXISTS egresos_metodo,
                DROP COLUMN IF EXISTS registrado_por,
                DROP COLUMN IF EXISTS cuenta_bancaria_id,
                DROP COLUMN IF EXISTS banco_id,
                DROP COLUMN IF EXISTS turno_id,
                DROP COLUMN IF EXISTS caja_id,
                DROP COLUMN IF EXISTS descripcion;
            ALTER TABLE ledger.egresos RENAME COLUMN metodo TO forma_pago;
            DROP INDEX IF EXISTS ledger.egresos_categorias_clave;
            ALTER TABLE ledger.egresos_categorias DROP COLUMN IF EXISTS clave;
        `)
    }
}
