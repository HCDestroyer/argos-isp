import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Schema `network` (parte 1): routers, redes IPv4, bloques y pools IPv6, planes.
 * Las tablas que dependen de `core.servicios` están en `..._crear_network_asignaciones`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE network.routers (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL UNIQUE,
                host text NOT NULL,
                api_usuario text,
                -- cifrado v1 (AES-256-GCM, AAA_PPP_KEY; app/shared/cifrado.ts)
                api_password text,
                -- cifrado v1 (AES-256-GCM, AAA_PPP_KEY): aaa y coa lo descifran
                radius_secret text,
                nas_ip inet NOT NULL UNIQUE,
                modo_seguridad text NOT NULL DEFAULT 'radius' CHECK (modo_seguridad IN ('radius', 'api')),
                modo_velocidad text NOT NULL DEFAULT 'simple' CHECK (modo_velocidad IN ('simple', 'pcq')),
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE network.redes_ipv4 (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                router_id bigint NOT NULL REFERENCES network.routers (id),
                cidr cidr NOT NULL CHECK (family(cidr) = 4),
                gateway inet CHECK (gateway IS NULL OR family(gateway) = 4),
                tipo text NOT NULL DEFAULT 'estatico' CHECK (tipo IN ('estatico', 'pool')),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                -- dos redes no pueden traslaparse
                EXCLUDE USING gist (cidr inet_ops WITH &&)
            );
            CREATE INDEX redes_ipv4_router ON network.redes_ipv4 (router_id);

            CREATE TABLE network.ipv6_bloques (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                router_id bigint NOT NULL REFERENCES network.routers (id),
                prefijo cidr NOT NULL CHECK (family(prefijo) = 6),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                EXCLUDE USING gist (prefijo inet_ops WITH &&)
            );
            CREATE INDEX ipv6_bloques_router ON network.ipv6_bloques (router_id);

            CREATE TABLE network.ipv6_pools (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                bloque_id bigint NOT NULL REFERENCES network.ipv6_bloques (id),
                prefijo cidr NOT NULL CHECK (family(prefijo) = 6),
                tipo text NOT NULL CHECK (tipo IN ('enlace', 'delegacion')),
                tamano_entrega smallint NOT NULL CHECK (tamano_entrega IN (64, 56, 48)),
                nombre_en_router text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (masklen(prefijo) <= tamano_entrega),
                EXCLUDE USING gist (prefijo inet_ops WITH &&)
            );
            CREATE INDEX ipv6_pools_bloque ON network.ipv6_pools (bloque_id);

            CREATE TABLE network.planes (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL UNIQUE,
                precio numeric(14, 2) NOT NULL CHECK (precio >= 0),
                bajada_kbps integer NOT NULL CHECK (bajada_kbps > 0),
                subida_kbps integer NOT NULL CHECK (subida_kbps > 0),
                bajada_limitada_kbps integer NOT NULL DEFAULT 0 CHECK (bajada_limitada_kbps >= 0),
                subida_limitada_kbps integer NOT NULL DEFAULT 0 CHECK (subida_limitada_kbps >= 0),
                -- relación de reuso 1:N
                reuso integer NOT NULL DEFAULT 1 CHECK (reuso >= 1),
                dual_stack text NOT NULL DEFAULT 'ambos' CHECK (dual_stack IN ('ambos', 'v4', 'v6')),
                tamano_prefijo_delegado smallint NOT NULL DEFAULT 56 CHECK (tamano_prefijo_delegado IN (64, 56, 48)),
                global boolean NOT NULL DEFAULT true,
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE network.planes_routers (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                plan_id bigint NOT NULL REFERENCES network.planes (id) ON DELETE CASCADE,
                router_id bigint NOT NULL REFERENCES network.routers (id) ON DELETE CASCADE,
                profile_ppp text,
                pool_ipv4 text,
                pool_ipv6_enlace text,
                pool_ipv6_delegacion text,
                local_address inet,
                no_crear_reglas boolean NOT NULL DEFAULT false,
                rate_limit_override text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (plan_id, router_id)
            );
            CREATE INDEX planes_routers_router ON network.planes_routers (router_id);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS network.planes_routers;
            DROP TABLE IF EXISTS network.planes;
            DROP TABLE IF EXISTS network.ipv6_pools;
            DROP TABLE IF EXISTS network.ipv6_bloques;
            DROP TABLE IF EXISTS network.redes_ipv4;
            DROP TABLE IF EXISTS network.routers;
        `)
    }
}
