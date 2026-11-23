import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Corridas de las tareas programadas (pantalla «Tareas programadas», `app/monitoreo/crons`). Una fila
 * por corrida de un cron del catálogo: se inserta `en_curso` al empezar (con la instancia que la
 * corre) y se completa al terminar con `ok`, `sin_cambios`, `error` u `omitido`.
 *
 * Por qué no en `audit.*`: una corrida tiene inicio y fin (la fila se actualiza) y `audit.*` es solo
 * de inserción; además las corridas sin cambios de los crons de alta frecuencia no dejan fila en
 * `audit.acciones` (excepciones de CLAUDE.md §9) y aquí tampoco crecen sin control: las corridas
 * programadas seguidas sin cambios se agrupan en una fila (`repeticiones`). Es un registro operativo,
 * no la bitácora: se conserva 90 días (`RETENCION_DIAS` de `corridas.ts`) y lo que haya hecho cada
 * corrida sigue auditado por sus acciones.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.cron_corridas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                clave text NOT NULL,
                origen text NOT NULL CHECK (origen IN ('programado', 'manual')),
                estado text NOT NULL DEFAULT 'en_curso'
                    CHECK (estado IN ('en_curso', 'ok', 'sin_cambios', 'error', 'omitido')),
                inicio timestamptz NOT NULL DEFAULT now(),
                ultimo_inicio timestamptz NOT NULL DEFAULT now(),
                fin timestamptz,
                duracion_ms integer CHECK (duracion_ms >= 0),
                repeticiones integer NOT NULL DEFAULT 1 CHECK (repeticiones >= 1),
                resumen text,
                error text,
                detalle jsonb,
                instancia text NOT NULL,
                job_id text,
                usuario_id bigint REFERENCES core.usuarios (id),
                request_id text
            );
            CREATE INDEX cron_corridas_clave_inicio ON core.cron_corridas (clave, id DESC);
            CREATE INDEX cron_corridas_en_curso ON core.cron_corridas (clave) WHERE estado = 'en_curso';
            CREATE INDEX cron_corridas_fin ON core.cron_corridas (fin);

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE, DELETE ON core.cron_corridas TO argosisp_app;
                    GRANT USAGE, SELECT ON SEQUENCE core.cron_corridas_id_seq TO argosisp_app;
                END IF;
            END
            $$;
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.cron_corridas')
    }
}
