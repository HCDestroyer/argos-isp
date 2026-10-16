import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Acceso del cliente al portal (A5, tarea 7): códigos de verificación y sesiones del portal.
 *
 * - `core.portal_codigos`: código de 6 dígitos enviado al correo o Telegram REGISTRADO del
 *   cliente. Solo se guarda el hash (HMAC-SHA256 con APP_KEY), nunca el código. `solicitud` es el
 *   identificador opaco que el portal devuelve en la verificación. Un código nuevo reemplaza a
 *   los anteriores sin usar (`reemplazado_en`).
 * - `core.portal_sesiones`: token opaco (solo su hash SHA-256) que viaja en una cookie httpOnly.
 *   Alcance: un cliente. `expira_en` se extiende con el uso hasta `expira_max_en`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.portal_codigos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                solicitud uuid NOT NULL UNIQUE,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                canal text NOT NULL CHECK (canal IN ('correo', 'telegram')),
                destino_mascarado text NOT NULL,
                codigo_hash text NOT NULL,
                expira_en timestamptz NOT NULL,
                intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
                usado_en timestamptz,
                reemplazado_en timestamptz,
                ip inet,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX portal_codigos_cliente ON core.portal_codigos (cliente_id, created_at DESC);

            CREATE TABLE core.portal_sesiones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                token_hash text NOT NULL UNIQUE,
                codigo_id bigint REFERENCES core.portal_codigos (id),
                expira_en timestamptz NOT NULL,
                expira_max_en timestamptz NOT NULL,
                ultimo_uso timestamptz,
                revocada_en timestamptz,
                ip inet,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX portal_sesiones_cliente ON core.portal_sesiones (cliente_id);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS core.portal_sesiones;
            DROP TABLE IF EXISTS core.portal_codigos;
        `)
    }
}
