import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · tarea 8: anular un pago es un cambio de estado con asiento de reverso, nunca un DELETE.
 * Se guarda quién, cuándo y por qué.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.pagos
                ADD COLUMN anulado_en timestamptz,
                ADD COLUMN anulado_por bigint REFERENCES core.usuarios (id),
                ADD COLUMN motivo_anulacion text,
                ADD CONSTRAINT pagos_anulacion CHECK ((estado = 'anulado') = (anulado_en IS NOT NULL));
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.pagos
                DROP CONSTRAINT IF EXISTS pagos_anulacion,
                DROP COLUMN IF EXISTS motivo_anulacion,
                DROP COLUMN IF EXISTS anulado_por,
                DROP COLUMN IF EXISTS anulado_en;
        `)
    }
}
