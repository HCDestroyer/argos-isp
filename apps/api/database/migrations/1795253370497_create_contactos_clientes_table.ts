import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contactos del cliente (contrato Iris 0.10.0 §3.5, pedido A42; 0.10.1 §3.8, pedido A46).
 *
 * - `core.contactos_cliente`: quien escribe o llama no siempre es el titular. Cada contacto tiene su
 *   `relacion`, los `servicios` del cliente a los que aplica (null = todos), sus `permisos`
 *   (`consultar`, `reportar`, `pagar`, `avisos`; todos encendidos por defecto) y, opcional,
 *   `persona_cliente_id`: el otro cliente de la misma empresa que es esa persona (A46).
 * - Un **contacto titular** por cliente (`es_titular`), creado por la base al insertar el cliente
 *   (trigger `clientes_contacto_titular`) y para los clientes existentes en esta migración. Sus
 *   números principales son `telefono` y `movil` del cliente; en `contactos_cliente_telefonos` solo
 *   lleva los **adicionales** (`telefonos_adicionales[]` de `POST /clientes`, §3.2), con
 *   `adicional = true`. No se quita (`422 contacto_titular`).
 * - `core.contactos_cliente_telefonos`: números en E.164 (`+50255123344`), `whatsapp` y `principal`
 *   (a lo sumo uno por contacto). Un mismo número puede estar en varios clientes. Índice por número
 *   para `GET /contactos/buscar`.
 * - Quitar un contacto lo marca (`quitado_en`) y rompe su vínculo; los teléfonos de un contacto
 *   quitado ya no se buscan. Sin DELETE para la app (la fila queda para la auditoría).
 *
 * En `core.clientes` (§3.4.6, §3.8 y ajuste ai):
 * - `telefono_verificado_en` / `movil_verificado_en`: última confirmación con un código a ese número
 *   («verificado» = en los últimos 12 meses). Se borran cuando el número cambia.
 * - `campos_sin_confirmar`: datos que llegaron desde Iris y no cuentan como «registrados» para
 *   §7.5 y §12.4 hasta que el titular los confirme (`telefono`, `movil`, `email` de
 *   `completar-datos`; `nit_cui` de un `POST /clientes` de Iris).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.clientes
                ADD COLUMN telefono_verificado_en timestamptz,
                ADD COLUMN movil_verificado_en timestamptz,
                ADD COLUMN campos_sin_confirmar text[] NOT NULL DEFAULT '{}';

            CREATE TABLE core.contactos_cliente (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id) ON DELETE CASCADE,
                nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 200),
                relacion text NOT NULL
                    CHECK (relacion IN ('titular', 'familiar', 'inquilino', 'empleado', 'otro')),
                es_titular boolean NOT NULL DEFAULT false,
                servicios bigint[],
                permisos jsonb NOT NULL
                    DEFAULT '{"consultar": true, "reportar": true, "pagar": true, "avisos": true}'::jsonb,
                persona_cliente_id bigint REFERENCES core.clientes (id) ON DELETE SET NULL,
                origen text NOT NULL DEFAULT 'argos' CHECK (origen IN ('argos', 'iris', 'portal')),
                version integer NOT NULL DEFAULT 1,
                quitado_en timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT contactos_titular_relacion CHECK (es_titular = (relacion = 'titular')),
                CONSTRAINT contactos_persona_no_si_mismo CHECK (persona_cliente_id IS NULL OR persona_cliente_id <> cliente_id)
            );
            CREATE UNIQUE INDEX contactos_cliente_un_titular ON core.contactos_cliente (cliente_id)
                WHERE es_titular;
            CREATE INDEX contactos_cliente_cliente ON core.contactos_cliente (cliente_id) WHERE quitado_en IS NULL;
            CREATE INDEX contactos_cliente_persona ON core.contactos_cliente (persona_cliente_id)
                WHERE persona_cliente_id IS NOT NULL AND quitado_en IS NULL;

            CREATE TABLE core.contactos_cliente_telefonos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                contacto_id bigint NOT NULL REFERENCES core.contactos_cliente (id) ON DELETE CASCADE,
                numero text NOT NULL CHECK (numero ~ '^\\+[1-9][0-9]{7,14}$'),
                whatsapp boolean NOT NULL DEFAULT false,
                principal boolean NOT NULL DEFAULT false,
                adicional boolean NOT NULL DEFAULT false,
                created_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (contacto_id, numero)
            );
            CREATE UNIQUE INDEX contactos_cliente_telefonos_un_principal
                ON core.contactos_cliente_telefonos (contacto_id) WHERE principal;
            CREATE INDEX contactos_cliente_telefonos_numero ON core.contactos_cliente_telefonos (numero);

            CREATE FUNCTION core.clientes_contacto_titular() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    INSERT INTO core.contactos_cliente (cliente_id, nombre, relacion, es_titular)
                    VALUES (NEW.id, left(NEW.nombre, 200), 'titular', true);
                    RETURN NEW;
                END
                $$;
            CREATE TRIGGER clientes_contacto_titular AFTER INSERT ON core.clientes
                FOR EACH ROW EXECUTE FUNCTION core.clientes_contacto_titular();

            INSERT INTO core.contactos_cliente (cliente_id, nombre, relacion, es_titular)
            SELECT c.id, left(c.nombre, 200), 'titular', true
              FROM core.clientes c
             ORDER BY c.id;

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON core.contactos_cliente TO argosisp_app;
                    GRANT SELECT, INSERT, DELETE ON core.contactos_cliente_telefonos TO argosisp_app;
                END IF;
            END
            $$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS clientes_contacto_titular ON core.clientes;
            DROP FUNCTION IF EXISTS core.clientes_contacto_titular();
            DROP TABLE IF EXISTS core.contactos_cliente_telefonos;
            DROP TABLE IF EXISTS core.contactos_cliente;
            ALTER TABLE core.clientes
                DROP COLUMN IF EXISTS telefono_verificado_en,
                DROP COLUMN IF EXISTS movil_verificado_en,
                DROP COLUMN IF EXISTS campos_sin_confirmar;
        `)
    }
}
