import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · anular factura: cambio de estado con asiento de reverso, nunca un DELETE. Se guarda
 * quién, cuándo y por qué (la acción siempre los llena; filas de pruebas o importadas pueden no
 * tenerlos). Una factura anulada no tiene pagos aplicados.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.facturas
                ADD COLUMN anulada_en timestamptz,
                ADD COLUMN anulada_por bigint REFERENCES core.usuarios (id),
                ADD COLUMN motivo_anulacion text,
                ADD CONSTRAINT facturas_anulacion CHECK (
                    (anulada_en IS NULL OR estado = 'anulada')
                    AND (estado <> 'anulada' OR pagado = 0)
                );
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.facturas
                DROP CONSTRAINT IF EXISTS facturas_anulacion,
                DROP COLUMN IF EXISTS motivo_anulacion,
                DROP COLUMN IF EXISTS anulada_por,
                DROP COLUMN IF EXISTS anulada_en;
        `)
    }
}
