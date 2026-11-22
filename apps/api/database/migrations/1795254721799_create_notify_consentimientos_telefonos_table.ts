import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A6 · permiso de contacto por WhatsApp **por número** (contrato Iris 0.10.0 §6.4 y §3.5, A42).
 *
 * `notify.consentimientos_iris.telefono` (E.164, opcional): el número de un contacto del cliente. Con
 * él, la marca va a Iris con `telefono` y la clave lleva el número
 * (`argos:consentimiento:<empresa_id>:<cliente_id>:whatsapp:<h>:<ocurrido_en>`, `<h>` = 16 hex del HMAC-SHA256 (contrato 0.12.1)
 * del número; nunca el número en claro): dos números
 * del mismo cliente en el mismo instante son dos permisos. No toca `notify.contacto_iris` (el estado
 * del cliente). Sale solo a un Iris con contrato ≥ 0.10.0.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE notify.consentimientos_iris
                ADD COLUMN telefono text CHECK (telefono IS NULL OR telefono ~ '^\\+[1-9][0-9]{7,14}$');
            CREATE INDEX consentimientos_iris_telefono ON notify.consentimientos_iris (cliente_id, telefono, id)
                WHERE telefono IS NOT NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS notify.consentimientos_iris_telefono;
            ALTER TABLE notify.consentimientos_iris DROP COLUMN IF EXISTS telefono;
        `)
    }
}
