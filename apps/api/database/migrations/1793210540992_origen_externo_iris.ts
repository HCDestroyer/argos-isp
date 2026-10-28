import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Pedidos A3 y A4 de Iris (`contratos/iris.md` §5.1): la orden de trabajo de Iris que originó un
 * movimiento del kardex (consumo, comodato, devolución) o un cargo único.
 *
 * - Columnas propias `origen_externo_tipo` + `origen_externo_id` (texto: el id de la orden de Iris es
 *   un UUID), no el `origen_tipo`/`origen_id` del movimiento: ese par es interno (compra, factura,
 *   conteo, nota_credito, sorteo_ganador…), su id es `bigint` y el auditor lo cruza con otras tablas.
 * - Solo trazabilidad: ningún asiento, saldo ni costo cambia. Las filas viejas quedan en null.
 * - `origen_externo_tipo` admite `iris_orden`; un origen nuevo amplía el CHECK con otra migración.
 */
const TABLAS = ['inventario.movimientos', 'billing.facturas', 'billing.bonificaciones'] as const

export default class extends BaseSchema {
    async up() {
        for (const tabla of TABLAS) {
            const nombre = tabla.split('.')[1]
            this.schema.raw(`
                ALTER TABLE ${tabla}
                    ADD COLUMN origen_externo_tipo text,
                    ADD COLUMN origen_externo_id text,
                    ADD CONSTRAINT ${nombre}_origen_externo_tipo CHECK (origen_externo_tipo IN ('iris_orden')),
                    ADD CONSTRAINT ${nombre}_origen_externo_par
                        CHECK ((origen_externo_tipo IS NULL) = (origen_externo_id IS NULL)),
                    ADD CONSTRAINT ${nombre}_origen_externo_id
                        CHECK (origen_externo_id IS NULL OR length(origen_externo_id) BETWEEN 1 AND 100);
                CREATE INDEX ${nombre}_origen_externo ON ${tabla} (origen_externo_tipo, origen_externo_id)
                    WHERE origen_externo_tipo IS NOT NULL;
                COMMENT ON COLUMN ${tabla}.origen_externo_tipo IS
                    'Sistema externo que originó el registro (iris_orden = orden de trabajo de Iris); solo trazabilidad';
                COMMENT ON COLUMN ${tabla}.origen_externo_id IS
                    'Id del registro en el sistema externo (UUID de la orden de Iris)';
            `)
        }
    }

    async down() {
        for (const tabla of TABLAS) {
            const nombre = tabla.split('.')[1]
            this.schema.raw(`
                DROP INDEX IF EXISTS ${tabla.split('.')[0]}.${nombre}_origen_externo;
                ALTER TABLE ${tabla}
                    DROP CONSTRAINT IF EXISTS ${nombre}_origen_externo_id,
                    DROP CONSTRAINT IF EXISTS ${nombre}_origen_externo_par,
                    DROP CONSTRAINT IF EXISTS ${nombre}_origen_externo_tipo,
                    DROP COLUMN IF EXISTS origen_externo_id,
                    DROP COLUMN IF EXISTS origen_externo_tipo;
            `)
        }
    }
}
