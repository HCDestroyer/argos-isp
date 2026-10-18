import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Reclasificación del documento fiscal al editar (pedido de A3 para FEL, fase 3).
 *
 * El trigger `clientes_tipo_documento` (migración `1792253931761`) solo clasificaba en el INSERT:
 * un `UPDATE` que cambiaba `nit_cui` sin tocar el tipo (SQL directo, scripts, pruebas) dejaba el
 * tipo viejo (un CF que recibe NIT seguía como `cf` y el receptor del DTE salía mal).
 *
 * La regla sigue siendo una sola, `core.clasificar_documento` (= `deducirTipoDocumento` de
 * `#core/nit_cui`, comprobado en `tests/core/localizacion_fiscal.spec.ts`). Ahora también en el
 * `UPDATE OF nit_cui, tipo_documento_fiscal`:
 *
 * - tipo NULL (insert o update): se clasifica, como antes.
 * - cambia `nit_cui` y el tipo no se tocó: si el número nuevo es válido para ese tipo, se
 *   respeta y se apaga `nit_cui_invalido` (un NIT con forma de CUI que el usuario eligió como
 *   `nit` sigue siendo `nit`); si no, se reclasifica con la marca que corresponda. Un pasaporte
 *   conserva su tipo salvo que el número quede vacío o `CF` (pasa a `cf`).
 * - el tipo cambió en la misma sentencia: se respeta (`clientes.editar` ya lo validó).
 *
 * `EditarCliente` siempre escribe tipo y número ya validados con la misma regla, así que el
 * trigger no altera nada de lo que escribe la acción: solo cubre las escrituras fuera de ella.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION core.clientes_tipo_documento() RETURNS trigger
                LANGUAGE plpgsql AS $$
                DECLARE
                    d record;
                    limpio text;
                BEGIN
                    IF NEW.tipo_documento_fiscal IS NULL THEN
                        d := core.clasificar_documento(NEW.nit_cui);
                        NEW.tipo_documento_fiscal := d.tipo;
                        NEW.nit_cui_invalido := d.invalido;
                    ELSIF TG_OP = 'UPDATE'
                        AND NEW.nit_cui IS DISTINCT FROM OLD.nit_cui
                        AND NEW.tipo_documento_fiscal = OLD.tipo_documento_fiscal THEN
                        limpio := upper(regexp_replace(coalesce(NEW.nit_cui, ''), '[[:space:]-]', '', 'g'));
                        IF NEW.tipo_documento_fiscal = 'pasaporte' AND limpio NOT IN ('', 'CF') THEN
                            RETURN NEW;
                        END IF;
                        d := core.clasificar_documento(NEW.nit_cui);
                        IF NOT d.invalido AND (
                            d.tipo = NEW.tipo_documento_fiscal
                            OR (NEW.tipo_documento_fiscal = 'nit' AND core.nit_valido(limpio))
                        ) THEN
                            NEW.nit_cui_invalido := false;
                        ELSE
                            NEW.tipo_documento_fiscal := d.tipo;
                            NEW.nit_cui_invalido := d.invalido;
                        END IF;
                    END IF;
                    RETURN NEW;
                END
                $$;
            DROP TRIGGER clientes_tipo_documento ON core.clientes;
            CREATE TRIGGER clientes_tipo_documento
                BEFORE INSERT OR UPDATE OF nit_cui, tipo_documento_fiscal ON core.clientes
                FOR EACH ROW EXECUTE FUNCTION core.clientes_tipo_documento();
        `)
    }

    async down() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION core.clientes_tipo_documento() RETURNS trigger
                LANGUAGE plpgsql AS $$
                DECLARE
                    d record;
                BEGIN
                    IF NEW.tipo_documento_fiscal IS NULL THEN
                        d := core.clasificar_documento(NEW.nit_cui);
                        NEW.tipo_documento_fiscal := d.tipo;
                        NEW.nit_cui_invalido := d.invalido;
                    END IF;
                    RETURN NEW;
                END
                $$;
            DROP TRIGGER clientes_tipo_documento ON core.clientes;
            CREATE TRIGGER clientes_tipo_documento BEFORE INSERT ON core.clientes
                FOR EACH ROW EXECUTE FUNCTION core.clientes_tipo_documento();
        `)
    }
}
