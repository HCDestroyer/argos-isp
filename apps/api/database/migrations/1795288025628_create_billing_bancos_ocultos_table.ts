import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · catálogo de bancos de origen (decisión del PM 23): `billing.bancos` es el único catálogo del
 * sistema (todas las empresas). El admin agrega y edita bancos (`version` para el control optimista);
 * cada empresa oculta los que no usa en `billing.bancos_ocultos` (una fila = oculto en esa empresa;
 * mostrar de nuevo borra la fila, con su diff en `audit.cambios`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.bancos ADD COLUMN version integer NOT NULL DEFAULT 1;

            CREATE TABLE billing.bancos_ocultos (
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                banco_id bigint NOT NULL REFERENCES billing.bancos (id),
                ocultado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (empresa_id, banco_id)
            );
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.bancos_ocultos;
            ALTER TABLE billing.bancos DROP COLUMN IF EXISTS version;
        `)
    }
}
