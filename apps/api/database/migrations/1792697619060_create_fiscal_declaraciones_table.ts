import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 7, PR B (contrato de localización fiscal §3.7, §9.3, §10.2, §10.4, §10.6 y §21).
 *
 *  - `fiscal.declaraciones`: borradores calculados (nunca se envían a la SAT). Una fila por versión
 *    (empresa, impuesto, periodo, version). Lo calculado (detalle, totales, parámetros, datos_hash)
 *    no cambia nunca (trigger); solo avanzan el estado y lo que el usuario registra al revisar y al
 *    presentar: borrador → revisada → presentada, y cualquiera → sustituida cuando una versión
 *    nueva la reemplaza. No se borra.
 *  - `fiscal.declaraciones_pagos` (solo inserción): el pago de una versión con su asiento
 *    (`pago_impuesto`), la mora y la multa calculadas.
 *  - `fiscal.obligaciones.declaracion_id` recibe su FK.
 *  - Bloqueo de impuestos por etiquetas (§10.4): `ledger.asiento_con_impuesto` mira solo los
 *    movimientos con `impuesto_codigo`; `ledger.cuentas_con_impuesto` y `ledger.cuentas_tocan_impuesto`
 *    se eliminan (los asientos de venta llevan desde ahora su etiqueta `V_IVA`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE fiscal.declaraciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                impuesto text NOT NULL CHECK (impuesto IN (
                    'iva_mensual', 'pc_mensual', 'isr_opcional_mensual', 'isr_trimestral',
                    'iso_trimestral', 'isr_anual', 'retenciones_iva', 'retenciones_isr'
                )),
                periodo_desde date NOT NULL,
                periodo_hasta date NOT NULL,
                version integer NOT NULL CHECK (version >= 1),
                sustitutiva boolean NOT NULL DEFAULT false,
                sustituye_a bigint REFERENCES fiscal.declaraciones (id),
                obligacion_id bigint NOT NULL REFERENCES fiscal.obligaciones (id),
                formulario text,
                vence_en date NOT NULL,
                parametros jsonb NOT NULL DEFAULT '[]'::jsonb,
                detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
                totales jsonb NOT NULL DEFAULT '{}'::jsonb,
                datos_hash text NOT NULL CHECK (datos_hash ~ '^[0-9a-f]{64}$'),
                calculada_por bigint REFERENCES core.usuarios (id),
                calculada_en timestamptz NOT NULL DEFAULT now(),
                estado text NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador', 'revisada', 'presentada', 'sustituida')),
                revisada_por bigint REFERENCES core.usuarios (id),
                revisada_en timestamptz,
                asiento_id bigint REFERENCES ledger.asientos (id),
                numero_formulario text,
                fecha_presentacion date,
                boleta text,
                presentada_por bigint REFERENCES core.usuarios (id),
                presentada_en timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT declaraciones_version_unica UNIQUE (empresa_id, impuesto, periodo_desde, version),
                CONSTRAINT declaraciones_periodo CHECK (periodo_hasta >= periodo_desde),
                CONSTRAINT declaraciones_presentada CHECK (
                    estado NOT IN ('presentada') OR (numero_formulario IS NOT NULL AND fecha_presentacion IS NOT NULL)
                ),
                CONSTRAINT declaraciones_revisada CHECK (
                    estado = 'borrador' OR estado = 'sustituida' OR revisada_en IS NOT NULL
                )
            );
            CREATE INDEX declaraciones_periodo_idx ON fiscal.declaraciones (empresa_id, impuesto, periodo_desde, version DESC);

            -- lo calculado no cambia; el estado solo avanza; nada se borra
            CREATE OR REPLACE FUNCTION fiscal.proteger_declaracion() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'Las declaraciones no se borran (una versión nueva las sustituye)'
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                IF (NEW.empresa_id, NEW.impuesto, NEW.periodo_desde, NEW.periodo_hasta, NEW.version, NEW.sustitutiva,
                    NEW.sustituye_a, NEW.obligacion_id, NEW.formulario, NEW.vence_en, NEW.parametros, NEW.detalle,
                    NEW.totales, NEW.datos_hash, NEW.calculada_por, NEW.calculada_en, NEW.created_at)
                   IS DISTINCT FROM
                   (OLD.empresa_id, OLD.impuesto, OLD.periodo_desde, OLD.periodo_hasta, OLD.version, OLD.sustitutiva,
                    OLD.sustituye_a, OLD.obligacion_id, OLD.formulario, OLD.vence_en, OLD.parametros, OLD.detalle,
                    OLD.totales, OLD.datos_hash, OLD.calculada_por, OLD.calculada_en, OLD.created_at) THEN
                    RAISE EXCEPTION 'Lo calculado en una declaración no cambia: se calcula otra versión'
                        USING ERRCODE = 'check_violation';
                END IF;
                IF OLD.estado <> NEW.estado AND NOT (
                    (OLD.estado = 'borrador' AND NEW.estado IN ('revisada', 'sustituida'))
                    OR (OLD.estado = 'revisada' AND NEW.estado IN ('presentada', 'sustituida'))
                    OR (OLD.estado = 'presentada' AND NEW.estado = 'sustituida')
                ) THEN
                    RAISE EXCEPTION 'Una declaración no pasa de % a %', OLD.estado, NEW.estado
                        USING ERRCODE = 'check_violation';
                END IF;
                IF OLD.estado <> 'borrador' AND (NEW.revisada_en, NEW.revisada_por, NEW.asiento_id)
                   IS DISTINCT FROM (OLD.revisada_en, OLD.revisada_por, OLD.asiento_id) THEN
                    RAISE EXCEPTION 'La revisión de una declaración no cambia' USING ERRCODE = 'check_violation';
                END IF;
                IF OLD.estado IN ('presentada', 'sustituida') AND (NEW.numero_formulario, NEW.fecha_presentacion,
                   NEW.boleta, NEW.presentada_por, NEW.presentada_en) IS DISTINCT FROM (OLD.numero_formulario,
                   OLD.fecha_presentacion, OLD.boleta, OLD.presentada_por, OLD.presentada_en) THEN
                    RAISE EXCEPTION 'Lo presentado de una declaración no cambia' USING ERRCODE = 'check_violation';
                END IF;
                NEW.updated_at := now();
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER declaraciones_protegidas BEFORE UPDATE OR DELETE ON fiscal.declaraciones
                FOR EACH ROW EXECUTE FUNCTION fiscal.proteger_declaracion();
            CREATE TRIGGER declaraciones_sin_truncate BEFORE TRUNCATE ON fiscal.declaraciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TABLE fiscal.declaraciones_pagos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                declaracion_id bigint NOT NULL UNIQUE REFERENCES fiscal.declaraciones (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                fecha date NOT NULL,
                impuesto numeric(14, 2) NOT NULL CHECK (impuesto > 0),
                mora numeric(14, 2) NOT NULL DEFAULT 0 CHECK (mora >= 0),
                multa numeric(14, 2) NOT NULL DEFAULT 0 CHECK (multa >= 0),
                total numeric(14, 2) NOT NULL,
                dias_atraso integer NOT NULL DEFAULT 0 CHECK (dias_atraso >= 0),
                boleta text,
                asiento_id bigint NOT NULL REFERENCES ledger.asientos (id),
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT declaraciones_pagos_total CHECK (total = impuesto + mora + multa)
            );
            CREATE TRIGGER declaraciones_pagos_inmutable BEFORE UPDATE OR DELETE ON fiscal.declaraciones_pagos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER declaraciones_pagos_sin_truncate BEFORE TRUNCATE ON fiscal.declaraciones_pagos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            ALTER TABLE fiscal.obligaciones
                ADD CONSTRAINT obligaciones_declaracion_fk FOREIGN KEY (declaracion_id) REFERENCES fiscal.declaraciones (id);

            -- §10.4: el bloqueo de impuestos aplica a todo asiento con algún movimiento etiquetado
            CREATE OR REPLACE FUNCTION ledger.asiento_con_impuesto(p_asiento bigint) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.movimientos m WHERE m.asiento_id = p_asiento AND m.impuesto_codigo IS NOT NULL
                );
            $fn$;
            -- validar_movimiento (fase 6 PR B) sin la lista de cuentas
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
            DROP FUNCTION IF EXISTS ledger.cuentas_tocan_impuesto(bigint[]);
            DROP TABLE IF EXISTS ledger.cuentas_con_impuesto;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON fiscal.declaraciones TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON fiscal.declaraciones FROM argosisp_app;
                    GRANT SELECT, INSERT ON fiscal.declaraciones_pagos TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON fiscal.declaraciones_pagos FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE fiscal.obligaciones DROP CONSTRAINT IF EXISTS obligaciones_declaracion_fk;
            DROP TABLE IF EXISTS fiscal.declaraciones_pagos;
            DROP TABLE IF EXISTS fiscal.declaraciones;
            DROP FUNCTION IF EXISTS fiscal.proteger_declaracion();
            CREATE TABLE IF NOT EXISTS ledger.cuentas_con_impuesto (
                pais char(2) NOT NULL, codigo text NOT NULL, descripcion text NOT NULL, PRIMARY KEY (pais, codigo)
            );
            CREATE OR REPLACE FUNCTION ledger.cuentas_tocan_impuesto(p_cuentas bigint[]) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.cuentas c
                      JOIN ledger.cuentas_con_impuesto t
                        ON t.pais = c.pais AND (c.codigo = t.codigo OR c.codigo LIKE t.codigo || '.%')
                     WHERE c.id = ANY (p_cuentas)
                );
            $fn$;
        `)
    }
}
