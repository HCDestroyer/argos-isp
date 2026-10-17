import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Multiempresa, paso 4: `audit.acciones.empresa_id` (nulable, sin FK: la auditoría es inmutable y
 * particionada). Lo escribe `DomainAction`: la empresa a la que pertenece lo que hizo la acción
 * (`t.fijarEmpresa`) o la empresa activa de la petición; null si no hay (crons, consola, acciones
 * de toda la instalación). Las filas anteriores quedan en null.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE audit.acciones ADD COLUMN empresa_id bigint;
            CREATE INDEX acciones_empresa ON audit.acciones (empresa_id, created_at);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS audit.acciones_empresa;
            ALTER TABLE audit.acciones DROP COLUMN IF EXISTS empresa_id;
        `)
    }
}
