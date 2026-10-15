import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Schema `core`: usuarios, ACL, tokens, sesiones de login, zonas, clientes e idempotencia.
 * `core.servicios` va en una migración posterior porque depende de `network` y `billing`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.usuarios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL,
                email text NOT NULL,
                password_hash text NOT NULL,
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX usuarios_email_unico ON core.usuarios (lower(email));

            CREATE TABLE core.roles (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL UNIQUE,
                descripcion text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE core.permisos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL UNIQUE CHECK (nombre ~ '^[a-z0-9_]+\\.[a-z0-9_]+$'),
                descripcion text,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE core.roles_permisos (
                role_id bigint NOT NULL REFERENCES core.roles (id) ON DELETE CASCADE,
                permiso_id bigint NOT NULL REFERENCES core.permisos (id) ON DELETE CASCADE,
                created_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (role_id, permiso_id)
            );
            CREATE INDEX roles_permisos_permiso ON core.roles_permisos (permiso_id);

            CREATE TABLE core.usuarios_roles (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                usuario_id bigint NOT NULL REFERENCES core.usuarios (id) ON DELETE CASCADE,
                role_id bigint NOT NULL REFERENCES core.roles (id) ON DELETE CASCADE,
                alcance_tipo text CHECK (alcance_tipo IN ('router', 'zona', 'caja')),
                alcance_id bigint,
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((alcance_tipo IS NULL) = (alcance_id IS NULL)),
                UNIQUE NULLS NOT DISTINCT (usuario_id, role_id, alcance_tipo, alcance_id)
            );
            CREATE INDEX usuarios_roles_role ON core.usuarios_roles (role_id);

            CREATE TABLE core.tokens_api (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                usuario_id bigint NOT NULL REFERENCES core.usuarios (id) ON DELETE CASCADE,
                nombre text NOT NULL,
                hash text NOT NULL UNIQUE,
                alcances jsonb NOT NULL DEFAULT '{}'::jsonb,
                ultimo_uso timestamptz,
                revocado_en timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX tokens_api_usuario ON core.tokens_api (usuario_id);

            -- Sesiones de login (tokens opacos de @adonisjs/auth).
            CREATE TABLE core.auth_access_tokens (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                tokenable_id bigint NOT NULL REFERENCES core.usuarios (id) ON DELETE CASCADE,
                type text NOT NULL,
                name text,
                hash text NOT NULL,
                abilities text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                last_used_at timestamptz,
                expires_at timestamptz
            );
            CREATE INDEX auth_access_tokens_tokenable ON core.auth_access_tokens (tokenable_id);

            CREATE TABLE core.zonas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL UNIQUE,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE core.clientes (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL,
                tipo text NOT NULL DEFAULT 'persona' CHECK (tipo IN ('persona', 'empresa')),
                nit_cui text,
                nombre_fiscal text,
                direccion_fiscal text,
                email text,
                telefono text,
                movil text,
                direccion text,
                -- "lat,lng" en grados decimales (WGS84)
                coordenadas text CHECK (coordenadas ~ '^-?[0-9]+(\\.[0-9]+)?, ?-?[0-9]+(\\.[0-9]+)?$'),
                zona_id bigint REFERENCES core.zonas (id),
                campos_personalizados jsonb NOT NULL DEFAULT '{}'::jsonb,
                canal_preferido text NOT NULL DEFAULT 'correo'
                    CHECK (canal_preferido IN ('correo', 'telegram', 'whatsapp')),
                telegram_chat_id text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX clientes_nombre ON core.clientes (lower(nombre));
            CREATE INDEX clientes_nit_cui ON core.clientes (nit_cui);
            CREATE INDEX clientes_telefono ON core.clientes (telefono);
            CREATE INDEX clientes_movil ON core.clientes (movil);
            CREATE INDEX clientes_zona ON core.clientes (zona_id);

            CREATE TABLE core.idempotency_keys (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                clave text NOT NULL CHECK (length(clave) BETWEEN 1 AND 255),
                actor_id bigint,
                metodo text NOT NULL,
                ruta text NOT NULL,
                -- sha256 del cuerpo de la petición: misma clave con otro cuerpo es un error
                huella text NOT NULL,
                -- { status, body } de la primera respuesta; null mientras se procesa
                respuesta jsonb,
                created_at timestamptz NOT NULL DEFAULT now(),
                completada_en timestamptz,
                UNIQUE NULLS NOT DISTINCT (clave, actor_id)
            );
            CREATE INDEX idempotency_keys_created ON core.idempotency_keys (created_at);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS core.idempotency_keys;
            DROP TABLE IF EXISTS core.clientes;
            DROP TABLE IF EXISTS core.zonas;
            DROP TABLE IF EXISTS core.auth_access_tokens;
            DROP TABLE IF EXISTS core.tokens_api;
            DROP TABLE IF EXISTS core.usuarios_roles;
            DROP TABLE IF EXISTS core.roles_permisos;
            DROP TABLE IF EXISTS core.permisos;
            DROP TABLE IF EXISTS core.roles;
            DROP TABLE IF EXISTS core.usuarios;
        `)
    }
}
