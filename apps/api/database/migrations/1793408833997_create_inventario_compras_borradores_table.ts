import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · inventario, fase D, pedido 5 (`contratos/inventario.md` D.5): factura de compra desde un archivo.
 *
 *  - `inventario.compras_borradores`: lo que leyó el parser FEL o la IA (`extraccion`, inmutable), lo que
 *    el usuario corrige (`datos`), la propuesta de proveedor y productos y, al confirmar, la compra. Se
 *    actualiza solo por sus acciones (editar, confirmar, descartar) con `version`. El archivo vive en el
 *    almacén (ruta, SHA-256, tipo y tamaño); un mismo archivo vivo una sola vez por empresa.
 *  - `inventario.ia_configuracion`: proveedor de IA por empresa o global (`empresa_id` null), con la
 *    clave cifrada (`v1` de `#shared/cifrado`); la clave nunca sale por la API.
 *  - `inventario.productos_codigos_proveedor`: el código con que un proveedor llama a un producto (se
 *    aprende al confirmar un borrador) para la coincidencia de la siguiente factura.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE inventario.compras_borradores (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'confirmado', 'descartado')),
                fuente text NOT NULL CHECK (fuente IN ('xml_fel', 'ia', 'manual')),
                archivo_ruta text,
                archivo_sha256 text CHECK (archivo_sha256 IS NULL OR archivo_sha256 ~ '^[0-9a-f]{64}$'),
                archivo_tipo text,
                archivo_tamano integer,
                archivo_nombre text,
                extraccion jsonb,
                confianza jsonb,
                error_extraccion text,
                ia_proveedor text,
                ia_modelo text,
                datos jsonb NOT NULL DEFAULT '{}'::jsonb,
                propuesta jsonb NOT NULL DEFAULT '{}'::jsonb,
                emisor_nit text,
                serie text,
                numero text,
                compra_id bigint REFERENCES ledger.compras (id),
                motivo_descarte text,
                creado_por bigint REFERENCES core.usuarios (id),
                confirmado_por bigint REFERENCES core.usuarios (id),
                confirmado_en timestamptz,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((estado = 'confirmado') = (compra_id IS NOT NULL)),
                CHECK ((archivo_ruta IS NULL) = (archivo_sha256 IS NULL)),
                CHECK (estado <> 'descartado' OR length(btrim(coalesce(motivo_descarte, ''))) > 0)
            );
            CREATE UNIQUE INDEX compras_borradores_archivo ON inventario.compras_borradores (empresa_id, archivo_sha256)
                WHERE archivo_sha256 IS NOT NULL AND estado <> 'descartado';
            CREATE INDEX compras_borradores_documento ON inventario.compras_borradores (empresa_id, emisor_nit, serie, numero);
            CREATE INDEX compras_borradores_empresa ON inventario.compras_borradores (empresa_id, id DESC);

            CREATE TABLE inventario.ia_configuracion (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint REFERENCES core.empresas (id),
                proveedor text NOT NULL CHECK (proveedor IN ('privada', 'anthropic', 'deepseek', 'openai')),
                modelo text NOT NULL CHECK (length(btrim(modelo)) > 0),
                url_base text,
                api_key_cifrada text,
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (proveedor <> 'privada' OR url_base IS NOT NULL)
            );
            CREATE UNIQUE INDEX ia_configuracion_empresa ON inventario.ia_configuracion (coalesce(empresa_id, 0));

            CREATE TABLE inventario.productos_codigos_proveedor (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                proveedor_id bigint NOT NULL REFERENCES ledger.proveedores (id),
                codigo text NOT NULL CHECK (length(btrim(codigo)) > 0),
                producto_id bigint NOT NULL REFERENCES inventario.productos (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX productos_codigos_proveedor_codigo
                ON inventario.productos_codigos_proveedor (proveedor_id, upper(codigo));
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS inventario.productos_codigos_proveedor;
            DROP TABLE IF EXISTS inventario.ia_configuracion;
            DROP TABLE IF EXISTS inventario.compras_borradores;
        `)
    }
}
