import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 4, decisiones del líder sobre H16–H18 (contrato §18). Solo DDL: ninguna fila cambia.
 *
 * - H16: estado **`acreditada`**: un aviso de cobro cubierto entero por notas internas no es venta
 *   (nadie pagó nada); no se certifica ni entra en la cola FEL.
 * - H17: `ledger.recuperaciones_castigo`: lo recuperado de cada castigo, partido en base (4.2.03) e
 *   IVA (de vuelta a 2.1.11) en la proporción del castigo.
 * - H18: tipo de factura **`cargo`** (cargo interno no fiscal, sin IVA) y
 *   `billing.diferencias_cobro_cargos`: anular el pago que cerró una diferencia cuando la factura
 *   ya tiene DTE devuelve la diferencia como un cargo `CxC / 5.3.05`, ligado al pago anulado.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.facturas DROP CONSTRAINT facturas_estado_check;
            ALTER TABLE billing.facturas ADD CONSTRAINT facturas_estado_check CHECK (estado IN (
                'por_certificar', 'emitida', 'parcial', 'pagada', 'vencida', 'anulada', 'castigada', 'acreditada'));
            ALTER TABLE billing.facturas DROP CONSTRAINT facturas_tipo_check;
            ALTER TABLE billing.facturas ADD CONSTRAINT facturas_tipo_check CHECK (tipo IN ('servicio', 'mora', 'cargo'));
            ALTER TABLE billing.facturas ADD CONSTRAINT facturas_cargo_sin_iva
                CHECK (tipo <> 'cargo' OR (iva = 0 AND NOT aviso_cobro AND factura_origen_id IS NOT NULL));

            CREATE TABLE ledger.recuperaciones_castigo (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                castigo_id bigint NOT NULL REFERENCES ledger.castigos (id),
                pago_id bigint NOT NULL REFERENCES billing.pagos (id),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                base numeric(14, 2) NOT NULL CHECK (base >= 0),
                iva numeric(14, 2) NOT NULL CHECK (iva >= 0),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT recuperaciones_castigo_reparto CHECK (base + iva = monto),
                CONSTRAINT recuperaciones_castigo_unica UNIQUE (castigo_id, pago_id)
            );
            CREATE INDEX recuperaciones_castigo_pago ON ledger.recuperaciones_castigo (pago_id);
            CREATE TRIGGER recuperaciones_castigo_inmutable BEFORE UPDATE OR DELETE ON ledger.recuperaciones_castigo
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER recuperaciones_castigo_sin_truncate BEFORE TRUNCATE ON ledger.recuperaciones_castigo
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TABLE billing.diferencias_cobro_cargos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                diferencia_id bigint NOT NULL UNIQUE REFERENCES billing.diferencias_cobro (id),
                pago_id bigint NOT NULL REFERENCES billing.pagos (id),
                factura_id bigint NOT NULL UNIQUE REFERENCES billing.facturas (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE TRIGGER diferencias_cobro_cargos_inmutable BEFORE UPDATE OR DELETE ON billing.diferencias_cobro_cargos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER diferencias_cobro_cargos_sin_truncate BEFORE TRUNCATE ON billing.diferencias_cobro_cargos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON ledger.recuperaciones_castigo, billing.diferencias_cobro_cargos TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.recuperaciones_castigo, billing.diferencias_cobro_cargos FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        // al bajar, una acreditada vuelve a «pagada» como se guardaba antes (las tablas se borran; el
        // libro no cambia)
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.diferencias_cobro_cargos;
            DROP TABLE IF EXISTS ledger.recuperaciones_castigo;
            ALTER TABLE billing.facturas DROP CONSTRAINT IF EXISTS facturas_cargo_sin_iva;
            ALTER TABLE billing.facturas DROP CONSTRAINT facturas_tipo_check;
            ALTER TABLE billing.facturas ADD CONSTRAINT facturas_tipo_check CHECK (tipo IN ('servicio', 'mora')) NOT VALID;
            ALTER TABLE billing.facturas DROP CONSTRAINT facturas_estado_check;
            UPDATE billing.facturas SET estado = 'pagada' WHERE estado = 'acreditada';
            ALTER TABLE billing.facturas ADD CONSTRAINT facturas_estado_check CHECK (estado IN (
                'por_certificar', 'emitida', 'parcial', 'pagada', 'vencida', 'anulada', 'castigada'));
        `)
    }
}
