import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Códigos de referido del programa de lealtad (`contratos/lealtad.md` §3 y §4, A1).
 *
 * - `core.codigos_referido`: un código por cliente y empresa (el referidor necesita un servicio en
 *   esa empresa), 8 caracteres sin ambigüedad (sin 0/O, 1/I/L), único en toda la instalación: el
 *   código solo ya dice de qué cliente y de qué empresa es.
 * - Se crea solo (trigger) cuando el cliente tiene su primer servicio en una empresa: al insertar
 *   el servicio o al pasarlo a otra empresa. La migración lo crea para los servicios existentes.
 * - `core.clientes.referido_por_id` / `referido_empresa_id`: quién refirió al cliente (el código
 *   capturado en el alta) y en qué empresa cuenta el referido. Un cliente es referido una vez.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE FUNCTION core.generar_codigo_referido() RETURNS text
            LANGUAGE plpgsql VOLATILE AS $$
            DECLARE
                alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
                candidato text;
            BEGIN
                LOOP
                    candidato := '';
                    FOR i IN 1..8 LOOP
                        candidato := candidato || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
                    END LOOP;
                    EXIT WHEN NOT EXISTS (SELECT 1 FROM core.codigos_referido c WHERE c.codigo = candidato);
                END LOOP;
                RETURN candidato;
            END
            $$;

            CREATE TABLE core.codigos_referido (
                id bigserial PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                codigo text NOT NULL CHECK (codigo ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT codigos_referido_codigo UNIQUE (codigo),
                CONSTRAINT codigos_referido_cliente_empresa UNIQUE (cliente_id, empresa_id)
            );

            CREATE FUNCTION core.asegurar_codigo_referido() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                INSERT INTO core.codigos_referido (empresa_id, cliente_id, codigo)
                VALUES (NEW.empresa_id, NEW.cliente_id, core.generar_codigo_referido())
                ON CONFLICT (cliente_id, empresa_id) DO NOTHING;
                RETURN NEW;
            END
            $$;
            CREATE TRIGGER servicios_codigo_referido
                AFTER INSERT OR UPDATE OF empresa_id, cliente_id ON core.servicios
                FOR EACH ROW EXECUTE FUNCTION core.asegurar_codigo_referido();

            DO $$
            DECLARE
                par record;
            BEGIN
                FOR par IN SELECT DISTINCT s.cliente_id, s.empresa_id FROM core.servicios s LOOP
                    INSERT INTO core.codigos_referido (empresa_id, cliente_id, codigo)
                    VALUES (par.empresa_id, par.cliente_id, core.generar_codigo_referido());
                END LOOP;
            END
            $$;

            ALTER TABLE core.clientes
                ADD COLUMN referido_por_id bigint REFERENCES core.clientes (id),
                ADD COLUMN referido_empresa_id bigint REFERENCES core.empresas (id),
                ADD CONSTRAINT clientes_referido_no_si_mismo
                    CHECK (referido_por_id IS NULL OR referido_por_id <> id),
                ADD CONSTRAINT clientes_referido_con_empresa
                    CHECK ((referido_por_id IS NULL) = (referido_empresa_id IS NULL));
            CREATE INDEX clientes_referido_por ON core.clientes (referido_por_id)
                WHERE referido_por_id IS NOT NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS core.clientes_referido_por;
            ALTER TABLE core.clientes
                DROP CONSTRAINT IF EXISTS clientes_referido_con_empresa,
                DROP CONSTRAINT IF EXISTS clientes_referido_no_si_mismo,
                DROP COLUMN IF EXISTS referido_empresa_id,
                DROP COLUMN IF EXISTS referido_por_id;
            DROP TRIGGER IF EXISTS servicios_codigo_referido ON core.servicios;
            DROP FUNCTION IF EXISTS core.asegurar_codigo_referido();
            DROP TABLE IF EXISTS core.codigos_referido;
            DROP FUNCTION IF EXISTS core.generar_codigo_referido();
        `)
    }
}
