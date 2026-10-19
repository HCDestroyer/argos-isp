import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · localización fiscal, fase 5 (contrato §3.5): **retenciones recibidas en el pago**.
 *
 * `billing.pagos.retenido` (`ALTER ADD COLUMN` con valor por defecto 0: ninguna fila cambia de
 * significado): la parte del pago que el cliente cubrió con constancias de retención de IVA o ISR
 * (`ledger.constancias_retencion`, dirección `recibida`). `monto` sigue siendo lo que el pago
 * aplica a la deuda; entra a caja o banco `monto − comision − retenido` y el resto va a `1.1.05`
 * o `1.1.06`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.pagos
                ADD COLUMN retenido numeric(14,2) NOT NULL DEFAULT 0,
                ADD CONSTRAINT pagos_retenido CHECK (retenido >= 0 AND retenido < monto);
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.pagos DROP CONSTRAINT IF EXISTS pagos_retenido;
            ALTER TABLE billing.pagos DROP COLUMN IF EXISTS retenido;
        `)
    }
}
