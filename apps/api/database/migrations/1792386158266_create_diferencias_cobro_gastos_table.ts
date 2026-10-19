import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · B (decisión del líder): la diferencia de cobro deja de ser una nota de crédito y pasa a
 * **gasto por centavos no cobrados** — asiento `diferencia_cobro` `5.3.05 / CxC`, sin tocar IVA ni
 * DTE (el DTE va siempre por el total de la factura). Anular el pago lo revierte en espejo.
 *
 * - Aborta si hay datos del esquema anterior (H13: diferencias con nota; H18: cargos `tipo = cargo`):
 *   no hay producción todavía.
 * - `billing.diferencias_cobro`: `nota_credito_id` deja de ser obligatoria (siempre null desde aquí) y
 *   se agrega `asiento_id` (único, obligatorio): la diferencia vigente es la de asiento sin reverso.
 * - `billing.facturas.tipo` vuelve a `servicio | mora` (se quita el cargo H18).
 * - `billing.diferencias_cobro_cargos` queda vacía y cerrada a inserciones: la suite del auditor
 *   (`verificar_libro.ts`, inv. 13) aún la consulta; se borra cuando el auditor quite esas consultas.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM billing.facturas WHERE tipo = 'cargo')
                   OR EXISTS (SELECT 1 FROM billing.diferencias_cobro_cargos)
                   OR EXISTS (SELECT 1 FROM billing.diferencias_cobro) THEN
                    RAISE EXCEPTION 'Hay diferencias de cobro o cargos H18 del esquema anterior (nota interna / cargo): migrarlas antes de pasar a diferencia como gasto';
                END IF;
            END $$;

            ALTER TABLE billing.facturas DROP CONSTRAINT IF EXISTS facturas_cargo_sin_iva;
            ALTER TABLE billing.facturas DROP CONSTRAINT facturas_tipo_check;
            ALTER TABLE billing.facturas ADD CONSTRAINT facturas_tipo_check CHECK (tipo IN ('servicio', 'mora'));

            ALTER TABLE billing.diferencias_cobro ALTER COLUMN nota_credito_id DROP NOT NULL;
            ALTER TABLE billing.diferencias_cobro
                ADD COLUMN asiento_id bigint NOT NULL UNIQUE REFERENCES ledger.asientos (id),
                ADD CONSTRAINT diferencias_cobro_sin_nota CHECK (nota_credito_id IS NULL);
            COMMENT ON COLUMN billing.diferencias_cobro.asiento_id IS
                'Asiento diferencia_cobro (5.3.05 / CxC); la diferencia está vigente mientras no tenga reverso';

            CREATE FUNCTION billing.rechazar_cargo_diferencia() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION 'billing.diferencias_cobro_cargos ya no se usa: la diferencia de cobro es un gasto (5.3.05)';
            END $$;
            CREATE TRIGGER diferencias_cobro_cargos_cerrada BEFORE INSERT ON billing.diferencias_cobro_cargos
                FOR EACH ROW EXECUTE FUNCTION billing.rechazar_cargo_diferencia();

            -- el id de la diferencia se reserva antes de su asiento (nextval + OVERRIDING SYSTEM VALUE)
            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO argosisp_app',
                                   pg_get_serial_sequence('billing.diferencias_cobro', 'id'));
                    REVOKE INSERT ON billing.diferencias_cobro_cargos FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS diferencias_cobro_cargos_cerrada ON billing.diferencias_cobro_cargos;
            DROP FUNCTION IF EXISTS billing.rechazar_cargo_diferencia();
            ALTER TABLE billing.diferencias_cobro DROP CONSTRAINT IF EXISTS diferencias_cobro_sin_nota;
            ALTER TABLE billing.diferencias_cobro DROP COLUMN IF EXISTS asiento_id;
            -- con diferencias como gasto ya registradas (pruebas) la columna queda opcional: la migración
            -- anterior borra la tabla al seguir bajando
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM billing.diferencias_cobro) THEN
                    ALTER TABLE billing.diferencias_cobro ALTER COLUMN nota_credito_id SET NOT NULL;
                END IF;
            END $$;
            ALTER TABLE billing.facturas DROP CONSTRAINT facturas_tipo_check;
            ALTER TABLE billing.facturas ADD CONSTRAINT facturas_tipo_check CHECK (tipo IN ('servicio', 'mora', 'cargo'));
            ALTER TABLE billing.facturas ADD CONSTRAINT facturas_cargo_sin_iva
                CHECK (tipo <> 'cargo' OR (iva = 0 AND NOT aviso_cobro AND factura_origen_id IS NOT NULL));
        `)
    }
}
