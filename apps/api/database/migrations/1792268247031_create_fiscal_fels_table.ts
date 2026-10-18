import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · localización fiscal, fase 3 (FEL): contrato §3.5, §3.6, §8, §10.1 y §10.9.
 *
 *  - `fiscal.fel_configuracion` (una fila por empresa, `version`): proveedor, ambiente, modo de
 *    emisión (`obligatoria`, `opcional`, `desactivada`) y contingencia. Las empresas existentes
 *    nacen en `desactivada` (§12.3): nada cambia hasta que el PM las pase a otro modo.
 *  - `fiscal.fel_credenciales`: datos del certificador cifrados (`v1.<iv>.<tag>.<datos>`, la clave
 *    de la instalación, como notify); nunca salen por la API ni a la auditoría.
 *  - `fiscal.dte`: la certificación de cada documento (factura, nota de crédito o de débito), con
 *    su ciclo propio. Nunca se borra; un rechazo definitivo deja la fila y el reintento crea otra.
 *  - `fiscal.dte_intentos`: bitácora ante el certificador, solo inserción.
 *  - `billing.facturas`: estado `por_certificar`, `establecimiento_id`, `tipo_dte`, `aviso_cobro`
 *    (el IVA se registró en `2.1.11 IVA por certificar`, §10.1) y `certificar_al` efectivo.
 *  - `billing.notas_credito_lineas` y `billing.sustituciones` (§10.9), solo inserción.
 *  - `ledger.asientos.origen_tipo` admite los orígenes de §3.3 (DDL: ninguna fila cambia).
 *  - Las facturas con `fel_*` (sistema anterior) pasan a `fiscal.dte` como `certificado` (§12.4).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE fiscal.fel_configuracion (
                empresa_id bigint PRIMARY KEY REFERENCES core.empresas (id),
                proveedor text CHECK (proveedor IN ('infile', 'falso')),
                ambiente text NOT NULL DEFAULT 'pruebas' CHECK (ambiente IN ('pruebas', 'produccion')),
                modo text NOT NULL DEFAULT 'desactivada' CHECK (modo IN ('obligatoria', 'opcional', 'desactivada')),
                contingencia_activa boolean NOT NULL DEFAULT false,
                contingencia_motivo text,
                contingencia_desde timestamptz,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (modo = 'desactivada' OR proveedor IS NOT NULL)
            );
            INSERT INTO fiscal.fel_configuracion (empresa_id) SELECT id FROM core.empresas ORDER BY id;

            CREATE TABLE fiscal.fel_credenciales (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                proveedor text NOT NULL CHECK (proveedor IN ('infile', 'falso')),
                ambiente text NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),
                datos text NOT NULL CHECK (datos LIKE 'v1.%'),
                campos_visibles jsonb NOT NULL DEFAULT '{}'::jsonb,
                probada_en timestamptz,
                resultado_prueba jsonb,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT fel_credenciales_unicas UNIQUE (empresa_id, proveedor, ambiente)
            );

            CREATE TABLE fiscal.dte (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                establecimiento_id bigint REFERENCES fiscal.establecimientos (id),
                documento_tipo text NOT NULL CHECK (documento_tipo IN ('factura', 'nota_credito', 'nota_debito')),
                documento_id bigint NOT NULL,
                tipo_dte text NOT NULL,
                estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
                    'pendiente', 'enviando', 'certificado', 'error_temporal', 'rechazado',
                    'contingencia', 'anulacion_pendiente', 'anulado')),
                proveedor text NOT NULL,
                ambiente text NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),
                identificador uuid NOT NULL,
                autorizacion text,
                serie text,
                numero text,
                fecha_emision timestamptz NOT NULL DEFAULT now(),
                certificado_en timestamptz,
                receptor jsonb NOT NULL,
                referencia jsonb,
                total numeric(14, 2) NOT NULL CHECK (total >= 0),
                iva numeric(14, 2) NOT NULL CHECK (iva >= 0),
                contingencia boolean NOT NULL DEFAULT false,
                intentos integer NOT NULL DEFAULT 0,
                proximo_intento timestamptz,
                ultimo_error text,
                definitivo boolean NOT NULL DEFAULT false,
                -- automatico (aviso cubierto, emisión) o manual (POST /facturas/:id/certificar)
                solicitud text NOT NULL DEFAULT 'automatico' CHECK (solicitud IN ('automatico', 'manual')),
                xml text,
                pdf text,
                anulado_en timestamptz,
                motivo_anulacion text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT dte_identificador_unico UNIQUE (identificador)
            );
            CREATE UNIQUE INDEX dte_documento_vigente ON fiscal.dte (documento_tipo, documento_id)
                WHERE estado <> 'rechazado';
            CREATE UNIQUE INDEX dte_autorizacion_unica ON fiscal.dte (autorizacion) WHERE autorizacion IS NOT NULL;
            CREATE INDEX dte_cola ON fiscal.dte (proximo_intento)
                WHERE estado IN ('pendiente', 'error_temporal', 'contingencia', 'anulacion_pendiente');
            CREATE INDEX dte_empresa ON fiscal.dte (empresa_id, id);
            CREATE TRIGGER dte_sin_borrado BEFORE DELETE ON fiscal.dte
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER dte_sin_truncate BEFORE TRUNCATE ON fiscal.dte
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TABLE fiscal.dte_intentos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                dte_id bigint NOT NULL REFERENCES fiscal.dte (id),
                operacion text NOT NULL CHECK (operacion IN ('certificar', 'anular', 'consultar', 'validar')),
                enviado_en timestamptz NOT NULL DEFAULT now(),
                respuesta jsonb NOT NULL DEFAULT '{}'::jsonb,
                resultado text NOT NULL,
                duracion_ms integer NOT NULL DEFAULT 0
            );
            CREATE INDEX dte_intentos_dte ON fiscal.dte_intentos (dte_id, id);
            CREATE TRIGGER dte_intentos_inmutable BEFORE UPDATE OR DELETE ON fiscal.dte_intentos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER dte_intentos_sin_truncate BEFORE TRUNCATE ON fiscal.dte_intentos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            ALTER TABLE billing.facturas DROP CONSTRAINT facturas_estado_check;
            ALTER TABLE billing.facturas
                ADD CONSTRAINT facturas_estado_check
                    CHECK (estado IN ('por_certificar', 'emitida', 'parcial', 'pagada', 'vencida', 'anulada')),
                ADD COLUMN establecimiento_id bigint REFERENCES fiscal.establecimientos (id),
                ADD COLUMN tipo_dte text,
                ADD COLUMN aviso_cobro boolean NOT NULL DEFAULT false,
                ADD COLUMN certificar_al text CHECK (certificar_al IN ('emitir', 'pagar', 'nunca'));

            CREATE TABLE billing.notas_credito_lineas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nota_id bigint NOT NULL REFERENCES billing.notas_credito (id),
                linea_id bigint NOT NULL REFERENCES billing.facturas_lineas (id),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                iva numeric(14, 2) NOT NULL CHECK (iva >= 0 AND iva <= monto),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT notas_credito_lineas_unica UNIQUE (nota_id, linea_id)
            );
            CREATE INDEX notas_credito_lineas_linea ON billing.notas_credito_lineas (linea_id);
            CREATE TRIGGER notas_credito_lineas_inmutable BEFORE UPDATE OR DELETE ON billing.notas_credito_lineas
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TABLE billing.sustituciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                original_id bigint NOT NULL REFERENCES billing.facturas (id),
                nueva_id bigint NOT NULL REFERENCES billing.facturas (id),
                tipo text NOT NULL CHECK (tipo IN ('anulacion', 'nota_credito')),
                nota_credito_id bigint REFERENCES billing.notas_credito (id),
                motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT sustituciones_original UNIQUE (original_id),
                CONSTRAINT sustituciones_nueva UNIQUE (nueva_id),
                CHECK ((tipo = 'nota_credito') = (nota_credito_id IS NOT NULL))
            );
            CREATE TRIGGER sustituciones_inmutable BEFORE UPDATE OR DELETE ON billing.sustituciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();

            ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
            ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN (
                'factura', 'pago', 'mora', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste',
                'compra', 'pago_proveedor', 'retencion', 'liquidacion_impuesto', 'pago_impuesto', 'cierre_anual',
                'reclasificacion', 'liquidacion_cobro', 'deposito', 'traslado', 'banco', 'provision', 'castigo',
                'diferencia_cobro', 'depreciacion', 'baja_activo', 'diferido', 'lealtad'));

            -- §12.4: lo certificado por el sistema anterior queda como DTE certificado
            INSERT INTO fiscal.dte (empresa_id, documento_tipo, documento_id, tipo_dte, estado, proveedor, ambiente,
                                    identificador, autorizacion, serie, numero, fecha_emision, certificado_en,
                                    receptor, total, iva)
            SELECT f.empresa_id, 'factura', f.id, 'FACT', 'certificado', 'infile', 'produccion', gen_random_uuid(),
                   f.fel_uuid, f.fel_serie, f.fel_numero, f.emitida_en, f.emitida_en,
                   jsonb_build_object('tipo', 'desconocido', 'id', null, 'nombre', null), f.total, f.iva
              FROM billing.facturas f
             WHERE f.fel_uuid IS NOT NULL
             ORDER BY f.id;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON fiscal.fel_configuracion, fiscal.fel_credenciales, fiscal.dte
                        TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON fiscal.fel_configuracion, fiscal.fel_credenciales, fiscal.dte
                        FROM argosisp_app;
                    GRANT SELECT, INSERT ON fiscal.dte_intentos, billing.notas_credito_lineas, billing.sustituciones
                        TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE
                        ON fiscal.dte_intentos, billing.notas_credito_lineas, billing.sustituciones FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
            -- NOT VALID: el libro no se borra; las filas con los orígenes nuevos se quedan
            ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN (
                'factura', 'pago', 'mora', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste')) NOT VALID;
            DROP TABLE IF EXISTS billing.sustituciones;
            DROP TABLE IF EXISTS billing.notas_credito_lineas;
            ALTER TABLE billing.facturas DROP CONSTRAINT facturas_estado_check;
            ALTER TABLE billing.facturas
                DROP COLUMN IF EXISTS establecimiento_id,
                DROP COLUMN IF EXISTS tipo_dte,
                DROP COLUMN IF EXISTS aviso_cobro,
                DROP COLUMN IF EXISTS certificar_al,
                ADD CONSTRAINT facturas_estado_check
                    CHECK (estado IN ('emitida', 'parcial', 'pagada', 'vencida', 'anulada')) NOT VALID;
            DROP TABLE IF EXISTS fiscal.dte_intentos;
            DROP TABLE IF EXISTS fiscal.dte;
            DROP TABLE IF EXISTS fiscal.fel_credenciales;
            DROP TABLE IF EXISTS fiscal.fel_configuracion;
        `)
    }
}
