import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · D0 (`contratos/debito-automatico.md` §2): cuentas de pasarela por empresa y proveedor.
 *
 * - `billing.pasarela_cuentas`: una cuenta por (empresa, proveedor) con sus credenciales cifradas
 *   (`#shared/cifrado`; en auditoría `***`), el secreto del webhook cifrado, la `clave_publica` que
 *   va en la URL del webhook (sin secreto), el modo, los usos (`pago_en_linea`, `debito`) y la
 *   cuenta predeterminada por uso (una sola por empresa y uso, índice parcial).
 * - `pasarela_cuenta_id` (nullable) en `pasarela_cobros`, `pasarela_eventos` y
 *   `pasarela_conciliaciones`: null = cobro hecho con las variables de entorno (antes de D0).
 *
 * No toca datos existentes: la cuenta equivalente al entorno la crea `pasarela.sembrar_cuenta`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.pasarela_cuentas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                proveedor text NOT NULL CHECK (proveedor ~ '^[a-z0-9_]{1,40}$'),
                alias text NOT NULL CHECK (length(btrim(alias)) > 0),
                proveedor_cobro_id bigint REFERENCES ledger.proveedores_cobro (id),
                credenciales_cifradas text,
                credenciales_claves text[] NOT NULL DEFAULT '{}',
                webhook_secreto_cifrado text,
                clave_publica text NOT NULL UNIQUE CHECK (clave_publica ~ '^[a-z0-9]{16,64}$'),
                opciones jsonb NOT NULL DEFAULT '{}'::jsonb,
                modo text NOT NULL DEFAULT 'pruebas' CHECK (modo IN ('pruebas', 'produccion')),
                usos text[] NOT NULL DEFAULT '{pago_en_linea}'
                    CHECK (cardinality(usos) > 0 AND usos <@ ARRAY['pago_en_linea', 'debito']),
                predeterminada_pago_en_linea boolean NOT NULL DEFAULT false,
                predeterminada_debito boolean NOT NULL DEFAULT false,
                activa boolean NOT NULL DEFAULT false,
                prueba_ok boolean NOT NULL DEFAULT false,
                probada_en timestamptz,
                prueba_detalle text,
                sembrada_desde_entorno boolean NOT NULL DEFAULT false,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT pasarela_cuentas_unica UNIQUE (empresa_id, proveedor),
                CONSTRAINT pasarela_cuentas_pred_pago CHECK (NOT predeterminada_pago_en_linea OR 'pago_en_linea' = ANY (usos)),
                CONSTRAINT pasarela_cuentas_pred_debito CHECK (NOT predeterminada_debito OR 'debito' = ANY (usos))
            );
            CREATE UNIQUE INDEX pasarela_cuentas_pred_pago_unica
                ON billing.pasarela_cuentas (empresa_id) WHERE predeterminada_pago_en_linea;
            CREATE UNIQUE INDEX pasarela_cuentas_pred_debito_unica
                ON billing.pasarela_cuentas (empresa_id) WHERE predeterminada_debito;

            ALTER TABLE billing.pasarela_cobros ADD COLUMN pasarela_cuenta_id bigint REFERENCES billing.pasarela_cuentas (id);
            CREATE INDEX pasarela_cobros_cuenta ON billing.pasarela_cobros (pasarela_cuenta_id) WHERE pasarela_cuenta_id IS NOT NULL;
            ALTER TABLE billing.pasarela_eventos ADD COLUMN pasarela_cuenta_id bigint REFERENCES billing.pasarela_cuentas (id);
            ALTER TABLE billing.pasarela_conciliaciones ADD COLUMN pasarela_cuenta_id bigint REFERENCES billing.pasarela_cuentas (id);
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.pasarela_conciliaciones DROP COLUMN IF EXISTS pasarela_cuenta_id;
            ALTER TABLE billing.pasarela_eventos DROP COLUMN IF EXISTS pasarela_cuenta_id;
            ALTER TABLE billing.pasarela_cobros DROP COLUMN IF EXISTS pasarela_cuenta_id;
            DROP TABLE IF EXISTS billing.pasarela_cuentas;
        `)
    }
}
