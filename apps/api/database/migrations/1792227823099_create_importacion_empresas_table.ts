import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Importación y multiempresa (`contratos/multiempresa.md`): el archivo del origen guarda a qué
 * empresa se asignó lo importado (`node ace importar --empresa=<id|nit>`). Las filas archivadas
 * antes de este cambio quedan en null (una instalación de una sola empresa: la 1).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE importacion.filas_origen
                ADD COLUMN empresa_id bigint REFERENCES core.empresas (id);
            CREATE INDEX filas_origen_empresa ON importacion.filas_origen (empresa_id)
                WHERE empresa_id IS NOT NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS importacion.filas_origen_empresa;
            ALTER TABLE importacion.filas_origen DROP COLUMN empresa_id;
        `)
    }
}
