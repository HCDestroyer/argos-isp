import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `notify.telegram_codigos`: estado `anulado` para los códigos de vinculación pendientes de un
 * cliente que desvinculó Telegram (`AnularCodigosTelegram`, pedido de A5). Sin esto, un enlace
 * viejo `t.me/<bot>?start=<código>` podía volver a vincular el chat hasta vencer.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE notify.telegram_codigos DROP CONSTRAINT telegram_codigos_estado_check;
            ALTER TABLE notify.telegram_codigos ADD CONSTRAINT telegram_codigos_estado_check
                CHECK (estado IN ('pendiente', 'usado', 'reemplazado', 'anulado'));
        `)
    }

    async down() {
        this.schema.raw(`
            UPDATE notify.telegram_codigos SET estado = 'reemplazado' WHERE estado = 'anulado';
            ALTER TABLE notify.telegram_codigos DROP CONSTRAINT telegram_codigos_estado_check;
            ALTER TABLE notify.telegram_codigos ADD CONSTRAINT telegram_codigos_estado_check
                CHECK (estado IN ('pendiente', 'usado', 'reemplazado'));
        `)
    }
}
