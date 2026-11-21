import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · cierre de caja del rediseño (`a4.md` fila del 21 nov): el turno guarda el conteo por
 * denominaciones, el fondo que queda para el turno siguiente y a quién se entrega el resto.
 *
 * - `denominaciones`: `[{ valor, cantidad }]` (Q200 … 1¢) o null si se escribió solo el total.
 * - `fondo_siguiente`: el efectivo que se queda en la caja para abrir el próximo turno (≤ contado).
 * - `entregado_a` + `entregado_monto`: quién recibe `contado − fondo_siguiente`. No es asiento: el
 *   dinero sigue en la cuenta de la caja hasta que se deposita (`cajas.depositar`).
 *
 * Solo se escriben al cerrar (el trigger `proteger_turno_caja` ya impide tocar un turno cerrado).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.cajas_turnos
                ADD COLUMN denominaciones jsonb,
                ADD COLUMN fondo_siguiente numeric(14, 2),
                ADD COLUMN entregado_a bigint REFERENCES core.usuarios (id),
                ADD COLUMN entregado_monto numeric(14, 2),
                ADD CONSTRAINT cajas_turnos_denominaciones CHECK (
                    denominaciones IS NULL OR jsonb_typeof(denominaciones) = 'array'),
                ADD CONSTRAINT cajas_turnos_fondo_siguiente CHECK (
                    fondo_siguiente IS NULL OR (fondo_siguiente >= 0 AND cerrado_en IS NOT NULL
                        AND fondo_siguiente <= contado)),
                ADD CONSTRAINT cajas_turnos_entrega CHECK (
                    (entregado_monto IS NULL OR (fondo_siguiente IS NOT NULL
                        AND entregado_monto = contado - fondo_siguiente))
                    AND (entregado_a IS NULL OR entregado_monto IS NOT NULL));
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE ledger.cajas_turnos
                DROP CONSTRAINT IF EXISTS cajas_turnos_entrega,
                DROP CONSTRAINT IF EXISTS cajas_turnos_fondo_siguiente,
                DROP CONSTRAINT IF EXISTS cajas_turnos_denominaciones,
                DROP COLUMN IF EXISTS entregado_monto,
                DROP COLUMN IF EXISTS entregado_a,
                DROP COLUMN IF EXISTS fondo_siguiente,
                DROP COLUMN IF EXISTS denominaciones;
        `)
    }
}
