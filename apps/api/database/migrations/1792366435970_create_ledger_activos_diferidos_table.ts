import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · localización fiscal, fase 5 (contrato §10.10): **activos fijos y diferidos**. Todas de solo
 * inserción (trigger y REVOKE).
 *
 * - `ledger.activos`: alta desde una línea `activo_fijo` de una compra (en su transacción) o a mano
 *   (`activos.registrar`, contra saldos de apertura o patrimonio, origen `alta_activo`). Costo sin
 *   el IVA tomado como crédito; tasa anual ≤ tope legal de la clase.
 * - `ledger.activos_cuotas`: una por activo y mes (único), con su asiento `depreciacion`
 *   (`5.3.01 / 1.2.02.NN`). Repetir el cron no duplica.
 * - `ledger.activos_bajas`: venta, retiro o anulación de su compra (una por activo), con su asiento
 *   `baja_activo` (null en la anulación: el reverso de la compra ya canceló el costo).
 * - `ledger.diferimientos` + `diferimientos_cuotas` (único por diferimiento y mes, asiento
 *   `diferido`) + `diferimientos_cancelaciones` (al anular su compra antes de amortizar).
 * - `ledger.asientos.origen_tipo` admite `alta_activo` (desvío pendiente de aprobación: el alta a
 *   mano necesita un origen propio).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.activos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                clase text NOT NULL,
                descripcion text NOT NULL CHECK (length(btrim(descripcion)) > 0),
                serie text,
                ubicacion text,
                compra_id bigint REFERENCES ledger.compras (id),
                compra_linea_id bigint UNIQUE REFERENCES ledger.compras_lineas (id),
                fecha_alta date NOT NULL,
                inicio_depreciacion date NOT NULL CHECK (inicio_depreciacion = date_trunc('month', inicio_depreciacion)::date),
                costo numeric(14,2) NOT NULL CHECK (costo > 0),
                valor_residual numeric(14,2) NOT NULL DEFAULT 0,
                depreciacion_inicial numeric(14,2) NOT NULL DEFAULT 0,
                -- tasa, no dinero: texto exacto (ledger solo guarda dinero en numeric(14,2))
                tasa_anual text NOT NULL CHECK (tasa_anual ~ '^[0-9]{1,3}([.][0-9]{1,2}){0,1}$'),
                cuenta_activo_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                cuenta_depreciacion_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                cuenta_gasto_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT activos_residual CHECK (valor_residual >= 0 AND depreciacion_inicial >= 0
                                                   AND valor_residual + depreciacion_inicial < costo)
            );
            CREATE INDEX activos_empresa ON ledger.activos (empresa_id, clase);

            CREATE TABLE ledger.activos_cuotas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                activo_id bigint NOT NULL REFERENCES ledger.activos (id),
                mes date NOT NULL CHECK (mes = date_trunc('month', mes)::date),
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                asiento_id bigint NOT NULL REFERENCES ledger.asientos (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT activos_cuotas_unica UNIQUE (activo_id, mes)
            );

            CREATE TABLE ledger.activos_bajas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                activo_id bigint NOT NULL UNIQUE REFERENCES ledger.activos (id),
                fecha date NOT NULL,
                tipo text NOT NULL CHECK (tipo IN ('venta', 'retiro', 'anulacion')),
                motivo text NOT NULL CHECK (length(btrim(motivo)) >= 3),
                precio_venta numeric(14,2) NOT NULL DEFAULT 0 CHECK (precio_venta >= 0),
                cuenta_cobro_id bigint REFERENCES ledger.cuentas (id),
                costo numeric(14,2) NOT NULL,
                depreciacion_acumulada numeric(14,2) NOT NULL,
                valor_libros numeric(14,2) NOT NULL,
                asiento_id bigint REFERENCES ledger.asientos (id),
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT activos_bajas_venta CHECK ((tipo = 'venta') = (cuenta_cobro_id IS NOT NULL)),
                CONSTRAINT activos_bajas_asiento CHECK ((tipo = 'anulacion') = (asiento_id IS NULL))
            );

            CREATE TABLE ledger.diferimientos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                origen text NOT NULL CHECK (origen IN ('factura', 'compra')),
                factura_id bigint REFERENCES billing.facturas (id),
                factura_linea_id bigint REFERENCES billing.facturas_lineas (id),
                compra_id bigint REFERENCES ledger.compras (id),
                compra_linea_id bigint REFERENCES ledger.compras_lineas (id),
                descripcion text NOT NULL,
                cuenta_diferida_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                cuenta_destino_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                total numeric(14,2) NOT NULL CHECK (total > 0),
                inicio date NOT NULL CHECK (inicio = date_trunc('month', inicio)::date),
                meses integer NOT NULL CHECK (meses BETWEEN 2 AND 120),
                -- el asiento que llevó el monto a la cuenta diferida (null: la línea de la compra ya fue a 1.1.13)
                asiento_inicial boolean NOT NULL,
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT diferimientos_origen CHECK (
                    (origen = 'factura' AND factura_linea_id IS NOT NULL AND compra_linea_id IS NULL)
                    OR (origen = 'compra' AND compra_linea_id IS NOT NULL AND factura_linea_id IS NULL))
            );
            CREATE INDEX diferimientos_empresa ON ledger.diferimientos (empresa_id);

            CREATE TABLE ledger.diferimientos_cuotas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                diferimiento_id bigint NOT NULL REFERENCES ledger.diferimientos (id),
                mes date NOT NULL CHECK (mes = date_trunc('month', mes)::date),
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                asiento_id bigint NOT NULL REFERENCES ledger.asientos (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT diferimientos_cuotas_unica UNIQUE (diferimiento_id, mes)
            );

            CREATE TABLE ledger.diferimientos_cancelaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                diferimiento_id bigint NOT NULL UNIQUE REFERENCES ledger.diferimientos (id),
                motivo text NOT NULL,
                asiento_id bigint REFERENCES ledger.asientos (id),
                cancelado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );

            ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
            ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN (
                'factura', 'pago', 'mora', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste',
                'compra', 'pago_proveedor', 'retencion', 'liquidacion_impuesto', 'pago_impuesto', 'cierre_anual',
                'reclasificacion', 'liquidacion_cobro', 'deposito', 'traslado', 'banco', 'provision', 'castigo',
                'diferencia_cobro', 'depreciacion', 'baja_activo', 'diferido', 'lealtad', 'alta_activo'));

            DO $do$
            DECLARE t text;
            BEGIN
                FOREACH t IN ARRAY ARRAY['activos', 'activos_cuotas', 'activos_bajas', 'diferimientos',
                                         'diferimientos_cuotas', 'diferimientos_cancelaciones'] LOOP
                    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON ledger.%I
                                    FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion()', t || '_inmutable', t);
                    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON ledger.%I
                                    FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion()', t || '_sin_truncate', t);
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                        EXECUTE format('GRANT SELECT, INSERT ON ledger.%I TO argosisp_app', t);
                        EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON ledger.%I FROM argosisp_app', t);
                    END IF;
                END LOOP;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
            ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN (
                'factura', 'pago', 'mora', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste',
                'compra', 'pago_proveedor', 'retencion', 'liquidacion_impuesto', 'pago_impuesto', 'cierre_anual',
                'reclasificacion', 'liquidacion_cobro', 'deposito', 'traslado', 'banco', 'provision', 'castigo',
                'diferencia_cobro', 'depreciacion', 'baja_activo', 'diferido', 'lealtad')) NOT VALID;
            DROP TABLE IF EXISTS ledger.diferimientos_cancelaciones;
            DROP TABLE IF EXISTS ledger.diferimientos_cuotas;
            DROP TABLE IF EXISTS ledger.diferimientos;
            DROP TABLE IF EXISTS ledger.activos_bajas;
            DROP TABLE IF EXISTS ledger.activos_cuotas;
            DROP TABLE IF EXISTS ledger.activos;
        `)
    }
}
