import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `core.servicios` y `core.servicios_excepciones`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.servicios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                router_id bigint NOT NULL REFERENCES network.routers (id),
                plan_id bigint NOT NULL REFERENCES network.planes (id),
                plantilla_facturacion_id bigint REFERENCES billing.plantillas_facturacion (id),
                estado text NOT NULL DEFAULT 'activo'
                    CHECK (estado IN ('activo', 'limitado', 'suspendido', 'retirado')),
                user_ppp text NOT NULL,
                -- cifrado v1 (AES-256-GCM, AAA_PPP_KEY; app/shared/cifrado.ts); aaa lo descifra
                pass_ppp text NOT NULL,
                mac macaddr,
                direccion text,
                coordenadas text CHECK (coordenadas ~ '^-?[0-9]+(\\.[0-9]+)?, ?-?[0-9]+(\\.[0-9]+)?$'),
                fecha_instalacion date,
                costo_override numeric(14, 2) CHECK (costo_override >= 0),
                excluir_firewall boolean NOT NULL DEFAULT false,
                ipv6_duid text,
                ipv6_modo text NOT NULL DEFAULT 'radius_servicio'
                    CHECK (ipv6_modo IN ('radius_servicio', 'radius_pool', 'duid', 'estatico', 'ninguno')),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT servicios_user_ppp_unico UNIQUE (user_ppp)
            );
            CREATE INDEX servicios_cliente ON core.servicios (cliente_id);
            CREATE INDEX servicios_router ON core.servicios (router_id);
            CREATE INDEX servicios_plan ON core.servicios (plan_id);
            CREATE INDEX servicios_plantilla ON core.servicios (plantilla_facturacion_id);
            CREATE INDEX servicios_estado ON core.servicios (estado);

            -- Excepciones a la plantilla de facturación por servicio (A3 define los campos).
            CREATE TABLE core.servicios_excepciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                servicio_id bigint NOT NULL REFERENCES core.servicios (id) ON DELETE CASCADE,
                campo text NOT NULL,
                valor jsonb NOT NULL,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (servicio_id, campo)
            );
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS core.servicios_excepciones;
            DROP TABLE IF EXISTS core.servicios;
        `)
    }
}
