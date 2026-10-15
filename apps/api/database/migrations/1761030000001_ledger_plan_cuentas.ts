import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · tarea 1: columnas del plan de cuentas.
 *
 *  - `cuentas.imputable`: solo las cuentas hoja reciben movimientos; las de agrupación (Activo,
 *    Cajas, Bancos…) no.
 *  - `cuentas.auxiliar_cliente`: la cuenta lleva auxiliar por cliente (CxC, Anticipos); todo
 *    movimiento en ella exige `cliente_id`. El saldo del cliente es la suma de su auxiliar.
 *  - `egresos_categorias.cuenta_id`: cuenta de gasto a la que va cada categoría de egreso.
 *
 * El contenido del plan lo siembra `database/seeders/plan_cuentas_seeder.ts`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.cuentas
                ADD COLUMN imputable boolean NOT NULL DEFAULT true,
                ADD COLUMN auxiliar_cliente boolean NOT NULL DEFAULT false;

            ALTER TABLE ledger.egresos_categorias
                ADD COLUMN cuenta_id bigint REFERENCES ledger.cuentas (id);
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE ledger.egresos_categorias DROP COLUMN IF EXISTS cuenta_id;
            ALTER TABLE ledger.cuentas
                DROP COLUMN IF EXISTS auxiliar_cliente,
                DROP COLUMN IF EXISTS imputable;
        `)
    }
}
