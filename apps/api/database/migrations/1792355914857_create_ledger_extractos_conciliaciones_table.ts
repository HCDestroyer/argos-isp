import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · localización fiscal, fase 4 (contrato §10.3): **extractos y conciliación bancaria de
 * solo inserción**.
 *
 * - `ledger.extractos` y `ledger.extractos_lineas`: el extracto importado (neutral al origen) y
 *   sus líneas con signo; la `huella` es única por (empresa, cuenta): una línea ya importada no
 *   entra dos veces.
 * - `ledger.conciliaciones`: una fila por movimiento del libro ligado a una línea; las filas de un
 *   mismo acto comparten `grupo`. Deshacer = fila en `ledger.conciliaciones_anulaciones`. Conciliar
 *   **nunca reescribe** un asiento: liga lo que ya existe; una línea sin documento genera un
 *   asiento nuevo (`banco`) antes de conciliarse.
 * - `ledger.reglas_conciliacion`: configuración con `version` y `audit.cambios`.
 * - `ledger.transitos_acreditados.linea_id`: la línea del extracto con la que llegó el depósito o
 *   el traslado.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.extractos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                cuenta_bancaria_id bigint REFERENCES billing.cuentas_bancarias (id),
                desde date NOT NULL,
                hasta date NOT NULL,
                saldo_inicial numeric(14,2) NOT NULL,
                saldo_final numeric(14,2) NOT NULL,
                archivo text,
                sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
                motivo_no_encadena text,
                importado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT extractos_rango CHECK (desde <= hasta)
            );
            CREATE INDEX extractos_cuenta ON ledger.extractos (empresa_id, cuenta_id, hasta);

            CREATE TABLE ledger.extractos_lineas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                extracto_id bigint NOT NULL REFERENCES ledger.extractos (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                orden integer NOT NULL CHECK (orden >= 1),
                fecha date NOT NULL,
                descripcion text NOT NULL,
                referencia text,
                monto numeric(14,2) NOT NULL CHECK (monto <> 0),
                saldo numeric(14,2),
                huella text NOT NULL CHECK (huella ~ '^[0-9a-f]{64}$'),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT extractos_lineas_huella UNIQUE (empresa_id, cuenta_id, huella),
                CONSTRAINT extractos_lineas_orden UNIQUE (extracto_id, orden)
            );
            CREATE INDEX extractos_lineas_cuenta_fecha ON ledger.extractos_lineas (empresa_id, cuenta_id, fecha);

            CREATE OR REPLACE FUNCTION ledger.validar_linea_extracto() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_ext record;
            BEGIN
                SELECT empresa_id, cuenta_id, desde, hasta INTO v_ext FROM ledger.extractos WHERE id = NEW.extracto_id;
                IF v_ext.empresa_id <> NEW.empresa_id OR v_ext.cuenta_id <> NEW.cuenta_id THEN
                    RAISE EXCEPTION 'La línea no es de la empresa ni de la cuenta de su extracto'
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'linea_de_otro_extracto';
                END IF;
                IF NEW.fecha < v_ext.desde OR NEW.fecha > v_ext.hasta THEN
                    RAISE EXCEPTION 'La línea del % está fuera del extracto (% a %)', NEW.fecha, v_ext.desde, v_ext.hasta
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'linea_fuera_del_extracto';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER extractos_lineas_validar BEFORE INSERT ON ledger.extractos_lineas
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_linea_extracto();

            CREATE TABLE ledger.reglas_conciliacion (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                nombre text NOT NULL CHECK (length(btrim(nombre)) > 0),
                cuenta_id bigint REFERENCES ledger.cuentas (id),
                tipo_condicion text NOT NULL CHECK (tipo_condicion IN ('contiene', 'regex')),
                patron text NOT NULL CHECK (length(patron) > 0),
                monto_min numeric(14,2),
                monto_max numeric(14,2),
                accion text NOT NULL CHECK (accion IN ('contrapartida', 'cliente')),
                contrapartida_cuenta_id bigint REFERENCES ledger.cuentas (id),
                prioridad integer NOT NULL DEFAULT 100,
                activa boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT reglas_conciliacion_contrapartida CHECK ((accion = 'contrapartida') = (contrapartida_cuenta_id IS NOT NULL)),
                CONSTRAINT reglas_conciliacion_rango CHECK (monto_min IS NULL OR monto_max IS NULL OR monto_min <= monto_max)
            );

            CREATE TABLE ledger.conciliaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                grupo uuid NOT NULL,
                linea_id bigint NOT NULL REFERENCES ledger.extractos_lineas (id),
                movimiento_id bigint NOT NULL REFERENCES ledger.movimientos (id),
                monto numeric(14,2) NOT NULL CHECK (monto <> 0),
                regla_id bigint REFERENCES ledger.reglas_conciliacion (id),
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT conciliaciones_movimiento UNIQUE (grupo, movimiento_id)
            );
            CREATE INDEX conciliaciones_linea ON ledger.conciliaciones (linea_id);
            CREATE INDEX conciliaciones_movimiento_id ON ledger.conciliaciones (movimiento_id);

            CREATE TABLE ledger.conciliaciones_anulaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                conciliacion_id bigint NOT NULL UNIQUE REFERENCES ledger.conciliaciones (id),
                motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
                anulado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );

            -- la fila liga una línea y un movimiento de la misma empresa y cuenta, por el neto del movimiento;
            -- ni el movimiento ni la línea están en otra conciliación vigente
            CREATE OR REPLACE FUNCTION ledger.validar_conciliacion() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_linea record;
                v_mov record;
            BEGIN
                SELECT empresa_id, cuenta_id INTO v_linea FROM ledger.extractos_lineas WHERE id = NEW.linea_id;
                SELECT m.cuenta_id, m.debe - m.haber AS neto, a.empresa_id INTO v_mov
                  FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id WHERE m.id = NEW.movimiento_id;
                IF v_linea.empresa_id <> NEW.empresa_id OR v_linea.cuenta_id <> NEW.cuenta_id
                   OR v_mov.empresa_id <> NEW.empresa_id OR v_mov.cuenta_id <> NEW.cuenta_id THEN
                    RAISE EXCEPTION 'La línea % y el movimiento % no son de la misma empresa y cuenta', NEW.linea_id, NEW.movimiento_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'conciliacion_otra_cuenta';
                END IF;
                IF NEW.monto <> v_mov.neto THEN
                    RAISE EXCEPTION 'El movimiento % se concilia por su neto (%), no por %', NEW.movimiento_id, v_mov.neto, NEW.monto
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'conciliacion_monto';
                END IF;
                IF EXISTS (SELECT 1 FROM ledger.conciliaciones c
                            WHERE c.grupo <> NEW.grupo AND (c.movimiento_id = NEW.movimiento_id OR c.linea_id = NEW.linea_id)
                              AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = c.id)) THEN
                    RAISE EXCEPTION 'La línea % o el movimiento % ya están conciliados', NEW.linea_id, NEW.movimiento_id
                        USING ERRCODE = 'unique_violation', CONSTRAINT = 'conciliacion_duplicada';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER conciliaciones_validar BEFORE INSERT ON ledger.conciliaciones
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_conciliacion();

            ALTER TABLE ledger.transitos_acreditados ADD COLUMN linea_id bigint REFERENCES ledger.extractos_lineas (id);

            CREATE TRIGGER extractos_inmutable BEFORE UPDATE OR DELETE ON ledger.extractos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER extractos_sin_truncate BEFORE TRUNCATE ON ledger.extractos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER extractos_lineas_inmutable BEFORE UPDATE OR DELETE ON ledger.extractos_lineas
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER extractos_lineas_sin_truncate BEFORE TRUNCATE ON ledger.extractos_lineas
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER conciliaciones_inmutable BEFORE UPDATE OR DELETE ON ledger.conciliaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER conciliaciones_sin_truncate BEFORE TRUNCATE ON ledger.conciliaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER conciliaciones_anulaciones_inmutable BEFORE UPDATE OR DELETE ON ledger.conciliaciones_anulaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER conciliaciones_anulaciones_sin_truncate BEFORE TRUNCATE ON ledger.conciliaciones_anulaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON ledger.extractos, ledger.extractos_lineas, ledger.conciliaciones,
                        ledger.conciliaciones_anulaciones TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.extractos, ledger.extractos_lineas, ledger.conciliaciones,
                        ledger.conciliaciones_anulaciones FROM argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON ledger.reglas_conciliacion TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON ledger.reglas_conciliacion FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE ledger.transitos_acreditados DROP COLUMN IF EXISTS linea_id;
            DROP TABLE IF EXISTS ledger.conciliaciones_anulaciones;
            DROP TABLE IF EXISTS ledger.conciliaciones;
            DROP FUNCTION IF EXISTS ledger.validar_conciliacion();
            DROP TABLE IF EXISTS ledger.reglas_conciliacion;
            DROP TABLE IF EXISTS ledger.extractos_lineas;
            DROP FUNCTION IF EXISTS ledger.validar_linea_extracto();
            DROP TABLE IF EXISTS ledger.extractos;
        `)
    }
}
