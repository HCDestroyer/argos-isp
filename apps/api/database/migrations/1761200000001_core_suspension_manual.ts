import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Suspensión manual (decisión del PM, 2026-10-15): cuando un operador suspende a mano, el
 * servicio queda suspendido hasta que un operador lo reactive a mano. `evaluarEstadoServicio`
 * no lo toca mientras la marca esté puesta (ni el cron de corte ni un pago lo reactivan).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.servicios
                ADD COLUMN suspension_manual boolean NOT NULL DEFAULT false,
                ADD COLUMN suspension_manual_motivo text,
                ADD COLUMN suspension_manual_en timestamptz,
                ADD COLUMN suspension_manual_por bigint REFERENCES core.usuarios (id),
                ADD CONSTRAINT servicios_suspension_manual_motivo
                    CHECK (NOT suspension_manual OR suspension_manual_motivo IS NOT NULL);
            CREATE INDEX servicios_suspension_manual ON core.servicios (id) WHERE suspension_manual;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS core.servicios_suspension_manual;
            ALTER TABLE core.servicios
                DROP CONSTRAINT IF EXISTS servicios_suspension_manual_motivo,
                DROP COLUMN IF EXISTS suspension_manual_por,
                DROP COLUMN IF EXISTS suspension_manual_en,
                DROP COLUMN IF EXISTS suspension_manual_motivo,
                DROP COLUMN IF EXISTS suspension_manual;
        `)
    }
}
