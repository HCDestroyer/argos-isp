import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · tareas 4 y 5: columnas de facturas para mora y vencimiento.
 *
 *  - `facturas.tipo`: `servicio` (la del periodo) o `mora` (recargo por vencimiento). Solo las de
 *    `servicio` cuentan para limitar/cortar. `factura_origen_id`: la factura que generó la mora.
 *  - `facturas.vencida_en`: cuándo `vencerFacturas` la marcó vencida. Si un pago se anula, la
 *    factura vuelve a `vencida` (no a `emitida`) porque ya pasó por el vencimiento.
 *  - `pagado <= total`: un pago nunca deja una factura sobrepagada (el excedente va a Anticipos).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.facturas
                ADD COLUMN tipo text NOT NULL DEFAULT 'servicio' CHECK (tipo IN ('servicio', 'mora')),
                ADD COLUMN factura_origen_id bigint REFERENCES billing.facturas (id),
                ADD COLUMN vencida_en timestamptz,
                ADD CONSTRAINT facturas_mora_origen CHECK (tipo <> 'mora' OR factura_origen_id IS NOT NULL),
                ADD CONSTRAINT facturas_pagado_maximo CHECK (pagado <= total);
            CREATE INDEX facturas_cliente_pendientes ON billing.facturas (cliente_id, vence_en, id)
                WHERE estado IN ('emitida', 'parcial', 'vencida');
            CREATE INDEX facturas_origen ON billing.facturas (factura_origen_id) WHERE factura_origen_id IS NOT NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS billing.facturas_origen;
            DROP INDEX IF EXISTS billing.facturas_cliente_pendientes;
            ALTER TABLE billing.facturas
                DROP CONSTRAINT IF EXISTS facturas_pagado_maximo,
                DROP CONSTRAINT IF EXISTS facturas_mora_origen,
                DROP COLUMN IF EXISTS vencida_en,
                DROP COLUMN IF EXISTS factura_origen_id,
                DROP COLUMN IF EXISTS tipo;
        `)
    }
}
