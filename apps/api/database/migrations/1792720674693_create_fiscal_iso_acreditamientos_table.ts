import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 7, PR C (contrato de localización fiscal §9.1, §9.3, §10.6 y §21).
 *
 *  - `fiscal.ajustes_fiscales` (solo inserción): partidas que llevan el resultado contable a la renta
 *    imponible del ISR (cierre parcial trimestral o anual): `efecto` suma o resta, un trimestre o el
 *    año (`trimestre` null). Se anula con otra fila que la referencia (`anula_a`, única).
 *  - `fiscal.iso_acreditamientos` (solo inserción): el ISO por acreditar al ISR. `origen` = el ISO de
 *    un trimestre revisado (acreditable del 1-ene siguiente hasta el 31-dic del tercer año); `acreditado`
 *    = lo que usó una declaración de ISR (trimestral o anual); `vencido` = lo que el cierre anual pasó a
 *    `5.3.03`. Cuenta solo la fila de una declaración vigente (revisada o presentada) o de un cierre
 *    anual vigente: una sustitutiva o una reapertura la dejan fuera sin tocarla.
 *  - `fiscal.declaraciones_pagos_anulaciones` (solo inserción): la anulación del pago de una
 *    declaración con el reverso de su asiento. El único por versión de `declaraciones_pagos` pasa a
 *    ser «un pago vigente por versión» (trigger): anulado, se puede registrar otro.
 *  - El cierre anual (`cierre_anual`) queda fuera de la regla de cuentas de impuesto del bloqueo de
 *    impuestos, como la liquidación y su pago: su provisión del ISR (`1.1.07`, `1.1.08`, `2.1.07`) y el
 *    ISO vencido van con fecha 31-dic, que la liquidación del IVA de diciembre ya bloqueó.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE fiscal.ajustes_fiscales (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                anio integer NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
                trimestre integer CHECK (trimestre BETWEEN 1 AND 4),
                efecto text NOT NULL CHECK (efecto IN ('suma', 'resta')),
                concepto text NOT NULL CHECK (length(btrim(concepto)) >= 3),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                anula_a bigint UNIQUE REFERENCES fiscal.ajustes_fiscales (id),
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX ajustes_fiscales_periodo ON fiscal.ajustes_fiscales (empresa_id, anio, trimestre);
            CREATE TRIGGER ajustes_fiscales_inmutable BEFORE UPDATE OR DELETE ON fiscal.ajustes_fiscales
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER ajustes_fiscales_sin_truncate BEFORE TRUNCATE ON fiscal.ajustes_fiscales
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TABLE fiscal.iso_acreditamientos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                tipo text NOT NULL CHECK (tipo IN ('origen', 'acreditado', 'vencido')),
                -- trimestre del ISO (primer día) al que pertenece el saldo
                iso_periodo date NOT NULL,
                declaracion_id bigint REFERENCES fiscal.declaraciones (id),
                cierre_id bigint REFERENCES ledger.cierres_anuales (id),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                acreditable_desde date NOT NULL,
                vence_en date NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT iso_acreditamientos_documento CHECK (
                    (tipo IN ('origen', 'acreditado') AND declaracion_id IS NOT NULL AND cierre_id IS NULL)
                    OR (tipo = 'vencido' AND cierre_id IS NOT NULL AND declaracion_id IS NULL)),
                CONSTRAINT iso_acreditamientos_vigencia CHECK (vence_en >= acreditable_desde)
            );
            CREATE UNIQUE INDEX iso_acreditamientos_origen ON fiscal.iso_acreditamientos (declaracion_id)
                WHERE tipo = 'origen';
            CREATE UNIQUE INDEX iso_acreditamientos_uso ON fiscal.iso_acreditamientos (declaracion_id, iso_periodo)
                WHERE tipo = 'acreditado';
            CREATE UNIQUE INDEX iso_acreditamientos_vencido ON fiscal.iso_acreditamientos (cierre_id, iso_periodo)
                WHERE tipo = 'vencido';
            CREATE INDEX iso_acreditamientos_empresa ON fiscal.iso_acreditamientos (empresa_id, iso_periodo);
            CREATE TRIGGER iso_acreditamientos_inmutable BEFORE UPDATE OR DELETE ON fiscal.iso_acreditamientos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER iso_acreditamientos_sin_truncate BEFORE TRUNCATE ON fiscal.iso_acreditamientos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TABLE fiscal.declaraciones_pagos_anulaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                pago_id bigint NOT NULL UNIQUE REFERENCES fiscal.declaraciones_pagos (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                motivo text NOT NULL CHECK (length(btrim(motivo)) >= 3),
                -- reverso del asiento pago_impuesto
                asiento_id bigint NOT NULL UNIQUE REFERENCES ledger.asientos (id),
                anulado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE TRIGGER declaraciones_pagos_anulaciones_inmutable BEFORE UPDATE OR DELETE
                ON fiscal.declaraciones_pagos_anulaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER declaraciones_pagos_anulaciones_sin_truncate BEFORE TRUNCATE
                ON fiscal.declaraciones_pagos_anulaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            -- un pago vigente (sin anulación) por versión, en lugar del único por versión
            ALTER TABLE fiscal.declaraciones_pagos DROP CONSTRAINT declaraciones_pagos_declaracion_id_key;
            CREATE INDEX declaraciones_pagos_declaracion ON fiscal.declaraciones_pagos (declaracion_id);
            CREATE OR REPLACE FUNCTION fiscal.un_pago_vigente() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                PERFORM pg_advisory_xact_lock(3044, NEW.declaracion_id::integer);
                IF EXISTS (
                    SELECT 1 FROM fiscal.declaraciones_pagos p
                     WHERE p.declaracion_id = NEW.declaracion_id
                       AND NOT EXISTS (SELECT 1 FROM fiscal.declaraciones_pagos_anulaciones x WHERE x.pago_id = p.id)
                ) THEN
                    RAISE EXCEPTION 'La declaración % ya tiene un pago vigente', NEW.declaracion_id
                        USING ERRCODE = 'unique_violation', CONSTRAINT = 'declaraciones_pagos_vigente';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER declaraciones_pagos_vigente BEFORE INSERT ON fiscal.declaraciones_pagos
                FOR EACH ROW EXECUTE FUNCTION fiscal.un_pago_vigente();

            -- §10.4: el cierre anual tampoco entra por la regla de cuentas de impuesto (sí por etiquetas)
            CREATE OR REPLACE FUNCTION ledger.asiento_con_impuesto(p_asiento bigint) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                     WHERE m.asiento_id = p_asiento
                       AND (m.impuesto_codigo IS NOT NULL
                            OR (a.origen_tipo NOT IN ('liquidacion_impuesto', 'pago_impuesto', 'cierre_anual')
                                AND ledger.cuenta_de_impuesto(m.cuenta_id)))
                );
            $fn$;
            ${validarMovimiento("('liquidacion_impuesto', 'pago_impuesto', 'cierre_anual')")}

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON fiscal.ajustes_fiscales, fiscal.iso_acreditamientos,
                        fiscal.declaraciones_pagos_anulaciones TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON fiscal.ajustes_fiscales, fiscal.iso_acreditamientos,
                        fiscal.declaraciones_pagos_anulaciones FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION ledger.asiento_con_impuesto(p_asiento bigint) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                     WHERE m.asiento_id = p_asiento
                       AND (m.impuesto_codigo IS NOT NULL
                            OR (a.origen_tipo NOT IN ('liquidacion_impuesto', 'pago_impuesto') AND ledger.cuenta_de_impuesto(m.cuenta_id)))
                );
            $fn$;
            ${validarMovimiento("('liquidacion_impuesto', 'pago_impuesto')")}
            DROP TRIGGER IF EXISTS declaraciones_pagos_vigente ON fiscal.declaraciones_pagos;
            DROP FUNCTION IF EXISTS fiscal.un_pago_vigente();
            DROP TABLE IF EXISTS fiscal.declaraciones_pagos_anulaciones;
            DROP INDEX IF EXISTS fiscal.declaraciones_pagos_declaracion;
            -- el único por versión vuelve solo si ninguna versión tiene más de un pago (uno anulado y otro):
            -- las filas son de solo inserción y no se borran
            DO $do$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM fiscal.declaraciones_pagos GROUP BY declaracion_id HAVING count(*) > 1) THEN
                    ALTER TABLE fiscal.declaraciones_pagos
                        ADD CONSTRAINT declaraciones_pagos_declaracion_id_key UNIQUE (declaracion_id);
                END IF;
            END
            $do$;
            DROP TABLE IF EXISTS fiscal.iso_acreditamientos;
            DROP TABLE IF EXISTS fiscal.ajustes_fiscales;
        `)
    }
}

/** `ledger.validar_movimiento` de la migración 1792711800604 con la lista de orígenes exentos. */
function validarMovimiento(exentos: string): string {
    return `
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
                        OR (v_asiento.origen_tipo NOT IN ${exentos} AND ledger.cuenta_de_impuesto(NEW.cuenta_id))
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
            $fn$;`
}
