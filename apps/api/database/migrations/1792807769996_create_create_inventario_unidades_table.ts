import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · inventario interno, fase B (`contratos/inventario.md` §4 y §5): unidades por serie y comodato.
 *
 *  - `inventario.unidades`: una fila por equipo de un producto con seguimiento `serie`, con su serie
 *    o MAC (al menos una; la MAC normalizada `AA:BB:CC:DD:EE:FF`), estado, condición, bodega, costo,
 *    servicio y activo. Es la única tabla del módulo que se actualiza (con `version`); cada cambio de
 *    estado pasa por una acción y deja su movimiento. Serie y MAC son únicas por empresa entre las
 *    unidades vivas: una de una compra anulada (`anulada`) o devuelta al proveedor
 *    (`devuelta_proveedor`) no bloquea volver a registrar ese equipo.
 *  - `inventario.movimientos.unidad_id` gana su FK; un movimiento de una unidad mueve ±1. El tipo
 *    `devolucion_proveedor` (NCRE del proveedor sobre líneas con producto) se suma al CHECK. El
 *    saldo inicial es único por producto y bodega solo para lo que se lleva por cantidad.
 *  - `ledger.activos.unidad_id`: el activo fijo de una unidad prestada en comodato (`ALTER ADD
 *    COLUMN`, nula en las filas existentes). `ledger.activos_bajas.tipo` admite
 *    `devolucion_comodato` (baja sin resultado: el equipo vuelve al inventario a su valor en libros).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE inventario.unidades (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                producto_id bigint NOT NULL REFERENCES inventario.productos (id),
                serie text CHECK (serie IS NULL OR length(btrim(serie)) > 0),
                mac text CHECK (mac IS NULL OR mac ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
                estado text NOT NULL CHECK (estado IN (
                    'disponible', 'en_comodato', 'por_recuperar', 'en_reparacion', 'vendida', 'dada_de_baja',
                    'anulada', 'devuelta_proveedor'
                )),
                condicion text NOT NULL DEFAULT 'nuevo' CHECK (condicion IN ('nuevo', 'usado')),
                bodega_id bigint REFERENCES inventario.bodegas (id),
                costo numeric(14, 2) NOT NULL CHECK (costo >= 0),
                servicio_id bigint REFERENCES core.servicios (id),
                activo_id bigint REFERENCES ledger.activos (id),
                compra_id bigint REFERENCES ledger.compras (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (serie IS NOT NULL OR mac IS NOT NULL),
                CHECK ((estado IN ('disponible', 'en_reparacion')) = (bodega_id IS NOT NULL)),
                CHECK (estado NOT IN ('en_comodato', 'por_recuperar') OR (servicio_id IS NOT NULL AND activo_id IS NOT NULL)),
                CHECK (estado IN ('en_comodato', 'por_recuperar') OR activo_id IS NULL)
            );
            CREATE UNIQUE INDEX unidades_serie ON inventario.unidades (empresa_id, upper(serie))
                WHERE serie IS NOT NULL AND estado NOT IN ('anulada', 'devuelta_proveedor');
            CREATE UNIQUE INDEX unidades_mac ON inventario.unidades (empresa_id, mac)
                WHERE mac IS NOT NULL AND estado NOT IN ('anulada', 'devuelta_proveedor');
            CREATE INDEX unidades_producto ON inventario.unidades (producto_id, estado, bodega_id);
            CREATE INDEX unidades_servicio ON inventario.unidades (servicio_id) WHERE servicio_id IS NOT NULL;
            CREATE INDEX unidades_empresa ON inventario.unidades (empresa_id, id DESC);

            -- producto de serie, bodega y servicio de la empresa de la unidad (regla 13)
            CREATE FUNCTION inventario.validar_unidad() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM inventario.productos p WHERE p.id = NEW.producto_id
                                  AND p.empresa_id = NEW.empresa_id AND p.seguimiento = 'serie') THEN
                    RAISE EXCEPTION 'El producto % no es de serie o no es de la empresa %', NEW.producto_id, NEW.empresa_id
                        USING ERRCODE = '23514';
                END IF;
                IF NEW.bodega_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM inventario.bodegas b WHERE b.id = NEW.bodega_id AND b.empresa_id = NEW.empresa_id
                ) THEN
                    RAISE EXCEPTION 'La bodega % no es de la empresa %', NEW.bodega_id, NEW.empresa_id USING ERRCODE = '23514';
                END IF;
                IF NEW.servicio_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM core.servicios s WHERE s.id = NEW.servicio_id AND s.empresa_id = NEW.empresa_id
                ) THEN
                    RAISE EXCEPTION 'El servicio % no es de la empresa %', NEW.servicio_id, NEW.empresa_id USING ERRCODE = '23514';
                END IF;
                IF TG_OP = 'UPDATE' AND (NEW.empresa_id <> OLD.empresa_id OR NEW.producto_id <> OLD.producto_id) THEN
                    RAISE EXCEPTION 'La empresa y el producto de una unidad no cambian' USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER unidades_validar BEFORE INSERT OR UPDATE ON inventario.unidades
                FOR EACH ROW EXECUTE FUNCTION inventario.validar_unidad();
            CREATE TRIGGER unidades_sin_borrar BEFORE DELETE ON inventario.unidades
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER unidades_sin_truncate BEFORE TRUNCATE ON inventario.unidades
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            ALTER TABLE inventario.movimientos
                ADD CONSTRAINT movimientos_unidad_fk FOREIGN KEY (unidad_id) REFERENCES inventario.unidades (id),
                ADD CONSTRAINT movimientos_unidad_una CHECK (unidad_id IS NULL OR abs(cantidad) = 1),
                DROP CONSTRAINT movimientos_tipo_check,
                ADD CONSTRAINT movimientos_tipo_check CHECK (tipo IN (
                    'entrada_compra', 'reverso_compra', 'devolucion_proveedor', 'venta', 'reverso_venta', 'consumo',
                    'traslado', 'asignacion_comodato', 'devolucion_comodato', 'ajuste_conteo', 'ajuste', 'baja',
                    'saldo_inicial'
                ));
            CREATE INDEX movimientos_unidad ON inventario.movimientos (unidad_id, id) WHERE unidad_id IS NOT NULL;
            DROP INDEX inventario.movimientos_saldo_inicial;
            CREATE UNIQUE INDEX movimientos_saldo_inicial ON inventario.movimientos (producto_id, bodega_id)
                WHERE tipo = 'saldo_inicial' AND unidad_id IS NULL;

            ALTER TABLE ledger.activos ADD COLUMN unidad_id bigint REFERENCES inventario.unidades (id);
            CREATE INDEX activos_unidad ON ledger.activos (unidad_id) WHERE unidad_id IS NOT NULL;
            ALTER TABLE ledger.activos_bajas DROP CONSTRAINT activos_bajas_tipo_check;
            ALTER TABLE ledger.activos_bajas ADD CONSTRAINT activos_bajas_tipo_check
                CHECK (tipo IN ('venta', 'retiro', 'anulacion', 'devolucion_comodato'));

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON inventario.unidades TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON inventario.unidades FROM argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inventario TO argosisp_app;
                END IF;
            END $$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE ledger.activos_bajas DROP CONSTRAINT activos_bajas_tipo_check;
            ALTER TABLE ledger.activos_bajas ADD CONSTRAINT activos_bajas_tipo_check
                CHECK (tipo IN ('venta', 'retiro', 'anulacion')) NOT VALID;
            ALTER TABLE ledger.activos DROP COLUMN IF EXISTS unidad_id;
            DROP INDEX IF EXISTS inventario.movimientos_saldo_inicial;
            -- con saldos iniciales de varias unidades del mismo producto y bodega el índice de antes no
            -- se puede crear: el rollback no falla por los datos de prueba
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM inventario.movimientos WHERE tipo = 'saldo_inicial'
                     GROUP BY producto_id, bodega_id HAVING count(*) > 1
                ) THEN
                    CREATE UNIQUE INDEX movimientos_saldo_inicial ON inventario.movimientos (producto_id, bodega_id)
                        WHERE tipo = 'saldo_inicial';
                END IF;
            END $$;
            ALTER TABLE inventario.movimientos
                DROP CONSTRAINT IF EXISTS movimientos_unidad_fk,
                DROP CONSTRAINT IF EXISTS movimientos_unidad_una,
                DROP CONSTRAINT movimientos_tipo_check,
                ADD CONSTRAINT movimientos_tipo_check CHECK (tipo IN (
                    'entrada_compra', 'reverso_compra', 'venta', 'reverso_venta', 'consumo', 'traslado',
                    'asignacion_comodato', 'devolucion_comodato', 'ajuste_conteo', 'ajuste', 'baja', 'saldo_inicial'
                )) NOT VALID;
            DROP TABLE IF EXISTS inventario.unidades;
            DROP FUNCTION IF EXISTS inventario.validar_unidad();
        `)
    }
}
