import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · anular una factura que recibió saldo a favor de una nota (decisión del líder): la aplicación se
 * revierte con una **fila de reverso** en `billing.notas_credito_aplicaciones` (monto negativo,
 * `reversa_de` = la aplicación), nunca con UPDATE. Σ monto por nota sigue siendo lo aplicado neto, así
 * el saldo a favor vuelve a Anticipos.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.notas_credito_aplicaciones
                ADD COLUMN reversa_de bigint UNIQUE REFERENCES billing.notas_credito_aplicaciones (id),
                DROP CONSTRAINT notas_credito_aplicaciones_monto_check,
                ADD CONSTRAINT notas_credito_aplicaciones_monto
                    CHECK ((reversa_de IS NULL AND monto > 0) OR (reversa_de IS NOT NULL AND monto < 0));
            COMMENT ON COLUMN billing.notas_credito_aplicaciones.reversa_de IS
                'Reverso de esta aplicación (monto negativo) al anular la factura que la recibió';

            -- el reverso es espejo exacto de su aplicación (misma nota y factura, monto opuesto), una vez
            CREATE FUNCTION billing.validar_reverso_aplicacion_nota() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                o billing.notas_credito_aplicaciones%ROWTYPE;
            BEGIN
                IF NEW.reversa_de IS NULL THEN
                    RETURN NEW;
                END IF;
                SELECT * INTO o FROM billing.notas_credito_aplicaciones WHERE id = NEW.reversa_de;
                IF o.id IS NULL OR o.reversa_de IS NOT NULL OR o.nota_credito_id <> NEW.nota_credito_id
                   OR o.factura_id <> NEW.factura_id OR o.monto <> -NEW.monto THEN
                    RAISE EXCEPTION 'El reverso de la aplicación % no es su espejo', NEW.reversa_de USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER notas_credito_aplicaciones_reverso BEFORE INSERT ON billing.notas_credito_aplicaciones
                FOR EACH ROW EXECUTE FUNCTION billing.validar_reverso_aplicacion_nota();
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS notas_credito_aplicaciones_reverso ON billing.notas_credito_aplicaciones;
            DROP FUNCTION IF EXISTS billing.validar_reverso_aplicacion_nota();
            ALTER TABLE billing.notas_credito_aplicaciones
                DROP CONSTRAINT IF EXISTS notas_credito_aplicaciones_monto,
                DROP COLUMN IF EXISTS reversa_de;
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM billing.notas_credito_aplicaciones WHERE monto <= 0) THEN
                    ALTER TABLE billing.notas_credito_aplicaciones
                        ADD CONSTRAINT notas_credito_aplicaciones_monto_check CHECK (monto > 0);
                END IF;
            END $$;
        `)
    }
}
