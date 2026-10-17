import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Schema `importacion` (A6): el **archivo del origen**. Decisión del PM: "se debe traer todo, para
 * no perder ni dejar volando datos". Cada fila de **cada** tabla del volcado (también las que no
 * tienen equivalente en ArgosIsp) se guarda tal cual en `filas_origen`, con a qué registro de
 * ArgosIsp se llevó o por qué se quedó solo en el archivo.
 *
 *  - Clave: (`origen`, `tabla`, `id_externo`). `id_externo` = la columna `id` de la fila (sin ceros
 *    a la izquierda) o, si la tabla no tiene `id`, una huella de la fila. Importar dos veces el
 *    mismo volcado no duplica nada.
 *  - `estado`: `importada` (tiene registro en ArgosIsp: `entidad_tipo` + `entidad_id`),
 *    `solo_archivo` (sin equivalente: la fila queda aquí) u `omitida` (con `motivo`).
 *  - `fila`: la fila tal cual, con las credenciales (contraseñas de router, PPPoE, tokens) como
 *    `***`. Las contraseñas PPPoE sí se importan al servicio, cifradas.
 *  - `huella`: SHA-1 de la fila y su mapeo; si no cambió, una corrida nueva no la reescribe (ni
 *    la audita).
 *  - Se escribe solo por la acción `importacion.archivar` (`ArchivarFilasOrigen`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE SCHEMA IF NOT EXISTS importacion;

            CREATE TABLE importacion.filas_origen (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                origen text NOT NULL CHECK (origen ~ '^[a-z0-9_]{1,40}$'),
                tabla text NOT NULL,
                id_externo text NOT NULL,
                linea integer NOT NULL,
                fila jsonb NOT NULL CHECK (jsonb_typeof(fila) = 'object'),
                estado text NOT NULL CHECK (estado IN ('importada', 'solo_archivo', 'omitida')),
                entidad_tipo text,
                entidad_id bigint,
                motivo text,
                huella text NOT NULL,
                request_id text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT filas_origen_clave UNIQUE (origen, tabla, id_externo),
                CHECK ((estado = 'importada') = (entidad_tipo IS NOT NULL)),
                CHECK (estado = 'importada' OR motivo IS NOT NULL)
            );
            CREATE INDEX filas_origen_entidad ON importacion.filas_origen (entidad_tipo, entidad_id)
                WHERE entidad_id IS NOT NULL;
            CREATE INDEX filas_origen_estado ON importacion.filas_origen (origen, tabla, estado);

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT USAGE ON SCHEMA importacion TO argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA importacion TO argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA importacion TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`DROP SCHEMA IF EXISTS importacion CASCADE;`)
    }
}
