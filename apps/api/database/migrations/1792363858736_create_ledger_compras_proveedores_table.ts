import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · localización fiscal, fase 5 (contrato §3.3 y §3.4): **proveedores y compras**.
 *
 * - `ledger.proveedores`: catálogo por empresa (configuración con `version` y `audit.cambios`). El
 *   documento (`nit`) va normalizado; único por empresa entre los activos.
 * - `ledger.movimientos.proveedor_id` (`ALTER ADD COLUMN`, las filas existentes quedan en null): el
 *   auxiliar de `2.1.03 Proveedores`. Un trigger lo exige en las cuentas con `auxiliar_proveedor` y
 *   que el proveedor sea de la empresa del asiento.
 * - `ledger.compras`, `compras_lineas`, `compras_retenciones` (la retención emitida por impuesto) y
 *   `compras_anulaciones`: solo inserción. Único (`empresa_id`, `proveedor_id`, `tipo_documento`,
 *   `serie`, `numero`) → 409 `compra_duplicada`. `total = bienes + servicios + importaciones +
 *   exento + iva`; FPEQ, FCAP y RECIBO no llevan IVA ni crédito fiscal (inv. A.3).
 * - `ledger.egresos.compra_id` (nulable; ningún UPDATE de filas): el egreso que paga una compra al
 *   contado. Su asiento es el de la compra (origen `compra`); el egreso no genera otro.
 * - `ledger.pagos_proveedores` + `pagos_proveedores_aplicaciones` + `pagos_proveedores_anulaciones`:
 *   pagos de compras al crédito (`2.1.03 / Caja | Banco`), solo inserción.
 * - `ledger.constancias_retencion`: constancias de retención recibidas de un cliente (con su pago) o
 *   emitidas a un proveedor (con su compra). Número único por empresa, dirección e impuesto entre
 *   las emitidas; las recibidas se validan en la acción (un pago anulado libera su número).
 *
 * Todas las de solo inserción rechazan UPDATE, DELETE y TRUNCATE por trigger y por `REVOKE`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.proveedores (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                tipo_documento text NOT NULL CHECK (tipo_documento IN ('nit', 'cui', 'id_extranjero')),
                nit text NOT NULL CHECK (length(btrim(nit)) > 0),
                nombre text NOT NULL CHECK (length(btrim(nombre)) > 0),
                tipo text NOT NULL DEFAULT 'general'
                    CHECK (tipo IN ('general', 'pequeno_contribuyente', 'no_residente', 'sin_documento')),
                regimen_isr text CHECK (regimen_isr IN ('utilidades', 'opcional_simplificado', 'pequeno_contribuyente')),
                agente_retencion_iva boolean NOT NULL DEFAULT false,
                pais char(2) NOT NULL DEFAULT 'GT',
                direccion text,
                correo text,
                telefono text,
                dias_credito integer NOT NULL DEFAULT 0 CHECK (dias_credito BETWEEN 0 AND 365),
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_by bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT proveedores_documento_pais CHECK (tipo_documento = 'id_extranjero' OR pais = 'GT'),
                CONSTRAINT proveedores_no_residente CHECK ((tipo = 'no_residente') = (tipo_documento = 'id_extranjero'))
            );
            CREATE UNIQUE INDEX proveedores_nit_activo ON ledger.proveedores (empresa_id, nit) WHERE activo;
            CREATE INDEX proveedores_empresa ON ledger.proveedores (empresa_id, nombre);

            ALTER TABLE ledger.movimientos ADD COLUMN proveedor_id bigint REFERENCES ledger.proveedores (id);
            CREATE INDEX movimientos_proveedor ON ledger.movimientos (proveedor_id) WHERE proveedor_id IS NOT NULL;

            CREATE OR REPLACE FUNCTION ledger.validar_movimiento_proveedor() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_auxiliar boolean;
                v_codigo text;
            BEGIN
                SELECT auxiliar_proveedor, codigo INTO v_auxiliar, v_codigo FROM ledger.cuentas WHERE id = NEW.cuenta_id;
                IF coalesce(v_auxiliar, false) AND NEW.proveedor_id IS NULL THEN
                    RAISE EXCEPTION 'La cuenta % lleva auxiliar por proveedor: falta proveedor_id', v_codigo
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'movimiento_proveedor';
                END IF;
                IF NEW.proveedor_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM ledger.proveedores p JOIN ledger.asientos a ON a.id = NEW.asiento_id
                     WHERE p.id = NEW.proveedor_id AND p.empresa_id = a.empresa_id) THEN
                    RAISE EXCEPTION 'El proveedor % no es de la empresa del asiento %', NEW.proveedor_id, NEW.asiento_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'proveedor_de_otra_empresa';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER movimientos_proveedor BEFORE INSERT ON ledger.movimientos
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_movimiento_proveedor();

            CREATE TABLE ledger.compras (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                proveedor_id bigint NOT NULL REFERENCES ledger.proveedores (id),
                tipo_documento text NOT NULL
                    CHECK (tipo_documento IN ('FACT', 'FCAM', 'FPEQ', 'FCAP', 'NCRE', 'NDEB', 'FESP', 'DUA', 'RECIBO')),
                serie text NOT NULL DEFAULT '',
                numero text NOT NULL CHECK (length(btrim(numero)) > 0),
                autorizacion text,
                fecha_documento date NOT NULL,
                periodo_iva date NOT NULL CHECK (periodo_iva = date_trunc('month', periodo_iva)::date),
                fecha date NOT NULL,
                condicion text NOT NULL CHECK (condicion IN ('contado', 'credito')),
                vence_en date,
                base_bienes numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_bienes >= 0),
                base_servicios numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_servicios >= 0),
                base_importaciones numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_importaciones >= 0),
                exento numeric(14,2) NOT NULL DEFAULT 0 CHECK (exento >= 0),
                iva numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva >= 0),
                total numeric(14,2) NOT NULL CHECK (total > 0),
                credito_fiscal boolean NOT NULL,
                retencion_iva numeric(14,2) NOT NULL DEFAULT 0 CHECK (retencion_iva >= 0),
                retencion_isr numeric(14,2) NOT NULL DEFAULT 0 CHECK (retencion_isr >= 0),
                compra_referencia_id bigint REFERENCES ledger.compras (id),
                egreso_id bigint REFERENCES ledger.egresos (id),
                descripcion text,
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT compras_documento_unico UNIQUE (empresa_id, proveedor_id, tipo_documento, serie, numero),
                CONSTRAINT compras_total CHECK (total = base_bienes + base_servicios + base_importaciones + exento + iva),
                CONSTRAINT compras_sin_iva CHECK (tipo_documento NOT IN ('FPEQ', 'FCAP', 'RECIBO') OR (iva = 0 AND NOT credito_fiscal)),
                CONSTRAINT compras_credito_con_iva CHECK (NOT credito_fiscal OR iva > 0),
                CONSTRAINT compras_retenciones CHECK (retencion_iva + retencion_isr < total),
                CONSTRAINT compras_referencia CHECK (
                    (tipo_documento = 'NCRE' AND compra_referencia_id IS NOT NULL AND condicion = 'credito')
                    OR tipo_documento = 'NDEB'
                    OR (tipo_documento NOT IN ('NCRE', 'NDEB') AND compra_referencia_id IS NULL)),
                CONSTRAINT compras_credito_vence CHECK (condicion = 'contado' OR vence_en IS NOT NULL),
                CONSTRAINT compras_fecha CHECK (fecha >= fecha_documento)
            );
            CREATE INDEX compras_empresa_periodo ON ledger.compras (empresa_id, periodo_iva);
            CREATE INDEX compras_proveedor ON ledger.compras (proveedor_id);
            CREATE INDEX compras_egreso ON ledger.compras (egreso_id) WHERE egreso_id IS NOT NULL;

            CREATE TABLE ledger.compras_lineas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                compra_id bigint NOT NULL REFERENCES ledger.compras (id),
                descripcion text NOT NULL,
                tipo text NOT NULL CHECK (tipo IN ('bien', 'servicio', 'activo_fijo', 'combustible', 'importacion')),
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                exento boolean NOT NULL DEFAULT false,
                base numeric(14,2) NOT NULL CHECK (base > 0),
                iva numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva >= 0),
                clase_activo text,
                diferir_meses integer CHECK (diferir_meses BETWEEN 2 AND 120),
                CONSTRAINT compras_lineas_activo CHECK ((tipo = 'activo_fijo') = (clase_activo IS NOT NULL)),
                CONSTRAINT compras_lineas_exenta CHECK (NOT exento OR iva = 0)
            );
            CREATE INDEX compras_lineas_compra ON ledger.compras_lineas (compra_id);

            CREATE TABLE ledger.compras_retenciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                compra_id bigint NOT NULL REFERENCES ledger.compras (id),
                impuesto_codigo text NOT NULL,
                impuesto text NOT NULL CHECK (impuesto IN ('iva', 'isr')),
                base numeric(14,2) NOT NULL CHECK (base >= 0),
                -- tasa, no dinero: texto exacto de fiscal.impuestos (ledger solo guarda dinero en numeric(14,2))
                tasa text NOT NULL CHECK (tasa ~ '^[0-9]{1,3}([.][0-9]{1,6}){0,1}$'),
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                CONSTRAINT compras_retenciones_unica UNIQUE (compra_id, impuesto_codigo)
            );

            CREATE TABLE ledger.compras_anulaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                compra_id bigint NOT NULL UNIQUE REFERENCES ledger.compras (id),
                -- reverso del asiento de la compra; null si la compra no tuvo asiento (desde un egreso
                -- sin IVA que reclasificar ni cuentas distintas)
                asiento_id bigint REFERENCES ledger.asientos (id),
                motivo text NOT NULL CHECK (length(btrim(motivo)) >= 3),
                anulado_por bigint REFERENCES core.usuarios (id),
                anulado_en timestamptz NOT NULL DEFAULT now()
            );

            ALTER TABLE ledger.egresos ADD COLUMN compra_id bigint REFERENCES ledger.compras (id);
            CREATE UNIQUE INDEX egresos_compra ON ledger.egresos (compra_id) WHERE compra_id IS NOT NULL;

            CREATE OR REPLACE FUNCTION ledger.validar_compra() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM ledger.proveedores p WHERE p.id = NEW.proveedor_id AND p.empresa_id = NEW.empresa_id) THEN
                    RAISE EXCEPTION 'El proveedor % no es de la empresa %', NEW.proveedor_id, NEW.empresa_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'proveedor_de_otra_empresa';
                END IF;
                IF NEW.egreso_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM ledger.egresos e WHERE e.id = NEW.egreso_id AND e.empresa_id = NEW.empresa_id) THEN
                    RAISE EXCEPTION 'El egreso % no es de la empresa %', NEW.egreso_id, NEW.empresa_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'egreso_de_otra_empresa';
                END IF;
                IF NEW.compra_referencia_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM ledger.compras c WHERE c.id = NEW.compra_referencia_id
                       AND c.empresa_id = NEW.empresa_id AND c.proveedor_id = NEW.proveedor_id) THEN
                    RAISE EXCEPTION 'La compra referida % no es del mismo proveedor y empresa', NEW.compra_referencia_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'referencia_de_otro_proveedor';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER compras_validar BEFORE INSERT ON ledger.compras
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_compra();

            CREATE TRIGGER compras_inmutable BEFORE UPDATE OR DELETE ON ledger.compras
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER compras_sin_truncate BEFORE TRUNCATE ON ledger.compras
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER compras_lineas_inmutable BEFORE UPDATE OR DELETE ON ledger.compras_lineas
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER compras_lineas_sin_truncate BEFORE TRUNCATE ON ledger.compras_lineas
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER compras_retenciones_inmutable BEFORE UPDATE OR DELETE ON ledger.compras_retenciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER compras_retenciones_sin_truncate BEFORE TRUNCATE ON ledger.compras_retenciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER compras_anulaciones_inmutable BEFORE UPDATE OR DELETE ON ledger.compras_anulaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER compras_anulaciones_sin_truncate BEFORE TRUNCATE ON ledger.compras_anulaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            -- pagos a proveedores (§3.4): Proveedores / Caja | Banco, aplicados a sus compras al crédito
            CREATE TABLE ledger.pagos_proveedores (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                proveedor_id bigint NOT NULL REFERENCES ledger.proveedores (id),
                fecha date NOT NULL,
                metodo text NOT NULL CHECK (metodo IN ('caja', 'banco', 'cuenta_bancaria')),
                caja_id bigint REFERENCES ledger.cajas (id),
                turno_id bigint REFERENCES ledger.cajas_turnos (id),
                banco_id bigint REFERENCES ledger.bancos (id),
                cuenta_bancaria_id bigint REFERENCES billing.cuentas_bancarias (id),
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                referencia text,
                descripcion text,
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT pagos_proveedores_origen CHECK (
                    (metodo = 'caja' AND caja_id IS NOT NULL AND banco_id IS NULL AND cuenta_bancaria_id IS NULL)
                    OR (metodo = 'banco' AND banco_id IS NOT NULL AND caja_id IS NULL AND cuenta_bancaria_id IS NULL)
                    OR (metodo = 'cuenta_bancaria' AND cuenta_bancaria_id IS NOT NULL AND caja_id IS NULL AND banco_id IS NULL))
            );
            CREATE INDEX pagos_proveedores_proveedor ON ledger.pagos_proveedores (proveedor_id, fecha);
            CREATE INDEX pagos_proveedores_turno ON ledger.pagos_proveedores (turno_id) WHERE turno_id IS NOT NULL;

            CREATE TABLE ledger.pagos_proveedores_aplicaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                pago_id bigint NOT NULL REFERENCES ledger.pagos_proveedores (id),
                compra_id bigint NOT NULL REFERENCES ledger.compras (id),
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                CONSTRAINT pagos_proveedores_aplicacion_unica UNIQUE (pago_id, compra_id)
            );
            CREATE INDEX pagos_proveedores_aplicaciones_compra ON ledger.pagos_proveedores_aplicaciones (compra_id);

            CREATE OR REPLACE FUNCTION ledger.validar_aplicacion_proveedor() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM ledger.pagos_proveedores p JOIN ledger.compras c ON c.id = NEW.compra_id
                                WHERE p.id = NEW.pago_id AND c.empresa_id = p.empresa_id AND c.proveedor_id = p.proveedor_id) THEN
                    RAISE EXCEPTION 'La compra % no es del proveedor ni de la empresa del pago %', NEW.compra_id, NEW.pago_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'aplicacion_de_otro_proveedor';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER pagos_proveedores_aplicaciones_validar BEFORE INSERT ON ledger.pagos_proveedores_aplicaciones
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_aplicacion_proveedor();

            CREATE TABLE ledger.pagos_proveedores_anulaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                pago_id bigint NOT NULL UNIQUE REFERENCES ledger.pagos_proveedores (id),
                asiento_id bigint NOT NULL REFERENCES ledger.asientos (id),
                motivo text NOT NULL CHECK (length(btrim(motivo)) >= 3),
                anulado_por bigint REFERENCES core.usuarios (id),
                anulado_en timestamptz NOT NULL DEFAULT now()
            );

            -- constancias de retención (§3.4): recibidas de un cliente (con su pago) o emitidas a un
            -- proveedor (con su compra). La emitida no mueve el libro: la retención ya está en 2.1.04/2.1.05
            CREATE TABLE ledger.constancias_retencion (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                direccion text NOT NULL CHECK (direccion IN ('recibida', 'emitida')),
                impuesto text NOT NULL CHECK (impuesto IN ('iva', 'isr')),
                impuesto_codigo text NOT NULL,
                numero text NOT NULL CHECK (length(btrim(numero)) > 0),
                fecha date NOT NULL,
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                pago_id bigint REFERENCES billing.pagos (id),
                cliente_id bigint REFERENCES core.clientes (id),
                compra_id bigint REFERENCES ledger.compras (id),
                proveedor_id bigint REFERENCES ledger.proveedores (id),
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT constancias_documento CHECK (
                    (direccion = 'recibida' AND pago_id IS NOT NULL AND cliente_id IS NOT NULL
                        AND compra_id IS NULL AND proveedor_id IS NULL)
                    OR (direccion = 'emitida' AND compra_id IS NOT NULL AND proveedor_id IS NOT NULL
                        AND pago_id IS NULL AND cliente_id IS NULL))
            );
            CREATE UNIQUE INDEX constancias_numero_emitida ON ledger.constancias_retencion (empresa_id, impuesto, numero)
                WHERE direccion = 'emitida';
            CREATE INDEX constancias_numero ON ledger.constancias_retencion (empresa_id, direccion, impuesto, numero);
            CREATE UNIQUE INDEX constancias_emitida_por_compra ON ledger.constancias_retencion (compra_id, impuesto_codigo)
                WHERE direccion = 'emitida';
            CREATE INDEX constancias_pago ON ledger.constancias_retencion (pago_id) WHERE pago_id IS NOT NULL;

            CREATE OR REPLACE FUNCTION ledger.validar_constancia() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.direccion = 'recibida' AND NOT EXISTS (
                    SELECT 1 FROM billing.pagos p WHERE p.id = NEW.pago_id AND p.empresa_id = NEW.empresa_id) THEN
                    RAISE EXCEPTION 'El pago % no es de la empresa %', NEW.pago_id, NEW.empresa_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'constancia_de_otra_empresa';
                END IF;
                IF NEW.direccion = 'emitida' AND NOT EXISTS (
                    SELECT 1 FROM ledger.compras c WHERE c.id = NEW.compra_id AND c.empresa_id = NEW.empresa_id
                       AND c.proveedor_id = NEW.proveedor_id) THEN
                    RAISE EXCEPTION 'La compra % no es del proveedor ni de la empresa de la constancia', NEW.compra_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'constancia_de_otra_empresa';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER constancias_validar BEFORE INSERT ON ledger.constancias_retencion
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_constancia();

            CREATE TRIGGER pagos_proveedores_inmutable BEFORE UPDATE OR DELETE ON ledger.pagos_proveedores
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER pagos_proveedores_sin_truncate BEFORE TRUNCATE ON ledger.pagos_proveedores
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER pagos_proveedores_aplicaciones_inmutable BEFORE UPDATE OR DELETE ON ledger.pagos_proveedores_aplicaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER pagos_proveedores_aplicaciones_sin_truncate BEFORE TRUNCATE ON ledger.pagos_proveedores_aplicaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER pagos_proveedores_anulaciones_inmutable BEFORE UPDATE OR DELETE ON ledger.pagos_proveedores_anulaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER pagos_proveedores_anulaciones_sin_truncate BEFORE TRUNCATE ON ledger.pagos_proveedores_anulaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER constancias_retencion_inmutable BEFORE UPDATE OR DELETE ON ledger.constancias_retencion
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER constancias_retencion_sin_truncate BEFORE TRUNCATE ON ledger.constancias_retencion
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON ledger.proveedores TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON ledger.proveedores FROM argosisp_app;
                    GRANT SELECT, INSERT ON ledger.compras, ledger.compras_lineas, ledger.compras_retenciones,
                        ledger.compras_anulaciones, ledger.pagos_proveedores, ledger.pagos_proveedores_aplicaciones,
                        ledger.pagos_proveedores_anulaciones, ledger.constancias_retencion TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.compras, ledger.compras_lineas,
                        ledger.compras_retenciones, ledger.compras_anulaciones, ledger.pagos_proveedores,
                        ledger.pagos_proveedores_aplicaciones, ledger.pagos_proveedores_anulaciones,
                        ledger.constancias_retencion FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS ledger.constancias_retencion;
            DROP FUNCTION IF EXISTS ledger.validar_constancia();
            DROP TABLE IF EXISTS ledger.pagos_proveedores_anulaciones;
            DROP TABLE IF EXISTS ledger.pagos_proveedores_aplicaciones;
            DROP FUNCTION IF EXISTS ledger.validar_aplicacion_proveedor();
            DROP TABLE IF EXISTS ledger.pagos_proveedores;
            DROP INDEX IF EXISTS ledger.egresos_compra;
            ALTER TABLE ledger.egresos DROP COLUMN IF EXISTS compra_id;
            DROP TABLE IF EXISTS ledger.compras_anulaciones;
            DROP TABLE IF EXISTS ledger.compras_retenciones;
            DROP TABLE IF EXISTS ledger.compras_lineas;
            DROP TABLE IF EXISTS ledger.compras;
            DROP FUNCTION IF EXISTS ledger.validar_compra();
            DROP TRIGGER IF EXISTS movimientos_proveedor ON ledger.movimientos;
            DROP FUNCTION IF EXISTS ledger.validar_movimiento_proveedor();
            ALTER TABLE ledger.movimientos DROP COLUMN IF EXISTS proveedor_id;
            DROP TABLE IF EXISTS ledger.proveedores;
        `)
    }
}
