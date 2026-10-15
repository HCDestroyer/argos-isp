import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * notify (A6): configuración de los recordatorios de pago (hasta tres).
 *
 *  - `dias`: días respecto al vencimiento de la factura (negativo = antes, 0 = el día, positivo = después).
 *  - `hora`: hora local de America/Guatemala a la que se envía.
 *  - La plantilla de cada uno es `notify.plantillas` con evento `recordatorio.<orden>`.
 *
 * Las filas iniciales las crea el seeder `notify_plantillas_seeder` (no pisa ediciones).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE notify.recordatorios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                orden smallint NOT NULL UNIQUE CHECK (orden BETWEEN 1 AND 3),
                dias integer NOT NULL CHECK (dias BETWEEN -60 AND 60),
                hora time NOT NULL DEFAULT '09:00',
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS notify.recordatorios;`)
    }
}
