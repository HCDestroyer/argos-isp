import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.8.0 (§7.8, revisión punto 9): `billing.cuentas_bancarias` guarda el `titular`
 * (nombre a quien se deposita, 2 a 120 caracteres) y el `tipo` de cuenta (`monetaria` | `ahorro`).
 * Los dos son nulables: las cuentas existentes quedan en null hasta que alguien las edite (Argos
 * no inventa un titular). El panel los pide al crear y al editar; la API los acepta nulos por
 * compatibilidad. Sin cambios en `ledger`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.cuentas_bancarias
                ADD COLUMN titular text
                    CHECK (titular IS NULL OR char_length(titular) BETWEEN 2 AND 120),
                ADD COLUMN tipo text
                    CHECK (tipo IS NULL OR tipo IN ('monetaria', 'ahorro'));
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.cuentas_bancarias
                DROP COLUMN IF EXISTS tipo,
                DROP COLUMN IF EXISTS titular;
        `)
    }
}
