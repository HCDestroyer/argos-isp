import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · inventario fase B, observación del auditor (decisión del líder): un equipo que volvió del
 * comodato totalmente depreciado vale Q0 y se puede volver a prestar; su comodato da de alta un activo
 * de costo Q0, sin depreciación ni asientos. Solo para activos de una unidad (`unidad_id`):
 *
 *  - `ledger.activos`: `costo >= 0` (antes `> 0`) y el residual con la depreciación inicial menor que el
 *    costo, o los tres en cero en un activo de costo cero de una unidad.
 *  - `ledger.activos_bajas`: sin asiento la anulación y la baja de un activo de costo cero.
 *
 * DDL sobre CHECK: ninguna fila cambia.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            DO $$
            DECLARE
                nombre text;
            BEGIN
                SELECT conname INTO nombre FROM pg_constraint
                 WHERE conrelid = 'ledger.activos'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%costo > (0)%';
                IF nombre IS NOT NULL THEN
                    EXECUTE format('ALTER TABLE ledger.activos DROP CONSTRAINT %I', nombre);
                END IF;
            END $$;
            ALTER TABLE ledger.activos DROP CONSTRAINT activos_residual;
            ALTER TABLE ledger.activos ADD CONSTRAINT activos_costo CHECK (costo > 0 OR (costo = 0 AND unidad_id IS NOT NULL));
            ALTER TABLE ledger.activos ADD CONSTRAINT activos_residual CHECK (
                valor_residual >= 0 AND depreciacion_inicial >= 0
                AND (valor_residual + depreciacion_inicial < costo
                     OR (costo = 0 AND valor_residual = 0 AND depreciacion_inicial = 0))
            );
            ALTER TABLE ledger.activos_bajas DROP CONSTRAINT activos_bajas_asiento;
            ALTER TABLE ledger.activos_bajas ADD CONSTRAINT activos_bajas_asiento
                CHECK ((asiento_id IS NULL) = (tipo = 'anulacion' OR costo = 0));
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE ledger.activos_bajas DROP CONSTRAINT activos_bajas_asiento;
            ALTER TABLE ledger.activos_bajas ADD CONSTRAINT activos_bajas_asiento
                CHECK ((tipo = 'anulacion') = (asiento_id IS NULL)) NOT VALID;
            ALTER TABLE ledger.activos DROP CONSTRAINT activos_residual;
            ALTER TABLE ledger.activos ADD CONSTRAINT activos_residual CHECK (valor_residual >= 0 AND depreciacion_inicial >= 0
                AND valor_residual + depreciacion_inicial < costo) NOT VALID;
            ALTER TABLE ledger.activos DROP CONSTRAINT activos_costo;
            ALTER TABLE ledger.activos ADD CONSTRAINT activos_costo_check CHECK (costo > 0) NOT VALID;
        `)
    }
}
