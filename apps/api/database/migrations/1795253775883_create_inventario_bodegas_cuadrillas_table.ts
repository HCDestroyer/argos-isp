import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · bodega de cuadrilla (contrato Iris 0.11.0 §3.9, A47; decisiones del PM en §10.6).
 *
 * - `inventario.bodegas.tipo` admite `cuadrilla`: la bodega compartida de una cuadrilla de Iris en una
 *   empresa (`cuadrilla_id_iris`, única por empresa), con la última `cuadrilla_version` aplicada y su
 *   `jefe_id` (usuario de Argos) actual. Una cuadrilla que atiende varias empresas tiene una bodega en
 *   cada una.
 * - `inventario.cuadrilla_miembros`: un vínculo por miembro con su historial (`desde`, `hasta`), el id
 *   de Iris (`iris_usuario_id`) y el usuario de Argos (`usuario_id`, el `id_externo` de I1). Los que
 *   Argos no acepta quedan con `aceptado = false` y su `motivo` (`miembro_rechazado` en el panel).
 * - `inventario.cuadrilla_jefes`: historial del jefe (`desde`, `hasta`), para saber quién era el jefe
 *   en `recibido_en` de una recepción.
 * - `inventario.movimientos.actor_tecnico` (`X-Iris-Actor`, nunca del cuerpo), `actor_tecnico_id` (el
 *   usuario de Argos que usó el material) y `ocurrido_en` (la `fecha` del teléfono).
 *
 * Las dos tablas nuevas son de solo inserción salvo cerrar un vínculo (`hasta`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE inventario.bodegas
                DROP CONSTRAINT bodegas_tipo_check,
                ADD CONSTRAINT bodegas_tipo_check CHECK (tipo IN ('bodega', 'tecnico', 'transito', 'cuadrilla')),
                ADD COLUMN cuadrilla_id_iris text,
                ADD COLUMN cuadrilla_version bigint,
                ADD COLUMN jefe_id bigint REFERENCES core.usuarios (id),
                ADD CONSTRAINT bodegas_cuadrilla CHECK (
                    (tipo = 'cuadrilla') = (cuadrilla_id_iris IS NOT NULL)
                    AND (tipo = 'cuadrilla' OR (cuadrilla_version IS NULL AND jefe_id IS NULL))
                    AND (cuadrilla_id_iris IS NULL OR cuadrilla_id_iris ~ '^[A-Za-z0-9._:-]{1,100}$'));
            CREATE UNIQUE INDEX bodegas_cuadrilla_iris ON inventario.bodegas (empresa_id, cuadrilla_id_iris)
                WHERE tipo = 'cuadrilla';

            CREATE TABLE inventario.cuadrilla_miembros (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                bodega_id bigint NOT NULL REFERENCES inventario.bodegas (id),
                iris_usuario_id text NOT NULL CHECK (iris_usuario_id ~ '^[A-Za-z0-9_-]{1,64}$'),
                usuario_id bigint REFERENCES core.usuarios (id),
                aceptado boolean NOT NULL,
                motivo text,
                desde timestamptz NOT NULL DEFAULT now(),
                hasta timestamptz,
                version bigint NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK (hasta IS NULL OR hasta >= desde),
                CHECK (aceptado = (motivo IS NULL)),
                CHECK (NOT aceptado OR usuario_id IS NOT NULL)
            );
            CREATE UNIQUE INDEX cuadrilla_miembros_vigente ON inventario.cuadrilla_miembros (bodega_id, iris_usuario_id)
                WHERE hasta IS NULL;
            CREATE INDEX cuadrilla_miembros_usuario ON inventario.cuadrilla_miembros (usuario_id, bodega_id)
                WHERE aceptado;

            CREATE TABLE inventario.cuadrilla_jefes (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                bodega_id bigint NOT NULL REFERENCES inventario.bodegas (id),
                usuario_id bigint NOT NULL REFERENCES core.usuarios (id),
                iris_usuario_id text NOT NULL,
                desde timestamptz NOT NULL DEFAULT now(),
                hasta timestamptz,
                version bigint NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK (hasta IS NULL OR hasta >= desde)
            );
            CREATE UNIQUE INDEX cuadrilla_jefes_vigente ON inventario.cuadrilla_jefes (bodega_id) WHERE hasta IS NULL;

            ALTER TABLE inventario.movimientos
                ADD COLUMN actor_tecnico text CHECK (actor_tecnico IS NULL OR actor_tecnico ~ '^usuario:[A-Za-z0-9_-]{1,64}$'),
                ADD COLUMN actor_tecnico_id bigint REFERENCES core.usuarios (id),
                ADD COLUMN ocurrido_en timestamptz;

            CREATE TRIGGER cuadrilla_miembros_sin_borrar BEFORE DELETE ON inventario.cuadrilla_miembros
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER cuadrilla_jefes_sin_borrar BEFORE DELETE ON inventario.cuadrilla_jefes
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON inventario.cuadrilla_miembros, inventario.cuadrilla_jefes TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON inventario.cuadrilla_miembros, inventario.cuadrilla_jefes FROM argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inventario TO argosisp_app;
                END IF;
            END $$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE inventario.movimientos
                DROP COLUMN IF EXISTS ocurrido_en,
                DROP COLUMN IF EXISTS actor_tecnico_id,
                DROP COLUMN IF EXISTS actor_tecnico;
            DROP TABLE IF EXISTS inventario.cuadrilla_jefes;
            DROP TABLE IF EXISTS inventario.cuadrilla_miembros;
            DROP INDEX IF EXISTS inventario.bodegas_cuadrilla_iris;
            ALTER TABLE inventario.bodegas
                DROP CONSTRAINT IF EXISTS bodegas_cuadrilla,
                DROP COLUMN IF EXISTS jefe_id,
                DROP COLUMN IF EXISTS cuadrilla_version,
                DROP COLUMN IF EXISTS cuadrilla_id_iris,
                DROP CONSTRAINT bodegas_tipo_check,
                ADD CONSTRAINT bodegas_tipo_check CHECK (tipo IN ('bodega', 'tecnico', 'transito')) NOT VALID;
        `)
    }
}
