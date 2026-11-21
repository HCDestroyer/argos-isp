import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A6 · prospectos registrados desde Argos en Iris (contrato Iris 0.10.0 §3.6, A44).
 *
 * `integraciones.iris_prospectos`: la cola de pendientes hacia `POST <iris>/api/v1/integraciones/
 * argosisp/prospectos` y, después, **solo el vínculo** con el prospecto de Iris.
 *
 *  - `idempotency_key` = `argos:prospecto:<uuid>`, única; cada reintento manda la misma clave y los
 *    mismos bytes (`cuerpo`, con `empresa_id` y `actor` de las cabeceras).
 *  - `cuerpo` lleva los datos personales (nombre, teléfonos, dirección) solo mientras el envío está
 *    pendiente: al terminar (`enviado`, `duplicado`, `rechazado` o `fallido`) se borra y queda el
 *    vínculo (`prospecto_id`, `numero`, `estado_iris`, `url_iris`).
 *  - `estado_iris` lo actualiza el webhook `prospecto.estado_cambiado` (§6.6).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE integraciones.iris_prospectos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^argos:prospecto:[0-9a-f-]{36}$'),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                cliente_id bigint REFERENCES core.clientes (id),
                registrado_por bigint REFERENCES core.usuarios (id),
                origen text NOT NULL CHECK (origen IN ('oficina', 'llamada', 'whatsapp', 'referido', 'otro')),
                telefonos smallint NOT NULL CHECK (telefonos BETWEEN 1 AND 5),
                cuerpo text,
                entrega text NOT NULL DEFAULT 'pendiente'
                    CHECK (entrega IN ('pendiente', 'enviado', 'duplicado', 'rechazado', 'fallido')),
                intentos integer NOT NULL DEFAULT 0,
                proximo_intento_en timestamptz NOT NULL DEFAULT now(),
                ultimo_status integer,
                ultimo_error text,
                codigo_error text,
                prospecto_id text,
                numero text,
                estado_iris text,
                motivo_iris text,
                asignado boolean,
                url_iris text,
                enviado_en timestamptz,
                estado_cambiado_en timestamptz,
                request_id text,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (entrega = 'pendiente' OR cuerpo IS NULL)
            );
            CREATE INDEX iris_prospectos_pendientes ON integraciones.iris_prospectos (proximo_intento_en)
                WHERE entrega = 'pendiente';
            CREATE INDEX iris_prospectos_prospecto ON integraciones.iris_prospectos (prospecto_id)
                WHERE prospecto_id IS NOT NULL;
            CREATE INDEX iris_prospectos_cliente ON integraciones.iris_prospectos (cliente_id)
                WHERE cliente_id IS NOT NULL;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON integraciones.iris_prospectos TO argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA integraciones TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS integraciones.iris_prospectos')
    }
}
