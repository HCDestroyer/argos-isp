import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · métodos de pago bancarios (decisión del PM, 2026-10-16).
 *
 *  - `billing.bancos`: catálogo de bancos de Guatemala (banco de origen de transferencias y ACH;
 *    también lo usa el portal). Se siembra aquí porque es un catálogo fijo del sistema.
 *  - `billing.cuentas_bancarias`: cuentas bancarias propias (destino de depósitos,
 *    transferencias, ACH y remesas). Cada una tiene su subcuenta de `1.1.02 Bancos` en el libro
 *    (`cuenta_id`), creada por la acción `cuentas_bancarias.crear`.
 *  - `billing.pagos`: métodos nuevos `transferencia`, `ach`, `remesa`; columnas
 *    `banco_origen_id` y `cuenta_bancaria_id`. Transferencia y ACH exigen banco de origen, cuenta
 *    de destino y referencia; remesa, cuenta y referencia (depósito lo exige la acción: hay
 *    depósitos históricos sin cuenta).
 *  - La referencia es única por (`metodo`, `cuenta_bancaria_id`, `referencia`) con NULLS NOT
 *    DISTINCT (mismo nombre de índice que antes).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.bancos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL UNIQUE,
                orden integer NOT NULL DEFAULT 0,
                activo boolean NOT NULL DEFAULT true,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            INSERT INTO billing.bancos (nombre, orden) VALUES
                ('Banrural', 10),
                ('Banco Industrial', 20),
                ('Banco G&T Continental', 30),
                ('BAM', 40),
                ('BAC Credomatic', 50),
                ('Bantrab', 60),
                ('Banco Promerica', 70),
                ('Banco Inmobiliario', 80),
                ('Banco Internacional', 90),
                ('Banco Ficohsa', 100),
                ('Banco Azteca', 110),
                ('Vivibanco', 120),
                ('Crédito Hipotecario Nacional', 130),
                ('Banco de Antigua', 140),
                ('Banco INV', 150),
                ('Banco Cuscatlán', 160),
                ('Banco Nexa', 170),
                ('Otro', 1000)
            ON CONFLICT (nombre) DO NOTHING;

            CREATE TABLE billing.cuentas_bancarias (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                banco_id bigint NOT NULL REFERENCES billing.bancos (id),
                numero text NOT NULL,
                alias text NOT NULL,
                moneda text NOT NULL DEFAULT 'GTQ' CHECK (moneda IN ('GTQ', 'USD')),
                activa boolean NOT NULL DEFAULT true,
                cuenta_id bigint NOT NULL UNIQUE REFERENCES ledger.cuentas (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT cuentas_bancarias_numero UNIQUE (banco_id, numero)
            );

            ALTER TABLE billing.pagos
                ADD COLUMN banco_origen_id bigint REFERENCES billing.bancos (id),
                ADD COLUMN cuenta_bancaria_id bigint REFERENCES billing.cuentas_bancarias (id),
                DROP CONSTRAINT IF EXISTS pagos_metodo_check,
                ADD CONSTRAINT pagos_metodo_check CHECK (metodo IN (
                    'caja', 'pasarela', 'deposito', 'transferencia', 'ach', 'remesa', 'agente', 'debito'
                )),
                ADD CONSTRAINT pagos_datos_bancarios CHECK (
                    (metodo NOT IN ('transferencia', 'ach')
                        OR (banco_origen_id IS NOT NULL AND cuenta_bancaria_id IS NOT NULL AND referencia IS NOT NULL))
                    AND (metodo <> 'remesa' OR (cuenta_bancaria_id IS NOT NULL AND referencia IS NOT NULL))
                );
            DROP INDEX IF EXISTS billing.pagos_metodo_referencia;
            CREATE UNIQUE INDEX pagos_metodo_referencia
                ON billing.pagos (metodo, cuenta_bancaria_id, referencia) NULLS NOT DISTINCT
                WHERE referencia IS NOT NULL;
            CREATE INDEX pagos_cuenta_bancaria ON billing.pagos (cuenta_bancaria_id)
                WHERE cuenta_bancaria_id IS NOT NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS billing.pagos_cuenta_bancaria;
            DROP INDEX IF EXISTS billing.pagos_metodo_referencia;
            ALTER TABLE billing.pagos
                DROP CONSTRAINT IF EXISTS pagos_datos_bancarios,
                DROP CONSTRAINT IF EXISTS pagos_metodo_check,
                -- NOT VALID: los pagos ya registrados con métodos nuevos no se borran
                ADD CONSTRAINT pagos_metodo_check
                    CHECK (metodo IN ('caja', 'pasarela', 'deposito', 'agente', 'debito')) NOT VALID,
                DROP COLUMN IF EXISTS cuenta_bancaria_id,
                DROP COLUMN IF EXISTS banco_origen_id;
            -- la unicidad vieja (metodo, referencia) puede no cumplirse con datos nuevos: índice simple
            DO $do$
            BEGIN
                CREATE UNIQUE INDEX pagos_metodo_referencia ON billing.pagos (metodo, referencia)
                    WHERE referencia IS NOT NULL;
            EXCEPTION WHEN unique_violation THEN
                CREATE INDEX pagos_metodo_referencia ON billing.pagos (metodo, referencia);
            END
            $do$;
            DROP TABLE IF EXISTS billing.cuentas_bancarias;
            DROP TABLE IF EXISTS billing.bancos;
        `)
    }
}
