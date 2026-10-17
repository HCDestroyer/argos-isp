import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · semana 3: importación de pagos históricos y reverso de saldos iniciales (importador de A6).
 *
 * - `billing.pagos.historico`: pago traído de otro sistema con su fecha original. Mueve el libro
 *   contra `2.9.01 Saldos de apertura` (no contra Caja ni Bancos: ese dinero no entró por
 *   ArgosIsp), no reevalúa servicios ni notifica. Sus datos bancarios y su caja son opcionales y
 *   su referencia no ocupa el índice único de referencias (el origen puede repetirlas).
 * - `billing.pagos.clave_externa`: id del pago en el origen; la importación es idempotente por ella.
 * - `billing.saldos_iniciales.anulado_*`: el saldo inicial se revierte con asiento de reverso
 *   (`AnularSaldoInicial`); la fila queda como historia.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.pagos
                ADD COLUMN historico boolean NOT NULL DEFAULT false,
                ADD COLUMN clave_externa text;
            CREATE UNIQUE INDEX pagos_clave_externa ON billing.pagos (clave_externa)
                WHERE clave_externa IS NOT NULL;
            ALTER TABLE billing.pagos ADD CONSTRAINT pagos_historico_clave
                CHECK (NOT historico OR clave_externa IS NOT NULL);

            ALTER TABLE billing.pagos DROP CONSTRAINT pagos_check;
            ALTER TABLE billing.pagos ADD CONSTRAINT pagos_check
                CHECK (historico OR metodo <> 'caja' OR caja_id IS NOT NULL);
            ALTER TABLE billing.pagos DROP CONSTRAINT pagos_datos_bancarios;
            ALTER TABLE billing.pagos ADD CONSTRAINT pagos_datos_bancarios CHECK (
                historico OR (
                    (metodo <> ALL (ARRAY['transferencia', 'ach'])
                        OR banco_origen_id IS NOT NULL AND cuenta_bancaria_id IS NOT NULL AND referencia IS NOT NULL)
                    AND (metodo <> 'remesa' OR cuenta_bancaria_id IS NOT NULL AND referencia IS NOT NULL)
                )
            );
            DROP INDEX billing.pagos_metodo_referencia;
            CREATE UNIQUE INDEX pagos_metodo_referencia
                ON billing.pagos (metodo, cuenta_bancaria_id, referencia) NULLS NOT DISTINCT
                WHERE referencia IS NOT NULL AND NOT historico;

            ALTER TABLE billing.saldos_iniciales
                ADD COLUMN anulado_en timestamptz,
                ADD COLUMN anulado_por bigint REFERENCES core.usuarios (id),
                ADD COLUMN motivo_anulacion text,
                ADD CONSTRAINT saldos_iniciales_anulacion CHECK ((anulado_en IS NULL) = (motivo_anulacion IS NULL));
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.saldos_iniciales
                DROP CONSTRAINT IF EXISTS saldos_iniciales_anulacion,
                DROP COLUMN IF EXISTS motivo_anulacion,
                DROP COLUMN IF EXISTS anulado_por,
                DROP COLUMN IF EXISTS anulado_en;

            -- con pagos históricos ya cargados: sus referencias se marcan para no chocar con el
            -- índice único original y los CHECK vuelven sin validar las filas existentes
            UPDATE billing.pagos SET referencia = referencia || ' [historico ' || id || ']'
             WHERE historico AND referencia IS NOT NULL;
            DROP INDEX billing.pagos_metodo_referencia;
            CREATE UNIQUE INDEX pagos_metodo_referencia
                ON billing.pagos (metodo, cuenta_bancaria_id, referencia) NULLS NOT DISTINCT
                WHERE referencia IS NOT NULL;
            ALTER TABLE billing.pagos DROP CONSTRAINT pagos_datos_bancarios;
            ALTER TABLE billing.pagos ADD CONSTRAINT pagos_datos_bancarios CHECK (
                (metodo <> ALL (ARRAY['transferencia', 'ach'])
                    OR banco_origen_id IS NOT NULL AND cuenta_bancaria_id IS NOT NULL AND referencia IS NOT NULL)
                AND (metodo <> 'remesa' OR cuenta_bancaria_id IS NOT NULL AND referencia IS NOT NULL)
            ) NOT VALID;
            ALTER TABLE billing.pagos DROP CONSTRAINT pagos_check;
            ALTER TABLE billing.pagos ADD CONSTRAINT pagos_check
                CHECK (metodo <> 'caja' OR caja_id IS NOT NULL) NOT VALID;
            ALTER TABLE billing.pagos DROP CONSTRAINT IF EXISTS pagos_historico_clave;
            DROP INDEX IF EXISTS billing.pagos_clave_externa;
            ALTER TABLE billing.pagos DROP COLUMN IF EXISTS clave_externa, DROP COLUMN IF EXISTS historico;
        `)
    }
}
