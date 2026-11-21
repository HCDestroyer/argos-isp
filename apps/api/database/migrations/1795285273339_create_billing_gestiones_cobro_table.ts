import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · gestiones de cobro (decisión del PM 8, contrato Iris 0.13.0).
 *
 * `billing.gestiones_cobro`: cada intento de cobro a un cliente (llamada, mensaje, visita, promesa
 * verbal o carta) con su resultado. Es la evidencia del castigo de cartera. Solo informativa: no
 * cambia servicios, facturas ni promesas. Nunca se edita ni se borra; lo único que se completa
 * después es el adjunto opcional (una vez, de null a un archivo).
 *
 * - `sistema_origen = 'iris'` y `iris_gestion_id` (UUID v7 de Iris, único) para lo que registra Iris;
 *   null desde el panel. `carta` y `origen_tipo = panel` son solo de Argos (lo valida la acción).
 * - `nota` corta (hasta 280) solo desde el panel; Iris no manda texto libre, montos ni teléfonos.
 * - `contacto_id`: el contacto del cliente con quien se habló (`X-Iris-Contacto`), si no fue el titular.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.gestiones_cobro (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                servicio_id bigint REFERENCES core.servicios (id),
                contacto_id bigint REFERENCES core.contactos_cliente (id) ON DELETE SET NULL,
                tipo text NOT NULL CHECK (tipo IN ('llamada', 'mensaje', 'visita', 'promesa', 'carta')),
                resultado text NOT NULL CHECK (resultado IN (
                    'contesto', 'no_contesto', 'numero_equivocado', 'promete_pagar', 'rechaza',
                    'pago_informado', 'visita_sin_contacto'
                )),
                ocurrido_en timestamptz NOT NULL,
                origen_tipo text NOT NULL CHECK (origen_tipo IN ('conversacion', 'orden', 'llamada', 'panel')),
                origen_id text CHECK (origen_id IS NULL OR length(origen_id) BETWEEN 1 AND 128),
                sistema_origen text CHECK (sistema_origen IN ('iris')),
                iris_gestion_id uuid UNIQUE,
                iris_actor text,
                nota text CHECK (nota IS NULL OR length(nota) BETWEEN 1 AND 280),
                adjunto text,
                adjunto_tipo text,
                adjunto_tamano integer,
                adjunto_en timestamptz,
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT gestiones_cobro_iris CHECK (
                    (sistema_origen IS NULL AND iris_gestion_id IS NULL)
                    OR (sistema_origen = 'iris' AND iris_gestion_id IS NOT NULL AND nota IS NULL
                        AND tipo <> 'carta' AND origen_tipo <> 'panel')
                ),
                CONSTRAINT gestiones_cobro_adjunto CHECK (
                    (adjunto IS NULL AND adjunto_tipo IS NULL AND adjunto_tamano IS NULL AND adjunto_en IS NULL)
                    OR (adjunto IS NOT NULL AND adjunto_tipo IS NOT NULL AND adjunto_tamano IS NOT NULL
                        AND adjunto_en IS NOT NULL)
                )
            );
            CREATE INDEX gestiones_cobro_cliente ON billing.gestiones_cobro (cliente_id, ocurrido_en DESC, id DESC);
            CREATE INDEX gestiones_cobro_empresa ON billing.gestiones_cobro (empresa_id, ocurrido_en DESC);
            CREATE INDEX gestiones_cobro_servicio ON billing.gestiones_cobro (servicio_id) WHERE servicio_id IS NOT NULL;

            -- inmutable: solo se completa el adjunto (de null a un archivo), una vez
            CREATE FUNCTION billing.gestiones_cobro_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'Las gestiones de cobro no se borran' USING ERRCODE = 'check_violation';
                END IF;
                IF OLD.adjunto IS NOT NULL
                    OR (to_jsonb(NEW) - ARRAY['adjunto', 'adjunto_tipo', 'adjunto_tamano', 'adjunto_en', 'contacto_id'])
                        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['adjunto', 'adjunto_tipo', 'adjunto_tamano', 'adjunto_en', 'contacto_id'])
                    OR (NEW.contacto_id IS DISTINCT FROM OLD.contacto_id AND NEW.contacto_id IS NOT NULL)
                THEN
                    RAISE EXCEPTION 'Las gestiones de cobro no se editan (solo se agrega el adjunto una vez)'
                        USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END
            $$;
            CREATE TRIGGER gestiones_cobro_inmutable BEFORE UPDATE OR DELETE ON billing.gestiones_cobro
                FOR EACH ROW EXECUTE FUNCTION billing.gestiones_cobro_inmutable();
            CREATE TRIGGER gestiones_cobro_sin_truncate BEFORE TRUNCATE ON billing.gestiones_cobro
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON billing.gestiones_cobro TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON billing.gestiones_cobro FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.gestiones_cobro;
            DROP FUNCTION IF EXISTS billing.gestiones_cobro_inmutable();
        `)
    }
}
