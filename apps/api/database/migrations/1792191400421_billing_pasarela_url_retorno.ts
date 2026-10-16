import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · semana 3: URL de retorno del pago en línea.
 *
 * - `billing.pasarela_cobros.url_retorno`: adonde el proveedor devuelve al cliente al terminar
 *   (ya validada contra `PASARELA_RETORNO_ORIGENES` y con `{cobro_id}` resuelto).
 * - `billing.pasarela_falsa.url_retorno`: el "lado del proveedor" de la pasarela falsa la guarda
 *   como lo haría un proveedor real (`return_url`) y su página responde 303 ahí.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.pasarela_cobros ADD COLUMN url_retorno text;
            ALTER TABLE billing.pasarela_falsa ADD COLUMN url_retorno text;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.pasarela_falsa DROP COLUMN IF EXISTS url_retorno;
            ALTER TABLE billing.pasarela_cobros DROP COLUMN IF EXISTS url_retorno;
        `)
    }
}
