import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'
import { instalarPaquete, instalacionVigente, paqueteDePais } from '#fiscal/instalador'
import { CODIGOS_INTERNOS_GT } from '#fiscal/l10n/gt/cuentas'

/**
 * A3 · B11 del plan de contabilidad: **caja sin factura** (decisiones del PM del 25 y 26 nov 2026;
 * `contratos/fel-establecimientos.md`, lote 3 y su nota «Pendiente»; plan §5.7, N1).
 *
 * - `ledger.cajas.fiscal` (true de fábrica): una caja de cobros o una caja chica puede ser «sin
 *   factura». Se permite aunque la empresa tenga FEL obligatoria (la API devuelve el aviso).
 * - `ledger.cajas_usuarios`: quiénes ven y usan una caja sin factura (vacía = todos los que la
 *   alcanzan por el ACL). La visibilidad de las cuentas internas es el permiso
 *   `contabilidad.ver_cuentas_internas`, por usuario.
 * - `ledger.cuentas.interna`: atributo verificable de las cuentas internas (fuera de los libros
 *   fiscales y de las declaraciones). gt-2026.7 agrega `4.3 / 4.3.01 Ingresos por recibos internos
 *   (caja sin factura)` y `5.7 / 5.7.01 Gastos internos sin factura` (no deducible). Códigos por
 *   confirmar con el contador.
 * - `ledger.egresos.cuenta_id`: la cuenta del gasto cuando no es la de su categoría (`5.7.01` en una
 *   caja sin factura).
 * - `billing.conceptos_cargo.facturable` (true de fábrica): un concepto no facturable es un cobro de
 *   control: sin IVA, a la cuenta interna, sin DTE ni libros fiscales.
 * - `billing.recibos` + `billing.recibos_secuencias`: **recibo no fiscal de pago** con numeración
 *   propia, correlativa y sin huecos **por empresa** (la secuencia se toma con un `UPDATE … RETURNING`
 *   en la transacción del pago: si el pago falla, el número no se gasta). Un recibo por pago.
 * - `billing.facturas_no_fiscales` (+ `_anulaciones`): la factura (aviso de cobro) que quedó fuera de
 *   la SAT porque se cubrió en una caja sin factura, o el cargo no facturable. Su asiento
 *   `recibo_interno` reclasifica el ingreso y el IVA por certificar a `4.3.01`. Anular el pago lo
 *   revierte (fila en `_anulaciones`). La cola FEL y la certificación las excluyen.
 * - Origen de asiento `recibo_interno` (origen_id = `billing.facturas_no_fiscales.id`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.cajas ADD COLUMN fiscal boolean NOT NULL DEFAULT true;

            CREATE TABLE ledger.cajas_usuarios (
                caja_id bigint NOT NULL REFERENCES ledger.cajas (id),
                usuario_id bigint NOT NULL REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (caja_id, usuario_id)
            );

            ALTER TABLE ledger.cuentas ADD COLUMN interna boolean NOT NULL DEFAULT false;

            -- cuenta del libro a la que fue el gasto cuando no es la de su categoría (caja sin factura:
            -- 5.7.01 Gastos internos); null = la de la categoría
            ALTER TABLE ledger.egresos ADD COLUMN cuenta_id bigint REFERENCES ledger.cuentas (id);

            ALTER TABLE billing.conceptos_cargo ADD COLUMN facturable boolean NOT NULL DEFAULT true;

            CREATE TABLE billing.recibos_secuencias (
                empresa_id bigint PRIMARY KEY REFERENCES core.empresas (id),
                ultimo bigint NOT NULL DEFAULT 0
            );

            CREATE TABLE billing.recibos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                numero bigint NOT NULL CHECK (numero > 0),
                pago_id bigint NOT NULL UNIQUE REFERENCES billing.pagos (id),
                caja_id bigint REFERENCES ledger.cajas (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                motivo text NOT NULL CHECK (motivo IN ('caja_sin_factura', 'cargo_no_facturable')),
                emitido_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT recibos_numero UNIQUE (empresa_id, numero)
            );

            CREATE TABLE billing.facturas_no_fiscales (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                factura_id bigint NOT NULL REFERENCES billing.facturas (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                motivo text NOT NULL CHECK (motivo IN ('caja_sin_factura', 'cargo_no_facturable')),
                recibo_id bigint REFERENCES billing.recibos (id),
                pago_id bigint REFERENCES billing.pagos (id),
                -- lo que pasó de ingresos facturados e IVA por certificar a 4.3.01
                base numeric(14, 2) NOT NULL DEFAULT 0,
                iva numeric(14, 2) NOT NULL DEFAULT 0,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX facturas_no_fiscales_factura ON billing.facturas_no_fiscales (factura_id);

            CREATE TABLE billing.facturas_no_fiscales_anulaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                no_fiscal_id bigint NOT NULL UNIQUE REFERENCES billing.facturas_no_fiscales (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                motivo text NOT NULL,
                anulado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );

            -- una sola marca vigente por factura
            CREATE OR REPLACE FUNCTION billing.validar_factura_no_fiscal() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM billing.facturas f WHERE f.id = NEW.factura_id AND f.empresa_id = NEW.empresa_id) THEN
                    RAISE EXCEPTION 'La factura % no es de la empresa %', NEW.factura_id, NEW.empresa_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'no_fiscal_otra_empresa';
                END IF;
                IF EXISTS (SELECT 1 FROM billing.facturas_no_fiscales n WHERE n.factura_id = NEW.factura_id
                             AND NOT EXISTS (SELECT 1 FROM billing.facturas_no_fiscales_anulaciones x WHERE x.no_fiscal_id = n.id)) THEN
                    RAISE EXCEPTION 'La factura % ya está fuera de la SAT', NEW.factura_id
                        USING ERRCODE = 'unique_violation', CONSTRAINT = 'no_fiscal_vigente_unica';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER facturas_no_fiscales_validar BEFORE INSERT ON billing.facturas_no_fiscales
                FOR EACH ROW EXECUTE FUNCTION billing.validar_factura_no_fiscal();

            CREATE TRIGGER recibos_inmutable BEFORE UPDATE OR DELETE ON billing.recibos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER recibos_sin_truncate BEFORE TRUNCATE ON billing.recibos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER facturas_no_fiscales_inmutable BEFORE UPDATE OR DELETE ON billing.facturas_no_fiscales
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER facturas_no_fiscales_sin_truncate BEFORE TRUNCATE ON billing.facturas_no_fiscales
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER facturas_no_fiscales_anulaciones_inmutable BEFORE UPDATE OR DELETE ON billing.facturas_no_fiscales_anulaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER facturas_no_fiscales_anulaciones_sin_truncate BEFORE TRUNCATE ON billing.facturas_no_fiscales_anulaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $$
            DECLARE
                valores text[];
            BEGIN
                SELECT array_agg(DISTINCT m[1]) INTO valores
                  FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
                 WHERE c.conname = 'asientos_origen_tipo_check' AND c.conrelid = 'ledger.asientos'::regclass;
                IF NOT 'recibo_interno' = ANY (valores) THEN
                    valores := valores || 'recibo_interno'::text;
                END IF;
                ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
                EXECUTE format('ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo = ANY (%L::text[]))', valores);
            END $$;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON billing.recibos, billing.facturas_no_fiscales,
                        billing.facturas_no_fiscales_anulaciones TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON billing.recibos, billing.facturas_no_fiscales,
                        billing.facturas_no_fiscales_anulaciones FROM argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON billing.recibos_secuencias TO argosisp_app;
                    GRANT SELECT, INSERT, DELETE ON ledger.cajas_usuarios TO argosisp_app;
                END IF;
            END
            $do$;
        `)

        // gt-2026.7: cuentas internas (4.3.01 y 5.7.01) en cada empresa instalada (aditivo e idempotente)
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
            // en una base nueva, una migración anterior pudo crear las cuentas antes de la columna
            await cliente
                .from('ledger.cuentas')
                .where('pais', 'GT')
                .whereIn('codigo', [...CODIGOS_INTERNOS_GT])
                .update({ interna: true })
        })
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.facturas_no_fiscales_anulaciones;
            DROP TABLE IF EXISTS billing.facturas_no_fiscales;
            DROP FUNCTION IF EXISTS billing.validar_factura_no_fiscal();
            DROP TABLE IF EXISTS billing.recibos;
            DROP TABLE IF EXISTS billing.recibos_secuencias;
            ALTER TABLE billing.conceptos_cargo DROP COLUMN IF EXISTS facturable;
            ALTER TABLE ledger.cuentas DROP COLUMN IF EXISTS interna;
            DROP TABLE IF EXISTS ledger.cajas_usuarios;
            ALTER TABLE ledger.cajas DROP COLUMN IF EXISTS fiscal;
        `)
    }
}
