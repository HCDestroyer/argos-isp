import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · semana 2: plantilla de facturación por defecto (pedido de A1 y A4). Un servicio creado sin
 * `plantilla_facturacion_id` usa la marcada. A lo sumo una con `por_defecto = true` (índice único
 * parcial). Si hoy existe una sola plantilla, queda marcada para no cambiar el comportamiento.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.plantillas_facturacion
                ADD COLUMN por_defecto boolean NOT NULL DEFAULT false;
            CREATE UNIQUE INDEX plantillas_facturacion_por_defecto
                ON billing.plantillas_facturacion (por_defecto) WHERE por_defecto;
            UPDATE billing.plantillas_facturacion SET por_defecto = true
             WHERE (SELECT count(*) FROM billing.plantillas_facturacion) = 1;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS billing.plantillas_facturacion_por_defecto;
            ALTER TABLE billing.plantillas_facturacion DROP COLUMN IF EXISTS por_defecto;
        `)
    }
}
