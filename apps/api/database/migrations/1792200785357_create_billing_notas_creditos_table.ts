import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · semana 3 · notas de crédito internas (sin FEL; la certificación llega en la semana 5).
 *
 *  - `billing.notas_credito`: una fila por nota, contra una factura viva, por un monto parcial o
 *    total de su saldo, con su desglose de IVA y motivo. Su asiento (`origen_tipo =
 *    nota_credito`, `origen_id = id`) reduce la CxC del cliente.
 *  - Inmutable como el libro (trigger y `REVOKE`): una nota no se edita ni se borra.
 *  - El monto se suma a `facturas.pagado` (lo cubierto de la factura, como un saldo inicial a
 *    favor); la parte acreditada se lee de esta tabla.
 *  - FEL (semana 5) guardará la certificación en su propia tabla: esta no admite UPDATE.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.notas_credito (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                factura_id bigint NOT NULL REFERENCES billing.facturas (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                servicio_id bigint REFERENCES core.servicios (id),
                fecha date NOT NULL,
                subtotal numeric(14, 2) NOT NULL CHECK (subtotal >= 0),
                iva numeric(14, 2) NOT NULL CHECK (iva >= 0),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
                created_by bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK (subtotal + iva = monto)
            );
            CREATE INDEX notas_credito_factura ON billing.notas_credito (factura_id);
            CREATE INDEX notas_credito_cliente ON billing.notas_credito (cliente_id);
            CREATE TRIGGER notas_credito_inmutable BEFORE UPDATE OR DELETE ON billing.notas_credito
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    REVOKE UPDATE, DELETE, TRUNCATE ON billing.notas_credito FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS billing.notas_credito`)
    }
}
