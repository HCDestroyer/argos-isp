import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Zona del router (pedido del PM, 28 oct: editar router desde el panel). Opcional: un router puede
 * atender varias zonas; esta es la que el panel muestra y por la que se agrupa. No cambia el alcance
 * del ACL (los routers siguen limitándose por `router`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.routers ADD COLUMN zona_id bigint REFERENCES core.zonas (id);
            CREATE INDEX routers_zona ON network.routers (zona_id) WHERE zona_id IS NOT NULL;
        `)
    }

    async down() {
        this.schema.raw('ALTER TABLE network.routers DROP COLUMN IF EXISTS zona_id')
    }
}
