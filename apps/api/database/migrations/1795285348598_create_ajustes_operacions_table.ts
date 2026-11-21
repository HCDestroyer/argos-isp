import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Ajustes de operación (decisiones del PM 17, 19, 22, 28 y 31, 21 nov): valores con su valor de
 * fábrica que el admin cambia sin tocar `.env`. `empresa_id` null = global; una fila de empresa
 * gana sobre la global solo en las claves que admiten empresa (`app/core/ajustes_operacion.ts`).
 * Solo las escribe `ajustes_operacion.editar` (diff en `audit.cambios`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.ajustes_operacion (
                id bigserial PRIMARY KEY,
                empresa_id bigint REFERENCES core.empresas (id),
                clave text NOT NULL CHECK (clave ~ '^[a-z_]+\\.[a-z_]+$'),
                valor jsonb NOT NULL,
                actualizado_por bigint REFERENCES core.usuarios (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX ajustes_operacion_clave
                ON core.ajustes_operacion (clave, coalesce(empresa_id, 0));
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.ajustes_operacion')
    }
}
