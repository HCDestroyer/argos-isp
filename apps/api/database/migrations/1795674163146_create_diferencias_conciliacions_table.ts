import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · plan de contabilidad, lote B3 (conciliación I, §5.8): diferencias al conciliar.
 *
 * Viven en `billing` (como `billing.ajustes_cobro`, `billing.asientos_borradores` y
 * `billing.diferencias_cobro`): son configuración y pedidos que no tocan el libro por sí mismos; el
 * asiento de la diferencia se registra en `ledger` con origen `diferencia_conciliacion` y
 * `origen_id` = `billing.diferencias_conciliacion.id`.
 *
 * - `billing.ajustes_conciliacion`: tope de quien concilia por empresa, por línea y por día. Sin fila
 *   = fábrica (Q 10.00 por línea y Q 50.00 por día, decisión N7 del PM). Configuración con
 *   `version` y `audit.cambios`.
 * - `billing.motivos_diferencia`: motivos con su cuenta, su límite y si cuentan contra el tope. Los
 *   de fábrica son globales (`empresa_id` null, con `codigo`); editar uno en una empresa crea su
 *   fila propia con el mismo `codigo`, que lo reemplaza solo en esa empresa. `clase = 'retencion'`
 *   queda reservada para el lote B10 (retenciones del cliente). Configuración con `version`.
 * - `billing.diferencias_conciliacion`: cada diferencia aceptada al conciliar o pedida para
 *   aprobación (solo inserción). La decisión (aprobada o rechazada) es una fila de
 *   `billing.diferencias_conciliacion_decisiones`; el estado se deriva.
 * - `billing.lineas_por_identificar`: «no sé todavía» de una línea del extracto, con su nota (solo
 *   inserción; la última nota manda).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.ajustes_conciliacion (
                empresa_id bigint PRIMARY KEY REFERENCES core.empresas (id),
                tope_linea numeric(14, 2) NOT NULL DEFAULT 10.00 CHECK (tope_linea >= 0),
                tope_dia numeric(14, 2) NOT NULL DEFAULT 50.00 CHECK (tope_dia >= 0),
                version integer NOT NULL DEFAULT 1,
                updated_by bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE billing.motivos_diferencia (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint REFERENCES core.empresas (id),
                codigo text CHECK (codigo IS NULL OR codigo ~ '^[a-z_]{3,40}$'),
                clase text NOT NULL DEFAULT 'diferencia' CHECK (clase IN ('diferencia', 'retencion')),
                nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 3 AND 80),
                sentido text NOT NULL CHECK (sentido IN ('menos', 'mas', 'ambos')),
                se_ofrece_en text NOT NULL DEFAULT 'cualquiera'
                    CHECK (se_ofrece_en IN ('cualquiera', 'depositos', 'cobros')),
                cuenta_banco_id bigint REFERENCES ledger.cuentas (id),
                texto text CHECK (texto IS NULL OR length(btrim(texto)) BETWEEN 1 AND 80),
                limite_tipo text NOT NULL CHECK (limite_tipo IN ('fijo', 'porcentaje', 'sin_limite')),
                limite_valor numeric(14, 2),
                cuenta_codigo text,
                cuenta_contra_tope boolean NOT NULL DEFAULT true,
                siempre_aprobacion boolean NOT NULL DEFAULT false,
                fija boolean NOT NULL DEFAULT false,
                activo boolean NOT NULL DEFAULT true,
                orden integer NOT NULL DEFAULT 100,
                version integer NOT NULL DEFAULT 1,
                updated_by bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT motivos_diferencia_limite CHECK ((limite_tipo = 'sin_limite') = (limite_valor IS NULL)),
                CONSTRAINT motivos_diferencia_limite_positivo CHECK (limite_valor IS NULL OR limite_valor > 0),
                CONSTRAINT motivos_diferencia_porcentaje CHECK (limite_tipo <> 'porcentaje' OR limite_valor <= 100),
                -- sin cuenta propia la elige quien concilia, y entonces siempre pide aprobación
                CONSTRAINT motivos_diferencia_cuenta CHECK (cuenta_codigo IS NOT NULL OR siempre_aprobacion),
                CONSTRAINT motivos_diferencia_fabrica CHECK (empresa_id IS NOT NULL OR codigo IS NOT NULL),
                -- una retención nunca se apaga (B10)
                CONSTRAINT motivos_diferencia_fija CHECK (NOT fija OR activo)
            );
            CREATE UNIQUE INDEX motivos_diferencia_codigo
                ON billing.motivos_diferencia (coalesce(empresa_id, 0), codigo) WHERE codigo IS NOT NULL;
            CREATE INDEX motivos_diferencia_empresa ON billing.motivos_diferencia (empresa_id, orden);

            -- motivos de fábrica (plan §5.8); las retenciones de IVA e ISR las agrega B10
            INSERT INTO billing.motivos_diferencia
                (empresa_id, codigo, nombre, sentido, se_ofrece_en, limite_tipo, limite_valor, cuenta_codigo,
                 cuenta_contra_tope, siempre_aprobacion, orden)
            VALUES
                (NULL, 'comision_banco', 'Comisión del banco', 'menos', 'cualquiera', 'fijo', 10.00, '5.3.07', true, false, 10),
                (NULL, 'comision_cobro', 'Comisión de pasarela o agente', 'menos', 'cobros', 'porcentaje', 4.50, '5.1.02', false, false, 20),
                (NULL, 'redondeo', 'Redondeo', 'ambos', 'cualquiera', 'fijo', 0.05, '5.3.05', false, false, 30),
                (NULL, 'faltante_deposito', 'Faltó efectivo en el depósito', 'menos', 'depositos', 'sin_limite', NULL, '5.2.06', true, false, 40),
                (NULL, 'otra', 'Otra razón', 'ambos', 'cualquiera', 'sin_limite', NULL, NULL, true, true, 90);

            CREATE TABLE billing.diferencias_conciliacion (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                linea_id bigint NOT NULL REFERENCES ledger.extractos_lineas (id),
                sentido text NOT NULL CHECK (sentido IN ('menos', 'mas')),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                monto_contra_tope numeric(14, 2) NOT NULL CHECK (monto_contra_tope >= 0),
                requiere_aprobacion boolean NOT NULL,
                razones text[] NOT NULL DEFAULT '{}'
                    CHECK (razones <@ ARRAY['motivo', 'tope_linea', 'tope_dia']::text[]),
                solicitud jsonb NOT NULL CHECK (jsonb_typeof(solicitud) = 'object'),
                detalle jsonb NOT NULL CHECK (jsonb_typeof(detalle) = 'array' AND jsonb_array_length(detalle) > 0),
                explicacion text CHECK (explicacion IS NULL OR length(btrim(explicacion)) BETWEEN 5 AND 500),
                fecha date NOT NULL,
                solicitado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT diferencias_conciliacion_razones CHECK (requiere_aprobacion = (cardinality(razones) > 0)),
                CONSTRAINT diferencias_conciliacion_explicacion CHECK (NOT requiere_aprobacion OR explicacion IS NOT NULL)
            );
            CREATE INDEX diferencias_conciliacion_linea ON billing.diferencias_conciliacion (linea_id);
            CREATE INDEX diferencias_conciliacion_usuario_dia
                ON billing.diferencias_conciliacion (empresa_id, solicitado_por, fecha);

            CREATE TABLE billing.diferencias_conciliacion_decisiones (
                diferencia_id bigint PRIMARY KEY REFERENCES billing.diferencias_conciliacion (id),
                decision text NOT NULL CHECK (decision IN ('aprobada', 'rechazada')),
                motivo text CHECK (motivo IS NULL OR length(btrim(motivo)) BETWEEN 3 AND 500),
                decidido_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT diferencias_decision_motivo CHECK (decision = 'aprobada' OR motivo IS NOT NULL)
            );

            CREATE TABLE billing.lineas_por_identificar (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                linea_id bigint NOT NULL REFERENCES ledger.extractos_lineas (id),
                nota text NOT NULL CHECK (length(btrim(nota)) BETWEEN 3 AND 500),
                marcado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX lineas_por_identificar_linea ON billing.lineas_por_identificar (linea_id, id DESC);

            -- solo inserción (trigger y REVOKE), como los borradores de asiento
            CREATE TRIGGER diferencias_conciliacion_inmutable BEFORE UPDATE OR DELETE ON billing.diferencias_conciliacion
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER diferencias_conciliacion_sin_truncate BEFORE TRUNCATE ON billing.diferencias_conciliacion
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER diferencias_decisiones_inmutable
                BEFORE UPDATE OR DELETE ON billing.diferencias_conciliacion_decisiones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER diferencias_decisiones_sin_truncate BEFORE TRUNCATE ON billing.diferencias_conciliacion_decisiones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER lineas_por_identificar_inmutable BEFORE UPDATE OR DELETE ON billing.lineas_por_identificar
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER lineas_por_identificar_sin_truncate BEFORE TRUNCATE ON billing.lineas_por_identificar
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            -- origen del asiento de una diferencia al conciliar; origen_id = billing.diferencias_conciliacion.id
            DO $$
            DECLARE
                valores text[];
            BEGIN
                SELECT array_agg(DISTINCT m[1]) INTO valores
                  FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
                 WHERE c.conname = 'asientos_origen_tipo_check' AND c.conrelid = 'ledger.asientos'::regclass;
                IF NOT 'diferencia_conciliacion' = ANY (valores) THEN
                    valores := valores || 'diferencia_conciliacion'::text;
                END IF;
                ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
                EXECUTE format('ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo = ANY (%L::text[]))', valores);
            END $$;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON billing.diferencias_conciliacion, billing.diferencias_conciliacion_decisiones,
                        billing.lineas_por_identificar TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON billing.diferencias_conciliacion,
                        billing.diferencias_conciliacion_decisiones, billing.lineas_por_identificar FROM argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON billing.ajustes_conciliacion, billing.motivos_diferencia TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON billing.ajustes_conciliacion, billing.motivos_diferencia FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.lineas_por_identificar;
            DROP TABLE IF EXISTS billing.diferencias_conciliacion_decisiones;
            DROP TABLE IF EXISTS billing.diferencias_conciliacion;
            DROP TABLE IF EXISTS billing.motivos_diferencia;
            DROP TABLE IF EXISTS billing.ajustes_conciliacion;
            DO $$
            DECLARE
                valores text[];
            BEGIN
                SELECT array_agg(DISTINCT m[1]) INTO valores
                  FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
                 WHERE c.conname = 'asientos_origen_tipo_check' AND c.conrelid = 'ledger.asientos'::regclass;
                valores := array_remove(valores, 'diferencia_conciliacion');
                ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
                EXECUTE format('ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo = ANY (%L::text[])) NOT VALID', valores);
            END $$;
        `)
    }
}
