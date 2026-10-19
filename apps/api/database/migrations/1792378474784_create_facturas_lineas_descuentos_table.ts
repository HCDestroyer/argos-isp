import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · línea `descuento` de las facturas (contrato de localización fiscal §3.5; lealtad §5).
 *
 * - `billing.facturas_lineas.tipo` admite `descuento`: una línea negativa ligada a la línea que
 *   descuenta (`linea_id`, de la misma factura). El IVA de la factura es el del neto.
 * - `descuento` en la línea descontada: la suma de sus descuentos (positiva), para leerla sin sumar.
 *
 * `facturas_lineas_no_negativas` va `NOT VALID`: no revisa filas importadas antiguas, solo las nuevas.
 * DDL sin datos: ninguna línea existente cambia (todas quedan con `linea_id` null y `descuento` 0).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.facturas_lineas DROP CONSTRAINT facturas_lineas_tipo_check;
            ALTER TABLE billing.facturas_lineas
                ADD CONSTRAINT facturas_lineas_tipo_check
                    CHECK (tipo IN ('servicio', 'producto', 'mora', 'otro', 'descuento')),
                ADD COLUMN linea_id bigint REFERENCES billing.facturas_lineas (id),
                ADD COLUMN descuento numeric(14, 2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
                ADD CONSTRAINT facturas_lineas_descuento_ligado CHECK ((tipo = 'descuento') = (linea_id IS NOT NULL)),
                ADD CONSTRAINT facturas_lineas_descuento_negativo
                    CHECK (tipo <> 'descuento' OR (total < 0 AND iva <= 0 AND descuento = 0)),
                ADD CONSTRAINT facturas_lineas_no_negativas CHECK (tipo = 'descuento' OR total >= 0) NOT VALID;
            CREATE INDEX facturas_lineas_descontada ON billing.facturas_lineas (linea_id) WHERE linea_id IS NOT NULL;

            -- el descuento es de una línea de la misma factura, que no es otro descuento
            CREATE FUNCTION billing.validar_linea_descuento() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.linea_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM billing.facturas_lineas l
                     WHERE l.id = NEW.linea_id AND l.factura_id = NEW.factura_id AND l.tipo <> 'descuento') THEN
                    RAISE EXCEPTION 'El descuento debe ligarse a una línea de su misma factura' USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER facturas_lineas_descuento BEFORE INSERT OR UPDATE OF linea_id, factura_id
                ON billing.facturas_lineas FOR EACH ROW EXECUTE FUNCTION billing.validar_linea_descuento();
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS facturas_lineas_descuento ON billing.facturas_lineas;
            DROP FUNCTION IF EXISTS billing.validar_linea_descuento();
            ALTER TABLE billing.facturas_lineas
                DROP CONSTRAINT IF EXISTS facturas_lineas_no_negativas,
                DROP CONSTRAINT IF EXISTS facturas_lineas_descuento_negativo,
                DROP CONSTRAINT IF EXISTS facturas_lineas_descuento_ligado,
                DROP COLUMN IF EXISTS descuento,
                DROP COLUMN IF EXISTS linea_id,
                DROP CONSTRAINT facturas_lineas_tipo_check;
            ALTER TABLE billing.facturas_lineas ADD CONSTRAINT facturas_lineas_tipo_check
                CHECK (tipo IN ('servicio', 'producto', 'mora', 'otro')) NOT VALID;
        `)
    }
}
