import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Recuperar la contraseña del panel por correo (decisión del PM 22): enlace de un solo uso. Solo se
 * guarda el hash SHA-256 del token (el token viaja únicamente en el correo); `usado_en` lo consume y
 * `expira_en` lo vence. Un pedido nuevo anula los anteriores sin usar del mismo usuario.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.recuperaciones_contrasena (
                id bigserial PRIMARY KEY,
                usuario_id bigint NOT NULL REFERENCES core.usuarios (id),
                token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
                expira_en timestamptz NOT NULL,
                usado_en timestamptz,
                anulado_en timestamptz,
                ip inet,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX recuperaciones_contrasena_usuario
                ON core.recuperaciones_contrasena (usuario_id) WHERE usado_en IS NULL AND anulado_en IS NULL;
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.recuperaciones_contrasena')
    }
}
