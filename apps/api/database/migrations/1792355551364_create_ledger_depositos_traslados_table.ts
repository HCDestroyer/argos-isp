import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · localización fiscal, fase 4 (contrato §10.3): **depósitos de caja y traslados** vía
 * `1.1.11 Fondos en tránsito`.
 *
 * - `ledger.depositos`: efectivo de un turno de caja abierto llevado al banco con su boleta
 *   (`1.1.11 / Caja`); baja el esperado del turno como un egreso.
 * - `ledger.traslados`: de una cuenta bancaria propia a otra de la misma empresa
 *   (`1.1.11 / Banco A`).
 * - `ledger.transitos_acreditados`: la llegada al banco de destino (`Banco / 1.1.11`), una por
 *   depósito o traslado; la escribe la conciliación (§10.3, «al conciliar el banco»).
 *
 * Las tres son de solo inserción (trigger y REVOKE). Su asiento es el de origen `deposito` o
 * `traslado` con su id (la llegada, el segundo asiento del mismo origen).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.depositos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                caja_id bigint NOT NULL REFERENCES ledger.cajas (id),
                turno_id bigint NOT NULL REFERENCES ledger.cajas_turnos (id),
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                cuenta_bancaria_id bigint REFERENCES billing.cuentas_bancarias (id),
                banco_id bigint REFERENCES ledger.bancos (id),
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                boleta text NOT NULL CHECK (length(btrim(boleta)) > 0),
                fecha date NOT NULL,
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT depositos_boleta UNIQUE (empresa_id, cuenta_id, boleta)
            );
            CREATE INDEX depositos_turno ON ledger.depositos (turno_id);

            CREATE TABLE ledger.traslados (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                cuenta_origen_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                cuenta_destino_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                fecha date NOT NULL,
                referencia text NOT NULL CHECK (length(btrim(referencia)) > 0),
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT traslados_distintas CHECK (cuenta_origen_id <> cuenta_destino_id),
                CONSTRAINT traslados_referencia UNIQUE (empresa_id, cuenta_origen_id, referencia)
            );

            CREATE TABLE ledger.transitos_acreditados (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                tipo text NOT NULL CHECK (tipo IN ('deposito', 'traslado')),
                documento_id bigint NOT NULL,
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                fecha date NOT NULL,
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT transitos_acreditados_unico UNIQUE (tipo, documento_id)
            );

            -- el documento es de la empresa; la caja y el turno abierto, de ella; las cuentas, bancos de
            -- la empresa (o comunes); la llegada, a la cuenta de destino del documento
            CREATE OR REPLACE FUNCTION ledger.validar_transito() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_cuenta record;
                v_ids bigint[];
                v_id bigint;
            BEGIN
                IF TG_TABLE_NAME = 'depositos' THEN
                    IF NOT EXISTS (SELECT 1 FROM ledger.cajas c JOIN ledger.cajas_turnos t ON t.caja_id = c.id
                                    WHERE c.id = NEW.caja_id AND t.id = NEW.turno_id AND c.empresa_id = NEW.empresa_id
                                      AND t.cerrado_en IS NULL) THEN
                        RAISE EXCEPTION 'El depósito necesita el turno abierto de una caja de la empresa %', NEW.empresa_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'deposito_sin_turno';
                    END IF;
                    v_ids := ARRAY[NEW.cuenta_id];
                ELSIF TG_TABLE_NAME = 'traslados' THEN
                    v_ids := ARRAY[NEW.cuenta_origen_id, NEW.cuenta_destino_id];
                ELSE
                    IF NEW.tipo = 'deposito' AND NOT EXISTS (SELECT 1 FROM ledger.depositos d WHERE d.id = NEW.documento_id
                            AND d.empresa_id = NEW.empresa_id AND d.cuenta_id = NEW.cuenta_id)
                       OR NEW.tipo = 'traslado' AND NOT EXISTS (SELECT 1 FROM ledger.traslados x WHERE x.id = NEW.documento_id
                            AND x.empresa_id = NEW.empresa_id AND x.cuenta_destino_id = NEW.cuenta_id) THEN
                        RAISE EXCEPTION 'La llegada del % % no es a su cuenta de destino', NEW.tipo, NEW.documento_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'transito_otra_cuenta';
                    END IF;
                    v_ids := ARRAY[NEW.cuenta_id];
                END IF;
                FOREACH v_id IN ARRAY v_ids LOOP
                    SELECT codigo, empresa_id INTO v_cuenta FROM ledger.cuentas WHERE id = v_id;
                    IF v_cuenta.codigo NOT LIKE '1.1.02.%' THEN
                        RAISE EXCEPTION 'La cuenta % no es un banco del libro', v_cuenta.codigo
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'transito_cuenta_banco';
                    END IF;
                    IF v_cuenta.empresa_id IS NOT NULL AND v_cuenta.empresa_id <> NEW.empresa_id THEN
                        RAISE EXCEPTION 'La cuenta % es de otra empresa', v_cuenta.codigo
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'cuenta_de_otra_empresa';
                    END IF;
                END LOOP;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER depositos_validar BEFORE INSERT ON ledger.depositos
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_transito();
            CREATE TRIGGER traslados_validar BEFORE INSERT ON ledger.traslados
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_transito();
            CREATE TRIGGER transitos_acreditados_validar BEFORE INSERT ON ledger.transitos_acreditados
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_transito();

            CREATE TRIGGER depositos_inmutable BEFORE UPDATE OR DELETE ON ledger.depositos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER depositos_sin_truncate BEFORE TRUNCATE ON ledger.depositos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER traslados_inmutable BEFORE UPDATE OR DELETE ON ledger.traslados
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER traslados_sin_truncate BEFORE TRUNCATE ON ledger.traslados
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER transitos_acreditados_inmutable BEFORE UPDATE OR DELETE ON ledger.transitos_acreditados
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER transitos_acreditados_sin_truncate BEFORE TRUNCATE ON ledger.transitos_acreditados
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON ledger.depositos, ledger.traslados, ledger.transitos_acreditados TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.depositos, ledger.traslados, ledger.transitos_acreditados
                        FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS ledger.transitos_acreditados;
            DROP TABLE IF EXISTS ledger.traslados;
            DROP TABLE IF EXISTS ledger.depositos;
            DROP FUNCTION IF EXISTS ledger.validar_transito();
        `)
    }
}
