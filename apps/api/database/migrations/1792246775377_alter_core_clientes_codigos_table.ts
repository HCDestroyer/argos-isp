import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Código de cliente estable (contrato Horus §2.1, pedido A3): `core.clientes.codigo`.
 *
 * - Formato `C-000455`: `C-` + id con relleno de 6 dígitos (`C-1234567` desde el millón). Lo pone
 *   la base al insertar (trigger `clientes_codigo`), así ningún alta (acción, importador, fixture)
 *   puede olvidarlo ni elegirlo; derivarlo del id lo hace único sin contador aparte.
 * - Inmutable: un `UPDATE` que lo cambie falla (`clientes_codigo_inmutable`).
 * - `codigo_externo`: el código del sistema anterior (importador), libre, nulable y no único. No
 *   reemplaza al estable.
 *
 * Los clientes existentes reciben su código derivado del id.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE FUNCTION core.codigo_cliente(id bigint) RETURNS text
                LANGUAGE sql IMMUTABLE STRICT
                AS $$ SELECT 'C-' || lpad(id::text, greatest(6, length(id::text)), '0') $$;

            ALTER TABLE core.clientes ADD COLUMN codigo text, ADD COLUMN codigo_externo text;
            UPDATE core.clientes SET codigo = core.codigo_cliente(id);
            ALTER TABLE core.clientes ALTER COLUMN codigo SET NOT NULL;
            ALTER TABLE core.clientes ADD CONSTRAINT clientes_codigo_unico UNIQUE (codigo);
            CREATE INDEX clientes_codigo_externo ON core.clientes (lower(codigo_externo))
                WHERE codigo_externo IS NOT NULL;

            CREATE FUNCTION core.clientes_codigo() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP = 'INSERT' THEN
                        NEW.codigo := core.codigo_cliente(NEW.id);
                    ELSIF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
                        RAISE EXCEPTION 'El código del cliente % es inmutable', OLD.codigo
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'clientes_codigo_inmutable';
                    END IF;
                    RETURN NEW;
                END
                $$;
            CREATE TRIGGER clientes_codigo BEFORE INSERT OR UPDATE OF codigo ON core.clientes
                FOR EACH ROW EXECUTE FUNCTION core.clientes_codigo();
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS clientes_codigo ON core.clientes;
            DROP FUNCTION IF EXISTS core.clientes_codigo();
            ALTER TABLE core.clientes DROP COLUMN IF EXISTS codigo, DROP COLUMN IF EXISTS codigo_externo;
            DROP FUNCTION IF EXISTS core.codigo_cliente(bigint);
        `)
    }
}
