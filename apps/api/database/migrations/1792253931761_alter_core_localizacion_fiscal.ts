import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Localización fiscal, fase 1 (A1; `contratos/localizacion-fiscal.md` §3.1 y §11.1).
 *
 * - `core.empresas.pais`: país de la localización (ISO 3166-1 alfa-2). Todas las existentes
 *   quedan en `GT` por el valor por defecto.
 * - `core.clientes`: datos del receptor. `tipo_documento_fiscal` (`nit`, `cui`, `pasaporte`, `cf`),
 *   `pais_fiscal`, `agente_retencion_iva`, `sector_publico` y la marca `nit_cui_invalido`.
 *
 * Clientes existentes (migración de datos de `core`, que sí admite `UPDATE`): el tipo se deduce
 * del `nit_cui` con las mismas reglas que `#core/nit_cui` (`core.clasificar_documento`): vacío o
 * `CF` → `cf`; CUI con estructura válida → `cui`; NIT con verificador → `nit`. Un valor inválido
 * **no se borra**: queda con el tipo que aparenta (13 dígitos → `cui`, forma de NIT → `nit`, otro →
 * `cf`) y `nit_cui_invalido = true`, para corregirlo antes de facturarle con FEL.
 *
 * Las altas que no indican el tipo (importador, fábricas de pruebas, SQL directo) lo reciben del
 * trigger `clientes_tipo_documento` con la misma clasificación; la acción `clientes.crear` siempre
 * lo manda ya validado.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.empresas
                ADD COLUMN pais char(2) NOT NULL DEFAULT 'GT'
                    CONSTRAINT empresas_pais_formato CHECK (pais ~ '^[A-Z]{2}$');

            -- NIT: módulo 11 con pesos largo+1 .. 2; 10 = K (#core/nit_cui).
            CREATE FUNCTION core.nit_valido(valor text) RETURNS boolean
                LANGUAGE plpgsql IMMUTABLE STRICT AS $$
                DECLARE
                    cuerpo text;
                    total integer := 0;
                    factor integer;
                    modulo integer;
                BEGIN
                    IF valor !~ '^[0-9]{1,12}[0-9K]$' THEN
                        RETURN false;
                    END IF;
                    cuerpo := left(valor, -1);
                    factor := length(cuerpo) + 1;
                    FOR i IN 1..length(cuerpo) LOOP
                        total := total + substr(cuerpo, i, 1)::integer * factor;
                        factor := factor - 1;
                    END LOOP;
                    modulo := (11 - total % 11) % 11;
                    RETURN right(valor, 1) = CASE WHEN modulo = 10 THEN 'K' ELSE modulo::text END;
                END
                $$;

            -- CUI: estructura de la Ley del RENAP, art. 4 (sin verificador; #core/nit_cui).
            CREATE FUNCTION core.cui_valido(valor text) RETURNS boolean
                LANGUAGE sql IMMUTABLE STRICT AS $$
                    SELECT valor ~ '^[0-9]{13}$'
                        AND substr(valor, 10, 2)::integer BETWEEN 1 AND 22
                        AND substr(valor, 12, 2)::integer >= 1
                $$;

            CREATE FUNCTION core.clasificar_documento(valor text, OUT tipo text, OUT invalido boolean)
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

            ALTER TABLE core.clientes
                ADD COLUMN tipo_documento_fiscal text
                    CONSTRAINT clientes_tipo_documento_fiscal
                    CHECK (tipo_documento_fiscal IN ('nit', 'cui', 'pasaporte', 'cf')),
                ADD COLUMN pais_fiscal char(2) NOT NULL DEFAULT 'GT'
                    CONSTRAINT clientes_pais_fiscal_formato CHECK (pais_fiscal ~ '^[A-Z]{2}$'),
                ADD COLUMN agente_retencion_iva boolean NOT NULL DEFAULT false,
                ADD COLUMN sector_publico boolean NOT NULL DEFAULT false,
                ADD COLUMN nit_cui_invalido boolean NOT NULL DEFAULT false;

            UPDATE core.clientes c
               SET (tipo_documento_fiscal, nit_cui_invalido) =
                   (SELECT d.tipo, d.invalido FROM core.clasificar_documento(c.nit_cui) d);

            ALTER TABLE core.clientes ALTER COLUMN tipo_documento_fiscal SET NOT NULL;
            CREATE INDEX clientes_nit_cui_invalido ON core.clientes (id) WHERE nit_cui_invalido;

            CREATE FUNCTION core.clientes_tipo_documento() RETURNS trigger
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
            CREATE TRIGGER clientes_tipo_documento BEFORE INSERT ON core.clientes
                FOR EACH ROW EXECUTE FUNCTION core.clientes_tipo_documento();
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS clientes_tipo_documento ON core.clientes;
            DROP FUNCTION IF EXISTS core.clientes_tipo_documento();
            ALTER TABLE core.clientes
                DROP COLUMN IF EXISTS tipo_documento_fiscal,
                DROP COLUMN IF EXISTS pais_fiscal,
                DROP COLUMN IF EXISTS agente_retencion_iva,
                DROP COLUMN IF EXISTS sector_publico,
                DROP COLUMN IF EXISTS nit_cui_invalido;
            DROP FUNCTION IF EXISTS core.clasificar_documento(text);
            DROP FUNCTION IF EXISTS core.cui_valido(text);
            DROP FUNCTION IF EXISTS core.nit_valido(text);
            ALTER TABLE core.empresas DROP COLUMN IF EXISTS pais;
        `)
    }
}
