import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Plantillas de documentos (A5, FEL fase 3): la nota de crédito (NCRE) también tiene su plantilla
 * editable desde el panel. Ninguna fila cambia; solo se amplía el `CHECK` de `tipo`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.plantillas_documentos DROP CONSTRAINT plantillas_documentos_tipo_check;
            ALTER TABLE core.plantillas_documentos
                ADD CONSTRAINT plantillas_documentos_tipo_check CHECK (tipo IN ('aviso_cobro', 'nota_credito'));
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE core.plantillas_documentos DROP CONSTRAINT plantillas_documentos_tipo_check;
            -- NOT VALID: una plantilla de nota de crédito ya guardada se queda
            ALTER TABLE core.plantillas_documentos
                ADD CONSTRAINT plantillas_documentos_tipo_check CHECK (tipo IN ('aviso_cobro')) NOT VALID;
        `)
    }
}
