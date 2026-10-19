import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Servicios adicionales de un servicio de internet (decisión del PM, 19 oct;
 * `contratos/adicionales.md`): una cuenta de streaming, usuarios de IPTV…
 *
 * - `core.adicionales`: catálogo por empresa. `codigo` único por empresa (también entre los
 *   inactivos: se desactiva, nunca se borra).
 * - `core.motivos_cortesia`: por qué se regala un adicional. `empresa_id` null = motivo común a
 *   todas las empresas (los cinco de la semilla); cada empresa agrega los suyos.
 * - `core.servicios_adicionales`: asignaciones. Un mismo adicional puede ir varias veces en un
 *   servicio (3 usuarios de IPTV): no hay índice único. `precio` solo con `cobrado`; `motivo_id`
 *   solo con `cortesia`. La baja es `estado = 'baja'` con `baja_en`, nunca DELETE. `credencial`
 *   va cifrada v1 (`#shared/cifrado`, como `pass_ppp`).
 * - `network.planes_adicionales`: adicionales que trae cada plan, con su cantidad. Los planes son
 *   de todas las empresas; al asignar se toman solo los adicionales de la empresa del servicio.
 *
 * Un trigger exige que la asignación, el adicional (y al insertar, el servicio) sean de la misma
 * empresa, y que el motivo sea común o de esa empresa.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.adicionales (
                id bigserial PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                codigo text NOT NULL,
                nombre text NOT NULL,
                descripcion text,
                precio_sugerido numeric(14,2) CHECK (precio_sugerido IS NULL OR precio_sugerido >= 0),
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT adicionales_codigo_empresa UNIQUE (empresa_id, codigo)
            );
            CREATE INDEX adicionales_empresa_nombre ON core.adicionales (empresa_id, nombre);

            CREATE TABLE core.motivos_cortesia (
                id bigserial PRIMARY KEY,
                empresa_id bigint REFERENCES core.empresas (id),
                codigo text NOT NULL,
                nombre text NOT NULL,
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX motivos_cortesia_codigo
                ON core.motivos_cortesia (COALESCE(empresa_id, 0), codigo);
            INSERT INTO core.motivos_cortesia (empresa_id, codigo, nombre) VALUES
                (NULL, 'PROMOCION', 'Promoción'),
                (NULL, 'CORTESIA', 'Cortesía'),
                (NULL, 'GARANTIA', 'Garantía'),
                (NULL, 'COMPENSACION_FALLA', 'Compensación por falla'),
                (NULL, 'CONVENIO', 'Convenio');

            CREATE TABLE core.servicios_adicionales (
                id bigserial PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                adicional_id bigint NOT NULL REFERENCES core.adicionales (id),
                modalidad text NOT NULL CHECK (modalidad IN ('incluido', 'cortesia', 'cobrado')),
                identificador text,
                credencial text,
                precio numeric(14,2),
                motivo_id bigint REFERENCES core.motivos_cortesia (id),
                motivo_detalle text,
                plan_id bigint REFERENCES network.planes (id),
                estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'baja')),
                alta_en timestamptz NOT NULL DEFAULT now(),
                baja_en timestamptz,
                motivo_baja text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT servicios_adicionales_precio
                    CHECK ((modalidad = 'cobrado') = (precio IS NOT NULL) AND (precio IS NULL OR precio > 0)),
                CONSTRAINT servicios_adicionales_motivo
                    CHECK ((modalidad = 'cortesia') = (motivo_id IS NOT NULL)),
                CONSTRAINT servicios_adicionales_baja
                    CHECK ((estado = 'baja') = (baja_en IS NOT NULL))
            );
            CREATE INDEX servicios_adicionales_servicio
                ON core.servicios_adicionales (servicio_id, id DESC);
            CREATE INDEX servicios_adicionales_adicional
                ON core.servicios_adicionales (adicional_id) WHERE estado = 'activo';

            CREATE FUNCTION core.servicios_adicionales_misma_empresa() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                IF (SELECT empresa_id FROM core.adicionales WHERE id = NEW.adicional_id) <> NEW.empresa_id THEN
                    RAISE EXCEPTION 'el adicional % es de otra empresa', NEW.adicional_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'adicional_de_otra_empresa';
                END IF;
                IF TG_OP = 'INSERT'
                   AND (SELECT empresa_id FROM core.servicios WHERE id = NEW.servicio_id) <> NEW.empresa_id THEN
                    RAISE EXCEPTION 'el servicio % es de otra empresa', NEW.servicio_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'adicional_de_otra_empresa';
                END IF;
                IF NEW.motivo_id IS NOT NULL AND (
                    SELECT COALESCE(empresa_id, NEW.empresa_id) FROM core.motivos_cortesia WHERE id = NEW.motivo_id
                ) <> NEW.empresa_id THEN
                    RAISE EXCEPTION 'el motivo % es de otra empresa', NEW.motivo_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'motivo_de_otra_empresa';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER servicios_adicionales_misma_empresa
                BEFORE INSERT OR UPDATE OF empresa_id, adicional_id, motivo_id ON core.servicios_adicionales
                FOR EACH ROW EXECUTE FUNCTION core.servicios_adicionales_misma_empresa();

            CREATE TABLE network.planes_adicionales (
                id bigserial PRIMARY KEY,
                plan_id bigint NOT NULL REFERENCES network.planes (id),
                adicional_id bigint NOT NULL REFERENCES core.adicionales (id),
                cantidad integer NOT NULL DEFAULT 1 CHECK (cantidad BETWEEN 1 AND 50),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT planes_adicionales_unico UNIQUE (plan_id, adicional_id)
            );
            CREATE INDEX planes_adicionales_adicional ON network.planes_adicionales (adicional_id);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS network.planes_adicionales;
            DROP TABLE IF EXISTS core.servicios_adicionales;
            DROP FUNCTION IF EXISTS core.servicios_adicionales_misma_empresa();
            DROP TABLE IF EXISTS core.motivos_cortesia;
            DROP TABLE IF EXISTS core.adicionales;
        `)
    }
}
