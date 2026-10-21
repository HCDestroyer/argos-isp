import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 6 (contrato de localización fiscal §3.7, §9.2 y §10.4): bloqueos del libro por tipo,
 * con excepciones, y traslado de los asientos automáticos al primer día abierto.
 *
 *  - `ledger.bloqueos` (solo inserción): `tipo` `global`, `ventas`, `compras`, `impuestos` o
 *    `duro`, `hasta` (null = sin bloqueo de ese tipo), `motivo`, `anterior` (el `hasta` vigente
 *    al insertar, lo escribe el trigger) y `confirmacion` (texto exacto del bloqueo duro). El
 *    vigente de cada tipo es la última fila (`ledger.bloqueo_vigente`). Trigger:
 *      - el duro solo avanza (`bloqueo_regresivo`);
 *      - ningún otro queda antes del duro (`bloqueo_bajo_duro`);
 *      - el de impuestos no retrocede: lo anterior se corrige con una excepción (`bloqueo_regresivo`).
 *  - `ledger.bloqueos_excepciones` (solo inserción): tipo (nunca `duro`), `usuario_id` (null =
 *    todos), motivo y `hasta_en` obligatorio. Revocar = fila en
 *    `ledger.bloqueos_excepciones_revocaciones` (una por excepción).
 *  - `ledger.cuentas_con_impuesto`: las cuentas que hacen que un asiento quede bajo el bloqueo de
 *    impuestos mientras no existan las etiquetas de §10.2 (fase 7: se reemplaza aquí, y solo aquí).
 *    Un movimiento con `impuesto_codigo` también cuenta.
 *  - `ledger.asientos`: `fecha_documento` (la fecha real de un asiento automático trasladado al
 *    primer día abierto) y `excepcion_id` (la excepción por la que entró bajo un bloqueo).
 *  - Funciones: `ledger.bloqueo_de(fecha, empresa, diario, origen, con_impuesto, usuario,
 *    excepcion)` devuelve qué impide la fecha (`duro`, `cerrado`, `global`, `ventas`, `compras`,
 *    `impuestos`) o null; `ledger.fecha_bloqueada(fecha, empresa, diario, con_impuesto)` (la del
 *    contrato, sin excepciones); `ledger.primer_dia_abierto(...)`.
 *  - Triggers en dos niveles (decisión del líder):
 *      - inmediato (`validar_asiento`, `validar_movimiento`): duro, mes cerrado, global y compras
 *        por origen, que no necesitan el diario;
 *      - diferido (`asientos_bloqueo`, constraint trigger `INITIALLY DEFERRED`): con el diario y
 *        los movimientos ya escritos, todos los tipos menos el mes cerrado (un cierre en la misma
 *        transacción, como el del cierre anual, no invalida lo registrado antes).
 *      `RegistrarAsiento` lo dispara al terminar (`SET CONSTRAINTS ... IMMEDIATE`), así el error
 *      sale de la acción; una inserción directa se verifica al hacer commit.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.bloqueos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                tipo text NOT NULL CHECK (tipo IN ('global', 'ventas', 'compras', 'impuestos', 'duro')),
                hasta date,
                anterior date,
                motivo text NOT NULL CHECK (length(btrim(motivo)) >= 3),
                confirmacion text,
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT bloqueos_duro_confirmado CHECK (tipo <> 'duro' OR (hasta IS NOT NULL AND confirmacion IS NOT NULL))
            );
            CREATE INDEX bloqueos_vigente_idx ON ledger.bloqueos (empresa_id, tipo, id DESC);

            CREATE TABLE ledger.bloqueos_excepciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                tipo text NOT NULL CHECK (tipo IN ('global', 'ventas', 'compras', 'impuestos')),
                usuario_id bigint REFERENCES core.usuarios (id),
                motivo text NOT NULL CHECK (length(btrim(motivo)) >= 3),
                hasta_en timestamptz NOT NULL,
                creada_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT bloqueos_excepciones_fin CHECK (hasta_en > created_at)
            );
            CREATE INDEX bloqueos_excepciones_empresa_idx ON ledger.bloqueos_excepciones (empresa_id, tipo, hasta_en);

            CREATE TABLE ledger.bloqueos_excepciones_revocaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                excepcion_id bigint NOT NULL UNIQUE REFERENCES ledger.bloqueos_excepciones (id),
                motivo text NOT NULL CHECK (length(btrim(motivo)) >= 3),
                revocada_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE ledger.cuentas_con_impuesto (
                pais char(2) NOT NULL,
                codigo text NOT NULL,
                descripcion text NOT NULL,
                PRIMARY KEY (pais, codigo)
            );
            INSERT INTO ledger.cuentas_con_impuesto (pais, codigo, descripcion) VALUES
                ('GT', '1.1.04', 'IVA crédito fiscal'),
                ('GT', '1.1.05', 'IVA retenido por clientes'),
                ('GT', '1.1.06', 'ISR retenido por clientes'),
                ('GT', '1.1.07', 'ISR pagos trimestrales'),
                ('GT', '1.1.08', 'ISO por acreditar'),
                ('GT', '2.1.02', 'IVA débito fiscal'),
                ('GT', '2.1.04', 'Retenciones de IVA por pagar'),
                ('GT', '2.1.05', 'Retenciones de ISR por pagar'),
                ('GT', '2.1.06', 'IVA por pagar'),
                ('GT', '2.1.07', 'ISR por pagar'),
                ('GT', '2.1.08', 'ISO por pagar'),
                ('GT', '2.1.09', 'Pequeño contribuyente por pagar'),
                ('GT', '2.1.11', 'IVA por certificar');

            ALTER TABLE ledger.asientos
                ADD COLUMN fecha_documento date,
                ADD COLUMN excepcion_id bigint REFERENCES ledger.bloqueos_excepciones (id);

            -- solo inserción
            CREATE TRIGGER bloqueos_inmutable BEFORE UPDATE OR DELETE ON ledger.bloqueos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER bloqueos_sin_truncate BEFORE TRUNCATE ON ledger.bloqueos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER bloqueos_excepciones_inmutable BEFORE UPDATE OR DELETE ON ledger.bloqueos_excepciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER bloqueos_excepciones_sin_truncate BEFORE TRUNCATE ON ledger.bloqueos_excepciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER bloqueos_revocaciones_inmutable BEFORE UPDATE OR DELETE ON ledger.bloqueos_excepciones_revocaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER bloqueos_revocaciones_sin_truncate BEFORE TRUNCATE ON ledger.bloqueos_excepciones_revocaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            -- la lista la cambia una migración (fase 7: etiquetas), nunca la app
            CREATE TRIGGER cuentas_con_impuesto_inmutable BEFORE UPDATE OR DELETE ON ledger.cuentas_con_impuesto
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER cuentas_con_impuesto_sin_truncate BEFORE TRUNCATE ON ledger.cuentas_con_impuesto
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE OR REPLACE FUNCTION ledger.bloqueo_vigente(p_empresa bigint, p_tipo text) RETURNS date
            LANGUAGE sql STABLE AS $fn$
                SELECT b.hasta FROM ledger.bloqueos b
                 WHERE b.empresa_id = p_empresa AND b.tipo = p_tipo
                 ORDER BY b.id DESC LIMIT 1;
            $fn$;

            -- el duro solo avanza; nada queda antes del duro; el de impuestos no retrocede
            CREATE OR REPLACE FUNCTION ledger.validar_bloqueo() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_duro date;
            BEGIN
                PERFORM pg_advisory_xact_lock(hashtext('ledger.bloqueos'), NEW.empresa_id::integer);
                v_duro := ledger.bloqueo_vigente(NEW.empresa_id, 'duro');
                NEW.anterior := ledger.bloqueo_vigente(NEW.empresa_id, NEW.tipo);
                IF NEW.tipo = 'duro' THEN
                    IF v_duro IS NOT NULL AND NEW.hasta <= v_duro THEN
                        RAISE EXCEPTION 'El bloqueo duro está en %: solo avanza', v_duro
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'bloqueo_regresivo';
                    END IF;
                ELSIF v_duro IS NOT NULL AND (NEW.hasta IS NULL OR NEW.hasta < v_duro) THEN
                    RAISE EXCEPTION 'El bloqueo % no puede quedar antes del bloqueo duro (%)', NEW.tipo, v_duro
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'bloqueo_bajo_duro';
                ELSIF NEW.tipo = 'impuestos' AND NEW.anterior IS NOT NULL
                      AND (NEW.hasta IS NULL OR NEW.hasta < NEW.anterior) THEN
                    RAISE EXCEPTION 'El bloqueo de impuestos está en % y no retrocede (use una excepción)', NEW.anterior
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'bloqueo_regresivo';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER bloqueos_validar BEFORE INSERT ON ledger.bloqueos
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_bloqueo();

            CREATE OR REPLACE FUNCTION ledger.excepcion_vigente(
                p_excepcion bigint, p_empresa bigint, p_tipo text, p_usuario bigint
            ) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.bloqueos_excepciones e
                     WHERE e.id = p_excepcion AND e.empresa_id = p_empresa AND e.tipo = p_tipo
                       AND e.hasta_en > now()
                       AND (e.usuario_id IS NULL OR e.usuario_id = p_usuario)
                       AND NOT EXISTS (SELECT 1 FROM ledger.bloqueos_excepciones_revocaciones r WHERE r.excepcion_id = e.id)
                );
            $fn$;

            -- ¿el asiento toca una cuenta con impuesto (o lleva etiqueta)? Cuentas: ledger.cuentas_con_impuesto
            CREATE OR REPLACE FUNCTION ledger.cuentas_tocan_impuesto(p_cuentas bigint[]) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.cuentas c
                      JOIN ledger.cuentas_con_impuesto t
                        ON t.pais = c.pais AND (c.codigo = t.codigo OR c.codigo LIKE t.codigo || '.%')
                     WHERE c.id = ANY (p_cuentas)
                );
            $fn$;

            CREATE OR REPLACE FUNCTION ledger.asiento_con_impuesto(p_asiento bigint) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (SELECT 1 FROM ledger.movimientos m WHERE m.asiento_id = p_asiento AND m.impuesto_codigo IS NOT NULL)
                    OR ledger.cuentas_tocan_impuesto(
                        ARRAY(SELECT DISTINCT m.cuenta_id FROM ledger.movimientos m WHERE m.asiento_id = p_asiento)
                    );
            $fn$;

            /*
             * Qué impide registrar un asiento con esa fecha, o null. En orden: duro (nunca con
             * excepción), mes cerrado (nunca con excepción) y los bloqueos que le aplican:
             * global (todo), ventas (diario de ventas), compras (diario de compras, o compras y
             * pagos a proveedores aunque vayan a una caja o un banco), impuestos (con impuesto).
             * Una excepción vigente cubre solo su tipo.
             */
            CREATE OR REPLACE FUNCTION ledger.bloqueo_de(
                p_fecha date, p_empresa bigint, p_diario bigint, p_origen text,
                p_con_impuesto boolean, p_usuario bigint, p_excepcion bigint
            ) RETURNS text
            LANGUAGE plpgsql STABLE AS $fn$
            DECLARE
                v_hasta date;
                v_tipo text;
                v_tipo_diario text;
            BEGIN
                v_hasta := ledger.bloqueo_vigente(p_empresa, 'duro');
                IF v_hasta IS NOT NULL AND p_fecha <= v_hasta THEN
                    RETURN 'duro';
                END IF;
                IF ledger.periodo_cerrado(p_fecha, p_empresa) THEN
                    RETURN 'cerrado';
                END IF;
                IF p_diario IS NOT NULL THEN
                    SELECT d.tipo INTO v_tipo_diario FROM ledger.diarios d WHERE d.id = p_diario;
                END IF;
                FOREACH v_tipo IN ARRAY ARRAY['global', 'ventas', 'compras', 'impuestos'] LOOP
                    CONTINUE WHEN v_tipo = 'ventas' AND v_tipo_diario IS DISTINCT FROM 'ventas';
                    CONTINUE WHEN v_tipo = 'compras' AND v_tipo_diario IS DISTINCT FROM 'compras'
                        AND coalesce(p_origen IN ('compra', 'pago_proveedor'), false) = false;
                    CONTINUE WHEN v_tipo = 'impuestos' AND NOT coalesce(p_con_impuesto, false);
                    v_hasta := ledger.bloqueo_vigente(p_empresa, v_tipo);
                    IF v_hasta IS NOT NULL AND p_fecha <= v_hasta
                       AND NOT (p_excepcion IS NOT NULL AND ledger.excepcion_vigente(p_excepcion, p_empresa, v_tipo, p_usuario)) THEN
                        RETURN v_tipo;
                    END IF;
                END LOOP;
                RETURN NULL;
            END
            $fn$;

            CREATE OR REPLACE FUNCTION ledger.fecha_bloqueada(
                p_fecha date, p_empresa bigint, p_diario bigint, p_con_impuesto boolean
            ) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT ledger.bloqueo_de(p_fecha, p_empresa, p_diario, NULL, p_con_impuesto, NULL, NULL) IS NOT NULL;
            $fn$;

            -- primer día en que un asiento automático no queda bloqueado (sin excepciones)
            CREATE OR REPLACE FUNCTION ledger.primer_dia_abierto(
                p_fecha date, p_empresa bigint, p_diario bigint, p_origen text, p_con_impuesto boolean
            ) RETURNS date
            LANGUAGE plpgsql STABLE AS $fn$
            DECLARE
                v_fecha date := p_fecha;
                v_tipo text;
            BEGIN
                FOR i IN 1..1000 LOOP
                    v_tipo := ledger.bloqueo_de(v_fecha, p_empresa, p_diario, p_origen, p_con_impuesto, NULL, NULL);
                    IF v_tipo IS NULL THEN
                        RETURN v_fecha;
                    ELSIF v_tipo = 'cerrado' THEN
                        v_fecha := (date_trunc('month', v_fecha) + interval '1 month')::date;
                    ELSE
                        v_fecha := ledger.bloqueo_vigente(p_empresa, v_tipo) + 1;
                    END IF;
                END LOOP;
                RAISE EXCEPTION 'No hay un día abierto después de %', p_fecha;
            END
            $fn$;

            CREATE OR REPLACE FUNCTION ledger.rechazar_bloqueo(p_tipo text, p_fecha date, p_detalle text) RETURNS void
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF p_tipo = 'cerrado' THEN
                    RAISE EXCEPTION 'Periodo % cerrado: %', to_char(p_fecha, 'YYYY-MM'), p_detalle
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'periodo_abierto';
                ELSIF p_tipo = 'duro' THEN
                    RAISE EXCEPTION 'Fecha % bajo el bloqueo duro: %', p_fecha, p_detalle
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'bloqueo_duro';
                ELSE
                    RAISE EXCEPTION 'Fecha % bajo el bloqueo %: %', p_fecha, p_tipo, p_detalle
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'periodo_bloqueado';
                END IF;
            END
            $fn$;

            CREATE OR REPLACE FUNCTION ledger.validar_asiento() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_tipo text;
            BEGIN
                IF NEW.excepcion_id IS NOT NULL THEN
                    PERFORM billing.exigir_misma_empresa(
                        NEW.empresa_id,
                        (SELECT empresa_id FROM ledger.bloqueos_excepciones WHERE id = NEW.excepcion_id),
                        'La excepción de bloqueo ' || NEW.excepcion_id
                    );
                END IF;
                v_tipo := ledger.bloqueo_de(NEW.fecha, NEW.empresa_id, NULL, NEW.origen_tipo, false,
                                            NEW.created_by, NEW.excepcion_id);
                IF v_tipo IS NOT NULL THEN
                    PERFORM ledger.rechazar_bloqueo(v_tipo, NEW.fecha, 'no se registran asientos con fecha ' || NEW.fecha);
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

            -- diferido: con el diario (asientos_numeros) y los movimientos ya escritos
            CREATE OR REPLACE FUNCTION ledger.verificar_bloqueo_asiento() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_diario bigint;
                v_tipo text;
            BEGIN
                SELECT n.diario_id INTO v_diario FROM ledger.asientos_numeros n WHERE n.asiento_id = NEW.id;
                v_tipo := ledger.bloqueo_de(NEW.fecha, NEW.empresa_id, v_diario, NEW.origen_tipo,
                                            ledger.asiento_con_impuesto(NEW.id), NEW.created_by, NEW.excepcion_id);
                -- el mes cerrado lo verifica el trigger inmediato (un cierre posterior en la misma
                -- transacción, como el del cierre anual, no invalida lo registrado antes)
                IF v_tipo IS NOT NULL AND v_tipo <> 'cerrado' THEN
                    PERFORM ledger.rechazar_bloqueo(v_tipo, NEW.fecha, 'asiento ' || NEW.id);
                END IF;
                RETURN NULL;
            END
            $fn$;
            CREATE CONSTRAINT TRIGGER asientos_bloqueo AFTER INSERT ON ledger.asientos
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION ledger.verificar_bloqueo_asiento();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON ledger.bloqueos, ledger.bloqueos_excepciones,
                        ledger.bloqueos_excepciones_revocaciones TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.bloqueos, ledger.bloqueos_excepciones,
                        ledger.bloqueos_excepciones_revocaciones FROM argosisp_app;
                    GRANT SELECT ON ledger.cuentas_con_impuesto TO argosisp_app;
                    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ledger.cuentas_con_impuesto FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS asientos_bloqueo ON ledger.asientos;
            DROP FUNCTION IF EXISTS ledger.verificar_bloqueo_asiento();

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

            DROP FUNCTION IF EXISTS ledger.rechazar_bloqueo(text, date, text);
            DROP FUNCTION IF EXISTS ledger.primer_dia_abierto(date, bigint, bigint, text, boolean);
            DROP FUNCTION IF EXISTS ledger.fecha_bloqueada(date, bigint, bigint, boolean);
            DROP FUNCTION IF EXISTS ledger.bloqueo_de(date, bigint, bigint, text, boolean, bigint, bigint);
            DROP FUNCTION IF EXISTS ledger.asiento_con_impuesto(bigint);
            DROP FUNCTION IF EXISTS ledger.cuentas_tocan_impuesto(bigint[]);
            DROP FUNCTION IF EXISTS ledger.excepcion_vigente(bigint, bigint, text, bigint);
            ALTER TABLE ledger.asientos DROP COLUMN IF EXISTS excepcion_id, DROP COLUMN IF EXISTS fecha_documento;
            DROP TABLE IF EXISTS ledger.cuentas_con_impuesto;
            DROP TABLE IF EXISTS ledger.bloqueos_excepciones_revocaciones;
            DROP TABLE IF EXISTS ledger.bloqueos_excepciones;
            DROP TABLE IF EXISTS ledger.bloqueos;
            DROP FUNCTION IF EXISTS ledger.validar_bloqueo();
            DROP FUNCTION IF EXISTS ledger.bloqueo_vigente(bigint, text);
        `)
    }
}
