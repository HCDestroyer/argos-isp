import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Plantillas HTML de documentos para el cliente (A5, tarea 8): hoy solo `aviso_cobro`.
 * Sin fila, se usa la plantilla de fábrica (`app/portal/documentos/plantilla_base.ts`); la primera
 * edición desde el panel crea la fila con `version = 1`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.plantillas_documentos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                tipo text NOT NULL UNIQUE CHECK (tipo IN ('aviso_cobro')),
                html text NOT NULL CHECK (length(html) BETWEEN 1 AND 100000),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.plantillas_documentos')
    }
}
