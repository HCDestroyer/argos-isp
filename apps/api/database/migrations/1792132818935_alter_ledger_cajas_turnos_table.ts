import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · tarea 9: turnos de caja.
 *
 *  - `cajas_turnos.abierto_por` / `cerrado_por`: quién abrió y cerró el turno (el cajero). El
 *    pago en efectivo sin `caja_id` va a la caja del turno que abrió el cajero.
 *  - `pagos.turno_id`: turno abierto de la caja cuando se registró el pago en efectivo. El
 *    esperado del cierre es `fondo_inicial + Σ pagos vigentes del turno`. Un pago en una caja sin
 *    turno abierto queda con `turno_id` nulo (como hasta hoy con la caja principal).
 *  - Un turno cerrado lleva esperado, contado y diferencia; con diferencia ≠ 0, motivo.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.cajas_turnos
                ADD COLUMN abierto_por bigint REFERENCES core.usuarios (id),
                ADD COLUMN cerrado_por bigint REFERENCES core.usuarios (id),
                ADD CONSTRAINT cajas_turnos_cierre_completo CHECK (
                    cerrado_en IS NULL
                    OR (esperado IS NOT NULL AND contado IS NOT NULL AND diferencia IS NOT NULL
                        AND diferencia = contado - esperado
                        AND (diferencia = 0 OR motivo IS NOT NULL))
                );
            CREATE INDEX cajas_turnos_caja ON ledger.cajas_turnos (caja_id, id);
            CREATE INDEX cajas_turnos_abierto_por ON ledger.cajas_turnos (abierto_por) WHERE cerrado_en IS NULL;

            ALTER TABLE billing.pagos
                ADD COLUMN turno_id bigint REFERENCES ledger.cajas_turnos (id);
            CREATE INDEX pagos_turno ON billing.pagos (turno_id) WHERE turno_id IS NOT NULL;

            -- Cuentas de diferencias de caja (también en PLAN_CUENTAS para bases nuevas, donde
            -- el seeder corre después de las migraciones y los padres aún no existen).
            INSERT INTO ledger.cuentas (codigo, nombre, tipo, padre_id, imputable, auxiliar_cliente)
            SELECT v.codigo, v.nombre, v.tipo, p.id, true, false
              FROM (VALUES ('4.1.04', 'Sobrantes de caja', 'ingreso', '4.1'),
                           ('5.2.06', 'Faltantes de caja', 'gasto', '5.2')) AS v (codigo, nombre, tipo, padre)
              JOIN ledger.cuentas p ON p.codigo = v.padre
            ON CONFLICT (codigo) DO NOTHING;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS billing.pagos_turno;
            ALTER TABLE billing.pagos DROP COLUMN IF EXISTS turno_id;
            DROP INDEX IF EXISTS ledger.cajas_turnos_abierto_por;
            DROP INDEX IF EXISTS ledger.cajas_turnos_caja;
            ALTER TABLE ledger.cajas_turnos
                DROP CONSTRAINT IF EXISTS cajas_turnos_cierre_completo,
                DROP COLUMN IF EXISTS cerrado_por,
                DROP COLUMN IF EXISTS abierto_por;
        `)
    }
}
