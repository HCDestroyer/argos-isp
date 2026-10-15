import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Schema `network` (parte 2): asignaciones IPv4/IPv6, sesiones e historial.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE network.ipv4_asignaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                red_id bigint NOT NULL REFERENCES network.redes_ipv4 (id),
                ip inet NOT NULL CHECK (family(ip) = 4 AND masklen(ip) = 32),
                inicio timestamptz NOT NULL DEFAULT now(),
                fin timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK (fin IS NULL OR fin >= inicio)
            );
            -- una IP vigente pertenece a un solo servicio
            CREATE UNIQUE INDEX ipv4_asignaciones_ip_vigente ON network.ipv4_asignaciones (ip) WHERE fin IS NULL;
            CREATE INDEX ipv4_asignaciones_servicio ON network.ipv4_asignaciones (servicio_id);
            CREATE INDEX ipv4_asignaciones_red ON network.ipv4_asignaciones (red_id);

            CREATE TABLE network.ipv6_asignaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                pool_id bigint REFERENCES network.ipv6_pools (id),
                prefijo cidr NOT NULL CHECK (family(prefijo) = 6),
                tipo text NOT NULL CHECK (tipo IN ('enlace', 'delegacion')),
                inicio timestamptz NOT NULL DEFAULT now(),
                fin timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK (fin IS NULL OR fin >= inicio)
            );
            CREATE UNIQUE INDEX ipv6_asignaciones_prefijo_vigente ON network.ipv6_asignaciones (prefijo) WHERE fin IS NULL;
            -- un prefijo vigente por servicio y tipo
            CREATE UNIQUE INDEX ipv6_asignaciones_servicio_tipo_vigente
                ON network.ipv6_asignaciones (servicio_id, tipo) WHERE fin IS NULL;
            CREATE INDEX ipv6_asignaciones_pool ON network.ipv6_asignaciones (pool_id);
            CREATE INDEX ipv6_asignaciones_prefijo_gist ON network.ipv6_asignaciones USING gist (prefijo inet_ops);

            CREATE TABLE network.sesiones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                servicio_id bigint REFERENCES core.servicios (id),
                router_id bigint REFERENCES network.routers (id),
                nas_ip inet NOT NULL,
                acct_session_id text NOT NULL,
                user_ppp text NOT NULL,
                ipv4 inet,
                prefijo_enlace_v6 cidr,
                prefijo_delegado_v6 cidr,
                inicio timestamptz NOT NULL DEFAULT now(),
                fin timestamptz,
                bytes_in bigint NOT NULL DEFAULT 0,
                bytes_out bigint NOT NULL DEFAULT 0,
                causa_fin text,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (nas_ip, acct_session_id)
            );
            CREATE INDEX sesiones_servicio_activa ON network.sesiones (servicio_id) WHERE fin IS NULL;
            CREATE INDEX sesiones_router_activa ON network.sesiones (router_id) WHERE fin IS NULL;
            CREATE INDEX sesiones_ipv4_activa ON network.sesiones (ipv4) WHERE fin IS NULL;
            CREATE INDEX sesiones_user_ppp ON network.sesiones (user_ppp);

            CREATE TABLE network.asignaciones_historial (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                router_id bigint REFERENCES network.routers (id),
                plan_id bigint REFERENCES network.planes (id),
                ipv4 inet,
                prefijo_v6 cidr,
                inicio timestamptz NOT NULL DEFAULT now(),
                fin timestamptz,
                motivo text,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX asignaciones_historial_servicio ON network.asignaciones_historial (servicio_id, inicio);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS network.asignaciones_historial;
            DROP TABLE IF EXISTS network.sesiones;
            DROP TABLE IF EXISTS network.ipv6_asignaciones;
            DROP TABLE IF EXISTS network.ipv4_asignaciones;
        `)
    }
}
