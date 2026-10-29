import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Coordenadas del router (contrato Iris 0.3.1, §2.1: factibilidad desde el catálogo de routers).
 * Opcionales y en pareja: o las dos o ninguna. Grados decimales WGS84 con 6 decimales (~10 cm).
 * La API las muestra como `coordenadas: "lat,lng"`, igual que clientes y servicios.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.routers
                ADD COLUMN latitud numeric(9, 6),
                ADD COLUMN longitud numeric(9, 6),
                ADD CONSTRAINT routers_latitud_rango CHECK (latitud BETWEEN -90 AND 90),
                ADD CONSTRAINT routers_longitud_rango CHECK (longitud BETWEEN -180 AND 180),
                ADD CONSTRAINT routers_coordenadas_pareja CHECK ((latitud IS NULL) = (longitud IS NULL));
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE network.routers
                DROP CONSTRAINT IF EXISTS routers_coordenadas_pareja,
                DROP CONSTRAINT IF EXISTS routers_longitud_rango,
                DROP CONSTRAINT IF EXISTS routers_latitud_rango,
                DROP COLUMN IF EXISTS longitud,
                DROP COLUMN IF EXISTS latitud;
        `)
    }
}
