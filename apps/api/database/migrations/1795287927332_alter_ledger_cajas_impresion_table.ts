import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · impresión por caja (decisión del PM 20): cada caja recuerda su formato. De fábrica el recibo
 * sale en ticket de 80 mm (`pos_80`) y la factura en carta. Mismos valores que los formatos de las
 * plantillas de documentos (`FORMATOS_DOCUMENTO`). `ledger.cajas` es un catálogo mutable con `version`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.cajas
                ADD COLUMN formato_recibo text NOT NULL DEFAULT 'pos_80' CHECK (formato_recibo IN ('pos_80', 'carta')),
                ADD COLUMN formato_factura text NOT NULL DEFAULT 'carta' CHECK (formato_factura IN ('pos_80', 'carta'));
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE ledger.cajas DROP COLUMN IF EXISTS formato_recibo, DROP COLUMN IF EXISTS formato_factura;
        `)
    }
}
