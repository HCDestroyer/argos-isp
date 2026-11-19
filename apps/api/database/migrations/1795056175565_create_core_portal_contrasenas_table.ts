import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Acceso al portal con documento y contraseña y acceso directo desde `/corte` (A5, pedido del PM).
 *
 * - `core.portal_credenciales`: la contraseña PROPIA del cliente (solo el hash de Adonis, scrypt).
 *   Sin fila, el cliente entra con la contraseña por defecto de la empresa. Tabla aparte de
 *   `core.clientes` para que ninguna lectura del cliente (`SELECT *`, diff de `clientes.editar`) la
 *   arrastre.
 * - `core.portal_contrasenas_defecto`: la contraseña por defecto de cada empresa (solo el hash).
 * - `core.portal_intentos_contrasena`: intentos de entrada para el límite por documento y por IP.
 *   El documento se guarda como HMAC (APP_KEY), nunca en claro. Se inserta el intento ANTES de
 *   verificar y fuera de la transacción de la acción: un intento fallido queda contado aunque la
 *   acción se revierta, y N peticiones en paralelo no pasan del límite.
 * - `core.portal_sesiones`: `origen` (codigo, contrasena, corte), `debe_cambiar_contrasena` (entró con
 *   la de por defecto: solo puede cambiarla o salir) y `servicio_id` (la sesión de `/corte`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.portal_credenciales (
                cliente_id bigint PRIMARY KEY REFERENCES core.clientes (id),
                contrasena_hash text NOT NULL,
                actualizada_en timestamptz NOT NULL DEFAULT now(),
                version integer NOT NULL DEFAULT 1
            );

            CREATE TABLE core.portal_contrasenas_defecto (
                empresa_id bigint PRIMARY KEY REFERENCES core.empresas (id),
                contrasena_hash text NOT NULL,
                actualizada_en timestamptz NOT NULL DEFAULT now(),
                version integer NOT NULL DEFAULT 1
            );

            CREATE TABLE core.portal_intentos_contrasena (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                clave_documento text NOT NULL,
                clave_ip text NOT NULL,
                exito boolean NOT NULL DEFAULT false,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX portal_intentos_documento ON core.portal_intentos_contrasena (clave_documento, created_at DESC);
            CREATE INDEX portal_intentos_ip ON core.portal_intentos_contrasena (clave_ip, created_at DESC);

            ALTER TABLE core.portal_sesiones
                ADD COLUMN origen text NOT NULL DEFAULT 'codigo'
                    CHECK (origen IN ('codigo', 'contrasena', 'corte')),
                ADD COLUMN debe_cambiar_contrasena boolean NOT NULL DEFAULT false,
                ADD COLUMN servicio_id bigint REFERENCES core.servicios (id);

            -- Búsqueda del documento normalizado (sin espacios ni guiones, en mayúsculas), como
            -- \`limpiarDocumento\` de #core/nit_cui.
            CREATE INDEX clientes_documento_portal
                ON core.clientes ((upper(regexp_replace(coalesce(nit_cui, ''), '[[:space:]-]', '', 'g'))));
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS core.clientes_documento_portal;
            ALTER TABLE core.portal_sesiones
                DROP COLUMN IF EXISTS servicio_id,
                DROP COLUMN IF EXISTS debe_cambiar_contrasena,
                DROP COLUMN IF EXISTS origen;
            DROP TABLE IF EXISTS core.portal_intentos_contrasena;
            DROP TABLE IF EXISTS core.portal_contrasenas_defecto;
            DROP TABLE IF EXISTS core.portal_credenciales;
        `)
    }
}
