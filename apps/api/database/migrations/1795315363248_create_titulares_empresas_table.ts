import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Titular empresa en el cambio de titular (contrato Iris 0.14.1 §3.4.4, §10.11).
 *
 * 1. `core.clientes.nit_verificado_en` / `nit_verificado_por`: el NIT lo verificó una persona en el
 *    panel (`clientes.verificar_nit`). Solo los clientes `tipo = empresa` con NIT verificado cuentan
 *    como titular existente por NIT. Nunca lo pone A43 ni el token de Iris. Un trigger lo borra
 *    cuando cambia `nit_cui` (normalizado) y la misma sentencia no lo vuelve a fijar: así ningún
 *    camino (edición, A43, importador, SQL) deja un NIT nuevo marcado como verificado.
 *
 * 2. `core.titulares_empresa_revision`: el cambio a una empresa existente que no se pudo asignar al
 *    momento (`422 titular_empresa_en_revision`): el representante no coincide con una identidad
 *    A41 de esa empresa, o hay más de un candidato. Guarda lo necesario para que una persona con
 *    `clientes.ver_identidad` apruebe o rechace. El documento, el nombre del representante y las
 *    fotos van **cifrados** como en `core.clientes_identidades`; al decidir se borran las fotos y el
 *    documento (al aprobar pasan a la identidad A41 del cliente).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.clientes
                ADD COLUMN nit_verificado_en timestamptz,
                ADD COLUMN nit_verificado_por bigint REFERENCES core.usuarios (id),
                ADD CONSTRAINT clientes_nit_verificado_completo
                    CHECK ((nit_verificado_en IS NULL) = (nit_verificado_por IS NULL));

            CREATE OR REPLACE FUNCTION core.borrar_nit_verificado() RETURNS trigger
                LANGUAGE plpgsql AS $$
            BEGIN
                IF upper(regexp_replace(coalesce(NEW.nit_cui, ''), '[[:space:]-]', '', 'g'))
                       IS DISTINCT FROM upper(regexp_replace(coalesce(OLD.nit_cui, ''), '[[:space:]-]', '', 'g'))
                   AND NEW.nit_verificado_en IS NOT DISTINCT FROM OLD.nit_verificado_en THEN
                    NEW.nit_verificado_en := NULL;
                    NEW.nit_verificado_por := NULL;
                END IF;
                RETURN NEW;
            END
            $$;

            CREATE TRIGGER clientes_borrar_nit_verificado
                BEFORE UPDATE OF nit_cui ON core.clientes
                FOR EACH ROW EXECUTE FUNCTION core.borrar_nit_verificado();

            CREATE INDEX clientes_nit_verificado_empresa
                ON core.clientes (upper(regexp_replace(coalesce(nit_cui, ''), '[[:space:]-]', '', 'g')))
                WHERE tipo = 'empresa' AND nit_verificado_en IS NOT NULL;

            CREATE TABLE core.titulares_empresa_revision (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                -- sin FK: la solicitud se escribe en otra transacción mientras el servicio está bloqueado
                servicio_id bigint NOT NULL,
                de_cliente_id bigint NOT NULL,
                candidatos bigint[] NOT NULL,
                motivo_revision text NOT NULL
                    CHECK (motivo_revision IN ('representante_nuevo', 'varios_candidatos')),
                estado text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'reemplazada')),
                razon_social text NOT NULL,
                nit text NOT NULL,
                telefono text,
                whatsapp boolean NOT NULL DEFAULT false,
                email text,
                relacion text,
                representante_documento_tipo text NOT NULL
                    CHECK (representante_documento_tipo IN ('dpi', 'pasaporte')),
                representante_documento_cifrado text,
                representante_documento_huella text,
                representante_nombre_cifrado text,
                representante_nombre_huella text,
                frente bytea,
                frente_tipo text CHECK (frente_tipo IN ('image/jpeg', 'image/png')),
                reverso bytea,
                reverso_tipo text CHECK (reverso_tipo IN ('image/jpeg', 'image/png')),
                verificado_en timestamptz NOT NULL,
                metodo text NOT NULL CHECK (metodo IN ('foto_documento', 'revision_panel')),
                motivo_codigo text NOT NULL,
                motivo text NOT NULL,
                origen_tipo text,
                origen_id text,
                iris_actor text,
                solicitada_por bigint REFERENCES core.usuarios (id),
                request_id text,
                cliente_asignado_id bigint,
                identidad_id bigint,
                decidida_por bigint REFERENCES core.usuarios (id),
                decidida_en timestamptz,
                decision_motivo text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((reverso IS NULL) = (reverso_tipo IS NULL)),
                CHECK (estado <> 'pendiente' OR (frente IS NOT NULL AND representante_documento_cifrado IS NOT NULL))
            );
            CREATE INDEX titulares_empresa_revision_estado
                ON core.titulares_empresa_revision (empresa_id, estado, id);
            CREATE UNIQUE INDEX titulares_empresa_revision_pendiente
                ON core.titulares_empresa_revision (servicio_id) WHERE estado = 'pendiente';

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON core.titulares_empresa_revision TO argosisp_app;
                END IF;
            END
            $$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS core.titulares_empresa_revision;
            DROP INDEX IF EXISTS core.clientes_nit_verificado_empresa;
            DROP TRIGGER IF EXISTS clientes_borrar_nit_verificado ON core.clientes;
            DROP FUNCTION IF EXISTS core.borrar_nit_verificado();
            ALTER TABLE core.clientes
                DROP CONSTRAINT IF EXISTS clientes_nit_verificado_completo,
                DROP COLUMN IF EXISTS nit_verificado_por,
                DROP COLUMN IF EXISTS nit_verificado_en;
        `)
    }
}
