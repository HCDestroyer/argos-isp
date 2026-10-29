import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · decisión del PM (29 oct): **una promesa cubre todo lo vencido**.
 *
 * - `billing.promesas.regla_cumplimiento`:
 *     - `monto` (las que existían al migrar y las importadas): se cumple cuando lo pagado a las
 *       facturas del servicio desde la promesa llega a su `monto`, o cuando ya no hay deuda vencida;
 *     - `facturas` (las nuevas de `crearPromesaPago`): se cumple cuando **todas** sus facturas
 *       cubiertas quedan saldadas. El monto lo calcula Argos (total vencido al crearla).
 * - `billing.promesas_facturas`: qué facturas cubre la promesa y su saldo al crearla. Las filas
 *   se escriben al crear la promesa y no se editan.
 * - `monto` puede ser 0 solo en una promesa `rechazada` (rechazada por `sin_deuda`: no hay nada
 *   vencido que cubrir); las demás siguen exigiendo monto > 0.
 *
 * Sin asientos: la promesa no mueve dinero (`ledger` no cambia).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.promesas
                ADD COLUMN regla_cumplimiento text NOT NULL DEFAULT 'monto'
                    CONSTRAINT promesas_regla_cumplimiento CHECK (regla_cumplimiento IN ('monto', 'facturas'));
            COMMENT ON COLUMN billing.promesas.regla_cumplimiento IS
                'monto: legado (lo pagado llega al monto o no queda deuda vencida); facturas: todas las de promesas_facturas saldadas';

            ALTER TABLE billing.promesas DROP CONSTRAINT promesas_monto_check;
            ALTER TABLE billing.promesas ADD CONSTRAINT promesas_monto_check
                CHECK (monto > 0 OR (monto = 0 AND estado = 'rechazada'));

            CREATE TABLE billing.promesas_facturas (
                promesa_id bigint NOT NULL REFERENCES billing.promesas (id),
                factura_id bigint NOT NULL REFERENCES billing.facturas (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                -- saldo de la factura cuando se creó la promesa (incluye la mora: es su propia factura)
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                created_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (promesa_id, factura_id)
            );
            CREATE INDEX promesas_facturas_factura ON billing.promesas_facturas (factura_id);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE billing.promesas_facturas;
            ALTER TABLE billing.promesas DROP CONSTRAINT promesas_monto_check;
            ALTER TABLE billing.promesas ADD CONSTRAINT promesas_monto_check CHECK (monto > 0) NOT VALID;
            ALTER TABLE billing.promesas DROP COLUMN regla_cumplimiento;
        `)
    }
}
