import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · línea mensual de los adicionales `cobrado` (contrato `adicionales.md`, «Para otros agentes»):
 * `billing.facturas_lineas.servicio_adicional_id` liga la línea a su asignación
 * (`core.servicios_adicionales`). Una asignación tiene a lo sumo una línea por factura; la factura es
 * única por `servicio_id-periodo` (`clave_unica`), así no se cobra dos veces el mismo periodo.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.facturas_lineas
                ADD COLUMN servicio_adicional_id bigint REFERENCES core.servicios_adicionales (id);
            CREATE UNIQUE INDEX facturas_lineas_adicional_unica
                ON billing.facturas_lineas (factura_id, servicio_adicional_id)
                WHERE servicio_adicional_id IS NOT NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS billing.facturas_lineas_adicional_unica;
            ALTER TABLE billing.facturas_lineas DROP COLUMN IF EXISTS servicio_adicional_id;
        `)
    }
}
