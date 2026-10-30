import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Coordenadas del router (contrato Iris 0.3.1, §2.1: factibilidad desde el catálogo de routers).
 * Igual que `core.clientes` y `core.servicios`: una columna `coordenadas text` `"lat,lng"` con un CHECK
 * de formato. El rango (latitud −90…90, longitud −180…180) lo valida VineJS (`coordenadasEnRango`).
 * No son `numeric`: toda columna `numeric` del modelo es dinero (`numeric(14,2)`, prueba del auditor).
 *
 * Sin `?` en la expresión regular: en `schema.raw` knex los toma como parámetros (ver
 * `1761000100001_corregir_coordenadas.ts`).
 */
const PATRON = `'^-{0,1}[0-9]+([.][0-9]+){0,1}, {0,1}-{0,1}[0-9]+([.][0-9]+){0,1}$'`

export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.routers
                ADD COLUMN coordenadas text,
                ADD CONSTRAINT routers_coordenadas_check CHECK (coordenadas ~ ${PATRON});
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE network.routers
                DROP CONSTRAINT IF EXISTS routers_coordenadas_check,
                DROP COLUMN IF EXISTS coordenadas;
        `)
    }
}
