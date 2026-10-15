import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Corrige el CHECK de `coordenadas` en `core.clientes` y `core.servicios`: en `schema.raw` knex
 * tomó los `?` de la expresión regular como parámetros y la restricción quedó como
 * `'^-$1[0-9]+...'`, que rechaza toda coordenada. Aquí se reescribe sin `?` (`{0,1}`).
 */
const PATRON = `'^-{0,1}[0-9]+([.][0-9]+){0,1}, {0,1}-{0,1}[0-9]+([.][0-9]+){0,1}$'`

export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.clientes DROP CONSTRAINT IF EXISTS clientes_coordenadas_check;
            ALTER TABLE core.clientes ADD CONSTRAINT clientes_coordenadas_check CHECK (coordenadas ~ ${PATRON});
            ALTER TABLE core.servicios DROP CONSTRAINT IF EXISTS servicios_coordenadas_check;
            ALTER TABLE core.servicios ADD CONSTRAINT servicios_coordenadas_check CHECK (coordenadas ~ ${PATRON});
        `)
    }

    async down() {
        // La restricción original nunca aceptó coordenadas válidas: se deja la corregida.
    }
}
