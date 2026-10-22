import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 6, PR D (contrato de localización fiscal §3.7 y §7): libros legales con folio.
 *
 *  - `fiscal.libros_habilitados` (solo inserción): un rango de folios habilitado de un libro de la
 *    empresa (autorización SAT-7121 y Registro Mercantil). Los rangos de cada (empresa, libro) son
 *    correlativos: el primero empieza donde diga la autorización y cada uno nuevo empieza en el
 *    folio siguiente al último habilitado (trigger), así los folios del libro nunca saltan.
 *  - `fiscal.libros_emisiones` (solo inserción): una emisión oficial de un libro (archivo, SHA-256,
 *    folios, último sello y hash de la cadena del periodo). El trigger exige que `folio_inicial`
 *    sea el siguiente del libro (el primero habilitado si no hay emisiones) y que `folio_final`
 *    no pase del último habilitado. Una reemisión del mismo rango es otra fila con folios nuevos y
 *    `reimpresion_de` = la emisión anterior que cubría el rango.
 *
 * Los dos triggers toman el advisory lock (3031, empresa) que también toma la acción.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE fiscal.libros_habilitados (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                libro text NOT NULL CHECK (libro IN ('diario', 'mayor', 'inventarios', 'estados_financieros', 'compras', 'ventas')),
                tipo text NOT NULL DEFAULT 'computarizado' CHECK (tipo IN ('computarizado')),
                autorizacion text NOT NULL CHECK (length(btrim(autorizacion)) >= 3),
                folio_desde integer NOT NULL CHECK (folio_desde > 0),
                folio_hasta integer NOT NULL,
                fecha date NOT NULL,
                nota text,
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT libros_habilitados_rango CHECK (folio_hasta >= folio_desde)
            );
            CREATE INDEX libros_habilitados_libro ON fiscal.libros_habilitados (empresa_id, libro, folio_desde);

            CREATE TABLE fiscal.libros_emisiones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                libro text NOT NULL CHECK (libro IN ('diario', 'mayor', 'inventarios', 'estados_financieros', 'compras', 'ventas')),
                desde date NOT NULL,
                hasta date NOT NULL,
                folio_inicial integer NOT NULL CHECK (folio_inicial > 0),
                folio_final integer NOT NULL,
                paginas integer NOT NULL CHECK (paginas > 0),
                formato text NOT NULL CHECK (formato IN ('pdf', 'xlsx')),
                archivo text NOT NULL,
                tamano integer NOT NULL CHECK (tamano > 0),
                sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
                filas integer NOT NULL CHECK (filas >= 0),
                totales jsonb NOT NULL DEFAULT '{}'::jsonb,
                ultimo_sello integer,
                ultimo_hash text,
                reimpresion_de bigint REFERENCES fiscal.libros_emisiones (id),
                generado_por bigint REFERENCES core.usuarios (id),
                generado_en timestamptz NOT NULL DEFAULT now(),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT libros_emisiones_rango CHECK (hasta >= desde),
                CONSTRAINT libros_emisiones_folios CHECK (folio_final = folio_inicial + paginas - 1),
                CONSTRAINT libros_emisiones_folio_unico UNIQUE (empresa_id, libro, folio_inicial)
            );
            CREATE INDEX libros_emisiones_libro ON fiscal.libros_emisiones (empresa_id, libro, desde, hasta);

            -- rangos correlativos por (empresa, libro)
            CREATE OR REPLACE FUNCTION fiscal.validar_libro_habilitado() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_ultimo integer;
            BEGIN
                PERFORM pg_advisory_xact_lock(3031, NEW.empresa_id::integer);
                SELECT max(folio_hasta) INTO v_ultimo
                  FROM fiscal.libros_habilitados WHERE empresa_id = NEW.empresa_id AND libro = NEW.libro;
                IF v_ultimo IS NOT NULL AND NEW.folio_desde <> v_ultimo + 1 THEN
                    RAISE EXCEPTION 'La habilitación del libro % debe empezar en el folio % (sigue a la anterior)',
                        NEW.libro, v_ultimo + 1
                        USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER libros_habilitados_correlativos BEFORE INSERT ON fiscal.libros_habilitados
                FOR EACH ROW EXECUTE FUNCTION fiscal.validar_libro_habilitado();

            -- folios correlativos del libro y dentro de lo habilitado
            CREATE OR REPLACE FUNCTION fiscal.validar_libro_emision() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_siguiente integer;
                v_tope integer;
            BEGIN
                PERFORM pg_advisory_xact_lock(3031, NEW.empresa_id::integer);
                SELECT max(folio_final) + 1 INTO v_siguiente
                  FROM fiscal.libros_emisiones WHERE empresa_id = NEW.empresa_id AND libro = NEW.libro;
                SELECT coalesce(v_siguiente, min(folio_desde)), max(folio_hasta) INTO v_siguiente, v_tope
                  FROM fiscal.libros_habilitados WHERE empresa_id = NEW.empresa_id AND libro = NEW.libro;
                IF v_tope IS NULL THEN
                    RAISE EXCEPTION 'El libro % no tiene folios habilitados', NEW.libro
                        USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.folio_inicial <> v_siguiente THEN
                    RAISE EXCEPTION 'La emisión del libro % debe empezar en el folio %', NEW.libro, v_siguiente
                        USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.folio_final > v_tope THEN
                    RAISE EXCEPTION 'La emisión del libro % pasa del último folio habilitado (%)', NEW.libro, v_tope
                        USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.reimpresion_de IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM fiscal.libros_emisiones o
                     WHERE o.id = NEW.reimpresion_de AND o.empresa_id = NEW.empresa_id AND o.libro = NEW.libro
                ) THEN
                    RAISE EXCEPTION 'La reimpresión debe ser del mismo libro y empresa'
                        USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER libros_emisiones_folios BEFORE INSERT ON fiscal.libros_emisiones
                FOR EACH ROW EXECUTE FUNCTION fiscal.validar_libro_emision();

            CREATE TRIGGER libros_habilitados_inmutable BEFORE UPDATE OR DELETE ON fiscal.libros_habilitados
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER libros_habilitados_sin_truncate BEFORE TRUNCATE ON fiscal.libros_habilitados
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER libros_emisiones_inmutable BEFORE UPDATE OR DELETE ON fiscal.libros_emisiones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER libros_emisiones_sin_truncate BEFORE TRUNCATE ON fiscal.libros_emisiones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON fiscal.libros_habilitados, fiscal.libros_emisiones TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON fiscal.libros_habilitados, fiscal.libros_emisiones
                        FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS fiscal.libros_emisiones;
            DROP TABLE IF EXISTS fiscal.libros_habilitados;
            DROP FUNCTION IF EXISTS fiscal.validar_libro_emision();
            DROP FUNCTION IF EXISTS fiscal.validar_libro_habilitado();
        `)
    }
}
