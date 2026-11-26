import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'
import { instalarPaquete, instalacionVigente, paqueteDePais } from '#fiscal/instalador'

/**
 * A3 · B1 del plan de contabilidad (`contratos/plan-contabilidad.md` §5.7, decisiones del PM del
 * 26 nov 2026): **cajas de cobros, custodia y entrega con «Recibí»**. Corrige E1 (la entrega al
 * cerrar no tenía asiento y lo entregado no se podía depositar).
 *
 * - `ledger.cajas`: `tipo` (`cobros` | `gastos`; la caja chica llega en B9) y `fondo_fijo` (null =
 *   el fondo de cambio de la empresa).
 * - `ledger.cajas_ajustes`: por empresa, el fondo de cambio de las cajas de cobros (Q200), el plazo
 *   (1 día hábil) y el tope (Q5,000) de la custodia por persona y si se permite «lo deposito yo».
 *   Sin fila = los valores de fábrica.
 * - `ledger.cajas_turnos.fondo_esperado`: lo que debía haber al abrir (lo que quedó del turno
 *   anterior, o el fondo fijo en el primero). El fondo de apertura ya no se escribe a mano.
 * - `ledger.entregas`: caja de cobros → custodia de una persona, al cerrar el turno. Sin asiento
 *   hasta que quien recibe dice «Recibí». Una entrega vigente por turno (una rechazada se puede
 *   volver a entregar).
 * - `ledger.entregas_recepciones`: «Recibí» (asiento `1.1.15 Efectivo en custodia / Caja`, con la
 *   diferencia a cargo de quien entregó) o «No lo recibí». Una por entrega.
 * - `ledger.depositos`: también salen de la custodia de quien deposita (`origen = custodia`, sin
 *   caja ni turno: el efectivo ya no es de una caja); los de un turno abierto (`origen = turno`)
 *   siguen como estaban.
 * - Origen de asiento `entrega_caja` (origen_id = la entrega).
 * - Historial: cada turno cerrado con `entregado_monto > 0` y `entregado_a` pasa a una entrega
 *   «por recibir» (`origen = migracion`): ese efectivo sigue en la cuenta de la caja del libro
 *   hasta que su receptor diga «Recibí» o «No lo recibí». Ningún turno ni asiento se toca.
 * - gt-2026.6: `1.1.15 Efectivo en custodia` en cada empresa instalada.
 *
 * Las tablas nuevas son de solo inserción (trigger y REVOKE), como el resto del libro.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.cajas
                ADD COLUMN tipo text NOT NULL DEFAULT 'cobros'
                    CONSTRAINT cajas_tipo CHECK (tipo IN ('cobros', 'gastos')),
                ADD COLUMN fondo_fijo numeric(14, 2)
                    CONSTRAINT cajas_fondo_fijo CHECK (fondo_fijo IS NULL OR fondo_fijo >= 0);

            CREATE TABLE ledger.cajas_ajustes (
                empresa_id bigint PRIMARY KEY REFERENCES core.empresas (id),
                fondo_cobros numeric(14, 2) NOT NULL DEFAULT 200.00 CHECK (fondo_cobros >= 0),
                custodia_plazo_dias integer NOT NULL DEFAULT 1 CHECK (custodia_plazo_dias BETWEEN 0 AND 30),
                custodia_tope numeric(14, 2) NOT NULL DEFAULT 5000.00 CHECK (custodia_tope >= 0),
                autoentrega boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                actualizado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            ALTER TABLE ledger.cajas_turnos
                ADD COLUMN fondo_esperado numeric(14, 2)
                    CONSTRAINT cajas_turnos_fondo_esperado CHECK (fondo_esperado IS NULL OR fondo_esperado >= 0);

            -- el cierre tampoco cambia lo que debía haber al abrir
            CREATE OR REPLACE FUNCTION ledger.proteger_turno_caja() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'El turno de caja % no se puede borrar', OLD.id
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                IF OLD.cerrado_en IS NOT NULL THEN
                    RAISE EXCEPTION 'El turno de caja % ya está cerrado: no se puede modificar', OLD.id
                        USING ERRCODE = 'insufficient_privilege',
                              HINT = 'Una diferencia se corrige con un asiento, nunca editando el cierre.';
                END IF;
                IF NEW.cerrado_en IS NULL THEN
                    RAISE EXCEPTION 'El turno de caja % solo admite su cierre', OLD.id
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                IF NEW.id IS DISTINCT FROM OLD.id
                   OR NEW.caja_id IS DISTINCT FROM OLD.caja_id
                   OR NEW.abierto_en IS DISTINCT FROM OLD.abierto_en
                   OR NEW.abierto_por IS DISTINCT FROM OLD.abierto_por
                   OR NEW.fondo_inicial IS DISTINCT FROM OLD.fondo_inicial
                   OR NEW.fondo_esperado IS DISTINCT FROM OLD.fondo_esperado
                   OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                    RAISE EXCEPTION 'El cierre del turno de caja % no puede cambiar los datos de apertura', OLD.id
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                RETURN NEW;
            END
            $fn$;

            CREATE TABLE ledger.entregas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                caja_id bigint NOT NULL REFERENCES ledger.cajas (id),
                turno_id bigint NOT NULL REFERENCES ledger.cajas_turnos (id),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                entregado_por bigint REFERENCES core.usuarios (id),
                recibe_id bigint NOT NULL REFERENCES core.usuarios (id),
                autoentrega boolean NOT NULL DEFAULT false,
                origen text NOT NULL DEFAULT 'cierre' CHECK (origen IN ('cierre', 'reentrega', 'migracion')),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX entregas_turno ON ledger.entregas (turno_id);
            CREATE INDEX entregas_recibe ON ledger.entregas (empresa_id, recibe_id);

            CREATE TABLE ledger.entregas_recepciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                entrega_id bigint NOT NULL UNIQUE REFERENCES ledger.entregas (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                resultado text NOT NULL CHECK (resultado IN ('recibida', 'rechazada')),
                recibido_por bigint REFERENCES core.usuarios (id),
                contado numeric(14, 2) CHECK (contado IS NULL OR contado >= 0),
                diferencia numeric(14, 2),
                motivo text,
                fecha date NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT entregas_recepciones_contado CHECK (
                    (resultado = 'recibida') = (contado IS NOT NULL AND diferencia IS NOT NULL)),
                CONSTRAINT entregas_recepciones_motivo CHECK (
                    (resultado = 'recibida' AND diferencia = 0) OR length(btrim(coalesce(motivo, ''))) >= 3)
            );
            CREATE INDEX entregas_recepciones_persona ON ledger.entregas_recepciones (empresa_id, recibido_por);

            -- la entrega sale de un turno cerrado de una caja de cobros de la empresa, por no más de lo
            -- contado y con una sola entrega vigente (sin «No lo recibí») por turno; la recepción es de la
            -- empresa de la entrega y su diferencia es contado − monto
            CREATE OR REPLACE FUNCTION ledger.validar_entrega() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_monto numeric;
            BEGIN
                IF TG_TABLE_NAME = 'entregas' THEN
                    IF NOT EXISTS (SELECT 1 FROM ledger.cajas c JOIN ledger.cajas_turnos t ON t.caja_id = c.id
                                    WHERE c.id = NEW.caja_id AND t.id = NEW.turno_id AND c.empresa_id = NEW.empresa_id
                                      AND c.tipo = 'cobros' AND t.cerrado_en IS NOT NULL
                                      AND NEW.monto <= t.contado) THEN
                        RAISE EXCEPTION 'La entrega necesita un turno cerrado de una caja de cobros de la empresa % (y no más de lo contado)', NEW.empresa_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'entrega_sin_turno';
                    END IF;
                    IF EXISTS (SELECT 1 FROM ledger.entregas e WHERE e.turno_id = NEW.turno_id
                                 AND NOT EXISTS (SELECT 1 FROM ledger.entregas_recepciones r
                                                  WHERE r.entrega_id = e.id AND r.resultado = 'rechazada')) THEN
                        RAISE EXCEPTION 'El turno % ya tiene una entrega vigente', NEW.turno_id
                            USING ERRCODE = 'unique_violation', CONSTRAINT = 'entrega_vigente_unica';
                    END IF;
                ELSE
                    SELECT e.monto INTO v_monto FROM ledger.entregas e
                     WHERE e.id = NEW.entrega_id AND e.empresa_id = NEW.empresa_id;
                    IF NOT FOUND THEN
                        RAISE EXCEPTION 'La recepción no es de la empresa de la entrega %', NEW.entrega_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'recepcion_otra_empresa';
                    END IF;
                    IF NEW.resultado = 'recibida' AND NEW.diferencia <> NEW.contado - v_monto THEN
                        RAISE EXCEPTION 'La diferencia de la recepción de la entrega % no es contado − monto', NEW.entrega_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'recepcion_diferencia';
                    END IF;
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER entregas_validar BEFORE INSERT ON ledger.entregas
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_entrega();
            CREATE TRIGGER entregas_recepciones_validar BEFORE INSERT ON ledger.entregas_recepciones
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_entrega();

            CREATE TRIGGER entregas_inmutable BEFORE UPDATE OR DELETE ON ledger.entregas
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER entregas_sin_truncate BEFORE TRUNCATE ON ledger.entregas
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER entregas_recepciones_inmutable BEFORE UPDATE OR DELETE ON ledger.entregas_recepciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER entregas_recepciones_sin_truncate BEFORE TRUNCATE ON ledger.entregas_recepciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            -- depósito desde la custodia de una persona (sin turno) o, como antes, desde un turno abierto
            ALTER TABLE ledger.depositos
                ALTER COLUMN caja_id DROP NOT NULL,
                ALTER COLUMN turno_id DROP NOT NULL,
                ADD COLUMN origen text NOT NULL DEFAULT 'turno' CHECK (origen IN ('turno', 'custodia')),
                ADD COLUMN custodio_id bigint REFERENCES core.usuarios (id),
                ADD CONSTRAINT depositos_origen CHECK (
                    (origen = 'turno' AND turno_id IS NOT NULL AND caja_id IS NOT NULL)
                    OR (origen = 'custodia' AND turno_id IS NULL AND caja_id IS NULL AND custodio_id IS NOT NULL));
            CREATE INDEX depositos_custodio ON ledger.depositos (empresa_id, custodio_id) WHERE origen = 'custodia';

            CREATE OR REPLACE FUNCTION ledger.validar_transito() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_cuenta record;
                v_ids bigint[];
                v_id bigint;
            BEGIN
                IF TG_TABLE_NAME = 'depositos' THEN
                    IF NEW.turno_id IS NOT NULL AND NOT EXISTS (
                                   SELECT 1 FROM ledger.cajas c JOIN ledger.cajas_turnos t ON t.caja_id = c.id
                                    WHERE c.id = NEW.caja_id AND t.id = NEW.turno_id AND c.empresa_id = NEW.empresa_id
                                      AND t.cerrado_en IS NULL) THEN
                        RAISE EXCEPTION 'El depósito necesita el turno abierto de una caja de la empresa %', NEW.empresa_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'deposito_sin_turno';
                    END IF;
                    v_ids := ARRAY[NEW.cuenta_id];
                ELSIF TG_TABLE_NAME = 'traslados' THEN
                    v_ids := ARRAY[NEW.cuenta_origen_id, NEW.cuenta_destino_id];
                ELSE
                    IF NEW.tipo = 'deposito' AND NOT EXISTS (SELECT 1 FROM ledger.depositos d WHERE d.id = NEW.documento_id
                            AND d.empresa_id = NEW.empresa_id AND d.cuenta_id = NEW.cuenta_id)
                       OR NEW.tipo = 'traslado' AND NOT EXISTS (SELECT 1 FROM ledger.traslados x WHERE x.id = NEW.documento_id
                            AND x.empresa_id = NEW.empresa_id AND x.cuenta_destino_id = NEW.cuenta_id) THEN
                        RAISE EXCEPTION 'La llegada del % % no es a su cuenta de destino', NEW.tipo, NEW.documento_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'transito_otra_cuenta';
                    END IF;
                    v_ids := ARRAY[NEW.cuenta_id];
                END IF;
                FOREACH v_id IN ARRAY v_ids LOOP
                    SELECT codigo, empresa_id INTO v_cuenta FROM ledger.cuentas WHERE id = v_id;
                    IF v_cuenta.codigo NOT LIKE '1.1.02.%' THEN
                        RAISE EXCEPTION 'La cuenta % no es un banco del libro', v_cuenta.codigo
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'transito_cuenta_banco';
                    END IF;
                    IF v_cuenta.empresa_id IS NOT NULL AND v_cuenta.empresa_id <> NEW.empresa_id THEN
                        RAISE EXCEPTION 'La cuenta % es de otra empresa', v_cuenta.codigo
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'cuenta_de_otra_empresa';
                    END IF;
                END LOOP;
                RETURN NEW;
            END
            $fn$;

            -- origen del asiento de la recepción de una entrega
            DO $$
            DECLARE
                valores text[];
            BEGIN
                SELECT array_agg(DISTINCT m[1]) INTO valores
                  FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
                 WHERE c.conname = 'asientos_origen_tipo_check' AND c.conrelid = 'ledger.asientos'::regclass;
                IF NOT 'entrega_caja' = ANY (valores) THEN
                    valores := valores || 'entrega_caja'::text;
                END IF;
                ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
                EXECUTE format('ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo = ANY (%L::text[]))', valores);
            END $$;

            -- historial: lo entregado al cerrar antes de B1 queda «por recibir» a nombre de su receptor
            INSERT INTO ledger.entregas (empresa_id, caja_id, turno_id, monto, entregado_por, recibe_id, autoentrega, origen, created_at)
            SELECT c.empresa_id, t.caja_id, t.id, t.entregado_monto, coalesce(t.cerrado_por, t.abierto_por), t.entregado_a,
                   t.entregado_a = coalesce(t.cerrado_por, t.abierto_por), 'migracion', t.cerrado_en
              FROM ledger.cajas_turnos t JOIN ledger.cajas c ON c.id = t.caja_id
             WHERE t.cerrado_en IS NOT NULL AND t.entregado_monto > 0 AND t.entregado_a IS NOT NULL
             ORDER BY t.id;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON ledger.entregas, ledger.entregas_recepciones TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.entregas, ledger.entregas_recepciones FROM argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON ledger.cajas_ajustes TO argosisp_app;
                    -- columnas del cierre que agregó el rediseño (denominaciones y entrega)
                    GRANT UPDATE (denominaciones, fondo_siguiente, entregado_a, entregado_monto)
                        ON ledger.cajas_turnos TO argosisp_app;
                END IF;
            END
            $do$;
        `)

        // gt-2026.6: 1.1.15 Efectivo en custodia en cada empresa instalada (aditivo e idempotente)
        this.defer(async (cliente) => {
            const hoy = DateTime.now().setZone('America/Guatemala').toISODate()!
            const empresas = (await cliente
                .from('core.empresas')
                .orderBy('id')
                .select('id', 'pais')) as Array<{ id: number; pais: string }>
            for (const empresa of empresas) {
                const vigente = await instalacionVigente(cliente, Number(empresa.id))
                if (!vigente) continue
                await instalarPaquete(cliente, paqueteDePais(empresa.pais.trim()), Number(empresa.id), {
                    instaladaPor: null,
                    hoy,
                })
            }
        })
    }

    async down() {
        // las entregas y recepciones son del libro (solo inserción): el reverso solo existe para una
        // base sin entregas; la versión 2026.6 del catálogo se queda
        this.schema.raw(`
            DROP TABLE IF EXISTS ledger.entregas_recepciones;
            DROP TABLE IF EXISTS ledger.entregas;
            DROP FUNCTION IF EXISTS ledger.validar_entrega();
            DROP INDEX IF EXISTS ledger.depositos_custodio;
            ALTER TABLE ledger.depositos
                DROP CONSTRAINT IF EXISTS depositos_origen,
                DROP COLUMN IF EXISTS custodio_id,
                DROP COLUMN IF EXISTS origen;
            ALTER TABLE ledger.cajas_turnos DROP COLUMN IF EXISTS fondo_esperado;
            DROP TABLE IF EXISTS ledger.cajas_ajustes;
            ALTER TABLE ledger.cajas DROP COLUMN IF EXISTS fondo_fijo, DROP COLUMN IF EXISTS tipo;
        `)
    }
}
