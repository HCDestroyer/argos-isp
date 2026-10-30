import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Conectar Iris con un botón (contrato Iris 0.4.0, §1.4): el código de conexión que crea
 * `POST /integraciones/iris/autorizar` es el mismo de §1.3 (`integraciones.iris_enlaces`), ligado
 * además al PKCE de Iris y a su origen.
 *
 * - `code_challenge`: `base64url(SHA-256(code_verifier))` (S256). Con valor, el canje exige el
 *   `code_verifier`; null en los enlaces de §1.3, que no lo piden.
 * - `origen_iris`: origen de Iris aprobado por el admin (`https://host[:puerto]`), a donde se
 *   redirigió con el código.
 * - `rechazado_en`: el canje llegó sin verifier o con uno que no coincide; el código queda gastado.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE integraciones.iris_enlaces
                ADD COLUMN code_challenge text,
                ADD COLUMN origen_iris text,
                ADD COLUMN rechazado_en timestamptz,
                ADD CONSTRAINT iris_enlaces_code_challenge_check
                    CHECK (code_challenge IS NULL OR code_challenge ~ '^[A-Za-z0-9_-]{43}$');
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE integraciones.iris_enlaces
                DROP CONSTRAINT IF EXISTS iris_enlaces_code_challenge_check,
                DROP COLUMN IF EXISTS rechazado_en,
                DROP COLUMN IF EXISTS origen_iris,
                DROP COLUMN IF EXISTS code_challenge;
        `)
    }
}
