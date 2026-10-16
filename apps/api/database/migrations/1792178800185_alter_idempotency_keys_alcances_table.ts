import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `Idempotency-Key` acotada en rutas públicas (semana 3, `a5.md:24`): sin usuario autenticado,
 * `actor_id` es null y todas las peticiones anónimas compartían el espacio de claves. `alcance`
 * separa ese espacio por sesión del portal o por IP de origen (hash; ver
 * `app/middleware/idempotencia_middleware.ts`). Con usuario autenticado queda null.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.idempotency_keys
                ADD COLUMN alcance text CHECK (length(alcance) BETWEEN 1 AND 100),
                DROP CONSTRAINT idempotency_keys_clave_actor_id_key,
                ADD CONSTRAINT idempotency_keys_clave_actor_alcance_key
                    UNIQUE NULLS NOT DISTINCT (clave, actor_id, alcance);
        `)
    }

    async down() {
        this.schema.raw(`
            DELETE FROM core.idempotency_keys WHERE alcance IS NOT NULL;
            ALTER TABLE core.idempotency_keys
                DROP CONSTRAINT idempotency_keys_clave_actor_alcance_key,
                DROP COLUMN alcance,
                ADD CONSTRAINT idempotency_keys_clave_actor_id_key UNIQUE NULLS NOT DISTINCT (clave, actor_id);
        `)
    }
}
