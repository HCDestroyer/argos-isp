import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · facturas de meses pasados (decisión del PM 21): al emitirlas a mano, quien emite escribe los
 * días de gracia antes del corte. Se guardan en la factura (`dias_gracia_corte` y `corte_desde` = día
 * de la emisión en Guatemala + esos días) y `evaluarEstadoServicio` no la cuenta para limitar ni
 * cortar antes de `corte_desde`. El vencimiento del documento (`vence_en`) y la mora no cambian.
 * null en todo lo demás (el cron, cargos únicos y emisiones sin el dato).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.facturas
                ADD COLUMN dias_gracia_corte integer CHECK (dias_gracia_corte BETWEEN 0 AND 90),
                ADD COLUMN corte_desde date,
                ADD CONSTRAINT facturas_corte_desde CHECK ((dias_gracia_corte IS NULL) = (corte_desde IS NULL));
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.facturas
                DROP CONSTRAINT IF EXISTS facturas_corte_desde,
                DROP COLUMN IF EXISTS corte_desde,
                DROP COLUMN IF EXISTS dias_gracia_corte;
        `)
    }
}
