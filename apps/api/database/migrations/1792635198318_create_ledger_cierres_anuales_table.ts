import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 6, PR C (contrato de localización fiscal §9.1 y §10.8): cierre anual.
 *
 *  - `ledger.cierres_anuales` (solo inserción): un ejercicio cerrado de una empresa, con el ISR que
 *    escribió el usuario (decisión del líder: dato obligatorio y auditado mientras no existan las
 *    declaraciones), el resultado antes y después del ISR, la reserva legal y el `resumen` (cuentas
 *    canceladas y parámetros usados). Los asientos del cierre llevan `origen_tipo = 'cierre_anual'`
 *    y `origen_id` = esta fila.
 *  - `ledger.reaperturas_anuales` (solo inserción): la reapertura de un cierre, con motivo. El
 *    ejercicio vigente es el cierre sin reapertura; un trigger impide dos vigentes por empresa y año.
 *  - `ledger.ejercicio_cerrado(fecha, empresa)`: ¿el año de la fecha tiene cierre vigente?
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.cierres_anuales (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                anio integer NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
                isr numeric(14, 2) NOT NULL CHECK (isr >= 0),
                isr_acreditado_trimestral numeric(14, 2) NOT NULL DEFAULT 0 CHECK (isr_acreditado_trimestral >= 0),
                isr_acreditado_iso numeric(14, 2) NOT NULL DEFAULT 0 CHECK (isr_acreditado_iso >= 0),
                isr_nota text,
                resultado_antes_isr numeric(14, 2) NOT NULL,
                resultado numeric(14, 2) NOT NULL,
                reserva_legal numeric(14, 2) NOT NULL DEFAULT 0 CHECK (reserva_legal >= 0),
                resumen jsonb NOT NULL,
                cerrado_por bigint REFERENCES core.usuarios (id),
                cerrado_en timestamptz NOT NULL DEFAULT now(),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT cierres_anuales_isr_acreditado CHECK (isr_acreditado_trimestral + isr_acreditado_iso <= isr),
                CONSTRAINT cierres_anuales_resultado CHECK (resultado = resultado_antes_isr - isr)
            );
            CREATE INDEX cierres_anuales_empresa_anio ON ledger.cierres_anuales (empresa_id, anio, id DESC);

            CREATE TABLE ledger.reaperturas_anuales (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cierre_id bigint NOT NULL UNIQUE REFERENCES ledger.cierres_anuales (id),
                motivo text NOT NULL CHECK (length(btrim(motivo)) >= 3),
                reabierto_por bigint REFERENCES core.usuarios (id),
                reabierto_en timestamptz NOT NULL DEFAULT now(),
                created_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE OR REPLACE FUNCTION ledger.ejercicio_cerrado(p_fecha date, p_empresa bigint) RETURNS boolean
            LANGUAGE sql STABLE AS $fn$
                SELECT EXISTS (
                    SELECT 1 FROM ledger.cierres_anuales c
                     WHERE c.empresa_id = p_empresa AND c.anio = extract(year FROM p_fecha)::int
                       AND NOT EXISTS (SELECT 1 FROM ledger.reaperturas_anuales r WHERE r.cierre_id = c.id)
                )
            $fn$;

            -- un solo cierre vigente por empresa y año
            CREATE OR REPLACE FUNCTION ledger.validar_cierre_anual() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                PERFORM pg_advisory_xact_lock(3006, NEW.empresa_id);
                IF ledger.ejercicio_cerrado(make_date(NEW.anio, 1, 1), NEW.empresa_id) THEN
                    RAISE EXCEPTION 'El ejercicio % de la empresa % ya está cerrado', NEW.anio, NEW.empresa_id
                        USING ERRCODE = 'unique_violation';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER cierres_anuales_vigente BEFORE INSERT ON ledger.cierres_anuales
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_cierre_anual();

            CREATE TRIGGER cierres_anuales_inmutable BEFORE UPDATE OR DELETE ON ledger.cierres_anuales
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER cierres_anuales_sin_truncate BEFORE TRUNCATE ON ledger.cierres_anuales
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER reaperturas_anuales_inmutable BEFORE UPDATE OR DELETE ON ledger.reaperturas_anuales
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER reaperturas_anuales_sin_truncate BEFORE TRUNCATE ON ledger.reaperturas_anuales
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON ledger.cierres_anuales, ledger.reaperturas_anuales TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.cierres_anuales, ledger.reaperturas_anuales
                        FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS ledger.reaperturas_anuales;
            DROP TABLE IF EXISTS ledger.cierres_anuales;
            DROP FUNCTION IF EXISTS ledger.validar_cierre_anual();
            DROP FUNCTION IF EXISTS ledger.ejercicio_cerrado(date, bigint);
        `)
    }
}
