import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Enlace de conexión con Horus (contrato `contratos/horus.md` §1.4, 1.5.0):
 *
 * - `anulado_en`: generar un enlace nuevo anula los anteriores sin usar (410 al canjearlos).
 * - `peticion_sha256` y `respuesta_cifrada`: la MISMA petición de canje repetida antes de que el
 *   enlace venza (un corte de red entre Horus y Argos) recibe la misma respuesta; cualquier otra
 *   con un código usado → 410. La respuesta lleva el `atk_` y el secreto del receptor: va cifrada
 *   (`app/shared/cifrado.ts`) y solo sirve mientras el enlace no vence.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE integraciones.horus_enlaces
                ADD COLUMN anulado_en timestamptz,
                ADD COLUMN peticion_sha256 text CHECK (peticion_sha256 IS NULL OR length(peticion_sha256) = 64),
                ADD COLUMN respuesta_cifrada text,
                ADD CONSTRAINT horus_enlaces_respuesta_con_uso
                    CHECK (respuesta_cifrada IS NULL OR (usado_en IS NOT NULL AND peticion_sha256 IS NOT NULL))
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE integraciones.horus_enlaces
                DROP CONSTRAINT IF EXISTS horus_enlaces_respuesta_con_uso,
                DROP COLUMN IF EXISTS respuesta_cifrada,
                DROP COLUMN IF EXISTS peticion_sha256,
                DROP COLUMN IF EXISTS anulado_en
        `)
    }
}
