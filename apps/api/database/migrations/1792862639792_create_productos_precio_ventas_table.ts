import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Pedido de A4 (inventario, cargo único): precio de venta sugerido del producto, opcional. Es el
 * precio al cliente con IVA incluido, como el de los planes y los cargos; el cargo único lo propone
 * y se puede cambiar. La edición va con `version` y `audit.cambios` (`productos.editar`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE inventario.productos ADD COLUMN precio_venta numeric(14, 2)
                CONSTRAINT productos_precio_venta CHECK (precio_venta IS NULL OR precio_venta >= 0);
            COMMENT ON COLUMN inventario.productos.precio_venta IS
                'Precio de venta sugerido (IVA incluido) para el cargo único; null = sin precio sugerido';
        `)
    }

    async down() {
        this.schema.raw(`ALTER TABLE inventario.productos DROP COLUMN IF EXISTS precio_venta;`)
    }
}
