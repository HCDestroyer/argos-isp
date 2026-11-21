import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Precisión en metros de las coordenadas de la instalación (contrato Iris 0.10.0 §3.4.6, A43): el GPS
 * del teléfono del técnico la informa con `completar-datos`. Opcional; null si no se sabe.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.servicios
                ADD COLUMN precision_m numeric(8, 1) CHECK (precision_m IS NULL OR (precision_m >= 0 AND precision_m <= 100000));
        `)
    }

    async down() {
        this.schema.raw('ALTER TABLE core.servicios DROP COLUMN IF EXISTS precision_m')
    }
}
