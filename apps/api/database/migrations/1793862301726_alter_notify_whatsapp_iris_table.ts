import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Canal WhatsApp de notify por la mensajería de Iris (contrato Iris 0.6.0 §6, pedido A21; A6).
 *
 * - `notify.configuracion_canales.whatsapp_activo`: interruptor por configuración (global o de la
 *   empresa, con la misma herencia que correo y Telegram). Apagado por defecto: sin él, nada sale
 *   por WhatsApp aunque el conector Iris esté activo.
 * - `notify.envios.entregado_en` / `leido_en`: acuse de Iris (`aviso.entregado`, §6.6).
 * - `notify.consentimientos_iris`: cola de permisos de contacto hacia Iris
 *   (`POST /mensajeria/consentimientos`, §6.4). El registro vive solo en Iris; esta tabla es la
 *   cola de entrega (sale al activarse el conector) con su `Idempotency-Key`.
 * - `notify.contacto_iris`: último estado de contacto que Iris informó por `contacto.baja` (o que
 *   Argos mandó después con un alta): con `baja`, notify deja de pedir avisos por WhatsApp a ese
 *   cliente. Es una copia de lo que decidió Iris, no un registro propio.
 * - `integraciones.iris_recibidos`: webhooks Iris → Argos (§6.6), deduplicados por `X-Webhook-Id`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE notify.configuracion_canales
                ADD COLUMN whatsapp_activo boolean NOT NULL DEFAULT false;

            ALTER TABLE notify.envios
                ADD COLUMN entregado_en timestamptz,
                ADD COLUMN leido_en timestamptz;
            CREATE INDEX envios_whatsapp_en_cola ON notify.envios (created_at)
                WHERE canal = 'whatsapp' AND estado = 'encolado' AND proveedor_id IS NOT NULL;

            CREATE TABLE notify.consentimientos_iris (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                canal text NOT NULL CHECK (canal IN ('whatsapp')),
                estado text NOT NULL CHECK (estado IN ('acepta', 'baja')),
                origen text NOT NULL CHECK (origen IN ('argos_panel', 'argos_portal')),
                ocurrido_en timestamptz NOT NULL,
                idempotency_key text NOT NULL UNIQUE,
                entrega text NOT NULL DEFAULT 'pendiente'
                    CHECK (entrega IN ('pendiente', 'enviado', 'fallido')),
                intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
                proximo_intento_en timestamptz NOT NULL DEFAULT now(),
                ultimo_status integer,
                ultimo_error text,
                enviado_en timestamptz,
                registrado_por bigint REFERENCES core.usuarios (id),
                request_id text,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX consentimientos_iris_pendientes ON notify.consentimientos_iris (proximo_intento_en)
                WHERE entrega = 'pendiente';
            CREATE INDEX consentimientos_iris_cliente ON notify.consentimientos_iris (cliente_id, id);

            CREATE TABLE notify.contacto_iris (
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                canal text NOT NULL CHECK (canal IN ('whatsapp', 'telegram', 'correo')),
                estado text NOT NULL CHECK (estado IN ('acepta', 'baja')),
                ocurrido_en timestamptz NOT NULL,
                origen text NOT NULL,
                empresa_id bigint REFERENCES core.empresas (id),
                webhook_id text,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (cliente_id, canal)
            );

            CREATE TABLE integraciones.iris_recibidos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                webhook_id text NOT NULL UNIQUE,
                evento text NOT NULL,
                ocurrido_en timestamptz,
                estado text NOT NULL CHECK (estado IN ('procesado', 'ignorado')),
                resultado text,
                empresa_id bigint REFERENCES core.empresas (id),
                cliente_id bigint REFERENCES core.clientes (id),
                envio_id bigint,
                cuerpo jsonb NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX iris_recibidos_evento ON integraciones.iris_recibidos (evento, id);

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON notify.consentimientos_iris TO argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON notify.contacto_iris TO argosisp_app;
                    GRANT SELECT, INSERT ON integraciones.iris_recibidos TO argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA notify TO argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA integraciones TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS integraciones.iris_recibidos;
            DROP TABLE IF EXISTS notify.contacto_iris;
            DROP TABLE IF EXISTS notify.consentimientos_iris;
            DROP INDEX IF EXISTS notify.envios_whatsapp_en_cola;
            ALTER TABLE notify.envios DROP COLUMN IF EXISTS entregado_en, DROP COLUMN IF EXISTS leido_en;
            ALTER TABLE notify.configuracion_canales DROP COLUMN IF EXISTS whatsapp_activo;
        `)
    }
}
