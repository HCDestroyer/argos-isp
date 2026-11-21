import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Código y nombre del servicio (contrato Iris 0.10.0 §3.7, pedido A45).
 *
 * - `codigo`: `S-000412`, `S-` + un número con relleno de 6 dígitos (`S-1234567` desde el millón).
 *   Lo pone la base al insertar (trigger `servicios_codigo`), así ningún alta (acción, importador,
 *   fixture) puede olvidarlo ni elegirlo, y es **inmutable** (`servicios_codigo_inmutable`).
 *   El número sale de la secuencia `core.servicios_codigo_seq`, una para toda la instalación: un
 *   servicio que pasa a otra empresa (`servicios.cambiar_empresa`) conserva su código y nunca choca
 *   con uno de la empresa destino. Con una sola empresa (el caso de hoy) la numeración es la de la
 *   empresa. Único en toda la instalación, por tanto también dentro de cada empresa.
 * - `nombre`: opcional, hasta 60 caracteres («Casa», «Negocio»). Texto del cliente: no va a logs.
 *
 * Los servicios existentes reciben su código en orden de id.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE SEQUENCE core.servicios_codigo_seq AS bigint START 1;

            CREATE FUNCTION core.codigo_servicio(n bigint) RETURNS text
                LANGUAGE sql IMMUTABLE STRICT
                AS $$ SELECT 'S-' || lpad(n::text, greatest(6, length(n::text)), '0') $$;

            ALTER TABLE core.servicios
                ADD COLUMN codigo text,
                ADD COLUMN nombre varchar(60) CHECK (nombre IS NULL OR length(btrim(nombre)) BETWEEN 1 AND 60);

            UPDATE core.servicios s
               SET codigo = core.codigo_servicio(o.n)
              FROM (SELECT id, nextval('core.servicios_codigo_seq') AS n
                      FROM (SELECT id FROM core.servicios ORDER BY id) ordenados) o
             WHERE o.id = s.id;

            ALTER TABLE core.servicios ALTER COLUMN codigo SET NOT NULL;
            ALTER TABLE core.servicios ADD CONSTRAINT servicios_codigo_unico UNIQUE (codigo);

            CREATE FUNCTION core.servicios_codigo() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP = 'INSERT' THEN
                        NEW.codigo := core.codigo_servicio(nextval('core.servicios_codigo_seq'));
                    ELSIF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
                        RAISE EXCEPTION 'El código del servicio % es inmutable', OLD.codigo
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'servicios_codigo_inmutable';
                    END IF;
                    RETURN NEW;
                END
                $$;
            CREATE TRIGGER servicios_codigo BEFORE INSERT OR UPDATE OF codigo ON core.servicios
                FOR EACH ROW EXECUTE FUNCTION core.servicios_codigo();

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT USAGE ON SEQUENCE core.servicios_codigo_seq TO argosisp_app;
                END IF;
            END
            $$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS servicios_codigo ON core.servicios;
            DROP FUNCTION IF EXISTS core.servicios_codigo();
            ALTER TABLE core.servicios DROP COLUMN IF EXISTS codigo, DROP COLUMN IF EXISTS nombre;
            DROP FUNCTION IF EXISTS core.codigo_servicio(bigint);
            DROP SEQUENCE IF EXISTS core.servicios_codigo_seq;
        `)
    }
}
