import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · localización fiscal, fase 4 (contrato §10.3): **cobros por liquidar**.
 *
 * - `ledger.proveedores_cobro`: cada pasarela, agente o débito automático de una empresa, con su
 *   subcuenta `1.1.10.NN Cobros por liquidar` (de la empresa) y la cuenta bancaria donde el
 *   proveedor deposita las liquidaciones. `desde` es la **fecha de corte**: los pagos de ese
 *   proveedor con fecha desde ese día van a su `1.1.10.NN` por el bruto; los anteriores (y los de
 *   un proveedor sin configurar) siguen como hoy contra el banco (§12.11). Configuración con
 *   `version` y `audit.cambios`.
 * - `billing.pagos.proveedor_cobro_id`: el proveedor cuya cuenta puente recibió el pago (null = como
 *   antes, directo al banco).
 * - `ledger.liquidaciones_cobro` + `ledger.liquidaciones_pagos`: la liquidación del proveedor
 *   (bruto, comisión, neto) y los pagos que incluye (o los contracargos de pagos ya liquidados y
 *   luego anulados). Solo inserción: un pago se liquida una sola vez y su contracargo también. Su
 *   asiento es el de origen `liquidacion_cobro` con su id (como los egresos).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.proveedores_cobro (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                metodo text NOT NULL CHECK (metodo IN ('pasarela', 'agente', 'debito')),
                codigo text NOT NULL CHECK (codigo ~ '^[a-z0-9_]{1,40}$'),
                nombre text NOT NULL CHECK (length(btrim(nombre)) > 0),
                cuenta_id bigint NOT NULL UNIQUE REFERENCES ledger.cuentas (id),
                cuenta_liquidacion_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                desde date NOT NULL,
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT proveedores_cobro_unico UNIQUE (empresa_id, metodo, codigo)
            );

            ALTER TABLE billing.pagos ADD COLUMN proveedor_cobro_id bigint REFERENCES ledger.proveedores_cobro (id);
            CREATE INDEX pagos_proveedor_cobro ON billing.pagos (proveedor_cobro_id) WHERE proveedor_cobro_id IS NOT NULL;

            CREATE TABLE ledger.liquidaciones_cobro (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                proveedor_cobro_id bigint NOT NULL REFERENCES ledger.proveedores_cobro (id),
                fecha date NOT NULL,
                referencia text NOT NULL CHECK (length(btrim(referencia)) > 0),
                bruto numeric(14,2) NOT NULL CHECK (bruto > 0),
                comision numeric(14,2) NOT NULL CHECK (comision >= 0),
                neto numeric(14,2) NOT NULL CHECK (neto >= 0),
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                archivo text,
                sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
                nota text,
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT liquidaciones_cobro_neto CHECK (neto = bruto - comision),
                CONSTRAINT liquidaciones_cobro_referencia UNIQUE (proveedor_cobro_id, referencia)
            );

            CREATE TABLE ledger.liquidaciones_pagos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                liquidacion_id bigint NOT NULL REFERENCES ledger.liquidaciones_cobro (id),
                pago_id bigint NOT NULL REFERENCES billing.pagos (id),
                tipo text NOT NULL CHECK (tipo IN ('cobro', 'contracargo')),
                monto numeric(14,2) NOT NULL CHECK (monto > 0),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT liquidaciones_pagos_unico UNIQUE (pago_id, tipo)
            );
            CREATE INDEX liquidaciones_pagos_liquidacion ON ledger.liquidaciones_pagos (liquidacion_id);

            -- el pago es de la empresa y del proveedor de la liquidación, por su monto; un contracargo solo
            -- de un pago anulado que ya se había liquidado
            CREATE OR REPLACE FUNCTION ledger.validar_liquidacion_pago() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_liq record;
                v_pago record;
            BEGIN
                SELECT empresa_id, proveedor_cobro_id INTO v_liq FROM ledger.liquidaciones_cobro WHERE id = NEW.liquidacion_id;
                SELECT empresa_id, proveedor_cobro_id, monto, estado INTO v_pago FROM billing.pagos WHERE id = NEW.pago_id;
                IF v_pago.empresa_id <> v_liq.empresa_id OR v_pago.proveedor_cobro_id IS DISTINCT FROM v_liq.proveedor_cobro_id THEN
                    RAISE EXCEPTION 'El pago % no es de la empresa ni del proveedor de la liquidación %', NEW.pago_id, NEW.liquidacion_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_de_otro_proveedor';
                END IF;
                IF NEW.monto <> v_pago.monto THEN
                    RAISE EXCEPTION 'El pago % se liquida por su monto (%), no por %', NEW.pago_id, v_pago.monto, NEW.monto
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_monto';
                END IF;
                IF NEW.tipo = 'cobro' AND v_pago.estado <> 'registrado' THEN
                    RAISE EXCEPTION 'El pago % no está registrado', NEW.pago_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_pago_no_vigente';
                END IF;
                IF NEW.tipo = 'contracargo' AND (v_pago.estado <> 'anulado' OR NOT EXISTS (
                    SELECT 1 FROM ledger.liquidaciones_pagos x WHERE x.pago_id = NEW.pago_id AND x.tipo = 'cobro')) THEN
                    RAISE EXCEPTION 'El pago % no es un contracargo: no está anulado o nunca se liquidó', NEW.pago_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_contracargo';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER liquidaciones_pagos_validar BEFORE INSERT ON ledger.liquidaciones_pagos
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_liquidacion_pago();

            CREATE TRIGGER liquidaciones_cobro_inmutable BEFORE UPDATE OR DELETE ON ledger.liquidaciones_cobro
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER liquidaciones_cobro_sin_truncate BEFORE TRUNCATE ON ledger.liquidaciones_cobro
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER liquidaciones_pagos_inmutable BEFORE UPDATE OR DELETE ON ledger.liquidaciones_pagos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER liquidaciones_pagos_sin_truncate BEFORE TRUNCATE ON ledger.liquidaciones_pagos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON ledger.proveedores_cobro TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON ledger.proveedores_cobro FROM argosisp_app;
                    GRANT SELECT, INSERT ON ledger.liquidaciones_cobro, ledger.liquidaciones_pagos TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON ledger.liquidaciones_cobro, ledger.liquidaciones_pagos
                        FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS ledger.liquidaciones_pagos;
            DROP TABLE IF EXISTS ledger.liquidaciones_cobro;
            DROP FUNCTION IF EXISTS ledger.validar_liquidacion_pago();
            ALTER TABLE billing.pagos DROP COLUMN IF EXISTS proveedor_cobro_id;
            DROP TABLE IF EXISTS ledger.proveedores_cobro;
        `)
    }
}
