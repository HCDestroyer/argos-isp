import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Nodos portal remotos (A5, contrato `nodo-portal.md`): un portal del cliente que corre en otro
 * servidor y llama a la API central por HTTPS con `X-Argos-Nodo-Token: argn_...`.
 *
 * Solo se guarda el sha256 del token (como `core.tokens_api`); el valor se muestra una vez al
 * crearlo. Un nodo revocado (`revocado_en`) deja de ser válido en la siguiente petición. No se
 * borra: la auditoría lo referencia.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.nodos_portal (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                -- identificador del nodo (CLI: argosisp nodo-portal revocar <nombre>); único aunque se revoque
                nombre text NOT NULL UNIQUE CHECK (nombre ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
                hash text NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$'),
                ultimo_uso timestamptz,
                ultima_ip inet,
                revocado_en timestamptz,
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS core.nodos_portal;`)
    }
}
