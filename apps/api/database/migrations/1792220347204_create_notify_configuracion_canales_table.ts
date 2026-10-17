import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * notify: configuración de los canales de notificación desde el panel (contrato
 * `contratos/multiempresa.md`, "Configuración de canales de notificación").
 *
 *  - `configuracion_canales`: una fila **global** (`empresa_id` nulo) y, opcional, una por
 *    empresa. La de una empresa con `hereda = true` (por defecto) no se usa: manda la global.
 *    - Correo (SMTP): host, puerto, TLS, usuario, contraseña cifrada, remitente y nombre visible.
 *    - Telegram: token cifrado, id del bot (público, sale del token), nombre del bot, chat del
 *      equipo y secreto del webhook cifrado.
 *    - Interruptores: correo, Telegram a clientes y Telegram de alertas al equipo; `avisos`
 *      (tipo de aviso → encendido; una clave ausente es encendido).
 *    - Secretos con `app/shared/cifrado.ts` (`v1.<iv>.<tag>.<datos>`, clave `AAA_PPP_KEY`).
 *  - `empresa_id` queda **nulable y sin FK** hasta que exista `core.empresas` (A1); una
 *    migración posterior agrega la FK.
 *  - `envios`: estado `omitido` (canal o tipo de aviso apagado), su `motivo` y la `empresa_id`
 *    cuya configuración se aplicó.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE notify.configuracion_canales (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint,
                hereda boolean NOT NULL DEFAULT true,

                correo_activo boolean NOT NULL DEFAULT true,
                smtp_host text,
                smtp_puerto integer CHECK (smtp_puerto BETWEEN 1 AND 65535),
                smtp_tls text NOT NULL DEFAULT 'auto'
                    CHECK (smtp_tls IN ('auto', 'starttls', 'tls', 'ninguno')),
                smtp_usuario text,
                smtp_password_cifrada text,
                correo_remitente text,
                correo_nombre text,

                telegram_clientes_activo boolean NOT NULL DEFAULT true,
                telegram_alertas_activo boolean NOT NULL DEFAULT true,
                telegram_token_cifrado text,
                telegram_bot_id text,
                telegram_bot_nombre text,
                telegram_chat_equipo text,
                telegram_webhook_secreto_cifrado text,

                avisos jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(avisos) = 'object'),
                sembrada_desde_entorno boolean NOT NULL DEFAULT false,

                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),

                -- la global no hereda de nadie
                CHECK (empresa_id IS NOT NULL OR hereda = false),
                CHECK ((telegram_token_cifrado IS NULL) = (telegram_bot_id IS NULL))
            );
            CREATE UNIQUE INDEX configuracion_canales_global
                ON notify.configuracion_canales ((empresa_id IS NULL)) WHERE empresa_id IS NULL;
            CREATE UNIQUE INDEX configuracion_canales_empresa
                ON notify.configuracion_canales (empresa_id) WHERE empresa_id IS NOT NULL;
            CREATE INDEX configuracion_canales_bot ON notify.configuracion_canales (telegram_bot_id)
                WHERE telegram_bot_id IS NOT NULL;

            ALTER TABLE notify.envios ADD COLUMN empresa_id bigint;
            ALTER TABLE notify.envios ADD COLUMN motivo text;
            ALTER TABLE notify.envios DROP CONSTRAINT envios_estado_check;
            ALTER TABLE notify.envios ADD CONSTRAINT envios_estado_check
                CHECK (estado IN ('encolado', 'enviado', 'fallido', 'omitido'));
        `)
    }

    async down() {
        this.schema.raw(`
            DELETE FROM notify.envios WHERE estado = 'omitido';
            ALTER TABLE notify.envios DROP CONSTRAINT envios_estado_check;
            ALTER TABLE notify.envios ADD CONSTRAINT envios_estado_check
                CHECK (estado IN ('encolado', 'enviado', 'fallido'));
            ALTER TABLE notify.envios DROP COLUMN motivo;
            ALTER TABLE notify.envios DROP COLUMN empresa_id;
            DROP TABLE IF EXISTS notify.configuracion_canales;
        `)
    }
}
