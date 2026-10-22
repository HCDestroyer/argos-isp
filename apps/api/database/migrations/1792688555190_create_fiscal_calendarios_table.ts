import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 7, PR A (contrato de localización fiscal §3.2, §3.7, §9.3 y §21): calendario fiscal.
 *
 *  - `fiscal.feriados` (global, solo inserción): días inhábiles para los plazos. La fila vigente de
 *    cada fecha es la última (`activo = false` la retira). Tabla vacía editable (§15 #22): sin filas
 *    solo son inhábiles sábados y domingos.
 *  - `fiscal.obligaciones` (por empresa): el calendario. Una fila por (empresa, impuesto,
 *    periodo_desde) que genera el cron `fiscal:calendario`. Cambian `vence_en`, `formulario`,
 *    `regla`, `estado`, `motivo_estado` y `declaracion_id` (con `version` y `audit.cambios`); la
 *    identidad (empresa, impuesto, periodo) no cambia y ninguna fila se borra (triggers).
 *    `declaracion_id` llega con las declaraciones (PR B), que le agrega la FK.
 *  - `fiscal.alertas` (solo inserción): una fila por alerta emitida (`fiscal.vencimiento_proximo`
 *    por obligación y umbral; `fiscal.limite_pc` por año y umbral). La clave única impide repetirla.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE fiscal.feriados (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                fecha date NOT NULL,
                nombre text NOT NULL CHECK (length(btrim(nombre)) >= 3),
                activo boolean NOT NULL DEFAULT true,
                origen text NOT NULL DEFAULT 'usuario' CHECK (origen IN ('paquete', 'usuario')),
                motivo text NOT NULL CHECK (length(btrim(motivo)) >= 3),
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX feriados_fecha ON fiscal.feriados (fecha, id);

            CREATE TABLE fiscal.obligaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                impuesto text NOT NULL CHECK (impuesto IN (
                    'iva_mensual', 'pc_mensual', 'isr_opcional_mensual', 'isr_trimestral',
                    'iso_trimestral', 'isr_anual', 'retenciones_iva', 'retenciones_isr'
                )),
                periodo_desde date NOT NULL,
                periodo_hasta date NOT NULL,
                formulario text,
                vence_en date NOT NULL,
                regla jsonb NOT NULL DEFAULT '{}'::jsonb,
                estado text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'borrador', 'presentada', 'no_aplica')),
                motivo_estado text,
                declaracion_id bigint,
                version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT obligaciones_unica UNIQUE (empresa_id, impuesto, periodo_desde),
                CONSTRAINT obligaciones_periodo CHECK (periodo_hasta >= periodo_desde),
                CONSTRAINT obligaciones_vence CHECK (vence_en > periodo_hasta)
            );
            CREATE INDEX obligaciones_vence ON fiscal.obligaciones (empresa_id, vence_en);
            CREATE INDEX obligaciones_estado ON fiscal.obligaciones (estado, vence_en);

            -- la identidad de una obligación no cambia y ninguna se borra
            CREATE OR REPLACE FUNCTION fiscal.proteger_obligacion() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'Las obligaciones fiscales no se borran (estado no_aplica)'
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                IF NEW.empresa_id <> OLD.empresa_id OR NEW.impuesto <> OLD.impuesto
                   OR NEW.periodo_desde <> OLD.periodo_desde OR NEW.periodo_hasta <> OLD.periodo_hasta THEN
                    RAISE EXCEPTION 'La empresa, el impuesto y el periodo de una obligación no cambian'
                        USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.version <> OLD.version + 1 THEN
                    RAISE EXCEPTION 'Cada cambio de una obligación sube su version en uno'
                        USING ERRCODE = 'check_violation';
                END IF;
                NEW.updated_at := now();
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER obligaciones_protegidas BEFORE UPDATE OR DELETE ON fiscal.obligaciones
                FOR EACH ROW EXECUTE FUNCTION fiscal.proteger_obligacion();
            CREATE TRIGGER obligaciones_sin_truncate BEFORE TRUNCATE ON fiscal.obligaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TABLE fiscal.alertas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                tipo text NOT NULL CHECK (tipo IN ('vencimiento_proximo', 'limite_pc')),
                clave text NOT NULL CHECK (length(clave) > 0),
                obligacion_id bigint REFERENCES fiscal.obligaciones (id),
                datos jsonb NOT NULL DEFAULT '{}'::jsonb,
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT alertas_unica UNIQUE (empresa_id, tipo, clave),
                CONSTRAINT alertas_obligacion CHECK ((tipo = 'vencimiento_proximo') = (obligacion_id IS NOT NULL))
            );

            CREATE TRIGGER feriados_inmutable BEFORE UPDATE OR DELETE ON fiscal.feriados
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER feriados_sin_truncate BEFORE TRUNCATE ON fiscal.feriados
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER alertas_inmutable BEFORE UPDATE OR DELETE ON fiscal.alertas
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER alertas_sin_truncate BEFORE TRUNCATE ON fiscal.alertas
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON fiscal.feriados, fiscal.alertas TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON fiscal.feriados, fiscal.alertas FROM argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON fiscal.obligaciones TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON fiscal.obligaciones FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS fiscal.alertas;
            DROP TABLE IF EXISTS fiscal.obligaciones;
            DROP TABLE IF EXISTS fiscal.feriados;
            DROP FUNCTION IF EXISTS fiscal.proteger_obligacion();
        `)
    }
}
