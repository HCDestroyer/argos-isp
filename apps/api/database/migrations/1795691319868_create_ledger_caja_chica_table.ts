import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · B9 del plan de contabilidad (`contratos/plan-contabilidad.md` §5.7, decisiones del PM del
 * 26 nov 2026): **caja chica** (caja de gastos con fondo fijo).
 *
 * - `ledger.cajas_ajustes.fondo_caja_chica`: fondo fijo de fábrica de cada caja chica de la empresa
 *   (Q2,000; cada caja puede tener el suyo en `ledger.cajas.fondo_fijo`). Sin tope por gasto (el PM:
 *   «el tope de gastos no se puede definir»): el único límite es el efectivo de la caja.
 * - `ledger.egresos_comprobantes`: el archivo (foto o PDF) del comprobante de un egreso. Obligatorio
 *   para todo gasto de caja chica; se guarda en el almacenamiento compartido (`COMPROBANTES_DIR`).
 *   Una fila por egreso, solo inserción.
 * - `ledger.reposiciones`: reponer la caja chica por lo gastado, desde la custodia de quien repone
 *   (`1.1.15`) o desde un banco del libro, nunca desde una caja de cobros. `monto` = fondo − efectivo
 *   en el libro; `fondo` = fondo fijo vigente desde esa reposición.
 * - `ledger.reposiciones_documentos`: los gastos (egresos) y las diferencias de conteo que la
 *   reposición sella como «repuestos». Un documento se sella una sola vez (índice único); un gasto
 *   sellado ya no se anula.
 * - `ledger.conteos_caja`: conteo sorpresa de una caja chica (esperado = efectivo en el libro). Con
 *   diferencia, motivo obligatorio y asiento `conteo_caja` (Faltantes de caja / Caja chica o Caja
 *   chica / Sobrantes de caja) a cargo de su encargado.
 * - Orígenes de asiento `reposicion_caja` y `conteo_caja`.
 *
 * Invariante (se prueba en `tests/ledger/caja_chica.spec.ts`; el auditor la suma en AU3): por caja
 * chica, efectivo en el libro + gastos vigentes sin reponer − diferencias de conteo sin reponer =
 * fondo de la última reposición (0 antes de la primera).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.cajas_ajustes
                ADD COLUMN fondo_caja_chica numeric(14, 2) NOT NULL DEFAULT 2000.00
                    CONSTRAINT cajas_ajustes_fondo_caja_chica CHECK (fondo_caja_chica >= 0);

            CREATE TABLE ledger.egresos_comprobantes (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                egreso_id bigint NOT NULL UNIQUE REFERENCES ledger.egresos (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                archivo text NOT NULL,
                tipo text NOT NULL CHECK (tipo IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
                tamano integer NOT NULL CHECK (tamano > 0),
                nombre text,
                subido_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE ledger.reposiciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                caja_id bigint NOT NULL REFERENCES ledger.cajas (id),
                origen text NOT NULL CHECK (origen IN ('custodia', 'banco')),
                custodio_id bigint REFERENCES core.usuarios (id),
                banco_id bigint REFERENCES ledger.bancos (id),
                cuenta_bancaria_id bigint REFERENCES billing.cuentas_bancarias (id),
                -- cuenta del libro de la que sale el efectivo (1.1.15 o el banco)
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                referencia text,
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                fondo numeric(14, 2) NOT NULL CHECK (fondo > 0),
                efectivo_antes numeric(14, 2) NOT NULL,
                fecha date NOT NULL,
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT reposiciones_origen CHECK (
                    (origen = 'custodia' AND custodio_id IS NOT NULL AND banco_id IS NULL AND cuenta_bancaria_id IS NULL)
                    OR (origen = 'banco' AND custodio_id IS NULL)),
                CONSTRAINT reposiciones_monto CHECK (efectivo_antes + monto = fondo)
            );
            CREATE INDEX reposiciones_caja ON ledger.reposiciones (caja_id, id);
            CREATE INDEX reposiciones_custodio ON ledger.reposiciones (empresa_id, custodio_id) WHERE origen = 'custodia';

            CREATE TABLE ledger.conteos_caja (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                caja_id bigint NOT NULL REFERENCES ledger.cajas (id),
                esperado numeric(14, 2) NOT NULL,
                contado numeric(14, 2) NOT NULL CHECK (contado >= 0),
                diferencia numeric(14, 2) NOT NULL,
                comprobantes numeric(14, 2) NOT NULL DEFAULT 0,
                fondo numeric(14, 2) NOT NULL DEFAULT 0,
                motivo text,
                responsable_id bigint REFERENCES core.usuarios (id),
                contado_por bigint REFERENCES core.usuarios (id),
                fecha date NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT conteos_caja_diferencia CHECK (diferencia = contado - esperado),
                CONSTRAINT conteos_caja_motivo CHECK (diferencia = 0 OR length(btrim(coalesce(motivo, ''))) >= 3)
            );
            CREATE INDEX conteos_caja_caja ON ledger.conteos_caja (caja_id, id);

            CREATE TABLE ledger.reposiciones_documentos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                reposicion_id bigint NOT NULL REFERENCES ledger.reposiciones (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                documento_tipo text NOT NULL CHECK (documento_tipo IN ('egreso', 'conteo')),
                documento_id bigint NOT NULL,
                -- egreso: lo que salió; conteo: la diferencia (contado − esperado)
                monto numeric(14, 2) NOT NULL,
                CONSTRAINT reposiciones_documentos_unico UNIQUE (documento_tipo, documento_id)
            );
            CREATE INDEX reposiciones_documentos_reposicion ON ledger.reposiciones_documentos (reposicion_id);

            -- la reposición y el conteo son de una caja chica de su empresa; lo sellado es de esa caja
            CREATE OR REPLACE FUNCTION ledger.validar_caja_chica() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_caja bigint;
            BEGIN
                IF TG_TABLE_NAME IN ('reposiciones', 'conteos_caja') THEN
                    IF NOT EXISTS (SELECT 1 FROM ledger.cajas c WHERE c.id = NEW.caja_id
                                    AND c.empresa_id = NEW.empresa_id AND c.tipo = 'gastos') THEN
                        RAISE EXCEPTION 'La caja % no es una caja chica de la empresa %', NEW.caja_id, NEW.empresa_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'caja_chica_requerida';
                    END IF;
                ELSE
                    SELECT r.caja_id INTO v_caja FROM ledger.reposiciones r
                     WHERE r.id = NEW.reposicion_id AND r.empresa_id = NEW.empresa_id;
                    IF NOT FOUND OR (NEW.documento_tipo = 'egreso' AND NOT EXISTS (
                            SELECT 1 FROM ledger.egresos e WHERE e.id = NEW.documento_id AND e.caja_id = v_caja
                               AND e.monto = NEW.monto))
                       OR (NEW.documento_tipo = 'conteo' AND NOT EXISTS (
                            SELECT 1 FROM ledger.conteos_caja k WHERE k.id = NEW.documento_id AND k.caja_id = v_caja
                               AND k.diferencia = NEW.monto)) THEN
                        RAISE EXCEPTION 'El % % no es de la caja chica de la reposición %', NEW.documento_tipo, NEW.documento_id, NEW.reposicion_id
                            USING ERRCODE = 'check_violation', CONSTRAINT = 'documento_de_otra_caja';
                    END IF;
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER reposiciones_validar BEFORE INSERT ON ledger.reposiciones
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_caja_chica();
            CREATE TRIGGER conteos_caja_validar BEFORE INSERT ON ledger.conteos_caja
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_caja_chica();
            CREATE TRIGGER reposiciones_documentos_validar BEFORE INSERT ON ledger.reposiciones_documentos
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_caja_chica();

            CREATE TRIGGER egresos_comprobantes_inmutable BEFORE UPDATE OR DELETE ON ledger.egresos_comprobantes
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER egresos_comprobantes_sin_truncate BEFORE TRUNCATE ON ledger.egresos_comprobantes
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER reposiciones_inmutable BEFORE UPDATE OR DELETE ON ledger.reposiciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER reposiciones_sin_truncate BEFORE TRUNCATE ON ledger.reposiciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER reposiciones_documentos_inmutable BEFORE UPDATE OR DELETE ON ledger.reposiciones_documentos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER reposiciones_documentos_sin_truncate BEFORE TRUNCATE ON ledger.reposiciones_documentos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER conteos_caja_inmutable BEFORE UPDATE OR DELETE ON ledger.conteos_caja
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER conteos_caja_sin_truncate BEFORE TRUNCATE ON ledger.conteos_caja
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            -- orígenes de asiento de la reposición y del conteo
            DO $$
            DECLARE
                valores text[];
            BEGIN
                SELECT array_agg(DISTINCT m[1]) INTO valores
                  FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
                 WHERE c.conname = 'asientos_origen_tipo_check' AND c.conrelid = 'ledger.asientos'::regclass;
                IF NOT 'reposicion_caja' = ANY (valores) THEN
                    valores := valores || 'reposicion_caja'::text;
                END IF;
                IF NOT 'conteo_caja' = ANY (valores) THEN
                    valores := valores || 'conteo_caja'::text;
                END IF;
                ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
                EXECUTE format('ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo = ANY (%L::text[]))', valores);
            END $$;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON ledger.egresos_comprobantes, ledger.reposiciones,
                        ledger.reposiciones_documentos, ledger.conteos_caja TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.egresos_comprobantes, ledger.reposiciones,
                        ledger.reposiciones_documentos, ledger.conteos_caja FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        // documentos del libro (solo inserción): el reverso solo existe para una base sin caja chica
        this.schema.raw(`
            DROP TABLE IF EXISTS ledger.reposiciones_documentos;
            DROP TABLE IF EXISTS ledger.conteos_caja;
            DROP TABLE IF EXISTS ledger.reposiciones;
            DROP TABLE IF EXISTS ledger.egresos_comprobantes;
            DROP FUNCTION IF EXISTS ledger.validar_caja_chica();
            ALTER TABLE ledger.cajas_ajustes DROP COLUMN IF EXISTS fondo_caja_chica;
        `)
    }
}
