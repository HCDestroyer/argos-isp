import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * notify (A6): columnas para entregar, reintentar y deduplicar envíos.
 *
 *  - `origen`: qué produjo el envío (`outbox:<id>` para eventos, `recordatorio:...`, `alerta:...`).
 *    Con `(origen, cliente_id, canal)` único, un evento entregado dos veces no notifica dos veces.
 *  - `asunto`, `cuerpo`: el mensaje ya renderizado (lo que se envió de verdad).
 *  - `variables`: snapshot de las variables de la plantilla (para el fallback a correo).
 *  - `intentos`, `proveedor_id` (Message-ID SMTP, `chat:message_id` de Telegram).
 *  - `fallback_de`: envío de otro canal que falló y originó este por correo.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE notify.envios
                ADD COLUMN origen text,
                ADD COLUMN asunto text,
                ADD COLUMN cuerpo text,
                ADD COLUMN variables jsonb NOT NULL DEFAULT '{}'::jsonb,
                ADD COLUMN intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
                ADD COLUMN proveedor_id text,
                ADD COLUMN fallback_de bigint REFERENCES notify.envios (id),
                ADD COLUMN request_id text;
            UPDATE notify.envios SET origen = 'legado:' || id WHERE origen IS NULL;
            ALTER TABLE notify.envios ALTER COLUMN origen SET NOT NULL;

            CREATE UNIQUE INDEX envios_origen_unico
                ON notify.envios (origen, cliente_id, canal) NULLS NOT DISTINCT;
            CREATE INDEX envios_evento ON notify.envios (evento, created_at);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS notify.envios_evento;
            DROP INDEX IF EXISTS notify.envios_origen_unico;
            ALTER TABLE notify.envios
                DROP COLUMN IF EXISTS request_id,
                DROP COLUMN IF EXISTS fallback_de,
                DROP COLUMN IF EXISTS proveedor_id,
                DROP COLUMN IF EXISTS intentos,
                DROP COLUMN IF EXISTS variables,
                DROP COLUMN IF EXISTS cuerpo,
                DROP COLUMN IF EXISTS asunto,
                DROP COLUMN IF EXISTS origen;
        `)
    }
}
