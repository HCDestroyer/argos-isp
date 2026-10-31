import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · inventario, fase D, pedidos 2 y 3 (`contratos/inventario.md` D.2 y D.3).
 *
 *  - `inventario.tipos_producto`: catálogo editable, por empresa o global (`empresa_id` null), con el
 *    seguimiento y la modalidad por defecto de sus productos. Semillas globales: los tres tipos fijos
 *    de antes (`equipo`, `material`, `otro`).
 *  - `inventario.productos.tipo` deja el CHECK fijo (sigue guardando el código) y gana `tipo_id`; las
 *    filas existentes apuntan a la semilla global de su código.
 *  - `inventario.productos.modalidad`: `comodato` (serie), `consumible_gasto` (cantidad) o
 *    `consumible_cobro` (las dos). Las existentes: serie → comodato, cantidad → consumible_gasto (lo
 *    de hoy). Ningún movimiento ni asiento cambia.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE inventario.tipos_producto (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint REFERENCES core.empresas (id),
                codigo text NOT NULL CHECK (codigo ~ '^[a-z0-9_]{2,40}$'),
                nombre text NOT NULL CHECK (length(btrim(nombre)) > 0),
                seguimiento_defecto text NOT NULL CHECK (seguimiento_defecto IN ('cantidad', 'serie')),
                modalidad_defecto text NOT NULL
                    CHECK (modalidad_defecto IN ('comodato', 'consumible_gasto', 'consumible_cobro')),
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT tipos_producto_modalidad CHECK (
                    (modalidad_defecto <> 'comodato' OR seguimiento_defecto = 'serie')
                    AND (modalidad_defecto <> 'consumible_gasto' OR seguimiento_defecto = 'cantidad')
                )
            );
            CREATE UNIQUE INDEX tipos_producto_codigo ON inventario.tipos_producto (coalesce(empresa_id, 0), codigo);
            INSERT INTO inventario.tipos_producto (empresa_id, codigo, nombre, seguimiento_defecto, modalidad_defecto) VALUES
                (NULL, 'equipo', 'Equipo', 'serie', 'comodato'),
                (NULL, 'material', 'Material', 'cantidad', 'consumible_gasto'),
                (NULL, 'otro', 'Otro', 'cantidad', 'consumible_gasto');

            ALTER TABLE inventario.productos
                DROP CONSTRAINT productos_tipo_check,
                ADD COLUMN tipo_id bigint REFERENCES inventario.tipos_producto (id),
                ADD COLUMN modalidad text;
            UPDATE inventario.productos p
               SET tipo_id = t.id,
                   modalidad = CASE WHEN p.seguimiento = 'serie' THEN 'comodato' ELSE 'consumible_gasto' END
              FROM inventario.tipos_producto t
             WHERE t.empresa_id IS NULL AND t.codigo = p.tipo;
            ALTER TABLE inventario.productos
                ALTER COLUMN tipo_id SET NOT NULL,
                ALTER COLUMN modalidad SET NOT NULL,
                ADD CONSTRAINT productos_modalidad_check
                    CHECK (modalidad IN ('comodato', 'consumible_gasto', 'consumible_cobro')),
                ADD CONSTRAINT productos_modalidad_seguimiento CHECK (
                    (modalidad <> 'comodato' OR seguimiento = 'serie')
                    AND (modalidad <> 'consumible_gasto' OR seguimiento = 'cantidad')
                );
            CREATE INDEX productos_tipo ON inventario.productos (tipo_id);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS inventario.productos_tipo;
            ALTER TABLE inventario.productos
                DROP CONSTRAINT IF EXISTS productos_modalidad_seguimiento,
                DROP CONSTRAINT IF EXISTS productos_modalidad_check,
                DROP COLUMN IF EXISTS modalidad,
                DROP COLUMN IF EXISTS tipo_id,
                ADD CONSTRAINT productos_tipo_check CHECK (tipo IN ('equipo', 'material', 'otro')) NOT VALID;
            DROP TABLE IF EXISTS inventario.tipos_producto;
        `)
    }
}
