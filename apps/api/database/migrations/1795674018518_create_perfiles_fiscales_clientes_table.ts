import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Perfil fiscal del cliente (lote B4 del plan de contabilidad, decisión del PM del 26 nov 2026):
 *
 * - `billing.perfiles_fiscales_cliente`: tipo de impuesto (`normal`, `agente_retenedor_iva`,
 *   `exento`) y la casilla aparte «me retiene ISR». Es del cliente, no de una empresa (el cliente no
 *   tiene empresa: `contratos/multiempresa.md`). Un cliente **sin fila es Normal** sin retención de
 *   ISR: así quedan todos los clientes existentes y los que se creen después, sin tocar
 *   `core.clientes` (A1). Se edita con `clientes.asignar_perfil_fiscal` (control por `version`).
 * - `billing.facturas.perfil_fiscal`: la instantánea del perfil al emitir (tipo, ISR, si la exención
 *   se aplicó y las retenciones esperadas). Null en las facturas anteriores a B4.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.perfiles_fiscales_cliente (
                cliente_id bigint PRIMARY KEY REFERENCES core.clientes (id) ON DELETE CASCADE,
                tipo_impuesto text NOT NULL DEFAULT 'normal'
                    CONSTRAINT perfiles_fiscales_tipo
                    CHECK (tipo_impuesto IN ('normal', 'agente_retenedor_iva', 'exento')),
                retiene_isr boolean NOT NULL DEFAULT false,
                resolucion_exencion jsonb,
                nota text,
                version integer NOT NULL DEFAULT 1,
                actualizado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT perfiles_fiscales_exento_resolucion
                    CHECK (tipo_impuesto <> 'exento' OR resolucion_exencion IS NOT NULL)
            );
            CREATE INDEX perfiles_fiscales_no_normales ON billing.perfiles_fiscales_cliente (tipo_impuesto)
                WHERE tipo_impuesto <> 'normal' OR retiene_isr;
            ALTER TABLE billing.facturas ADD COLUMN perfil_fiscal jsonb;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.facturas DROP COLUMN IF EXISTS perfil_fiscal;
            DROP TABLE IF EXISTS billing.perfiles_fiscales_cliente;
        `)
    }
}
