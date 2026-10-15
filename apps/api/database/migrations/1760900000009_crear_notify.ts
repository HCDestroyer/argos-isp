import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Schema `notify`: plantillas de notificación y registro de envíos.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE notify.plantillas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                evento text NOT NULL,
                canal text NOT NULL CHECK (canal IN ('correo', 'telegram', 'whatsapp')),
                asunto text,
                cuerpo text NOT NULL,
                activa boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (evento, canal)
            );

            CREATE TABLE notify.envios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint REFERENCES core.clientes (id),
                evento text NOT NULL,
                canal text NOT NULL CHECK (canal IN ('correo', 'telegram', 'whatsapp')),
                destino text NOT NULL,
                estado text NOT NULL DEFAULT 'encolado' CHECK (estado IN ('encolado', 'enviado', 'fallido')),
                error text,
                enviado_en timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX envios_cliente ON notify.envios (cliente_id);
            CREATE INDEX envios_encolados ON notify.envios (created_at) WHERE estado = 'encolado';
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS notify.envios;
            DROP TABLE IF EXISTS notify.plantillas;
        `)
    }
}
