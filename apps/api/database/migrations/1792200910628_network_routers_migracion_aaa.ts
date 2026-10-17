import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A2 (semana 3, tanda 2, tarea 3): cuándo pasó cada router al nuevo `aaa`.
 *
 * Tabla propia de A2 (no columna en `network.routers`, que es de A1): la escribe solo la acción
 * `routers.marcar_migrado` (`app/network/sesiones/actions/marcar_router_migrado.ts`).
 * `aaa_desde` null = el router volvió al RADIUS anterior (vuelta atrás del piloto).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE network.routers_migracion_aaa (
                router_id bigint PRIMARY KEY REFERENCES network.routers (id),
                aaa_desde timestamptz,
                motivo text NOT NULL,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            -- primer accounting del router (dato que acompaña la marca) y GET /sesiones?router_id=&desde=
            CREATE INDEX sesiones_router_inicio ON network.sesiones (router_id, inicio);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS network.sesiones_router_inicio;
            DROP TABLE IF EXISTS network.routers_migracion_aaa;
        `)
    }
}
