import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · importación completa (decisión del PM, 17 oct: "se debe traer todo"): promesas de pago
 * vigentes traídas de otro sistema (`ImportarPromesa`).
 *
 *  - `billing.promesas.origen` + `clave_externa` (el `id_externo` del contrato), únicos por par,
 *    como en facturas, pagos y saldos iniciales. Null en las promesas creadas por ArgosIsp.
 *
 * Las facturas de cargo único (sin servicio o sin periodo) no necesitan columnas nuevas: usan
 * `clave_unica = importada-<origen>:<id_externo>`, que nunca choca con `servicio_id-periodo`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.promesas
                ADD COLUMN origen text,
                ADD COLUMN clave_externa text,
                ADD CONSTRAINT promesas_origen CHECK (origen ~ '^[a-z0-9_]{1,40}$'),
                ADD CONSTRAINT promesas_origen_clave CHECK ((origen IS NULL) = (clave_externa IS NULL));
            CREATE UNIQUE INDEX promesas_origen_clave_externa ON billing.promesas (origen, clave_externa)
                WHERE clave_externa IS NOT NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS billing.promesas_origen_clave_externa;
            ALTER TABLE billing.promesas
                DROP CONSTRAINT IF EXISTS promesas_origen_clave,
                DROP CONSTRAINT IF EXISTS promesas_origen,
                DROP COLUMN IF EXISTS clave_externa,
                DROP COLUMN IF EXISTS origen;
        `)
    }
}
