import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 7, PR B (decisión del líder tras la auditoría): el bloqueo de impuestos alcanza también
 * a las partidas **sin etiqueta** en una cuenta de impuesto (1.1.04–1.1.08, 2.1.02, 2.1.04–2.1.09 y
 * 2.1.11, la lista que tenía `ledger.cuentas_con_impuesto`), para que un ajuste manual sin etiqueta no
 * entre en un mes ya liquidado. La liquidación (`liquidacion_impuesto`) y su pago (`pago_impuesto`)
 * quedan fuera: la primera liquidación lleva la fecha del último día de su mes, que un bloqueo posterior
 * puede cubrir ya, y el pago solo salda la deuda ya declarada. Los asientos automáticos siguen yendo al
 * primer día abierto.
 *
 *  - `ledger.cuenta_de_impuesto(cuenta)`: la cuenta (o una subcuenta) es de impuesto.
 *  - `ledger.asiento_con_impuesto(asiento)`: alguna partida etiquetada o, fuera de la liquidación y su pago,
 *    alguna partida en una cuenta de impuesto.
 *  - `ledger.validar_movimiento`: lo mismo por cada movimiento que se inserta.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION ledger.cuenta_de_impuesto(p_cuenta bigint) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.cuentas c
                      JOIN unnest(ARRAY['1.1.04', '1.1.05', '1.1.06', '1.1.07', '1.1.08', '2.1.02', '2.1.04',
                                        '2.1.05', '2.1.06', '2.1.07', '2.1.08', '2.1.09', '2.1.11']) AS t (codigo)
                        ON c.codigo = t.codigo OR c.codigo LIKE t.codigo || '.%'
                     WHERE c.id = p_cuenta AND c.pais = 'GT'
                );
            $fn$;

            CREATE OR REPLACE FUNCTION ledger.asiento_con_impuesto(p_asiento bigint) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                     WHERE m.asiento_id = p_asiento
                       AND (m.impuesto_codigo IS NOT NULL
                            OR (a.origen_tipo NOT IN ('liquidacion_impuesto', 'pago_impuesto') AND ledger.cuenta_de_impuesto(m.cuenta_id)))
                );
            $fn$;

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
                        OR (v_asiento.origen_tipo NOT IN ('liquidacion_impuesto', 'pago_impuesto') AND ledger.cuenta_de_impuesto(NEW.cuenta_id))
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
        `)
    }

    async down() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION ledger.asiento_con_impuesto(p_asiento bigint) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.movimientos m WHERE m.asiento_id = p_asiento AND m.impuesto_codigo IS NOT NULL
                );
            $fn$;
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
            DROP FUNCTION IF EXISTS ledger.cuenta_de_impuesto(bigint);
        `)
    }
}
