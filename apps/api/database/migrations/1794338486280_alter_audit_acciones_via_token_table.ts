import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.7.0 (A23, actuación vinculada): un operador humano de Iris aprueba o rechaza un
 * comprobante como su usuario de Argos vinculado. La fila de `audit.acciones` queda con ese usuario
 * como actor (canal `api`) y `via_token_id` guarda la vía: el token del usuario técnico Iris con el
 * que llegó la petición (`core.tokens_api.id`). Columna nueva y nula: las filas existentes no se
 * tocan (la tabla es de solo inserción; sin llave foránea, igual que `actor_id`). Índice parcial
 * solo sobre las filas con vía.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE audit.acciones ADD COLUMN IF NOT EXISTS via_token_id bigint;
            CREATE INDEX IF NOT EXISTS acciones_via_token
                ON audit.acciones (via_token_id, created_at)
                WHERE via_token_id IS NOT NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS audit.acciones_via_token;
            ALTER TABLE audit.acciones DROP COLUMN IF EXISTS via_token_id;
        `)
    }
}
