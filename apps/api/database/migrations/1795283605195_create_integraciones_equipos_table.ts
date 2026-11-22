import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Equipos del cliente con SmartOLT y GenieACS (A6, contrato Iris 0.9.0 §12: A32, A33 y A35).
 *
 * - `equipos_config`: una fila por empresa. URL y token de SmartOLT (`X-Token`), URL, usuario y
 *   clave de GenieACS (NBI detrás de un proxy con autenticación básica), cifrados con
 *   `app/shared/cifrado.ts`, y el resultado de la última prueba de cada uno. Cambiar la URL o el
 *   secreto borra la prueba: la capacidad vuelve a false hasta probar de nuevo.
 * - `equipos_perfiles`: perfil de autorización de SmartOLT (`authorization_preset_id`) por OLT de
 *   SmartOLT y plan (plan null = el de la OLT para cualquier plan).
 * - `equipos_servicio`: el equipo gestionado de cada servicio (id externo de la ONU en SmartOLT,
 *   id del dispositivo en GenieACS). Lo llena el aprovisionamiento o la primera lectura.
 * - `aprovisionamientos`: pedidos de A32 con sus pasos, causa y reintentos. La clave Wi-Fi inicial
 *   se guarda cifrada solo mientras está en proceso y se borra al terminar.
 * - `wifi_solicitudes`: pedidos de A35. SSID y clave cifrados solo hasta resolverse.
 * - `equipos_lecturas`: última lectura del estado del equipo (§12.3 permite responder la de menos
 *   de 60 s). No es caché con TTL: se reemplaza al leer y se borra al aprovisionar o cambiar el Wi-Fi.
 * - `audit.red.tipo` admite `smartolt` y `genieacs` (cada comando a esos sistemas queda ahí).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE integraciones.equipos_config (
                empresa_id bigint PRIMARY KEY REFERENCES core.empresas (id),
                activo boolean NOT NULL DEFAULT false,
                smartolt_url text,
                smartolt_token_cifrado text,
                smartolt_probado_en timestamptz,
                smartolt_prueba_ok boolean,
                smartolt_prueba_error text,
                genieacs_url text,
                genieacs_usuario text,
                genieacs_clave_cifrada text,
                genieacs_probado_en timestamptz,
                genieacs_prueba_ok boolean,
                genieacs_prueba_error text,
                pppoe_por_acs boolean NOT NULL DEFAULT false,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE integraciones.equipos_perfiles (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                smartolt_olt_id text NOT NULL,
                plan_id bigint REFERENCES network.planes (id),
                authorization_preset_id integer NOT NULL CHECK (authorization_preset_id > 0),
                pon_type text NOT NULL DEFAULT 'gpon' CHECK (pon_type IN ('gpon', 'epon')),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX equipos_perfiles_unico
                ON integraciones.equipos_perfiles (empresa_id, smartolt_olt_id, coalesce(plan_id, 0));

            CREATE TABLE integraciones.equipos_servicio (
                servicio_id bigint PRIMARY KEY REFERENCES core.servicios (id) ON DELETE CASCADE,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                tipo text NOT NULL CHECK (tipo IN ('ont', 'cpe_wireless', 'router_tr069')),
                serie text,
                mac text,
                modelo text,
                unidad_id bigint,
                smartolt_external_id text,
                acs_device_id text,
                aprovisionamiento_id bigint,
                actualizado_en timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX equipos_servicio_serie ON integraciones.equipos_servicio (upper(serie))
                WHERE serie IS NOT NULL;

            CREATE TABLE integraciones.aprovisionamientos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id) ON DELETE CASCADE,
                cliente_id bigint NOT NULL,
                origen_tipo text,
                origen_id text,
                idempotency_key text,
                estado text NOT NULL DEFAULT 'en_proceso'
                    CHECK (estado IN ('en_proceso', 'listo', 'fallido')),
                pasos jsonb NOT NULL,
                causa text,
                reintentable boolean NOT NULL DEFAULT false,
                detalle text,
                equipo jsonb NOT NULL,
                planta jsonb,
                wireless jsonb,
                wifi_ssid_cifrado text,
                wifi_clave_cifrada text,
                tecnico_id_externo text,
                iris_actor text,
                senal jsonb,
                smartolt_external_id text,
                acs_device_id text,
                intentos integer NOT NULL DEFAULT 0,
                proximo_intento_en timestamptz,
                terminado_en timestamptz,
                creado_por_tipo text NOT NULL,
                creado_por_id bigint,
                request_id text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (estado = 'en_proceso' OR (wifi_clave_cifrada IS NULL AND wifi_ssid_cifrado IS NULL)),
                CHECK (estado <> 'en_proceso' OR proximo_intento_en IS NOT NULL)
            );
            CREATE UNIQUE INDEX aprovisionamientos_en_curso
                ON integraciones.aprovisionamientos (servicio_id) WHERE estado = 'en_proceso';
            CREATE INDEX aprovisionamientos_pendientes
                ON integraciones.aprovisionamientos (proximo_intento_en) WHERE estado = 'en_proceso';
            CREATE INDEX aprovisionamientos_servicio ON integraciones.aprovisionamientos (servicio_id, id);

            CREATE TABLE integraciones.wifi_solicitudes (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id) ON DELETE CASCADE,
                cliente_id bigint NOT NULL,
                origen_tipo text NOT NULL,
                origen_id text NOT NULL,
                idempotency_key text,
                estado text NOT NULL DEFAULT 'en_proceso'
                    CHECK (estado IN ('en_proceso', 'aplicado', 'fallido')),
                causa text,
                cambia_ssid boolean NOT NULL,
                cambia_clave boolean NOT NULL,
                ssid_cifrado text,
                clave_cifrada text,
                verificacion jsonb NOT NULL,
                intentos integer NOT NULL DEFAULT 0,
                proximo_intento_en timestamptz,
                resuelto_en timestamptz,
                request_id text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (estado = 'en_proceso' OR (clave_cifrada IS NULL AND ssid_cifrado IS NULL)),
                CHECK (estado <> 'en_proceso' OR proximo_intento_en IS NOT NULL)
            );
            CREATE INDEX wifi_solicitudes_servicio ON integraciones.wifi_solicitudes (servicio_id, created_at);
            CREATE INDEX wifi_solicitudes_pendientes
                ON integraciones.wifi_solicitudes (proximo_intento_en) WHERE estado = 'en_proceso';

            CREATE TABLE integraciones.equipos_lecturas (
                servicio_id bigint PRIMARY KEY REFERENCES core.servicios (id) ON DELETE CASCADE,
                datos jsonb NOT NULL,
                leido_en timestamptz NOT NULL
            );

            ALTER TABLE audit.red DROP CONSTRAINT red_tipo_check;
            ALTER TABLE audit.red ADD CONSTRAINT red_tipo_check
                CHECK (tipo IN ('coa', 'disconnect', 'routeros', 'smartolt', 'genieacs'));

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON integraciones.equipos_config,
                        integraciones.equipos_servicio, integraciones.aprovisionamientos,
                        integraciones.wifi_solicitudes, integraciones.equipos_lecturas TO argosisp_app;
                    GRANT SELECT, INSERT, UPDATE, DELETE ON integraciones.equipos_perfiles,
                        integraciones.equipos_lecturas TO argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA integraciones TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS integraciones.equipos_lecturas;
            DROP TABLE IF EXISTS integraciones.wifi_solicitudes;
            DROP TABLE IF EXISTS integraciones.aprovisionamientos;
            DROP TABLE IF EXISTS integraciones.equipos_servicio;
            DROP TABLE IF EXISTS integraciones.equipos_perfiles;
            DROP TABLE IF EXISTS integraciones.equipos_config;
            -- audit.red es inmutable: las filas smartolt/genieacs ya escritas se quedan, así que el
            -- CHECK de audit.red conserva los dos tipos nuevos al revertir.
        `)
    }
}
