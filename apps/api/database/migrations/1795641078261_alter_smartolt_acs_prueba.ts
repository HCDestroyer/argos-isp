import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tableros aprobados de SmartOLT y ACS (`PendSmartoltDetalle`, `PendAcs`): «Última prueba» muestra en
 * cuánto respondió y quién la hizo. Se guardan con la prueba (`smartolt.probar_instancia`,
 * `acs.probar`) y se borran con ella cuando cambia la URL o el secreto.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE integraciones.smartolt_instancias
                ADD COLUMN IF NOT EXISTS prueba_latencia_ms integer,
                ADD COLUMN IF NOT EXISTS probado_por_id bigint REFERENCES core.usuarios (id) ON DELETE SET NULL;
            ALTER TABLE integraciones.acs_config
                ADD COLUMN IF NOT EXISTS prueba_latencia_ms integer,
                ADD COLUMN IF NOT EXISTS probado_por_id bigint REFERENCES core.usuarios (id) ON DELETE SET NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE integraciones.smartolt_instancias
                DROP COLUMN IF EXISTS prueba_latencia_ms, DROP COLUMN IF EXISTS probado_por_id;
            ALTER TABLE integraciones.acs_config
                DROP COLUMN IF EXISTS prueba_latencia_ms, DROP COLUMN IF EXISTS probado_por_id;
        `)
    }
}
