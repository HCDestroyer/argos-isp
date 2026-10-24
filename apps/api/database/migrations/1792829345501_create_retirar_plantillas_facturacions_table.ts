import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · pedido de A4: retirar una plantilla de facturación (`plantillas.retirar`, con motivo).
 *
 * - `retirada_en`, `retirada_por`, `motivo_retiro`: una plantilla retirada sigue facturando a los
 *   servicios que ya la tienen (nada cambia para ellos) pero no se asigna a servicios nuevos ni se
 *   cambia un servicio a ella. No puede ser la plantilla por defecto.
 * - Trigger `core.servicios_plantilla_vigente` (en `billing`, dueño de las plantillas): un INSERT de
 *   servicio o un cambio de `plantilla_facturacion_id` hacia una plantilla retirada falla con
 *   `check_violation` (422 `restriccion` en la API) y el mensaje claro. El resto del servicio se
 *   edita igual.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.plantillas_facturacion
                ADD COLUMN retirada_en timestamptz,
                ADD COLUMN retirada_por bigint REFERENCES core.usuarios (id),
                ADD COLUMN motivo_retiro text,
                ADD CONSTRAINT plantillas_facturacion_retiro CHECK (
                    (retirada_en IS NULL AND motivo_retiro IS NULL)
                    OR (retirada_en IS NOT NULL AND length(btrim(coalesce(motivo_retiro, ''))) >= 3)
                ),
                ADD CONSTRAINT plantillas_facturacion_retirada_no_por_defecto CHECK (
                    NOT (por_defecto AND retirada_en IS NOT NULL)
                );

            CREATE OR REPLACE FUNCTION billing.exigir_plantilla_vigente() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_nombre text;
            BEGIN
                IF NEW.plantilla_facturacion_id IS NULL THEN
                    RETURN NEW;
                END IF;
                IF TG_OP = 'UPDATE' AND NEW.plantilla_facturacion_id IS NOT DISTINCT FROM OLD.plantilla_facturacion_id THEN
                    RETURN NEW;
                END IF;
                SELECT nombre INTO v_nombre FROM billing.plantillas_facturacion
                 WHERE id = NEW.plantilla_facturacion_id AND retirada_en IS NOT NULL;
                IF FOUND THEN
                    RAISE EXCEPTION 'La plantilla de facturación % (%) está retirada: no se asigna a servicios nuevos',
                        v_nombre, NEW.plantilla_facturacion_id
                        USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER servicios_plantilla_vigente
                BEFORE INSERT OR UPDATE OF plantilla_facturacion_id ON core.servicios
                FOR EACH ROW EXECUTE FUNCTION billing.exigir_plantilla_vigente();
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS servicios_plantilla_vigente ON core.servicios;
            DROP FUNCTION IF EXISTS billing.exigir_plantilla_vigente();
            ALTER TABLE billing.plantillas_facturacion
                DROP CONSTRAINT IF EXISTS plantillas_facturacion_retirada_no_por_defecto,
                DROP CONSTRAINT IF EXISTS plantillas_facturacion_retiro,
                DROP COLUMN IF EXISTS motivo_retiro,
                DROP COLUMN IF EXISTS retirada_por,
                DROP COLUMN IF EXISTS retirada_en;
        `)
    }
}
