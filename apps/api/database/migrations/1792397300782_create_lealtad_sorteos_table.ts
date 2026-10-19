import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · lealtad fase 3, sorteos (`contratos/lealtad.md` §7 y §8; alcance acordado con el líder):
 *
 * - `lealtad.sorteos`: bases y criterios congelados desde `bases_publicadas` (trigger), compromiso de
 *   la semilla, `lista_hash` del corte, `valor_publico` y resultado. Estados de esta fase:
 *   `borrador → bases_publicadas → participacion_abierta → corte_cerrado → ejecutado →
 *   premios_entregados`, y `cancelado` antes de `ejecutado` (`acta_cerrada` llega con la segunda PR).
 * - `lealtad.sorteos_premios`: premios del sorteo (nombre, cantidad, imagen, valor, tipo de entrega,
 *   retención de ISR); fijos desde `bases_publicadas`.
 * - `lealtad.sorteos_boletos`: boletos por criterio (al corte) y por canje de puntos; solo inserción,
 *   antes del corte.
 * - `lealtad.sorteos_participantes`: foto del corte; solo inserción.
 * - `lealtad.sorteos_ganadores`: titulares y suplentes; su estado cambia por acción.
 * - `lealtad.sorteos_requisitos`: checklist legal (§8); solo inserción, vale la última fila por clave.
 * - `lealtad.premios`: el premio `boletos` dice a qué sorteo y cuántos boletos da.
 * - `lealtad.canjes`: un premio de servicio de un sorteo se entrega como canje sin puntos
 *   (`sorteo_ganador_id`).
 * - `ledger.asientos.origen_tipo` agrega `sorteo` (entrega de premios en especie e ISR retenido).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE lealtad.sorteos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                programa_id bigint REFERENCES lealtad.programas (id),
                nombre text NOT NULL CHECK (length(btrim(nombre)) > 0),
                descripcion text,
                estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN (
                    'borrador', 'bases_publicadas', 'participacion_abierta', 'corte_cerrado', 'ejecutado',
                    'premios_entregados', 'cancelado')),
                bases jsonb NOT NULL DEFAULT '{}'::jsonb,
                criterios jsonb NOT NULL DEFAULT '{}'::jsonb,
                bases_version integer NOT NULL DEFAULT 1,
                bases_hash text,
                inscripcion_desde date,
                corte_en timestamptz,
                fecha_sorteo timestamptz,
                lugar text,
                suplentes integer NOT NULL DEFAULT 0 CHECK (suplentes BETWEEN 0 AND 20),
                algoritmo text NOT NULL DEFAULT 'argos-sorteo-v1',
                compromiso text,
                semilla_cifrada text,
                semilla text,
                valor_publico text,
                lista_hash text,
                resultado jsonb,
                asistentes jsonb,
                motivo_cancelacion text,
                publicado_en timestamptz,
                corte_cerrado_en timestamptz,
                ejecutado_en timestamptz,
                cancelado_en timestamptz,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (estado = 'borrador' OR estado = 'cancelado' OR (bases_hash IS NOT NULL AND compromiso IS NOT NULL)),
                CHECK (estado NOT IN ('ejecutado', 'premios_entregados') OR (semilla IS NOT NULL AND valor_publico IS NOT NULL AND lista_hash IS NOT NULL)),
                CHECK ((estado = 'cancelado') = (cancelado_en IS NOT NULL))
            );
            CREATE INDEX sorteos_empresa ON lealtad.sorteos (empresa_id, id DESC);

            -- bases, criterios y fechas congelados desde que se publican; la semilla nunca cambia
            CREATE FUNCTION lealtad.congelar_sorteo() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF OLD.estado <> 'borrador' AND (
                    NEW.bases IS DISTINCT FROM OLD.bases OR NEW.criterios IS DISTINCT FROM OLD.criterios
                    OR NEW.nombre IS DISTINCT FROM OLD.nombre OR NEW.descripcion IS DISTINCT FROM OLD.descripcion
                    OR NEW.inscripcion_desde IS DISTINCT FROM OLD.inscripcion_desde
                    OR NEW.corte_en IS DISTINCT FROM OLD.corte_en OR NEW.fecha_sorteo IS DISTINCT FROM OLD.fecha_sorteo
                    OR NEW.lugar IS DISTINCT FROM OLD.lugar OR NEW.suplentes IS DISTINCT FROM OLD.suplentes
                    OR NEW.bases_hash IS DISTINCT FROM OLD.bases_hash OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
                    OR NEW.algoritmo IS DISTINCT FROM OLD.algoritmo) THEN
                    RAISE EXCEPTION 'Las bases del sorteo % ya se publicaron: no cambian', OLD.id USING ERRCODE = '23514';
                END IF;
                IF OLD.compromiso IS NOT NULL AND (NEW.compromiso IS DISTINCT FROM OLD.compromiso
                    OR NEW.semilla_cifrada IS DISTINCT FROM OLD.semilla_cifrada) THEN
                    RAISE EXCEPTION 'La semilla del sorteo % ya está comprometida', OLD.id USING ERRCODE = '23514';
                END IF;
                IF OLD.lista_hash IS NOT NULL AND NEW.lista_hash IS DISTINCT FROM OLD.lista_hash THEN
                    RAISE EXCEPTION 'El corte del sorteo % ya se cerró', OLD.id USING ERRCODE = '23514';
                END IF;
                IF OLD.resultado IS NOT NULL AND (NEW.resultado IS DISTINCT FROM OLD.resultado
                    OR NEW.semilla IS DISTINCT FROM OLD.semilla OR NEW.valor_publico IS DISTINCT FROM OLD.valor_publico) THEN
                    RAISE EXCEPTION 'El sorteo % ya se ejecutó', OLD.id USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER sorteos_congelar BEFORE UPDATE ON lealtad.sorteos
                FOR EACH ROW EXECUTE FUNCTION lealtad.congelar_sorteo();

            CREATE TABLE lealtad.sorteos_premios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                sorteo_id bigint NOT NULL REFERENCES lealtad.sorteos (id),
                posicion integer NOT NULL CHECK (posicion BETWEEN 1 AND 100),
                nombre text NOT NULL CHECK (length(btrim(nombre)) > 0),
                cantidad integer NOT NULL DEFAULT 1 CHECK (cantidad BETWEEN 1 AND 100),
                imagen_url text,
                valor numeric(14, 2) NOT NULL CHECK (valor > 0),
                tipo text NOT NULL CHECK (tipo IN ('efectivo', 'bien', 'servicio')),
                premio_id bigint REFERENCES lealtad.premios (id),
                retiene_isr boolean NOT NULL DEFAULT false,
                isr_pct numeric(5, 2) NOT NULL DEFAULT 10 CHECK (isr_pct >= 0 AND isr_pct <= 100),
                CONSTRAINT sorteos_premios_posicion UNIQUE (sorteo_id, posicion),
                CHECK (tipo <> 'servicio' OR premio_id IS NOT NULL)
            );
            CREATE FUNCTION lealtad.premios_sorteo_en_borrador() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                estado_sorteo text;
            BEGIN
                SELECT estado INTO estado_sorteo FROM lealtad.sorteos WHERE id = coalesce(NEW.sorteo_id, OLD.sorteo_id);
                IF estado_sorteo <> 'borrador' THEN
                    RAISE EXCEPTION 'Los premios del sorteo ya se publicaron: no cambian' USING ERRCODE = '23514';
                END IF;
                RETURN coalesce(NEW, OLD);
            END $$;
            CREATE TRIGGER sorteos_premios_borrador BEFORE INSERT OR UPDATE OR DELETE ON lealtad.sorteos_premios
                FOR EACH ROW EXECUTE FUNCTION lealtad.premios_sorteo_en_borrador();

            CREATE TABLE lealtad.sorteos_boletos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                sorteo_id bigint NOT NULL REFERENCES lealtad.sorteos (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                boletos integer NOT NULL CHECK (boletos > 0),
                origen text NOT NULL CHECK (origen IN ('criterio', 'canje', 'regla')),
                canje_id bigint UNIQUE REFERENCES lealtad.canjes (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((origen = 'canje') = (canje_id IS NOT NULL))
            );
            CREATE INDEX sorteos_boletos_sorteo ON lealtad.sorteos_boletos (sorteo_id, cliente_id);
            CREATE FUNCTION lealtad.boletos_antes_del_corte() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                estado_sorteo text;
            BEGIN
                SELECT estado INTO estado_sorteo FROM lealtad.sorteos WHERE id = NEW.sorteo_id FOR SHARE;
                IF estado_sorteo <> 'participacion_abierta' THEN
                    RAISE EXCEPTION 'El sorteo % no está abierto a la participación', NEW.sorteo_id USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER sorteos_boletos_abierto BEFORE INSERT ON lealtad.sorteos_boletos
                FOR EACH ROW EXECUTE FUNCTION lealtad.boletos_antes_del_corte();

            CREATE TABLE lealtad.sorteos_participantes (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                sorteo_id bigint NOT NULL REFERENCES lealtad.sorteos (id),
                orden integer NOT NULL CHECK (orden >= 1),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                servicio_id bigint REFERENCES core.servicios (id),
                codigo_publico text NOT NULL,
                boletos integer NOT NULL CHECK (boletos > 0),
                CONSTRAINT sorteos_participantes_cliente UNIQUE (sorteo_id, cliente_id),
                CONSTRAINT sorteos_participantes_codigo UNIQUE (sorteo_id, codigo_publico),
                CONSTRAINT sorteos_participantes_orden UNIQUE (sorteo_id, orden)
            );

            CREATE TABLE lealtad.sorteos_ganadores (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                sorteo_id bigint NOT NULL REFERENCES lealtad.sorteos (id),
                posicion integer NOT NULL CHECK (posicion >= 1),
                tipo text NOT NULL CHECK (tipo IN ('titular', 'suplente')),
                participante_id bigint NOT NULL REFERENCES lealtad.sorteos_participantes (id),
                premio_posicion integer,
                estado text NOT NULL DEFAULT 'por_notificar' CHECK (estado IN (
                    'por_notificar', 'notificado', 'entregado', 'no_reclamado', 'sustituido')),
                retencion_isr numeric(14, 2) CHECK (retencion_isr >= 0),
                contrapartida text,
                asiento_id bigint REFERENCES ledger.asientos (id),
                egreso_id bigint REFERENCES ledger.egresos (id),
                canje_id bigint REFERENCES lealtad.canjes (id),
                nota text,
                entregado_en timestamptz,
                entregado_por bigint REFERENCES core.usuarios (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT sorteos_ganadores_posicion UNIQUE (sorteo_id, posicion),
                CONSTRAINT sorteos_ganadores_participante UNIQUE (sorteo_id, participante_id),
                CHECK ((tipo = 'titular') = (premio_posicion IS NOT NULL)),
                CHECK ((estado = 'entregado') = (entregado_en IS NOT NULL))
            );

            CREATE TABLE lealtad.sorteos_requisitos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                sorteo_id bigint NOT NULL REFERENCES lealtad.sorteos (id),
                clave text NOT NULL CHECK (clave IN (
                    'bases_diaco', 'autorizacion_gobernacion', 'fianza', 'isr_premios', 'timbre_fiscal',
                    'delegado_o_notario', 'publicacion_resultados', 'lista_a_gobernacion')),
                estado text NOT NULL CHECK (estado IN ('cumplido', 'no_aplica', 'pendiente')),
                valor text,
                evidencia text,
                nota text,
                marcado_por bigint REFERENCES core.usuarios (id),
                marcado_en timestamptz NOT NULL DEFAULT now(),
                CHECK (estado = 'pendiente' OR length(btrim(coalesce(evidencia, ''))) > 0)
            );
            CREATE INDEX sorteos_requisitos_clave ON lealtad.sorteos_requisitos (sorteo_id, clave, id DESC);

            CREATE TRIGGER sorteos_boletos_inmutable BEFORE UPDATE OR DELETE ON lealtad.sorteos_boletos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER sorteos_participantes_inmutable BEFORE UPDATE OR DELETE ON lealtad.sorteos_participantes
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER sorteos_requisitos_inmutable BEFORE UPDATE OR DELETE ON lealtad.sorteos_requisitos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();

            ALTER TABLE lealtad.premios
                ADD COLUMN sorteo_id bigint REFERENCES lealtad.sorteos (id),
                ADD COLUMN boletos integer CHECK (boletos BETWEEN 1 AND 1000),
                ADD CONSTRAINT premios_boletos CHECK (tipo <> 'boletos' OR (sorteo_id IS NOT NULL AND boletos IS NOT NULL));

            ALTER TABLE lealtad.canjes
                ADD COLUMN sorteo_ganador_id bigint UNIQUE REFERENCES lealtad.sorteos_ganadores (id),
                DROP CONSTRAINT canjes_puntos_check,
                ADD CONSTRAINT canjes_puntos CHECK (puntos > 0 OR (puntos = 0 AND sorteo_ganador_id IS NOT NULL));

            ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
            ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN (
                'factura', 'pago', 'mora', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste',
                'compra', 'pago_proveedor', 'retencion', 'liquidacion_impuesto', 'pago_impuesto', 'cierre_anual',
                'reclasificacion', 'liquidacion_cobro', 'deposito', 'traslado', 'banco', 'provision', 'castigo',
                'diferencia_cobro', 'depreciacion', 'baja_activo', 'diferido', 'lealtad', 'sorteo'));

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON lealtad.sorteos, lealtad.sorteos_ganadores TO argosisp_app;
                    GRANT SELECT, INSERT, UPDATE, DELETE ON lealtad.sorteos_premios TO argosisp_app;
                    GRANT SELECT, INSERT ON lealtad.sorteos_boletos, lealtad.sorteos_participantes,
                        lealtad.sorteos_requisitos TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON lealtad.sorteos_boletos, lealtad.sorteos_participantes,
                        lealtad.sorteos_requisitos FROM argosisp_app;
                    REVOKE DELETE, TRUNCATE ON lealtad.sorteos, lealtad.sorteos_ganadores FROM argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA lealtad TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
            ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN (
                'factura', 'pago', 'mora', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste',
                'compra', 'pago_proveedor', 'retencion', 'liquidacion_impuesto', 'pago_impuesto', 'cierre_anual',
                'reclasificacion', 'liquidacion_cobro', 'deposito', 'traslado', 'banco', 'provision', 'castigo',
                'diferencia_cobro', 'depreciacion', 'baja_activo', 'diferido', 'lealtad')) NOT VALID;
            ALTER TABLE lealtad.canjes DROP CONSTRAINT IF EXISTS canjes_puntos;
            ALTER TABLE lealtad.canjes DROP COLUMN IF EXISTS sorteo_ganador_id;
            ALTER TABLE lealtad.canjes ADD CONSTRAINT canjes_puntos_check CHECK (puntos > 0) NOT VALID;
            ALTER TABLE lealtad.premios DROP CONSTRAINT IF EXISTS premios_boletos;
            ALTER TABLE lealtad.premios DROP COLUMN IF EXISTS boletos, DROP COLUMN IF EXISTS sorteo_id;
            DROP TABLE IF EXISTS lealtad.sorteos_requisitos;
            DROP TABLE IF EXISTS lealtad.sorteos_ganadores;
            DROP TABLE IF EXISTS lealtad.sorteos_participantes;
            DROP TABLE IF EXISTS lealtad.sorteos_boletos;
            DROP TABLE IF EXISTS lealtad.sorteos_premios;
            DROP TABLE IF EXISTS lealtad.sorteos;
            DROP FUNCTION IF EXISTS lealtad.boletos_antes_del_corte();
            DROP FUNCTION IF EXISTS lealtad.premios_sorteo_en_borrador();
            DROP FUNCTION IF EXISTS lealtad.congelar_sorteo();
        `)
    }
}
