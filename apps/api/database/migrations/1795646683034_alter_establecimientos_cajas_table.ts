import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Establecimientos según la SAT con la decisión del PM P1 (`contratos/fel-establecimientos.md`
 * lote 4, 25-nov-2026): la factura sale de la sucursal de la caja que la cobra.
 *
 * - `fiscal.establecimientos.codigo_postal` (5 dígitos, del RTU; null = 01001 en el DTE).
 * - `ledger.cajas.establecimiento_id`: la sucursal de cada caja (se asigna desde el
 *   establecimiento, `cajas[]`). Reemplaza la tabla de zonas que proponía el plan.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE fiscal.establecimientos
                ADD COLUMN codigo_postal text
                    CONSTRAINT establecimientos_codigo_postal CHECK (codigo_postal ~ '^[0-9]{5}$');
            ALTER TABLE ledger.cajas
                ADD COLUMN establecimiento_id bigint REFERENCES fiscal.establecimientos (id);
            CREATE INDEX cajas_establecimiento ON ledger.cajas (establecimiento_id);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS ledger.cajas_establecimiento;
            ALTER TABLE ledger.cajas DROP COLUMN IF EXISTS establecimiento_id;
            ALTER TABLE fiscal.establecimientos DROP COLUMN IF EXISTS codigo_postal;
        `)
    }
}
