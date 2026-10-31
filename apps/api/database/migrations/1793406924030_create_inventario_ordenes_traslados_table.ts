import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · inventario, fase D, pedido 1 (`contratos/inventario.md` D.1): orden de traslado que recibe quien
 * recibe.
 *
 *  - `inventario.bodegas.tipo` admite `transito`: una bodega virtual por empresa (índice único) donde
 *    está lo enviado mientras viaja. El kardex sigue siendo la única verdad y la existencia del origen
 *    y del destino no la cuenta.
 *  - `inventario.ordenes_traslado` (número correlativo por empresa), sus líneas y las unidades de
 *    serie de cada línea. Se actualizan solo por sus acciones (enviar, recibir, cancelar, adjuntar el
 *    papel firmado), con `version` y `audit.cambios`.
 *  - `inventario.configuracion`: una fila por empresa (`traslado_firma_obligatoria`, por defecto true).
 *
 * Sin datos previos: ninguna fila existente cambia.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE inventario.bodegas
                DROP CONSTRAINT bodegas_tipo_check,
                ADD CONSTRAINT bodegas_tipo_check CHECK (tipo IN ('bodega', 'tecnico', 'transito'));
            CREATE UNIQUE INDEX bodegas_transito ON inventario.bodegas (empresa_id) WHERE tipo = 'transito';

            CREATE TABLE inventario.ordenes_traslado (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                numero integer NOT NULL CHECK (numero > 0),
                bodega_origen_id bigint NOT NULL REFERENCES inventario.bodegas (id),
                bodega_destino_id bigint NOT NULL REFERENCES inventario.bodegas (id),
                bodega_transito_id bigint NOT NULL REFERENCES inventario.bodegas (id),
                estado text NOT NULL DEFAULT 'en_transito'
                    CHECK (estado IN ('en_transito', 'recibida', 'recibida_con_diferencias', 'cancelada')),
                motivo text,
                enviado_por bigint REFERENCES core.usuarios (id),
                enviado_en timestamptz NOT NULL DEFAULT now(),
                metodo_recepcion text CHECK (metodo_recepcion IN ('firma_digital', 'firma_papel', 'aceptacion_sistema')),
                recibido_por bigint REFERENCES core.usuarios (id),
                registrado_por bigint REFERENCES core.usuarios (id),
                recibido_en timestamptz,
                observaciones text,
                firma_ruta text,
                firma_sha256 text CHECK (firma_sha256 IS NULL OR firma_sha256 ~ '^[0-9a-f]{64}$'),
                firma_tamano integer,
                firma_ip text,
                firma_en timestamptz,
                documento_ruta text,
                documento_sha256 text CHECK (documento_sha256 IS NULL OR documento_sha256 ~ '^[0-9a-f]{64}$'),
                documento_tipo text,
                documento_tamano integer,
                documento_por bigint REFERENCES core.usuarios (id),
                documento_en timestamptz,
                cancelado_por bigint REFERENCES core.usuarios (id),
                cancelado_en timestamptz,
                motivo_cancelacion text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (empresa_id, numero),
                CHECK (bodega_origen_id <> bodega_destino_id),
                CHECK ((estado IN ('recibida', 'recibida_con_diferencias'))
                       = (metodo_recepcion IS NOT NULL AND recibido_en IS NOT NULL)),
                CHECK ((estado = 'cancelada')
                       = (cancelado_en IS NOT NULL AND length(btrim(coalesce(motivo_cancelacion, ''))) > 0)),
                CHECK ((metodo_recepcion = 'firma_digital') = (firma_sha256 IS NOT NULL)),
                CHECK (documento_sha256 IS NULL OR metodo_recepcion = 'firma_papel')
            );
            CREATE INDEX ordenes_traslado_empresa ON inventario.ordenes_traslado (empresa_id, id DESC);
            CREATE INDEX ordenes_traslado_destino ON inventario.ordenes_traslado (bodega_destino_id, estado);
            CREATE INDEX ordenes_traslado_origen ON inventario.ordenes_traslado (bodega_origen_id, estado);

            CREATE TABLE inventario.ordenes_traslado_lineas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                orden_id bigint NOT NULL REFERENCES inventario.ordenes_traslado (id),
                producto_id bigint NOT NULL REFERENCES inventario.productos (id),
                cantidad numeric(14, 3) NOT NULL CHECK (cantidad > 0),
                costo_total numeric(14, 2) NOT NULL CHECK (costo_total >= 0),
                cantidad_recibida numeric(14, 3) CHECK (cantidad_recibida >= 0 AND cantidad_recibida <= cantidad),
                costo_recibido numeric(14, 2) CHECK (costo_recibido >= 0 AND costo_recibido <= costo_total),
                UNIQUE (orden_id, producto_id),
                CHECK ((cantidad_recibida IS NULL) = (costo_recibido IS NULL))
            );

            CREATE TABLE inventario.ordenes_traslado_unidades (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                linea_id bigint NOT NULL REFERENCES inventario.ordenes_traslado_lineas (id),
                unidad_id bigint NOT NULL REFERENCES inventario.unidades (id),
                costo numeric(14, 2) NOT NULL CHECK (costo >= 0),
                recibida boolean,
                UNIQUE (linea_id, unidad_id)
            );
            CREATE INDEX ordenes_traslado_unidades_unidad ON inventario.ordenes_traslado_unidades (unidad_id);

            CREATE TABLE inventario.configuracion (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL UNIQUE REFERENCES core.empresas (id),
                traslado_firma_obligatoria boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS inventario.configuracion;
            DROP TABLE IF EXISTS inventario.ordenes_traslado_unidades;
            DROP TABLE IF EXISTS inventario.ordenes_traslado_lineas;
            DROP TABLE IF EXISTS inventario.ordenes_traslado;
            DROP INDEX IF EXISTS inventario.bodegas_transito;
            ALTER TABLE inventario.bodegas
                DROP CONSTRAINT bodegas_tipo_check,
                ADD CONSTRAINT bodegas_tipo_check CHECK (tipo IN ('bodega', 'tecnico')) NOT VALID;
        `)
    }
}
