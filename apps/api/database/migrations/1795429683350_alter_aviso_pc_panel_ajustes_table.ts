import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Decisión 12 del PM: el aviso de pequeño contribuyente en el panel del dueño se enciende o apaga por
 * empresa (`aviso_pc_activo`, encendido de fábrica). Los umbrales no se guardan aquí: son el parámetro
 * fiscal `pc_alertas` de la empresa (80, 95 y 100 % de fábrica desde `gt-2026.5`), con su historial.
 * Aditivo: las filas que ya existen quedan con el aviso encendido.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.panel_ajustes
                ADD COLUMN IF NOT EXISTS aviso_pc_activo boolean NOT NULL DEFAULT true;
        `)
    }

    async down() {
        this.schema.raw(`ALTER TABLE billing.panel_ajustes DROP COLUMN IF EXISTS aviso_pc_activo;`)
    }
}
