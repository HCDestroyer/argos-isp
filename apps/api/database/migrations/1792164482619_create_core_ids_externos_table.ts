import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Ids de sistemas externos (pedido de A6 para el importador de Mikrowisp): qué entidad de
 * ArgosIsp corresponde a cada id del origen, sin depender de nombres ni de claves naturales.
 *
 * - Único por (`sistema`, `entidad_tipo`, `externo_id`): un id del origen se importa una sola vez.
 * - Único por (`sistema`, `entidad_tipo`, `entidad_id`): una entidad tiene un solo id en cada origen.
 * - `entidad_tipo`: `cliente`, `router`, `plan` o `servicio` (los que crea el importador).
 * - Lo escriben las acciones de alta con la opción `externo` en su misma transacción
 *   (`app/core/ids_externos.ts`). Sin FK: `entidad_id` apunta a tablas distintas según el tipo.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.ids_externos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                sistema text NOT NULL CHECK (sistema ~ '^[a-z0-9_]{1,40}$'),
                entidad_tipo text NOT NULL CHECK (entidad_tipo IN ('cliente', 'router', 'plan', 'servicio')),
                externo_id text NOT NULL CHECK (length(externo_id) BETWEEN 1 AND 100),
                entidad_id bigint NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT ids_externos_externo_unico UNIQUE (sistema, entidad_tipo, externo_id),
                CONSTRAINT ids_externos_entidad_unica UNIQUE (sistema, entidad_tipo, entidad_id)
            );
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS core.ids_externos;`)
    }
}
