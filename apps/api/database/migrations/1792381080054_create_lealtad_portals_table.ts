import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · lealtad en el portal (decisión del PM): dos interruptores del programa por empresa.
 *
 * - `visible_portal`: el cliente ve sus puntos en el portal (por defecto no).
 * - `canje_portal`: el cliente canjea desde el portal; solo con `visible_portal` (por defecto no).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE lealtad.programas
                ADD COLUMN visible_portal boolean NOT NULL DEFAULT false,
                ADD COLUMN canje_portal boolean NOT NULL DEFAULT false,
                ADD CONSTRAINT programas_canje_portal CHECK (NOT canje_portal OR visible_portal);
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE lealtad.programas
                DROP CONSTRAINT IF EXISTS programas_canje_portal,
                DROP COLUMN IF EXISTS canje_portal,
                DROP COLUMN IF EXISTS visible_portal;
        `)
    }
}
