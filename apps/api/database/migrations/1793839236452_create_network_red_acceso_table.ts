import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Red de acceso (`contratos/red-acceso.md`): OLT y puertos PON (datos para ordenar), VLAN y
 * servidores PPPoE ligados al router, y `core.servicios.servidor_pppoe_id`.
 *
 * - Un servidor PPPoE por interfaz (o VLAN) del router: índices únicos.
 * - Máximo 2 VLAN por puerto PON: lo valida la acción con bloqueo de la fila del puerto.
 * - `estado`: `administrado` (Argos lo escribe en el router con `comment = argosisp:…`) o
 *   `adoptado` (existía en el router; Argos nunca lo toca).
 */
export default class extends BaseSchema {
    async up() {
        this.defer(async (db) => {
            await db.rawQuery(`
                CREATE TABLE network.olts (
                    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    nombre text NOT NULL,
                    marca text,
                    modelo text,
                    empresa_id bigint REFERENCES core.empresas (id),
                    descripcion text,
                    activo boolean NOT NULL DEFAULT true,
                    version integer NOT NULL DEFAULT 1,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                );
                CREATE UNIQUE INDEX olts_nombre ON network.olts (lower(nombre));

                CREATE TABLE network.olt_puertos_pon (
                    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    olt_id bigint NOT NULL REFERENCES network.olts (id) ON DELETE CASCADE,
                    identificador text NOT NULL CHECK (identificador ~ '^[0-9]{1,3}(/[0-9]{1,3}){1,3}$'),
                    descripcion text,
                    version integer NOT NULL DEFAULT 1,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    UNIQUE (olt_id, identificador)
                );

                CREATE TABLE network.vlans (
                    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    router_id bigint NOT NULL REFERENCES network.routers (id),
                    empresa_id bigint REFERENCES core.empresas (id),
                    interfaz_padre text NOT NULL,
                    vlan_id integer NOT NULL CHECK (vlan_id BETWEEN 1 AND 4094),
                    nombre text NOT NULL,
                    puerto_pon_id bigint REFERENCES network.olt_puertos_pon (id),
                    mtu integer CHECK (mtu BETWEEN 576 AND 9216),
                    estado text NOT NULL DEFAULT 'administrado' CHECK (estado IN ('administrado', 'adoptado')),
                    ros_id text,
                    descripcion text,
                    version integer NOT NULL DEFAULT 1,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    UNIQUE (router_id, interfaz_padre, vlan_id)
                );
                CREATE UNIQUE INDEX vlans_nombre ON network.vlans (router_id, lower(nombre));
                CREATE INDEX vlans_puerto_pon ON network.vlans (puerto_pon_id) WHERE puerto_pon_id IS NOT NULL;

                CREATE TABLE network.servidores_pppoe (
                    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    router_id bigint NOT NULL REFERENCES network.routers (id),
                    empresa_id bigint REFERENCES core.empresas (id),
                    nombre text NOT NULL,
                    vlan_id bigint REFERENCES network.vlans (id),
                    interfaz text NOT NULL,
                    service_name text NOT NULL,
                    red_ipv4_id bigint REFERENCES network.redes_ipv4 (id),
                    ipv6_pool_enlace_id bigint REFERENCES network.ipv6_pools (id),
                    ipv6_pool_delegacion_id bigint REFERENCES network.ipv6_pools (id),
                    perfil_base text NOT NULL DEFAULT 'default',
                    perfil_router text,
                    max_mtu integer NOT NULL DEFAULT 1480 CHECK (max_mtu BETWEEN 576 AND 9000),
                    max_mru integer NOT NULL DEFAULT 1480 CHECK (max_mru BETWEEN 576 AND 9000),
                    mrru integer CHECK (mrru BETWEEN 1500 AND 65535),
                    autenticacion text[] NOT NULL DEFAULT '{pap,chap,mschap1,mschap2}'
                        CHECK (cardinality(autenticacion) > 0
                               AND autenticacion <@ ARRAY['pap', 'chap', 'mschap1', 'mschap2']),
                    keepalive_timeout integer NOT NULL DEFAULT 10 CHECK (keepalive_timeout BETWEEN 0 AND 3600),
                    una_sesion_por_host boolean NOT NULL DEFAULT true,
                    max_sesiones integer CHECK (max_sesiones > 0),
                    estado text NOT NULL DEFAULT 'administrado' CHECK (estado IN ('administrado', 'adoptado')),
                    ros_id text,
                    activo boolean NOT NULL DEFAULT true,
                    descripcion text,
                    version integer NOT NULL DEFAULT 1,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                );
                CREATE UNIQUE INDEX servidores_pppoe_interfaz ON network.servidores_pppoe (router_id, lower(interfaz));
                CREATE UNIQUE INDEX servidores_pppoe_nombre ON network.servidores_pppoe (router_id, lower(nombre));
                CREATE UNIQUE INDEX servidores_pppoe_vlan ON network.servidores_pppoe (vlan_id) WHERE vlan_id IS NOT NULL;
                CREATE INDEX servidores_pppoe_red ON network.servidores_pppoe (red_ipv4_id) WHERE red_ipv4_id IS NOT NULL;

                ALTER TABLE core.servicios
                    ADD COLUMN servidor_pppoe_id bigint REFERENCES network.servidores_pppoe (id);
                CREATE INDEX servicios_servidor_pppoe ON core.servicios (servidor_pppoe_id)
                    WHERE servidor_pppoe_id IS NOT NULL;
            `)
        })
    }

    async down() {
        this.defer(async (db) => {
            await db.rawQuery(`
                ALTER TABLE core.servicios DROP COLUMN IF EXISTS servidor_pppoe_id;
                DROP TABLE IF EXISTS network.servidores_pppoe;
                DROP TABLE IF EXISTS network.vlans;
                DROP TABLE IF EXISTS network.olt_puertos_pon;
                DROP TABLE IF EXISTS network.olts;
            `)
        })
    }
}
