import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · cadena de hash de los asientos (contrato de localización fiscal §10.10, fase 2).
 *
 *  - `ledger.asientos_sellos` (`asiento_id` PK, `empresa_id`, `sello` correlativo por empresa,
 *    `version` `v1`, `hash_anterior`, `hash`, `sellado_en`): solo inserción (trigger y `REVOKE`).
 *    La escribe el sellador (`#ledger/sellos`), nunca la transacción del asiento: así los cobros
 *    no se serializan detrás de la cadena.
 *  - Un trigger exige que cada sello encadene con el último de su empresa: `sello = último + 1`,
 *    `hash_anterior = hash del último` (64 ceros en el primero) y la empresa del asiento. El hash
 *    lo calcula la aplicación (JSON canónico v1); la base garantiza que la cadena no se bifurca.
 *  - `ledger.cierres_mensuales.ultimo_hash`: último hash de la empresa al cerrar el mes (columna
 *    nueva, nula en los cierres anteriores; ningún `UPDATE`).
 *  - Los asientos existentes se sellan en la primera corrida del sellador, en orden de id.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.asientos_sellos (
                asiento_id bigint PRIMARY KEY REFERENCES ledger.asientos (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                sello integer NOT NULL CHECK (sello > 0),
                version text NOT NULL DEFAULT 'v1' CHECK (version IN ('v1')),
                hash_anterior char(64) NOT NULL CHECK (hash_anterior ~ '^[0-9a-f]{64}$'),
                hash char(64) NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
                sellado_en timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT asientos_sellos_correlativo UNIQUE (empresa_id, sello)
            );

            CREATE OR REPLACE FUNCTION ledger.validar_sello() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_empresa bigint;
                v_ultimo ledger.asientos_sellos%ROWTYPE;
            BEGIN
                SELECT empresa_id INTO v_empresa FROM ledger.asientos WHERE id = NEW.asiento_id;
                IF v_empresa IS DISTINCT FROM NEW.empresa_id THEN
                    RAISE EXCEPTION 'El asiento % es de la empresa %, no de la %', NEW.asiento_id, v_empresa, NEW.empresa_id
                        USING ERRCODE = 'check_violation';
                END IF;
                SELECT * INTO v_ultimo FROM ledger.asientos_sellos
                 WHERE empresa_id = NEW.empresa_id ORDER BY sello DESC LIMIT 1;
                IF NOT FOUND THEN
                    IF NEW.sello <> 1 OR NEW.hash_anterior <> repeat('0', 64) THEN
                        RAISE EXCEPTION 'El primer sello de la empresa % es el 1 y encadena con 64 ceros', NEW.empresa_id
                            USING ERRCODE = 'check_violation';
                    END IF;
                ELSIF NEW.sello <> v_ultimo.sello + 1 OR NEW.hash_anterior <> v_ultimo.hash THEN
                    RAISE EXCEPTION 'El sello % de la empresa % no encadena con el sello %', NEW.sello, NEW.empresa_id, v_ultimo.sello
                        USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER asientos_sellos_validar BEFORE INSERT ON ledger.asientos_sellos
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_sello();
            CREATE TRIGGER asientos_sellos_inmutable BEFORE UPDATE OR DELETE ON ledger.asientos_sellos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER asientos_sellos_sin_truncate BEFORE TRUNCATE ON ledger.asientos_sellos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            ALTER TABLE ledger.cierres_mensuales
                ADD COLUMN ultimo_hash char(64) CHECK (ultimo_hash ~ '^[0-9a-f]{64}$'),
                ADD COLUMN ultimo_sello integer;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON ledger.asientos_sellos TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.asientos_sellos FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE ledger.cierres_mensuales DROP COLUMN IF EXISTS ultimo_hash, DROP COLUMN IF EXISTS ultimo_sello;
            DROP TABLE IF EXISTS ledger.asientos_sellos;
            DROP FUNCTION IF EXISTS ledger.validar_sello();
        `)
    }
}
