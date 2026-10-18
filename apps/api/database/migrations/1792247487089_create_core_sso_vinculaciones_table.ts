import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Autologin desde otro sistema (contrato Horus §1.5, lado receptor):
 *
 * - `core.sso_tickets`: ticket de un solo uso que pide el servidor del otro sistema con su token de
 *   integración (`token_api_id`, el conector). Se guarda solo el sha256 (`hash`); vence a los 60 s.
 *   Si al canjearlo no hay vinculación, la misma fila guarda el token de vinculación (sha256,
 *   10 min, un uso) que permite completar el login normal y vincular.
 * - `core.vinculaciones_externas`: `(conector, id_externo) → usuario local`. Solo se crea tras un
 *   login correcto del usuario local; nunca por coincidir el correo. Revocar marca `revocada_en`
 *   (la fila queda como historial); una sola vigente por `(conector, id_externo)`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.sso_tickets (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                hash text NOT NULL UNIQUE,
                conector text NOT NULL,
                token_api_id bigint NOT NULL REFERENCES core.tokens_api (id),
                usuario_id_externo text NOT NULL CHECK (length(usuario_id_externo) BETWEEN 1 AND 200),
                usuario_correo text,
                usuario_nombre text,
                destino_tipo text NOT NULL CHECK (destino_tipo IN ('cliente', 'servicio', 'router')),
                destino_id_externo text NOT NULL,
                expira_en timestamptz NOT NULL,
                usado_en timestamptz,
                vinculacion_hash text UNIQUE,
                vinculacion_expira_en timestamptz,
                vinculacion_usada_en timestamptz,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX sso_tickets_token ON core.sso_tickets (token_api_id);

            CREATE TABLE core.vinculaciones_externas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                conector text NOT NULL,
                id_externo text NOT NULL CHECK (length(id_externo) BETWEEN 1 AND 200),
                usuario_id bigint NOT NULL REFERENCES core.usuarios (id),
                correo_externo text,
                nombre_externo text,
                creada_por_ticket_id bigint REFERENCES core.sso_tickets (id),
                revocada_en timestamptz,
                revocada_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX vinculaciones_externas_vigente
                ON core.vinculaciones_externas (conector, id_externo) WHERE revocada_en IS NULL;
            CREATE INDEX vinculaciones_externas_usuario ON core.vinculaciones_externas (usuario_id);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS core.vinculaciones_externas;
            DROP TABLE IF EXISTS core.sso_tickets;
        `)
    }
}
