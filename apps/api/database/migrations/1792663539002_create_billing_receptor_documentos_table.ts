import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 6 PR D, hallazgo H29 del auditor: el receptor (tipo, NIT/CUI/CF y nombre) de una
 * factura y de una nota de crédito se guarda al emitirlas, para que el libro de ventas de un mes
 * cerrado no cambie si después se edita el dato fiscal del cliente. Mismo formato que
 * `fiscal.dte.receptor` (`{ tipo, id, nombre }`).
 *
 *  - `billing.receptor_cliente(cliente, corregido)`: la regla de `receptorDe` (`#fiscal/fel/dte`) en
 *    SQL: CF si el cliente es consumidor final o su NIT es inválido; si no, su NIT/CUI sin guiones y
 *    su nombre fiscal; `corregido` es el receptor de una sustitución (`reglas_snapshot.receptor`).
 *  - Facturas: `emitirDocumento` lo escribe; el trigger llena el que falte (saldos iniciales,
 *    importadas) y nadie lo cambia después (trigger de UPDATE).
 *  - Notas de crédito: el receptor de su factura (trigger al insertar).
 *  - Lo existente: se llena con el dato actual del cliente (o el corregido de la sustitución); el
 *    de las notas, con el de su factura. Es lo más cercano que hay al dato de la fecha de emisión.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.facturas ADD COLUMN receptor jsonb;
            ALTER TABLE billing.notas_credito ADD COLUMN receptor jsonb;

            CREATE OR REPLACE FUNCTION billing.receptor_cliente(p_cliente bigint, p_corregido jsonb)
            RETURNS jsonb LANGUAGE sql STABLE AS $fn$
                WITH c AS (
                    SELECT coalesce(nullif(p_corregido ->> 'tipo_documento_fiscal', ''),
                                    CASE WHEN c.nit_cui_invalido THEN 'cf' ELSE c.tipo_documento_fiscal END) AS tipo,
                           coalesce(p_corregido ->> 'nit_cui', c.nit_cui, '') AS nit,
                           coalesce(p_corregido ->> 'nombre_fiscal', c.nombre_fiscal, c.nombre) AS nombre
                      FROM core.clientes c WHERE c.id = p_cliente
                )
                SELECT jsonb_build_object(
                           'tipo', tipo,
                           'id', CASE WHEN tipo = 'cf' THEN 'CF'
                                      ELSE coalesce(nullif(upper(regexp_replace(nit, '[\\s-]', '', 'g')), ''), 'CF') END,
                           'nombre', CASE WHEN tipo = 'cf' THEN 'Consumidor Final' ELSE nombre END)
                  FROM c
            $fn$;

            CREATE OR REPLACE FUNCTION billing.fijar_receptor_factura() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF TG_OP = 'UPDATE' THEN
                    IF NEW.receptor IS DISTINCT FROM OLD.receptor THEN
                        RAISE EXCEPTION 'El receptor de la factura % no se cambia después de emitirla', OLD.id
                            USING ERRCODE = 'insufficient_privilege';
                    END IF;
                    RETURN NEW;
                END IF;
                IF NEW.receptor IS NULL THEN
                    NEW.receptor := billing.receptor_cliente(NEW.cliente_id, NEW.reglas_snapshot -> 'receptor');
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER facturas_receptor BEFORE INSERT OR UPDATE ON billing.facturas
                FOR EACH ROW EXECUTE FUNCTION billing.fijar_receptor_factura();

            CREATE OR REPLACE FUNCTION billing.fijar_receptor_nota() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.receptor IS NULL THEN
                    SELECT f.receptor INTO NEW.receptor FROM billing.facturas f WHERE f.id = NEW.factura_id;
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER notas_credito_receptor BEFORE INSERT ON billing.notas_credito
                FOR EACH ROW EXECUTE FUNCTION billing.fijar_receptor_nota();

            -- lo existente (el trigger de UPDATE solo deja escribirlo una vez: de null al valor)
            ALTER TABLE billing.facturas DISABLE TRIGGER facturas_receptor;
            UPDATE billing.facturas f
               SET receptor = billing.receptor_cliente(f.cliente_id, f.reglas_snapshot -> 'receptor');
            ALTER TABLE billing.facturas ENABLE TRIGGER facturas_receptor;
            ALTER TABLE billing.notas_credito DISABLE TRIGGER notas_credito_inmutable;
            UPDATE billing.notas_credito n SET receptor = f.receptor FROM billing.facturas f WHERE f.id = n.factura_id;
            ALTER TABLE billing.notas_credito ENABLE TRIGGER notas_credito_inmutable;

            ALTER TABLE billing.facturas ALTER COLUMN receptor SET NOT NULL;
            ALTER TABLE billing.notas_credito ALTER COLUMN receptor SET NOT NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS notas_credito_receptor ON billing.notas_credito;
            DROP TRIGGER IF EXISTS facturas_receptor ON billing.facturas;
            DROP FUNCTION IF EXISTS billing.fijar_receptor_nota();
            DROP FUNCTION IF EXISTS billing.fijar_receptor_factura();
            DROP FUNCTION IF EXISTS billing.receptor_cliente(bigint, jsonb);
            ALTER TABLE billing.notas_credito DISABLE TRIGGER notas_credito_inmutable;
            ALTER TABLE billing.notas_credito DROP COLUMN IF EXISTS receptor;
            ALTER TABLE billing.notas_credito ENABLE TRIGGER notas_credito_inmutable;
            ALTER TABLE billing.facturas DROP COLUMN IF EXISTS receptor;
        `)
    }
}
