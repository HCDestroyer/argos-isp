import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · inventario interno, fase C (`contratos/inventario.md` §5, decisión del líder): la salida
 * «premio» del kardex. Un bien del inventario entregado como premio de un sorteo (o, cuando se
 * habilite, de un canje en especie) sale con un movimiento `premio` a su costo y su asiento
 * `5.1.03 / 1.1.14`; anular la entrega lo reingresa con `reverso_premio`.
 *
 *  - `inventario.movimientos.tipo` admite `premio` y `reverso_premio`.
 *  - `inventario.unidades.estado` admite `entregada` (la unidad de serie que salió como premio).
 *  - `lealtad.sorteos_ganadores.movimiento_inventario_id`: el movimiento `premio` de la entrega.
 */
const TIPOS_ANTES = `'entrada_compra', 'reverso_compra', 'devolucion_proveedor', 'venta', 'reverso_venta', 'consumo',
                    'traslado', 'asignacion_comodato', 'devolucion_comodato', 'ajuste_conteo', 'ajuste', 'baja',
                    'saldo_inicial'`
const ESTADOS_ANTES = `'disponible', 'en_comodato', 'por_recuperar', 'en_reparacion', 'vendida', 'dada_de_baja',
                    'anulada', 'devuelta_proveedor'`

export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE inventario.movimientos
                DROP CONSTRAINT movimientos_tipo_check,
                ADD CONSTRAINT movimientos_tipo_check CHECK (tipo IN (${TIPOS_ANTES}, 'premio', 'reverso_premio'));
            ALTER TABLE inventario.unidades
                DROP CONSTRAINT unidades_estado_check,
                ADD CONSTRAINT unidades_estado_check CHECK (estado IN (${ESTADOS_ANTES}, 'entregada'));
            ALTER TABLE lealtad.sorteos_ganadores
                ADD COLUMN movimiento_inventario_id bigint REFERENCES inventario.movimientos (id);
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE lealtad.sorteos_ganadores DROP COLUMN IF EXISTS movimiento_inventario_id;
            ALTER TABLE inventario.unidades
                DROP CONSTRAINT unidades_estado_check,
                ADD CONSTRAINT unidades_estado_check CHECK (estado IN (${ESTADOS_ANTES})) NOT VALID;
            ALTER TABLE inventario.movimientos
                DROP CONSTRAINT movimientos_tipo_check,
                ADD CONSTRAINT movimientos_tipo_check CHECK (tipo IN (${TIPOS_ANTES})) NOT VALID;
        `)
    }
}
