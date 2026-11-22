import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · decisión del PM 14: un comprobante con menos dinero se aplica como abono a las facturas más
 * viejas y se avisa cuánto falta. `rechazar_monto_distinto` (false de fábrica) es el ajuste por
 * plantilla para quien prefiera no aprobar un comprobante cuyo monto no coincide con lo que debe
 * cubrir (422 `monto_distinto` al aprobarlo; caja lo rechaza con la causa `monto_distinto`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.plantillas_facturacion
                ADD COLUMN rechazar_monto_distinto boolean NOT NULL DEFAULT false;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.plantillas_facturacion DROP COLUMN IF EXISTS rechazar_monto_distinto;
        `)
    }
}
