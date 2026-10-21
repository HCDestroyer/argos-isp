import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 6, PR B (contrato de localización fiscal §10.5): lista de verificación de cierre, y la
 * observación del auditor a la PR A sobre el trigger inmediato de movimientos.
 *
 *  - `ledger.cierres_checks` (solo inserción): `empresa_id`, `tipo` (`mensual`, `impuestos`,
 *    `anual`), `periodo` (primer día del mes; del año en los anuales), `clave`, `automatico`,
 *    `valor_esperado`, `valor_obtenido` (texto: conteos, montos o «verificada»; la API los da como
 *    `esperado` y `obtenido`, y el prefijo evita confundirlos con columnas de dinero), `resultado`
 *    (`ok`, `anomalia`), `estado` (`revisado`, `anomalia`, `supervisado`), `nota` (obligatoria al
 *    supervisar), `detalle` jsonb, `revisado_por`. El estado vigente de cada clave es su última fila.
 *  - `ledger.validar_movimiento`: un movimiento nuevo de un asiento que ya existe se revisa con la
 *    misma `ledger.bloqueo_de` que el trigger diferido (diario del asiento y si el asiento, con
 *    este movimiento, toca impuestos), no solo con duro, mes cerrado y global. En la transacción
 *    del asiento (todavía sin número) sigue el chequeo inmediato de antes y el diferido completa.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.cierres_checks (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                tipo text NOT NULL CHECK (tipo IN ('mensual', 'impuestos', 'anual')),
                periodo date NOT NULL CHECK (
                    periodo = date_trunc('month', periodo)::date
                    AND (tipo <> 'anual' OR periodo = date_trunc('year', periodo)::date)
                ),
                clave text NOT NULL,
                automatico boolean NOT NULL,
                valor_esperado text,
                valor_obtenido text,
                resultado text NOT NULL CHECK (resultado IN ('ok', 'anomalia')),
                estado text NOT NULL CHECK (estado IN ('revisado', 'anomalia', 'supervisado')),
                nota text,
                detalle jsonb,
                revisado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT cierres_checks_supervisado_con_nota CHECK (
                    estado <> 'supervisado' OR length(btrim(coalesce(nota, ''))) >= 3
                ),
                CONSTRAINT cierres_checks_estado_coherente CHECK (
                    (resultado = 'ok' AND estado = 'revisado')
                    OR (resultado = 'anomalia' AND estado IN ('anomalia', 'supervisado'))
                )
            );
            CREATE INDEX cierres_checks_vigente_idx ON ledger.cierres_checks (empresa_id, tipo, periodo, clave, id DESC);

            CREATE TRIGGER cierres_checks_inmutable BEFORE UPDATE OR DELETE ON ledger.cierres_checks
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER cierres_checks_sin_truncate BEFORE TRUNCATE ON ledger.cierres_checks
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE OR REPLACE FUNCTION ledger.validar_movimiento() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_cuenta record;
                v_asiento record;
                v_diario bigint;
                v_impuesto boolean;
                v_tipo text;
            BEGIN
                SELECT codigo, activa, imputable, auxiliar_cliente, empresa_id INTO v_cuenta
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

                SELECT id, fecha, empresa_id, origen_tipo, created_by, excepcion_id INTO v_asiento
                  FROM ledger.asientos WHERE id = NEW.asiento_id;
                IF FOUND THEN
                    -- con número (asiento ya registrado): todos los tipos, como el trigger diferido
                    SELECT n.diario_id INTO v_diario FROM ledger.asientos_numeros n WHERE n.asiento_id = NEW.asiento_id;
                    v_impuesto := v_diario IS NOT NULL AND (
                        NEW.impuesto_codigo IS NOT NULL
                        OR ledger.cuentas_tocan_impuesto(ARRAY[NEW.cuenta_id])
                        OR ledger.asiento_con_impuesto(NEW.asiento_id)
                    );
                    v_tipo := ledger.bloqueo_de(v_asiento.fecha, v_asiento.empresa_id, v_diario, v_asiento.origen_tipo,
                                                coalesce(v_impuesto, false), v_asiento.created_by, v_asiento.excepcion_id);
                    IF v_tipo IS NOT NULL THEN
                        PERFORM ledger.rechazar_bloqueo(v_tipo, v_asiento.fecha,
                            'el asiento ' || NEW.asiento_id || ' no admite movimientos');
                    END IF;
                    IF v_cuenta.empresa_id IS NOT NULL AND v_cuenta.empresa_id <> v_asiento.empresa_id THEN
                        RAISE EXCEPTION 'La cuenta % es de la empresa %, no de la % del asiento %',
                            v_cuenta.codigo, v_cuenta.empresa_id, v_asiento.empresa_id, NEW.asiento_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'cuenta_de_otra_empresa';
                    END IF;
                END IF;
                RETURN NEW;
            END
            $fn$;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON ledger.cierres_checks TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.cierres_checks FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION ledger.validar_movimiento() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_cuenta record;
                v_asiento record;
                v_tipo text;
            BEGIN
                SELECT codigo, activa, imputable, auxiliar_cliente, empresa_id INTO v_cuenta
                  FROM ledger.cuentas WHERE id = NEW.cuenta_id;
                IF NOT FOUND THEN
                    RETURN NEW;
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
                SELECT fecha, empresa_id, origen_tipo, created_by, excepcion_id INTO v_asiento
                  FROM ledger.asientos WHERE id = NEW.asiento_id;
                IF FOUND THEN
                    v_tipo := ledger.bloqueo_de(v_asiento.fecha, v_asiento.empresa_id, NULL, v_asiento.origen_tipo,
                                                false, v_asiento.created_by, v_asiento.excepcion_id);
                    IF v_tipo IS NOT NULL THEN
                        PERFORM ledger.rechazar_bloqueo(v_tipo, v_asiento.fecha,
                            'el asiento ' || NEW.asiento_id || ' no admite movimientos');
                    END IF;
                    IF v_cuenta.empresa_id IS NOT NULL AND v_cuenta.empresa_id <> v_asiento.empresa_id THEN
                        RAISE EXCEPTION 'La cuenta % es de la empresa %, no de la % del asiento %',
                            v_cuenta.codigo, v_cuenta.empresa_id, v_asiento.empresa_id, NEW.asiento_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'cuenta_de_otra_empresa';
                    END IF;
                END IF;
                RETURN NEW;
            END
            $fn$;
            DROP TABLE IF EXISTS ledger.cierres_checks;
        `)
    }
}
