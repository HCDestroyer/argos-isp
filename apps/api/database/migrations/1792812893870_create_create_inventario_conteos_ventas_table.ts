import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · inventario interno, fase C (`contratos/inventario.md` §4 y §5): conteos físicos y venta.
 *
 *  - `inventario.conteos` (estado `abierto` → `cerrado` | `cancelado`; uno abierto por bodega) y
 *    `inventario.conteo_lineas` (una por producto: lo contado y, para serie, las series o MAC
 *    contadas; mientras el conteo está abierto la línea se vuelve a capturar). El cierre guarda en la
 *    línea lo esperado y la diferencia, y deja sus movimientos `ajuste_conteo` (origen `conteo`).
 *  - `billing.facturas_lineas` agrega `producto_id`, `bodega_id` y `unidad_id` (`ALTER ADD COLUMN`,
 *    nulas en las filas existentes): la línea de un cargo único que vende del inventario.
 *  - `inventario.movimientos.factura_linea_id`: la línea de la factura que vendió (venta y sus
 *    reversos por anulación o nota de crédito).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE inventario.conteos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                bodega_id bigint NOT NULL REFERENCES inventario.bodegas (id),
                estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado', 'cancelado')),
                fecha_corte date NOT NULL,
                motivo text,
                abierto_por bigint REFERENCES core.usuarios (id),
                cerrado_por bigint REFERENCES core.usuarios (id),
                cerrado_en timestamptz,
                faltante numeric(14, 2) NOT NULL DEFAULT 0,
                sobrante numeric(14, 2) NOT NULL DEFAULT 0,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((estado = 'abierto') = (cerrado_en IS NULL))
            );
            CREATE UNIQUE INDEX conteos_uno_abierto ON inventario.conteos (bodega_id) WHERE estado = 'abierto';
            CREATE INDEX conteos_empresa ON inventario.conteos (empresa_id, id DESC);

            CREATE TABLE inventario.conteo_lineas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                conteo_id bigint NOT NULL REFERENCES inventario.conteos (id),
                producto_id bigint NOT NULL REFERENCES inventario.productos (id),
                contado numeric(14, 3) NOT NULL CHECK (contado >= 0),
                series jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(series) = 'array'),
                costo_unitario numeric(18, 6) CHECK (costo_unitario >= 0),
                esperado numeric(14, 3),
                diferencia numeric(14, 3),
                valor_diferencia numeric(14, 2),
                registrado_por bigint REFERENCES core.usuarios (id),
                updated_at timestamptz NOT NULL DEFAULT now(),
                created_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (conteo_id, producto_id)
            );

            ALTER TABLE billing.facturas_lineas
                ADD COLUMN producto_id bigint REFERENCES inventario.productos (id),
                ADD COLUMN bodega_id bigint REFERENCES inventario.bodegas (id),
                ADD COLUMN unidad_id bigint REFERENCES inventario.unidades (id),
                ADD CONSTRAINT facturas_lineas_inventario CHECK ((producto_id IS NULL) = (bodega_id IS NULL));

            ALTER TABLE inventario.movimientos
                ADD COLUMN factura_linea_id bigint REFERENCES billing.facturas_lineas (id);
            CREATE INDEX movimientos_factura_linea ON inventario.movimientos (factura_linea_id)
                WHERE factura_linea_id IS NOT NULL;

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON inventario.conteos, inventario.conteo_lineas TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON inventario.conteos, inventario.conteo_lineas FROM argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inventario TO argosisp_app;
                END IF;
            END $$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE inventario.movimientos DROP COLUMN IF EXISTS factura_linea_id;
            ALTER TABLE billing.facturas_lineas
                DROP CONSTRAINT IF EXISTS facturas_lineas_inventario,
                DROP COLUMN IF EXISTS producto_id,
                DROP COLUMN IF EXISTS bodega_id,
                DROP COLUMN IF EXISTS unidad_id;
            DROP TABLE IF EXISTS inventario.conteo_lineas;
            DROP TABLE IF EXISTS inventario.conteos;
        `)
    }
}
