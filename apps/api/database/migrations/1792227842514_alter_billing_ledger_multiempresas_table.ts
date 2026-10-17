import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · multiempresa (`contratos/multiempresa.md`): contabilidad separada por NIT.
 *
 *  - `empresa_id NOT NULL` (FK a `core.empresas`) en lo financiero: facturas, notas de crédito,
 *    pagos, comprobantes, cobros de la pasarela, promesas, saldos iniciales, cuentas bancarias,
 *    asientos, cajas, bancos del libro, egresos y cierres mensuales. Lo existente queda en la
 *    empresa 1 (`DEFAULT 1` al agregar la columna: no reescribe filas ni dispara triggers).
 *  - Trigger `billing.empresa_por_defecto` (BEFORE INSERT) para inserciones sin `empresa_id`: la
 *    del servicio (`servicio_id`), la de la factura (`factura_id`) o, si no hay, la única empresa
 *    activa; con varias, error `empresa_requerida`. Las acciones siempre la mandan explícita.
 *  - `ledger.cuentas.empresa_id` (nulable = cuenta común): las subcuentas de una caja, de una
 *    cuenta bancaria o de un banco del libro son de su empresa. Un movimiento en una cuenta de
 *    otra empresa se rechaza (`cuenta_de_otra_empresa`): un asiento nunca mezcla empresas.
 *  - Coherencia por base de datos: un pago solo aplica a facturas de su empresa (y un saldo
 *    inicial igual); la caja, la cuenta bancaria y el turno de un pago o egreso son de su empresa;
 *    una nota de crédito es de la empresa de su factura.
 *  - Periodos por empresa: `ledger.periodo_cerrado(fecha, empresa_id)`; los triggers de asientos,
 *    movimientos y cierres la usan con la empresa del asiento.
 *  - `billing.cobros`: un cobro de caja que cubre facturas de varias empresas se divide en un pago
 *    por empresa agrupados por `cobro_id`.
 *  - Vistas del dashboard con `empresa_id` en la clave (se suman al leer).
 *  - Nombres de caja únicos por empresa; la referencia de un pago, única por empresa.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            -- 1. empresa_id en lo financiero (lo existente → empresa 1)
            ALTER TABLE billing.facturas ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE billing.notas_credito ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE billing.pagos ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE billing.comprobantes ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE billing.pasarela_cobros ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE billing.promesas ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE billing.saldos_iniciales ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE billing.cuentas_bancarias ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE ledger.asientos ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE ledger.cajas ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE ledger.bancos ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE ledger.egresos ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE ledger.cierres_mensuales ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);

            ALTER TABLE billing.facturas ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE billing.notas_credito ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE billing.pagos ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE billing.comprobantes ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE billing.pasarela_cobros ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE billing.promesas ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE billing.saldos_iniciales ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE billing.cuentas_bancarias ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE ledger.asientos ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE ledger.cajas ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE ledger.bancos ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE ledger.egresos ALTER COLUMN empresa_id DROP DEFAULT;
            ALTER TABLE ledger.cierres_mensuales ALTER COLUMN empresa_id DROP DEFAULT;

            CREATE INDEX facturas_empresa ON billing.facturas (empresa_id, id);
            CREATE INDEX pagos_empresa ON billing.pagos (empresa_id, id);
            CREATE INDEX promesas_empresa ON billing.promesas (empresa_id, id);
            CREATE INDEX comprobantes_empresa ON billing.comprobantes (empresa_id, id);
            CREATE INDEX asientos_empresa_fecha ON ledger.asientos (empresa_id, fecha);
            CREATE INDEX egresos_empresa ON ledger.egresos (empresa_id, fecha);
            DROP INDEX IF EXISTS ledger.cierres_mensuales_periodo;
            CREATE INDEX cierres_mensuales_periodo ON ledger.cierres_mensuales (empresa_id, periodo);

            -- referencia única por empresa (un cobro repartido lleva la misma en cada pago)
            DROP INDEX billing.pagos_metodo_referencia;
            CREATE UNIQUE INDEX pagos_metodo_referencia
                ON billing.pagos (empresa_id, metodo, cuenta_bancaria_id, referencia) NULLS NOT DISTINCT
                WHERE referencia IS NOT NULL AND NOT historico;

            -- nombres de caja únicos por empresa ("Caja principal" en cada una)
            ALTER TABLE ledger.cajas DROP CONSTRAINT IF EXISTS cajas_nombre_key;
            CREATE UNIQUE INDEX cajas_empresa_nombre ON ledger.cajas (empresa_id, nombre);

            -- subcuentas de una empresa (caja, cuenta bancaria, banco del libro); null = común
            ALTER TABLE ledger.cuentas ADD COLUMN empresa_id bigint REFERENCES core.empresas (id);
            UPDATE ledger.cuentas c SET empresa_id = 1
             WHERE EXISTS (SELECT 1 FROM ledger.cajas x WHERE x.cuenta_id = c.id)
                OR EXISTS (SELECT 1 FROM billing.cuentas_bancarias x WHERE x.cuenta_id = c.id);

            -- 2. empresa por defecto para inserciones sin empresa_id
            CREATE OR REPLACE FUNCTION billing.empresa_por_defecto() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_fila jsonb := to_jsonb(NEW);
                v_empresa bigint;
            BEGIN
                IF NEW.empresa_id IS NOT NULL THEN
                    RETURN NEW;
                END IF;
                IF (v_fila->>'servicio_id') IS NOT NULL THEN
                    SELECT empresa_id INTO v_empresa FROM core.servicios
                     WHERE id = (v_fila->>'servicio_id')::bigint;
                END IF;
                IF v_empresa IS NULL AND (v_fila->>'factura_id') IS NOT NULL THEN
                    SELECT empresa_id INTO v_empresa FROM billing.facturas
                     WHERE id = (v_fila->>'factura_id')::bigint;
                END IF;
                IF v_empresa IS NULL AND (v_fila->>'caja_id') IS NOT NULL THEN
                    SELECT empresa_id INTO v_empresa FROM ledger.cajas
                     WHERE id = (v_fila->>'caja_id')::bigint;
                END IF;
                IF v_empresa IS NULL AND (v_fila->>'cuenta_bancaria_id') IS NOT NULL THEN
                    SELECT empresa_id INTO v_empresa FROM billing.cuentas_bancarias
                     WHERE id = (v_fila->>'cuenta_bancaria_id')::bigint;
                END IF;
                IF v_empresa IS NULL THEN
                    SELECT CASE WHEN count(*) = 1 THEN min(id) END INTO v_empresa
                      FROM core.empresas WHERE activa;
                END IF;
                IF v_empresa IS NULL THEN
                    RAISE EXCEPTION 'No se pudo deducir la empresa de %.% (hay varias empresas activas)',
                        TG_TABLE_SCHEMA, TG_TABLE_NAME
                        USING ERRCODE = 'not_null_violation', CONSTRAINT = 'empresa_requerida';
                END IF;
                NEW.empresa_id := v_empresa;
                RETURN NEW;
            END
            $fn$;

            DO $do$
            DECLARE
                v_tabla text;
            BEGIN
                FOREACH v_tabla IN ARRAY ARRAY[
                    'billing.facturas', 'billing.notas_credito', 'billing.pagos', 'billing.comprobantes',
                    'billing.pasarela_cobros', 'billing.promesas', 'billing.saldos_iniciales',
                    'billing.cuentas_bancarias', 'ledger.asientos', 'ledger.cajas', 'ledger.bancos',
                    'ledger.egresos', 'ledger.cierres_mensuales'
                ] LOOP
                    EXECUTE format(
                        'CREATE TRIGGER a_empresa_por_defecto BEFORE INSERT ON %s FOR EACH ROW EXECUTE FUNCTION billing.empresa_por_defecto()',
                        v_tabla
                    );
                END LOOP;
            END
            $do$;

            -- 3. coherencia entre documentos de la misma empresa
            CREATE OR REPLACE FUNCTION billing.exigir_misma_empresa(p_esperada bigint, p_otra bigint, p_que text)
            RETURNS void LANGUAGE plpgsql AS $fn$
            BEGIN
                IF p_otra IS NOT NULL AND p_otra <> p_esperada THEN
                    RAISE EXCEPTION '% es de la empresa %, no de la %', p_que, p_otra, p_esperada
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'misma_empresa';
                END IF;
            END
            $fn$;

            CREATE OR REPLACE FUNCTION billing.validar_empresa_aplicacion() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_origen bigint;
                v_factura bigint;
            BEGIN
                IF TG_TABLE_NAME = 'pagos_aplicaciones' THEN
                    SELECT empresa_id INTO v_origen FROM billing.pagos WHERE id = NEW.pago_id;
                ELSE
                    SELECT empresa_id INTO v_origen FROM billing.saldos_iniciales WHERE id = NEW.saldo_inicial_id;
                END IF;
                SELECT empresa_id INTO v_factura FROM billing.facturas WHERE id = NEW.factura_id;
                PERFORM billing.exigir_misma_empresa(v_origen, v_factura, 'La factura ' || NEW.factura_id);
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER pagos_aplicaciones_empresa BEFORE INSERT ON billing.pagos_aplicaciones
                FOR EACH ROW EXECUTE FUNCTION billing.validar_empresa_aplicacion();
            CREATE TRIGGER saldos_iniciales_aplicaciones_empresa BEFORE INSERT ON billing.saldos_iniciales_aplicaciones
                FOR EACH ROW EXECUTE FUNCTION billing.validar_empresa_aplicacion();

            -- caja, turno, cuenta bancaria y banco de un documento: de su misma empresa
            CREATE OR REPLACE FUNCTION billing.validar_empresa_destino() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_fila jsonb := to_jsonb(NEW);
                v_otra bigint;
            BEGIN
                IF (v_fila->>'caja_id') IS NOT NULL THEN
                    SELECT empresa_id INTO v_otra FROM ledger.cajas WHERE id = (v_fila->>'caja_id')::bigint;
                    PERFORM billing.exigir_misma_empresa(NEW.empresa_id, v_otra, 'La caja ' || (v_fila->>'caja_id'));
                END IF;
                IF (v_fila->>'turno_id') IS NOT NULL THEN
                    SELECT c.empresa_id INTO v_otra FROM ledger.cajas_turnos t JOIN ledger.cajas c ON c.id = t.caja_id
                     WHERE t.id = (v_fila->>'turno_id')::bigint;
                    PERFORM billing.exigir_misma_empresa(NEW.empresa_id, v_otra, 'El turno ' || (v_fila->>'turno_id'));
                END IF;
                IF (v_fila->>'cuenta_bancaria_id') IS NOT NULL THEN
                    SELECT empresa_id INTO v_otra FROM billing.cuentas_bancarias
                     WHERE id = (v_fila->>'cuenta_bancaria_id')::bigint;
                    PERFORM billing.exigir_misma_empresa(NEW.empresa_id, v_otra,
                        'La cuenta bancaria ' || (v_fila->>'cuenta_bancaria_id'));
                END IF;
                IF TG_TABLE_NAME = 'egresos' AND (v_fila->>'banco_id') IS NOT NULL THEN
                    SELECT empresa_id INTO v_otra FROM ledger.bancos WHERE id = (v_fila->>'banco_id')::bigint;
                    PERFORM billing.exigir_misma_empresa(NEW.empresa_id, v_otra, 'El banco ' || (v_fila->>'banco_id'));
                END IF;
                IF TG_TABLE_NAME = 'notas_credito' THEN
                    SELECT empresa_id INTO v_otra FROM billing.facturas WHERE id = NEW.factura_id;
                    PERFORM billing.exigir_misma_empresa(NEW.empresa_id, v_otra, 'La factura ' || NEW.factura_id);
                END IF;
                IF TG_TABLE_NAME IN ('cajas', 'bancos', 'cuentas_bancarias') THEN
                    SELECT empresa_id INTO v_otra FROM ledger.cuentas WHERE id = (v_fila->>'cuenta_id')::bigint;
                    PERFORM billing.exigir_misma_empresa(NEW.empresa_id, v_otra, 'La cuenta contable ' || (v_fila->>'cuenta_id'));
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER pagos_empresa BEFORE INSERT OR UPDATE OF empresa_id, caja_id, turno_id, cuenta_bancaria_id
                ON billing.pagos FOR EACH ROW EXECUTE FUNCTION billing.validar_empresa_destino();
            CREATE TRIGGER egresos_empresa BEFORE INSERT ON ledger.egresos
                FOR EACH ROW EXECUTE FUNCTION billing.validar_empresa_destino();
            CREATE TRIGGER notas_credito_empresa BEFORE INSERT ON billing.notas_credito
                FOR EACH ROW EXECUTE FUNCTION billing.validar_empresa_destino();
            CREATE TRIGGER comprobantes_empresa BEFORE INSERT OR UPDATE OF empresa_id, cuenta_bancaria_id
                ON billing.comprobantes FOR EACH ROW EXECUTE FUNCTION billing.validar_empresa_destino();
            CREATE TRIGGER cajas_empresa BEFORE INSERT OR UPDATE OF empresa_id, cuenta_id
                ON ledger.cajas FOR EACH ROW EXECUTE FUNCTION billing.validar_empresa_destino();
            CREATE TRIGGER bancos_empresa BEFORE INSERT OR UPDATE OF empresa_id, cuenta_id
                ON ledger.bancos FOR EACH ROW EXECUTE FUNCTION billing.validar_empresa_destino();
            CREATE TRIGGER cuentas_bancarias_empresa BEFORE INSERT OR UPDATE OF empresa_id, cuenta_id
                ON billing.cuentas_bancarias FOR EACH ROW EXECUTE FUNCTION billing.validar_empresa_destino();

            -- 4. periodos por empresa
            CREATE OR REPLACE FUNCTION ledger.periodo_cerrado(p_fecha date, p_empresa bigint) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.cierres_mensuales c
                     WHERE c.periodo = date_trunc('month', p_fecha)::date
                       AND c.empresa_id = p_empresa
                       AND NOT EXISTS (SELECT 1 FROM ledger.reaperturas_mensuales r WHERE r.cierre_id = c.id)
                );
            $fn$;

            CREATE OR REPLACE FUNCTION ledger.validar_asiento() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF ledger.periodo_cerrado(NEW.fecha, NEW.empresa_id) THEN
                    RAISE EXCEPTION 'Periodo % cerrado: no se registran asientos con fecha %',
                        to_char(NEW.fecha, 'YYYY-MM'), NEW.fecha
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'periodo_abierto';
                END IF;
                IF NEW.reversa_de IS NOT NULL THEN
                    PERFORM billing.exigir_misma_empresa(
                        NEW.empresa_id,
                        (SELECT empresa_id FROM ledger.asientos WHERE id = NEW.reversa_de),
                        'El asiento revertido ' || NEW.reversa_de
                    );
                END IF;
                RETURN NEW;
            END
            $fn$;

            CREATE OR REPLACE FUNCTION ledger.validar_movimiento() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_cuenta record;
                v_asiento record;
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

                SELECT fecha, empresa_id INTO v_asiento FROM ledger.asientos WHERE id = NEW.asiento_id;
                IF FOUND THEN
                    IF ledger.periodo_cerrado(v_asiento.fecha, v_asiento.empresa_id) THEN
                        RAISE EXCEPTION 'Periodo % cerrado: el asiento % no admite movimientos',
                            to_char(v_asiento.fecha, 'YYYY-MM'), NEW.asiento_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'periodo_abierto';
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

            CREATE OR REPLACE FUNCTION ledger.validar_cierre() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF ledger.periodo_cerrado(NEW.periodo, NEW.empresa_id) THEN
                    RAISE EXCEPTION 'El periodo % ya está cerrado', to_char(NEW.periodo, 'YYYY-MM')
                        USING ERRCODE = 'unique_violation', CONSTRAINT = 'periodo_ya_cerrado';
                END IF;
                RETURN NEW;
            END
            $fn$;

            DROP FUNCTION IF EXISTS ledger.periodo_cerrado(date);

            -- 5. cobros repartidos por empresa
            CREATE TABLE billing.cobros (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                metodo text NOT NULL,
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE TRIGGER cobros_inmutable
                BEFORE UPDATE OR DELETE ON billing.cobros
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            ALTER TABLE billing.pagos ADD COLUMN cobro_id bigint REFERENCES billing.cobros (id);
            CREATE INDEX pagos_cobro ON billing.pagos (cobro_id) WHERE cobro_id IS NOT NULL;
            -- un cobro tiene a lo sumo un pago por empresa
            CREATE UNIQUE INDEX pagos_cobro_empresa ON billing.pagos (cobro_id, empresa_id) WHERE cobro_id IS NOT NULL;

            -- 6. vistas del dashboard por empresa
            DROP MATERIALIZED VIEW billing.resumen_mensual;
            DROP MATERIALIZED VIEW billing.resumen_cobros_diarios;
            DROP MATERIALIZED VIEW billing.resumen_servicios;
            DROP MATERIALIZED VIEW billing.resumen_cartera;
            DROP MATERIALIZED VIEW billing.resumen_promesas;

            CREATE MATERIALIZED VIEW billing.resumen_mensual AS
            WITH facturado AS (
                SELECT f.empresa_id,
                       date_trunc('month', f.periodo)::date AS mes,
                       count(*)::int AS facturas,
                       sum(f.total) AS facturado
                  FROM billing.facturas f
                 WHERE f.estado <> 'anulada'
                 GROUP BY 1, 2
            ), cobrado AS (
                SELECT p.empresa_id,
                       date_trunc('month', p.created_at AT TIME ZONE 'America/Guatemala')::date AS mes,
                       count(*)::int AS pagos,
                       sum(p.monto) AS cobrado
                  FROM billing.pagos p
                 WHERE p.estado = 'registrado'
                 GROUP BY 1, 2
            )
            SELECT empresa_id,
                   mes,
                   coalesce(f.facturas, 0) AS facturas,
                   coalesce(f.facturado, 0)::numeric(14, 2) AS facturado,
                   coalesce(c.pagos, 0) AS pagos,
                   coalesce(c.cobrado, 0)::numeric(14, 2) AS cobrado
              FROM facturado f
              FULL JOIN cobrado c USING (empresa_id, mes);
            CREATE UNIQUE INDEX resumen_mensual_mes ON billing.resumen_mensual (empresa_id, mes);

            CREATE MATERIALIZED VIEW billing.resumen_cobros_diarios AS
            SELECT p.empresa_id,
                   (p.created_at AT TIME ZONE 'America/Guatemala')::date AS dia,
                   count(*)::int AS pagos,
                   sum(p.monto)::numeric(14, 2) AS cobrado
              FROM billing.pagos p
             WHERE p.estado = 'registrado'
             GROUP BY 1, 2;
            CREATE UNIQUE INDEX resumen_cobros_diarios_dia ON billing.resumen_cobros_diarios (empresa_id, dia);

            -- por una función: la vista no queda atada a las columnas de core.servicios (A1 puede
            -- rehacer su migración de empresa_id sin tocar billing)
            CREATE FUNCTION billing.conteo_servicios()
            RETURNS TABLE (empresa_id bigint, estado text, servicios int, clientes int)
            LANGUAGE sql STABLE AS $fn$
                SELECT s.empresa_id, s.estado, count(*)::int, count(DISTINCT s.cliente_id)::int
                  FROM core.servicios s
                 GROUP BY s.empresa_id, s.estado
            $fn$;
            CREATE MATERIALIZED VIEW billing.resumen_servicios AS
            SELECT * FROM billing.conteo_servicios();
            CREATE UNIQUE INDEX resumen_servicios_estado ON billing.resumen_servicios (empresa_id, estado);

            CREATE MATERIALIZED VIEW billing.resumen_cartera AS
            SELECT e.id AS empresa_id,
                   coalesce(sum(f.total - f.pagado) FILTER (WHERE f.estado = 'vencida'), 0)::numeric(14, 2) AS vencida,
                   count(f.id) FILTER (WHERE f.estado = 'vencida')::int AS facturas_vencidas,
                   count(DISTINCT f.cliente_id) FILTER (WHERE f.estado = 'vencida')::int AS clientes_morosos,
                   coalesce(sum(f.total - f.pagado), 0)::numeric(14, 2) AS pendiente
              FROM core.empresas e
              LEFT JOIN billing.facturas f
                ON f.empresa_id = e.id AND f.estado IN ('emitida', 'parcial', 'vencida')
             GROUP BY e.id;
            CREATE UNIQUE INDEX resumen_cartera_id ON billing.resumen_cartera (empresa_id);

            CREATE MATERIALIZED VIEW billing.resumen_promesas AS
            SELECT p.empresa_id,
                   p.estado,
                   count(*)::int AS promesas,
                   sum(p.monto)::numeric(14, 2) AS monto
              FROM billing.promesas p
             GROUP BY p.empresa_id, p.estado;
            CREATE UNIQUE INDEX resumen_promesas_estado ON billing.resumen_promesas (empresa_id, estado);

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT ON billing.resumen_mensual, billing.resumen_cobros_diarios,
                        billing.resumen_servicios, billing.resumen_cartera, billing.resumen_promesas
                        TO argosisp_app;
                    GRANT SELECT, INSERT ON billing.cobros TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON billing.cobros FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP MATERIALIZED VIEW billing.resumen_mensual;
            DROP MATERIALIZED VIEW billing.resumen_cobros_diarios;
            DROP MATERIALIZED VIEW billing.resumen_servicios;
            DROP MATERIALIZED VIEW billing.resumen_cartera;
            DROP MATERIALIZED VIEW billing.resumen_promesas;
            DROP FUNCTION IF EXISTS billing.conteo_servicios();

            CREATE MATERIALIZED VIEW billing.resumen_mensual AS
            WITH facturado AS (
                SELECT date_trunc('month', f.periodo)::date AS mes, count(*)::int AS facturas, sum(f.total) AS facturado
                  FROM billing.facturas f WHERE f.estado <> 'anulada' GROUP BY 1
            ), cobrado AS (
                SELECT date_trunc('month', p.created_at AT TIME ZONE 'America/Guatemala')::date AS mes,
                       count(*)::int AS pagos, sum(p.monto) AS cobrado
                  FROM billing.pagos p WHERE p.estado = 'registrado' GROUP BY 1
            )
            SELECT mes, coalesce(f.facturas, 0) AS facturas, coalesce(f.facturado, 0)::numeric(14, 2) AS facturado,
                   coalesce(c.pagos, 0) AS pagos, coalesce(c.cobrado, 0)::numeric(14, 2) AS cobrado
              FROM facturado f FULL JOIN cobrado c USING (mes);
            CREATE UNIQUE INDEX resumen_mensual_mes ON billing.resumen_mensual (mes);
            CREATE MATERIALIZED VIEW billing.resumen_cobros_diarios AS
            SELECT (p.created_at AT TIME ZONE 'America/Guatemala')::date AS dia, count(*)::int AS pagos,
                   sum(p.monto)::numeric(14, 2) AS cobrado
              FROM billing.pagos p WHERE p.estado = 'registrado' GROUP BY 1;
            CREATE UNIQUE INDEX resumen_cobros_diarios_dia ON billing.resumen_cobros_diarios (dia);
            CREATE MATERIALIZED VIEW billing.resumen_servicios AS
            SELECT s.estado, count(*)::int AS servicios, count(DISTINCT s.cliente_id)::int AS clientes
              FROM core.servicios s GROUP BY s.estado;
            CREATE UNIQUE INDEX resumen_servicios_estado ON billing.resumen_servicios (estado);
            CREATE MATERIALIZED VIEW billing.resumen_cartera AS
            SELECT 1 AS id,
                   coalesce(sum(f.total - f.pagado) FILTER (WHERE f.estado = 'vencida'), 0)::numeric(14, 2) AS vencida,
                   count(*) FILTER (WHERE f.estado = 'vencida')::int AS facturas_vencidas,
                   count(DISTINCT f.cliente_id) FILTER (WHERE f.estado = 'vencida')::int AS clientes_morosos,
                   coalesce(sum(f.total - f.pagado), 0)::numeric(14, 2) AS pendiente
              FROM billing.facturas f WHERE f.estado IN ('emitida', 'parcial', 'vencida');
            CREATE UNIQUE INDEX resumen_cartera_id ON billing.resumen_cartera (id);
            CREATE MATERIALIZED VIEW billing.resumen_promesas AS
            SELECT p.estado, count(*)::int AS promesas, sum(p.monto)::numeric(14, 2) AS monto
              FROM billing.promesas p GROUP BY p.estado;
            CREATE UNIQUE INDEX resumen_promesas_estado ON billing.resumen_promesas (estado);

            DROP INDEX IF EXISTS billing.pagos_cobro_empresa;
            DROP INDEX IF EXISTS billing.pagos_cobro;
            ALTER TABLE billing.pagos DROP COLUMN IF EXISTS cobro_id;
            DROP TABLE IF EXISTS billing.cobros;

            CREATE OR REPLACE FUNCTION ledger.periodo_cerrado(p_fecha date) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.cierres_mensuales c
                     WHERE c.periodo = date_trunc('month', p_fecha)::date
                       AND NOT EXISTS (SELECT 1 FROM ledger.reaperturas_mensuales r WHERE r.cierre_id = c.id)
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
            CREATE OR REPLACE FUNCTION ledger.validar_movimiento() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_cuenta record;
                v_fecha date;
            BEGIN
                SELECT codigo, activa, imputable, auxiliar_cliente INTO v_cuenta
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
                SELECT fecha INTO v_fecha FROM ledger.asientos WHERE id = NEW.asiento_id;
                IF FOUND AND ledger.periodo_cerrado(v_fecha) THEN
                    RAISE EXCEPTION 'Periodo % cerrado: el asiento % no admite movimientos',
                        to_char(v_fecha, 'YYYY-MM'), NEW.asiento_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'periodo_abierto';
                END IF;
                RETURN NEW;
            END
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
            DROP FUNCTION IF EXISTS ledger.periodo_cerrado(date, bigint);

            DROP TRIGGER IF EXISTS cuentas_bancarias_empresa ON billing.cuentas_bancarias;
            DROP TRIGGER IF EXISTS bancos_empresa ON ledger.bancos;
            DROP TRIGGER IF EXISTS cajas_empresa ON ledger.cajas;
            DROP TRIGGER IF EXISTS comprobantes_empresa ON billing.comprobantes;
            DROP TRIGGER IF EXISTS notas_credito_empresa ON billing.notas_credito;
            DROP TRIGGER IF EXISTS egresos_empresa ON ledger.egresos;
            DROP TRIGGER IF EXISTS pagos_empresa ON billing.pagos;
            DROP TRIGGER IF EXISTS saldos_iniciales_aplicaciones_empresa ON billing.saldos_iniciales_aplicaciones;
            DROP TRIGGER IF EXISTS pagos_aplicaciones_empresa ON billing.pagos_aplicaciones;
            DROP FUNCTION IF EXISTS billing.validar_empresa_destino();
            DROP FUNCTION IF EXISTS billing.validar_empresa_aplicacion();

            DO $do$
            DECLARE
                v_tabla text;
            BEGIN
                FOREACH v_tabla IN ARRAY ARRAY[
                    'billing.facturas', 'billing.notas_credito', 'billing.pagos', 'billing.comprobantes',
                    'billing.pasarela_cobros', 'billing.promesas', 'billing.saldos_iniciales',
                    'billing.cuentas_bancarias', 'ledger.asientos', 'ledger.cajas', 'ledger.bancos',
                    'ledger.egresos', 'ledger.cierres_mensuales'
                ] LOOP
                    EXECUTE format('DROP TRIGGER IF EXISTS a_empresa_por_defecto ON %s', v_tabla);
                END LOOP;
            END
            $do$;
            DROP FUNCTION IF EXISTS billing.empresa_por_defecto();
            DROP FUNCTION IF EXISTS billing.exigir_misma_empresa(bigint, bigint, text);

            ALTER TABLE ledger.cuentas DROP COLUMN IF EXISTS empresa_id;
            DROP INDEX billing.pagos_metodo_referencia;
            CREATE UNIQUE INDEX pagos_metodo_referencia
                ON billing.pagos (metodo, cuenta_bancaria_id, referencia) NULLS NOT DISTINCT
                WHERE referencia IS NOT NULL AND NOT historico;
            DROP INDEX IF EXISTS ledger.cajas_empresa_nombre;
            ALTER TABLE ledger.cajas ADD CONSTRAINT cajas_nombre_key UNIQUE (nombre);
            DROP INDEX IF EXISTS ledger.cierres_mensuales_periodo;
            CREATE INDEX cierres_mensuales_periodo ON ledger.cierres_mensuales (periodo);

            ALTER TABLE billing.facturas DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE billing.notas_credito DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE billing.pagos DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE billing.comprobantes DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE billing.pasarela_cobros DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE billing.promesas DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE billing.saldos_iniciales DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE billing.cuentas_bancarias DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE ledger.asientos DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE ledger.cajas DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE ledger.bancos DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE ledger.egresos DROP COLUMN IF EXISTS empresa_id;
            ALTER TABLE ledger.cierres_mensuales DROP COLUMN IF EXISTS empresa_id;
        `)
    }
}
