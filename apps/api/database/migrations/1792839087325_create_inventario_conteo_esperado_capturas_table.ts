import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · inventario, fase C (H56, decisión del líder): cada línea de un conteo guarda lo esperado **al
 * capturarla** (cantidad y valor de la bodega; por serie, las unidades que había) y el último movimiento
 * del producto en la bodega a ese momento. Al cerrar, la diferencia es contado − esperado al capturar;
 * lo que se movió después de la captura ya está en el kardex y no es faltante ni sobrante.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE inventario.conteo_lineas
                ADD COLUMN esperado_captura numeric(14, 3),
                ADD COLUMN valor_captura numeric(14, 2),
                ADD COLUMN unidades_captura jsonb CHECK (unidades_captura IS NULL OR jsonb_typeof(unidades_captura) = 'array'),
                ADD COLUMN ultimo_movimiento_id bigint,
                ADD COLUMN capturado_en timestamptz;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE inventario.conteo_lineas
                DROP COLUMN IF EXISTS esperado_captura,
                DROP COLUMN IF EXISTS valor_captura,
                DROP COLUMN IF EXISTS unidades_captura,
                DROP COLUMN IF EXISTS ultimo_movimiento_id,
                DROP COLUMN IF EXISTS capturado_en;
        `)
    }
}
