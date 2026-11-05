import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.6.3, reconexión: un canje nuevo sobre un conector en uso no lo reemplaza al
 * momento. Queda **pendiente** en estas columnas hasta su primera llamada autenticada (entonces se
 * aplica y se revoca el `atk_` anterior); si se revoca o vence sin uso, se descarta y el conector
 * anterior sigue igual.
 *
 * - `pendiente_token_argos_id`: el `atk_` del canje pendiente.
 * - `pendiente_canjeado_en`: cuándo se canjeó (vence a las 24 h sin uso).
 * - `pendiente_secreto_cifrado`: el juego pendiente cifrado (`url_base`, `iris_pat_`, receptor de
 *   Iris y su secreto, secreto del receptor de Argos, `contrato`, `receptor_argos`). El nombre lleva
 *   `secreto` para que `audit.cambios` lo registre como `***`.
 *
 * Las tres van juntas (todas null o ninguna). Las filas existentes quedan sin pendiente.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE integraciones.iris_conector
                ADD COLUMN pendiente_token_argos_id bigint REFERENCES core.tokens_api (id),
                ADD COLUMN pendiente_canjeado_en timestamptz,
                ADD COLUMN pendiente_secreto_cifrado text,
                ADD CONSTRAINT iris_conector_pendiente CHECK (
                    (pendiente_token_argos_id IS NULL) = (pendiente_canjeado_en IS NULL)
                    AND (pendiente_token_argos_id IS NULL) = (pendiente_secreto_cifrado IS NULL)
                );
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE integraciones.iris_conector
                DROP CONSTRAINT IF EXISTS iris_conector_pendiente,
                DROP COLUMN IF EXISTS pendiente_secreto_cifrado,
                DROP COLUMN IF EXISTS pendiente_canjeado_en,
                DROP COLUMN IF EXISTS pendiente_token_argos_id;
        `)
    }
}
