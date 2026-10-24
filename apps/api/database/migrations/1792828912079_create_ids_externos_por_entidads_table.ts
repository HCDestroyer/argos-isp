import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `Cliente.externo` y `Servicio.externo` (fila 60 de `a4.md`): las vistas buscan el id externo por
 * entidad (`entidad_tipo`, `entidad_id`) en cada fila; los índices únicos de la tabla empiezan por
 * `sistema` y no sirven para esa búsqueda.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(
            'CREATE INDEX ids_externos_por_entidad ON core.ids_externos (entidad_tipo, entidad_id, id)',
        )
    }

    async down() {
        this.schema.raw('DROP INDEX IF EXISTS core.ids_externos_por_entidad')
    }
}
