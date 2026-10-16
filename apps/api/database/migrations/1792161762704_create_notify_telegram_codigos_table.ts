import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * notify (A6, semana 2): códigos de vinculación del bot de Telegram (`contratos/telegram.md`).
 *
 * El portal (A5) pide un código para el cliente con su sesión (`GenerarCodigoTelegram`); el
 * cliente abre `t.me/<bot>?start=<código>` y el webhook del bot lo canjea (`CanjearCodigoTelegram`),
 * que llama `VincularTelegramCliente` de A1. Solo se guarda el SHA-256 del código.
 *
 *  - `pendiente`: vigente hasta `vence_en`. Solo uno pendiente por cliente (pedir otro reemplaza).
 *  - `usado`: canjeado por `chat_id` en `usado_en`. Canjear de nuevo desde el mismo chat responde
 *    lo mismo (Telegram reintenta el webhook); desde otro chat es inválido.
 *  - `reemplazado`: el cliente pidió otro código antes de usar este.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE notify.telegram_codigos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                codigo_hash text NOT NULL UNIQUE,
                estado text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'usado', 'reemplazado')),
                vence_en timestamptz NOT NULL,
                usado_en timestamptz,
                chat_id text,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((estado = 'usado') = (usado_en IS NOT NULL AND chat_id IS NOT NULL))
            );
            CREATE UNIQUE INDEX telegram_codigos_pendiente_unico
                ON notify.telegram_codigos (cliente_id) WHERE estado = 'pendiente';
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS notify.telegram_codigos;`)
    }
}
