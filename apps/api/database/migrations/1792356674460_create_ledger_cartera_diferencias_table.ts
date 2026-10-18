import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · localización fiscal, fase 4 (contrato §10.9): **estimación y castigo de cartera** y
 * **cierre de diferencias de cobro**. Todas de solo inserción (trigger y REVOKE).
 *
 * - `ledger.provisiones_cartera`: cada cálculo de `cartera.provisionar` (base = saldos deudores al
 *   corte, tope = `reserva_incobrables_max`, lo que ya había en 1.1.12 y lo registrado). Su asiento
 *   es el de origen `provision` con su id (`5.3.02 / 1.1.12`).
 * - `ledger.castigos` + `ledger.castigos_facturas`: el castigo de un cliente con motivo y evidencia,
 *   y lo castigado de cada factura (monto e IVA que sale de 2.1.11). Una factura se castiga una vez.
 *   Asiento de origen `castigo` con su id.
 * - `billing.diferencias_cobro`: la nota con la que `pagos.cerrar_diferencia` cerró el saldo pequeño
 *   que dejó un pago en cada factura (una vez por pago y factura).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.provisiones_cartera (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                anio integer NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
                fecha date NOT NULL,
                base numeric(14,2) NOT NULL CHECK (base >= 0),
                -- tasa, no dinero: texto exacto del parámetro (ledger solo admite dinero numeric(14,2))
                porcentaje text NOT NULL CHECK (porcentaje ~ '^[0-9]{1,3}([.][0-9]{1,6}){0,1}$'),
                tope numeric(14,2) NOT NULL CHECK (tope >= 0),
                saldo_anterior numeric(14,2) NOT NULL,
                monto numeric(14,2) NOT NULL CHECK (monto >= 0),
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX provisiones_cartera_empresa ON ledger.provisiones_cartera (empresa_id, anio);

            CREATE TABLE ledger.castigos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                fecha date NOT NULL,
                motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
                evidencia text NOT NULL CHECK (length(btrim(evidencia)) > 0),
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                iva numeric(14,2) NOT NULL CHECK (iva >= 0),
                estimacion numeric(14,2) NOT NULL CHECK (estimacion >= 0),
                gasto numeric(14,2) NOT NULL CHECK (gasto >= 0),
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT castigos_reparto CHECK (iva + estimacion + gasto = monto)
            );

            CREATE TABLE ledger.castigos_facturas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                castigo_id bigint NOT NULL REFERENCES ledger.castigos (id),
                factura_id bigint NOT NULL UNIQUE REFERENCES billing.facturas (id),
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                iva numeric(14,2) NOT NULL CHECK (iva >= 0 AND iva <= monto)
            );

            CREATE OR REPLACE FUNCTION ledger.validar_castigo_factura() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM ledger.castigos k JOIN billing.facturas f ON f.id = NEW.factura_id
                                WHERE k.id = NEW.castigo_id AND f.empresa_id = k.empresa_id AND f.cliente_id = k.cliente_id) THEN
                    RAISE EXCEPTION 'La factura % no es del cliente ni de la empresa del castigo %', NEW.factura_id, NEW.castigo_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'castigo_de_otro_cliente';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER castigos_facturas_validar BEFORE INSERT ON ledger.castigos_facturas
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_castigo_factura();

            CREATE TABLE billing.diferencias_cobro (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                pago_id bigint NOT NULL REFERENCES billing.pagos (id),
                factura_id bigint NOT NULL REFERENCES billing.facturas (id),
                nota_credito_id bigint NOT NULL UNIQUE REFERENCES billing.notas_credito (id),
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT diferencias_cobro_unica UNIQUE (pago_id, factura_id)
            );

            CREATE TRIGGER provisiones_cartera_inmutable BEFORE UPDATE OR DELETE ON ledger.provisiones_cartera
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER provisiones_cartera_sin_truncate BEFORE TRUNCATE ON ledger.provisiones_cartera
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER castigos_inmutable BEFORE UPDATE OR DELETE ON ledger.castigos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER castigos_sin_truncate BEFORE TRUNCATE ON ledger.castigos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER castigos_facturas_inmutable BEFORE UPDATE OR DELETE ON ledger.castigos_facturas
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER castigos_facturas_sin_truncate BEFORE TRUNCATE ON ledger.castigos_facturas
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER diferencias_cobro_inmutable BEFORE UPDATE OR DELETE ON billing.diferencias_cobro
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER diferencias_cobro_sin_truncate BEFORE TRUNCATE ON billing.diferencias_cobro
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON ledger.provisiones_cartera, ledger.castigos, ledger.castigos_facturas,
                        billing.diferencias_cobro TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.provisiones_cartera, ledger.castigos,
                        ledger.castigos_facturas, billing.diferencias_cobro FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.diferencias_cobro;
            DROP TABLE IF EXISTS ledger.castigos_facturas;
            DROP FUNCTION IF EXISTS ledger.validar_castigo_factura();
            DROP TABLE IF EXISTS ledger.castigos;
            DROP TABLE IF EXISTS ledger.provisiones_cartera;
        `)
    }
}
