import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.14.3 §12.2: con un Iris ≥ 0.14.3 la unidad del inventario se valida al aceptar el
 * aprovisionamiento (bodega personal o de cuadrilla del técnico vinculado, o ya asignada al servicio) y
 * el comodato sale después de esa bodega, sin volver a mirar el actor de Iris (con la orden cerrada lo
 * pide un agente, no el técnico). `bodega_id` guarda esa bodega; null = reglas anteriores.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`ALTER TABLE integraciones.aprovisionamientos ADD COLUMN bodega_id bigint`)
    }

    async down() {
        this.schema.raw(`ALTER TABLE integraciones.aprovisionamientos DROP COLUMN IF EXISTS bodega_id`)
    }
}
