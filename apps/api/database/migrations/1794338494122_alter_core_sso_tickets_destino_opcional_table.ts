import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.7.0 (A23, «Vincular mi usuario de Argos»): un ticket de autologin de Iris puede
 * no llevar destino; el canje lleva entonces al inicio del panel. `destino_tipo` y
 * `destino_id_externo` aceptan null, pero los dos juntos (o los dos con valor) y solo con el
 * conector `iris`: los tickets de Horus siguen exigiendo destino.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.sso_tickets
                ALTER COLUMN destino_tipo DROP NOT NULL,
                ALTER COLUMN destino_id_externo DROP NOT NULL,
                ADD CONSTRAINT sso_tickets_destino_opcional CHECK (
                    (destino_tipo IS NULL) = (destino_id_externo IS NULL)
                    AND (destino_tipo IS NOT NULL OR conector = 'iris')
                );
        `)
    }

    async down() {
        // Sin volver a NOT NULL: los tickets sin destino ya emitidos quedarían inválidos (y una
        // vinculación puede apuntar a ellos). Solo se quita la restricción nueva.
        this.schema.raw(
            `ALTER TABLE core.sso_tickets DROP CONSTRAINT IF EXISTS sso_tickets_destino_opcional;`,
        )
    }
}
