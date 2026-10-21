import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · sorteos, segunda PR (`contratos/lealtad.md` §7.3 punto 6, §7.4 y §8):
 *
 * - `lealtad.sorteos_archivos` (solo inserción): evidencias del checklist, imágenes de premios, el acta y
 *   las constancias de entrega. El archivo vive en disco (`COMPROBANTES_DIR/sorteos/`); la fila guarda
 *   ruta, tipo (por firma), tamaño, SHA-256 y, en imágenes, ancho y alto.
 * - `sorteos_requisitos.archivo_id`: evidencia como archivo.
 * - `sorteos_premios.imagen_archivo_id`: la imagen del premio se sube (el portal no carga URLs externas).
 * - `sorteos`: estado `acta_cerrada` (entre `ejecutado` y `premios_entregados`), `acta_archivo_id`,
 *   `acta_hash`, `acta_cerrada_en`, `acta_constancia`; `aviso_portal` (el panel decide si se anuncia en el
 *   portal; editable hasta antes de ejecutar).
 * - `sorteos_ganadores`: `notificado_en`, `reclamar_antes`, `sustituye_a` y `premio_sustitucion` (el
 *   suplente que toma el premio de un ganador que no lo reclamó), `no_reclamado_en`,
 *   `constancia_archivo_id`.
 * - El trigger del estado admite `acta_cerrada` y la reapertura de una entrega anulada hacia
 *   `acta_cerrada` o `ejecutado`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE lealtad.sorteos_archivos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                sorteo_id bigint NOT NULL REFERENCES lealtad.sorteos (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                uso text NOT NULL CHECK (uso IN ('evidencia', 'imagen_premio', 'acta', 'constancia')),
                nombre text NOT NULL CHECK (length(btrim(nombre)) > 0),
                tipo text NOT NULL CHECK (tipo IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
                tamano integer NOT NULL CHECK (tamano > 0),
                sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
                ruta text NOT NULL UNIQUE,
                ancho integer,
                alto integer,
                subido_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((ancho IS NULL) = (alto IS NULL))
            );
            CREATE INDEX sorteos_archivos_sorteo ON lealtad.sorteos_archivos (sorteo_id, id DESC);
            CREATE TRIGGER sorteos_archivos_inmutable BEFORE UPDATE OR DELETE ON lealtad.sorteos_archivos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER sorteos_archivos_sin_truncate BEFORE TRUNCATE ON lealtad.sorteos_archivos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            ALTER TABLE lealtad.sorteos_requisitos
                ADD COLUMN archivo_id bigint REFERENCES lealtad.sorteos_archivos (id);
            ALTER TABLE lealtad.sorteos_premios
                ADD COLUMN imagen_archivo_id bigint REFERENCES lealtad.sorteos_archivos (id);

            ALTER TABLE lealtad.sorteos
                ADD COLUMN aviso_portal boolean NOT NULL DEFAULT false,
                ADD COLUMN acta_archivo_id bigint REFERENCES lealtad.sorteos_archivos (id),
                ADD COLUMN acta_hash text,
                ADD COLUMN acta_constancia text,
                ADD COLUMN acta_cerrada_en timestamptz;
            ALTER TABLE lealtad.sorteos DROP CONSTRAINT sorteos_estado_check;
            ALTER TABLE lealtad.sorteos ADD CONSTRAINT sorteos_estado_check CHECK (estado IN (
                'borrador', 'bases_publicadas', 'participacion_abierta', 'corte_cerrado', 'ejecutado',
                'acta_cerrada', 'premios_entregados', 'cancelado'));
            DO $$
            DECLARE
                nombre text;
            BEGIN
                SELECT c.conname INTO nombre FROM pg_constraint c
                 WHERE c.conrelid = 'lealtad.sorteos'::regclass AND c.contype = 'c'
                   AND pg_get_constraintdef(c.oid) LIKE '%semilla IS NOT NULL%';
                EXECUTE format('ALTER TABLE lealtad.sorteos DROP CONSTRAINT %I', nombre);
            END $$;
            ALTER TABLE lealtad.sorteos ADD CONSTRAINT sorteos_resultado_al_ejecutar
                CHECK (estado NOT IN ('ejecutado', 'acta_cerrada', 'premios_entregados')
                       OR (semilla IS NOT NULL AND valor_publico IS NOT NULL AND lista_hash IS NOT NULL));
            ALTER TABLE lealtad.sorteos ADD CONSTRAINT sorteos_acta
                CHECK ((acta_hash IS NULL) = (acta_cerrada_en IS NULL)
                       AND (acta_hash IS NULL) = (acta_archivo_id IS NULL)
                       AND (estado NOT IN ('acta_cerrada') OR acta_hash IS NOT NULL));

            ALTER TABLE lealtad.sorteos_ganadores
                ADD COLUMN notificado_en timestamptz,
                ADD COLUMN reclamar_antes timestamptz,
                ADD COLUMN no_reclamado_en timestamptz,
                ADD COLUMN sustituye_a bigint UNIQUE REFERENCES lealtad.sorteos_ganadores (id),
                ADD COLUMN premio_sustitucion integer,
                ADD COLUMN constancia_archivo_id bigint REFERENCES lealtad.sorteos_archivos (id),
                ADD CONSTRAINT sorteos_ganadores_sustitucion
                    CHECK ((sustituye_a IS NULL) = (premio_sustitucion IS NULL)
                           AND (sustituye_a IS NULL OR tipo = 'suplente')),
                ADD CONSTRAINT sorteos_ganadores_notificado
                    CHECK ((notificado_en IS NULL) = (reclamar_antes IS NULL));

            CREATE OR REPLACE FUNCTION lealtad.sorteo_estado_avanza() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                orden CONSTANT text[] := ARRAY['borrador', 'bases_publicadas', 'participacion_abierta',
                    'corte_cerrado', 'ejecutado', 'acta_cerrada', 'premios_entregados'];
                de integer;
                a integer;
            BEGIN
                IF OLD.acta_hash IS NOT NULL AND (NEW.acta_hash IS DISTINCT FROM OLD.acta_hash
                    OR NEW.acta_archivo_id IS DISTINCT FROM OLD.acta_archivo_id) THEN
                    RAISE EXCEPTION 'El acta del sorteo % ya se cerró', OLD.id USING ERRCODE = '23514';
                END IF;
                IF OLD.resultado IS NOT NULL AND NEW.aviso_portal IS DISTINCT FROM OLD.aviso_portal THEN
                    RAISE EXCEPTION 'El sorteo % ya se ejecutó: el aviso en el portal no cambia', OLD.id
                        USING ERRCODE = '23514';
                END IF;
                IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
                    IF OLD.resultado IS NOT NULL
                       AND NEW.valor_publico_evidencia IS DISTINCT FROM OLD.valor_publico_evidencia THEN
                        RAISE EXCEPTION 'El sorteo % ya se ejecutó', OLD.id USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END IF;
                IF OLD.estado = 'cancelado' THEN
                    RAISE EXCEPTION 'El sorteo % está cancelado', OLD.id USING ERRCODE = '23514';
                END IF;
                IF NEW.estado = 'cancelado' THEN
                    IF OLD.estado IN ('ejecutado', 'acta_cerrada', 'premios_entregados') THEN
                        RAISE EXCEPTION 'El sorteo % ya se ejecutó: no se cancela', OLD.id USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END IF;
                de := array_position(orden, OLD.estado);
                a := array_position(orden, NEW.estado);
                IF OLD.estado = 'premios_entregados' AND NEW.estado IN ('ejecutado', 'acta_cerrada')
                   AND coalesce(current_setting('lealtad.reabrir_entrega', true), '') = 'on' THEN
                    RETURN NEW;
                END IF;
                IF a IS NULL OR de IS NULL OR a <= de THEN
                    RAISE EXCEPTION 'El sorteo % no vuelve de % a %', OLD.id, OLD.estado, NEW.estado
                        USING ERRCODE = '23514';
                END IF;
                IF OLD.valor_publico_evidencia IS NOT NULL
                   AND NEW.valor_publico_evidencia IS DISTINCT FROM OLD.valor_publico_evidencia THEN
                    RAISE EXCEPTION 'El sorteo % ya se ejecutó', OLD.id USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON lealtad.sorteos_archivos TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON lealtad.sorteos_archivos FROM argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA lealtad TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION lealtad.sorteo_estado_avanza() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                orden CONSTANT text[] := ARRAY['borrador', 'bases_publicadas', 'participacion_abierta',
                    'corte_cerrado', 'ejecutado', 'premios_entregados'];
                de integer;
                a integer;
            BEGIN
                IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
                    IF OLD.resultado IS NOT NULL
                       AND NEW.valor_publico_evidencia IS DISTINCT FROM OLD.valor_publico_evidencia THEN
                        RAISE EXCEPTION 'El sorteo % ya se ejecutó', OLD.id USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END IF;
                IF OLD.estado = 'cancelado' THEN
                    RAISE EXCEPTION 'El sorteo % está cancelado', OLD.id USING ERRCODE = '23514';
                END IF;
                IF NEW.estado = 'cancelado' THEN
                    IF OLD.estado IN ('ejecutado', 'premios_entregados') THEN
                        RAISE EXCEPTION 'El sorteo % ya se ejecutó: no se cancela', OLD.id USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END IF;
                de := array_position(orden, OLD.estado);
                a := array_position(orden, NEW.estado);
                IF OLD.estado = 'premios_entregados' AND NEW.estado = 'ejecutado'
                   AND coalesce(current_setting('lealtad.reabrir_entrega', true), '') = 'on' THEN
                    RETURN NEW;
                END IF;
                IF a IS NULL OR de IS NULL OR a <= de THEN
                    RAISE EXCEPTION 'El sorteo % no vuelve de % a %', OLD.id, OLD.estado, NEW.estado
                        USING ERRCODE = '23514';
                END IF;
                IF OLD.valor_publico_evidencia IS NOT NULL
                   AND NEW.valor_publico_evidencia IS DISTINCT FROM OLD.valor_publico_evidencia THEN
                    RAISE EXCEPTION 'El sorteo % ya se ejecutó', OLD.id USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
            ALTER TABLE lealtad.sorteos_ganadores
                DROP CONSTRAINT IF EXISTS sorteos_ganadores_sustitucion,
                DROP CONSTRAINT IF EXISTS sorteos_ganadores_notificado,
                DROP COLUMN IF EXISTS constancia_archivo_id,
                DROP COLUMN IF EXISTS premio_sustitucion,
                DROP COLUMN IF EXISTS sustituye_a,
                DROP COLUMN IF EXISTS no_reclamado_en,
                DROP COLUMN IF EXISTS reclamar_antes,
                DROP COLUMN IF EXISTS notificado_en;
            ALTER TABLE lealtad.sorteos DROP CONSTRAINT IF EXISTS sorteos_acta;
            ALTER TABLE lealtad.sorteos DROP CONSTRAINT IF EXISTS sorteos_resultado_al_ejecutar;
            ALTER TABLE lealtad.sorteos DROP CONSTRAINT sorteos_estado_check;
            ALTER TABLE lealtad.sorteos ADD CONSTRAINT sorteos_estado_check CHECK (estado IN (
                'borrador', 'bases_publicadas', 'participacion_abierta', 'corte_cerrado', 'ejecutado',
                'premios_entregados', 'cancelado')) NOT VALID;
            ALTER TABLE lealtad.sorteos ADD CONSTRAINT sorteos_resultado_ejecutado
                CHECK (estado NOT IN ('ejecutado', 'premios_entregados')
                       OR (semilla IS NOT NULL AND valor_publico IS NOT NULL AND lista_hash IS NOT NULL)) NOT VALID;
            ALTER TABLE lealtad.sorteos
                DROP COLUMN IF EXISTS acta_cerrada_en,
                DROP COLUMN IF EXISTS acta_constancia,
                DROP COLUMN IF EXISTS acta_hash,
                DROP COLUMN IF EXISTS acta_archivo_id,
                DROP COLUMN IF EXISTS aviso_portal;
            ALTER TABLE lealtad.sorteos_premios DROP COLUMN IF EXISTS imagen_archivo_id;
            ALTER TABLE lealtad.sorteos_requisitos DROP COLUMN IF EXISTS archivo_id;
            DROP TABLE IF EXISTS lealtad.sorteos_archivos;
        `)
    }
}
