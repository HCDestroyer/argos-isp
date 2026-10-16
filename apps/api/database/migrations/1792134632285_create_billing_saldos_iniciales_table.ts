import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · acciones para el importador (A6, Mikrowisp):
 *
 *  - `billing.facturas.clave_externa`: id de la factura en el sistema de origen; la importación
 *    es idempotente por esta clave.
 *  - `billing.saldos_iniciales`: asiento de apertura por cliente, idempotente por
 *    `clave_externa`. Positivo (debe) → factura de apertura sin servicio; negativo (a favor) →
 *    anticipo que se aplica a sus facturas como el excedente de un pago.
 *  - `billing.saldos_iniciales_aplicaciones`: qué factura cubrió cada saldo a favor.
 *  - Cuenta `2.9.01 Saldos de apertura por importación` (contrapartida de la apertura), también
 *    en `PLAN_CUENTAS` para bases nuevas.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.facturas ADD COLUMN clave_externa text;
            CREATE UNIQUE INDEX facturas_clave_externa ON billing.facturas (clave_externa)
                WHERE clave_externa IS NOT NULL;

            CREATE TABLE billing.saldos_iniciales (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                clave_externa text NOT NULL UNIQUE,
                -- positivo: el cliente debe; negativo: saldo a favor
                monto numeric(14, 2) NOT NULL CHECK (monto <> 0),
                fecha date NOT NULL,
                descripcion text,
                factura_id bigint REFERENCES billing.facturas (id),
                created_by bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((monto > 0) = (factura_id IS NOT NULL))
            );
            CREATE INDEX saldos_iniciales_cliente ON billing.saldos_iniciales (cliente_id);

            CREATE TABLE billing.saldos_iniciales_aplicaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                saldo_inicial_id bigint NOT NULL REFERENCES billing.saldos_iniciales (id),
                factura_id bigint NOT NULL REFERENCES billing.facturas (id),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX saldos_iniciales_aplicaciones_saldo ON billing.saldos_iniciales_aplicaciones (saldo_inicial_id);
            CREATE INDEX saldos_iniciales_aplicaciones_factura ON billing.saldos_iniciales_aplicaciones (factura_id);

            INSERT INTO ledger.cuentas (codigo, nombre, tipo, padre_id, imputable, auxiliar_cliente)
            SELECT '2.9', 'Cuentas transitorias', 'pasivo', p.id, false, false
              FROM ledger.cuentas p WHERE p.codigo = '2'
            ON CONFLICT (codigo) DO NOTHING;
            INSERT INTO ledger.cuentas (codigo, nombre, tipo, padre_id, imputable, auxiliar_cliente)
            SELECT '2.9.01', 'Saldos de apertura por importación', 'pasivo', p.id, true, false
              FROM ledger.cuentas p WHERE p.codigo = '2.9'
            ON CONFLICT (codigo) DO NOTHING;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.saldos_iniciales_aplicaciones;
            DROP TABLE IF EXISTS billing.saldos_iniciales;
            DROP INDEX IF EXISTS billing.facturas_clave_externa;
            ALTER TABLE billing.facturas DROP COLUMN IF EXISTS clave_externa;
        `)
    }
}
