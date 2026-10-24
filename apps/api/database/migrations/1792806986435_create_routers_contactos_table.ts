import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Último contacto de cada router (pedido de A4, `a4.md`: `Router.en_linea` y `ultimo_contacto`).
 * Telemetría, no una entidad: una fila por router con la última vez que el equipo habló con Argos
 * por una fuente periódica (accounting RADIUS, sondeo de la API REST). La escribe
 * `registrarContactoRouter` (`app/network/contacto_router.ts`), que llaman las acciones de
 * accounting y RouterOS (A2) dentro de su transacción. Sin fila = nadie lo mide: `en_linea` null.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE network.routers_contacto (
                router_id bigint PRIMARY KEY REFERENCES network.routers (id),
                ultimo_contacto timestamptz NOT NULL,
                fuente text NOT NULL CHECK (fuente IN ('accounting', 'routeros', 'sondeo')),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS network.routers_contacto')
    }
}
