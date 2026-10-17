import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · semana 3: banco (institución) de cada banco del libro.
 *
 * `ledger.bancos` es la lista de bancos del libro que usan los egresos con `metodo: banco`.
 * Para que `GET /libro/bancos` diga de qué banco es cada uno, se enlaza (opcional) con el
 * catálogo `billing.bancos`. Las filas existentes quedan sin banco (null).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.bancos
                ADD COLUMN banco_id bigint REFERENCES billing.bancos (id);
        `)
    }

    async down() {
        this.schema.raw(`ALTER TABLE ledger.bancos DROP COLUMN IF EXISTS banco_id;`)
    }
}
