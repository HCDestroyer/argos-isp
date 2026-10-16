import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Vinculación de Telegram desde el portal (A5, semana 2). Contrato en
 * `.claude/integration/contratos/telegram.md`.
 *
 * `core.portal_vinculos_telegram`: código de un solo uso que el portal pone en el enlace profundo
 * `https://t.me/<bot>?start=<código>`. Solo se guarda `sha256(código)`. Un código nuevo del mismo
 * cliente reemplaza a los anteriores sin usar (`reemplazado_en`). Al canjearlo el bot de A6 se
 * guarda el `chat_id` que lo usó (para responder igual si Telegram reintenta el mismo update).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.portal_vinculos_telegram (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                codigo_hash text NOT NULL UNIQUE,
                sesion_id bigint REFERENCES core.portal_sesiones (id),
                expira_en timestamptz NOT NULL,
                usado_en timestamptz,
                chat_id text,
                reemplazado_en timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((usado_en IS NULL) = (chat_id IS NULL))
            );
            CREATE INDEX portal_vinculos_telegram_cliente
                ON core.portal_vinculos_telegram (cliente_id, created_at DESC);
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.portal_vinculos_telegram')
    }
}
