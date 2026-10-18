import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Schema `integraciones` (A6): conector con Horus Flow (contrato `contratos/horus.md`, ADR-0030).
 *
 * - `horus_conector`: una sola fila (`id = 1`). Apagado por defecto. URL base de Horus, código de
 *   conexión `hf_pat_` cifrado, URL y secreto del receptor de Horus (webhooks Argos → Horus) y el
 *   secreto que genera Argos para su receptor (Horus → Argos). Secretos con `app/shared/cifrado.ts`.
 * - `horus_salud`: una sola fila con el estado de la conexión (fallos seguidos y pausa con espera
 *   exponencial, máx. 15 min). Aparte del conector para no tocar su `version`.
 * - `horus_datos`: **último dato conocido** de cada consulta (360 de un servicio, consumo,
 *   seguridad). No es caché con TTL: se reemplaza cuando Horus responde y se muestra `stale`
 *   cuando no (regla 5).
 * - `horus_envios`: webhooks Argos → Horus, uno por evento del bus (`evento_id` único = id del
 *   outbox), con su estado, intentos y próximo intento (1 min, 5 min, 30 min, 2 h, 12 h).
 * - `horus_recibidos`: webhooks Horus → Argos, deduplicados por `webhook_id`.
 * - `horus_enlaces`: enlaces de conexión de un solo uso (§1.4): SHA-256 del código, vencimiento
 *   (15 min) y uso.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE SCHEMA IF NOT EXISTS integraciones;

            CREATE TABLE integraciones.horus_conector (
                id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                activo boolean NOT NULL DEFAULT false,
                url_base text,
                token_cifrado text,
                webhook_salida_url text,
                webhook_salida_secreto_cifrado text,
                webhook_entrada_secreto_cifrado text,
                -- id opaco del conector en Argos (§1.4, respuesta del canje)
                conector_id text NOT NULL DEFAULT ('argos_' || md5(random()::text || clock_timestamp()::text)),
                -- token atk_ que Argos emitió para Horus en el último canje (se revoca en el siguiente)
                token_argos_id bigint REFERENCES core.tokens_api (id),
                conectado_por_enlace_en timestamptz,
                ultima_prueba_en timestamptz,
                ultima_prueba_ok boolean,
                ultima_prueba_error text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                -- encendido exige lo mínimo para hablar con Horus
                CHECK (NOT activo OR (url_base IS NOT NULL AND token_cifrado IS NOT NULL))
            );

            -- §1.4: enlaces de conexión generados en Argos. Solo el SHA-256 del código.
            CREATE TABLE integraciones.horus_enlaces (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                codigo_sha256 text NOT NULL UNIQUE,
                -- URL pública de Argos con la que se generó (el receptor que se devuelve en el canje)
                base_url text NOT NULL,
                vence_en timestamptz NOT NULL,
                usado_en timestamptz,
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE integraciones.horus_salud (
                id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                fallos_seguidos integer NOT NULL DEFAULT 0,
                pausa_hasta timestamptz,
                ultimo_error text,
                ultimo_error_en timestamptz,
                ultimo_exito_en timestamptz,
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE integraciones.horus_datos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                tipo text NOT NULL CHECK (tipo IN ('servicio_360', 'consumo', 'seguridad')),
                clave text NOT NULL,
                servicio_id bigint REFERENCES core.servicios (id),
                datos jsonb NOT NULL,
                actualizado_en timestamptz NOT NULL,
                ultimo_error text,
                ultimo_error_en timestamptz,
                CONSTRAINT horus_datos_clave UNIQUE (tipo, clave)
            );
            CREATE INDEX horus_datos_servicio ON integraciones.horus_datos (servicio_id)
                WHERE servicio_id IS NOT NULL;

            CREATE TABLE integraciones.horus_envios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                evento_id text NOT NULL UNIQUE,
                evento text NOT NULL,
                empresa_id bigint REFERENCES core.empresas (id),
                cuerpo text NOT NULL,
                estado text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'enviado', 'fallido', 'descartado')),
                intentos integer NOT NULL DEFAULT 0,
                proximo_intento_en timestamptz,
                ultimo_status integer,
                ultimo_error text,
                enviado_en timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (estado <> 'pendiente' OR proximo_intento_en IS NOT NULL)
            );
            CREATE INDEX horus_envios_pendientes ON integraciones.horus_envios (proximo_intento_en)
                WHERE estado = 'pendiente';
            CREATE INDEX horus_envios_estado ON integraciones.horus_envios (estado, id);

            CREATE TABLE integraciones.horus_recibidos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                webhook_id text NOT NULL UNIQUE,
                evento text NOT NULL,
                ocurrido_en timestamptz,
                estado text NOT NULL CHECK (estado IN ('procesado', 'ignorado')),
                evento_interno text,
                empresa_id bigint REFERENCES core.empresas (id),
                servicio_id bigint REFERENCES core.servicios (id),
                cuerpo jsonb NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX horus_recibidos_servicio ON integraciones.horus_recibidos (servicio_id, id)
                WHERE servicio_id IS NOT NULL;

            INSERT INTO integraciones.horus_salud (id) VALUES (1);

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT USAGE ON SCHEMA integraciones TO argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA integraciones TO argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA integraciones TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`DROP SCHEMA IF EXISTS integraciones CASCADE;`)
    }
}
