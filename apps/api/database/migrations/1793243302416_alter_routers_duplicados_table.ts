import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Routers duplicados (pedido del PM, 29 oct; `contratos/routers.md`):
 * - `serial`: número de serie del equipo (`/system/routerboard` `serial-number`) o, en un CHR,
 *   `software-id` de `/system/license`. Lo escribe el sondeo; null = no se conoce. Sin UNIQUE: dos
 *   registros que ya existen con el mismo serial se detectan (`GET /routers/duplicados`) y se unen.
 * - `unido_a_id`: el router que lo absorbió (`routers.unir`). Un router unido queda inactivo y el
 *   dispatcher de RouterOS ya no limpia en él: es el mismo equipo que el que queda.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.routers
                ADD COLUMN serial text,
                ADD COLUMN unido_a_id bigint REFERENCES network.routers (id),
                ADD COLUMN unido_en timestamptz,
                ADD CONSTRAINT routers_unido_a_otro CHECK (unido_a_id IS NULL OR unido_a_id <> id);
            CREATE INDEX routers_serial ON network.routers (lower(serial)) WHERE serial IS NOT NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS network.routers_serial;
            ALTER TABLE network.routers
                DROP CONSTRAINT IF EXISTS routers_unido_a_otro,
                DROP COLUMN IF EXISTS unido_en,
                DROP COLUMN IF EXISTS unido_a_id,
                DROP COLUMN IF EXISTS serial;
        `)
    }
}
