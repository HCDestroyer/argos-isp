import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * NIT tolerante (`contratos/fel-establecimientos.md` R1, lote 1): el módulo 11 pasa a advertencia.
 *
 * - `core.clasificar_documento`: un valor `^[0-9A-Z]{2,20}$` que no es CUI ni NIT válido queda
 *   `tipo = 'nit'`, `invalido = true` (antes caía a `cf` si tenía letras). 13 dígitos sin CUI ni
 *   NIT siguen siendo `cui` marcado; vacío y `CF`, `cf`.
 * - `core.clientes_tipo_documento`: con tipo `nit`, sin cambio de tipo y un número con forma de NIT
 *   que no cuadra (ni CUI ni NIT válidos), **no reclasifica**: queda `nit` con `nit_cui_invalido`.
 *   Un número válido de otro tipo (CUI, CF) se reclasifica como en `1792273376188` (la regla del
 *   alta, `deducirTipoDocumento`), y un NIT válido apaga la marca.
 *
 * `down` restaura las dos definiciones anteriores (`1792253931761` y `1792273376188`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION core.clasificar_documento(valor text, OUT tipo text, OUT invalido boolean)
                LANGUAGE plpgsql IMMUTABLE AS $$
                DECLARE
                    limpio text := upper(regexp_replace(coalesce(valor, ''), '[[:space:]-]', '', 'g'));
                BEGIN
                    invalido := false;
                    IF limpio = '' OR limpio = 'CF' THEN
                        tipo := 'cf';
                    ELSIF core.cui_valido(limpio) THEN
                        tipo := 'cui';
                    ELSIF core.nit_valido(limpio) THEN
                        tipo := 'nit';
                    ELSE
                        invalido := true;
                        tipo := CASE
                            WHEN limpio ~ '^[0-9]{13}$' THEN 'cui'
                            WHEN limpio ~ '^[0-9A-Z]{2,20}$' THEN 'nit'
                            ELSE 'cf'
                        END;
                    END IF;
                END
                $$;

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
                        -- NIT con forma que no cuadra: sigue siendo NIT, con la marca (no se vuelve cf ni cui)
                        IF NEW.tipo_documento_fiscal = 'nit' AND d.invalido AND limpio ~ '^[0-9A-Z]{2,20}$' THEN
                            NEW.nit_cui_invalido := true;
                            RETURN NEW;
                        END IF;
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
        `)
    }

    async down() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION core.clasificar_documento(valor text, OUT tipo text, OUT invalido boolean)
                LANGUAGE plpgsql IMMUTABLE AS $$
                DECLARE
                    limpio text := upper(regexp_replace(coalesce(valor, ''), '[[:space:]-]', '', 'g'));
                BEGIN
                    invalido := false;
                    IF limpio = '' OR limpio = 'CF' THEN
                        tipo := 'cf';
                    ELSIF core.cui_valido(limpio) THEN
                        tipo := 'cui';
                    ELSIF core.nit_valido(limpio) THEN
                        tipo := 'nit';
                    ELSE
                        invalido := true;
                        tipo := CASE
                            WHEN limpio ~ '^[0-9]{13}$' THEN 'cui'
                            WHEN limpio ~ '^[0-9]{1,12}[0-9K]$' THEN 'nit'
                            ELSE 'cf'
                        END;
                    END IF;
                END
                $$;

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
        `)
    }
}
