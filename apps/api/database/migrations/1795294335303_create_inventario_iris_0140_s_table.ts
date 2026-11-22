import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · contrato Iris 0.14.0 del lado de inventario y equipos (§3.9, §3.10, §4.5, §6.6, §10.10).
 *
 * - `inventario.verificaciones_iris`: la verificación de servidor a servidor de cada intento de
 *   recuperación y de cada cambio con cobro propuesto que llega de un Iris ≥ 0.14.0 (R-01 a R-03). Guarda la
 *   `Idempotency-Key` tal como llegó, el estado (`pendiente`, `verificado`, `no_verificado`, `anterior`,
 *   `aceptado`, `descartado`), el motivo de la lista cerrada y el siguiente reintento (`proxima_en`, que el
 *   worker toma con una actualización condicional: varias instancias nunca consultan la misma fila a la
 *   vez). Los intentos de Iris anteriores a esta migración quedan `anterior` («anterior a la
 *   verificación»: los decide una persona, §4.5).
 * - `inventario.avisos_recuperacion`: un aviso al titular por servicio y día (de Guatemala), solo por
 *   intentos verificados (R-02). La clave única hace que dos instancias no avisen dos veces.
 * - `inventario.tecnicos_iris`: el vínculo de cada técnico de Iris con su usuario de Argos por empresa
 *   (`tecnico.argos_vinculado` / `tecnico.argos_desvinculado`, §6.6, R-10), con `version` creciente,
 *   `vinculo_rechazado` y la reevaluación pendiente cuando se libera un `id_externo` (N-2). Aparte del
 *   vínculo de §7.7: nunca autoriza nada de pagos y atención (T-10).
 * - `inventario.alertas_tecnico`: alertas al admin por movimientos de un técnico vinculado fuera de una
 *   orden informada o por encima del volumen diario (riesgo aceptado T-12), una por clave.
 * - `inventario.intentos_recuperacion`: sin el índice único por unidad y día. El cupo diario lo decide la
 *   acción con la unidad bloqueada, porque un intento que Iris no confirma no ocupa el cupo (T-2).
 * - `inventario.cobros_equipo`: estados `por_verificar` (cobro propuesto de un cambio que espera su
 *   verificación; no está en la cola) y `no_verificado` (no entró nunca, T-7).
 * - `inventario.cambios_equipo.foto_ref`, `inventario.movimientos.idempotency_key` (la clave de cada
 *   consumo, comodato y devolución que llega de Iris, T-12), `inventario.contactos_recuperacion.actor_tipo`
 *   (solo cuenta el contacto que registró una persona, T-8), `inventario.configuracion
 *   .iris_movimientos_diarios_alerta` (40 de fábrica) e `integraciones.iris_conector.vinculos_cargados`
 *   y `vinculos_cargados_en` (fin de la carga inicial de vínculos, N-1).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE inventario.verificaciones_iris (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                operacion text NOT NULL CHECK (operacion IN ('no_recuperado', 'cambio')),
                intento_id bigint UNIQUE REFERENCES inventario.intentos_recuperacion (id),
                cambio_id bigint UNIQUE REFERENCES inventario.cambios_equipo (id),
                idempotency_key text CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 255),
                estado text NOT NULL CHECK (estado IN (
                    'pendiente', 'verificado', 'no_verificado', 'anterior', 'aceptado', 'descartado'
                )),
                motivo text CHECK (motivo IS NULL OR motivo ~ '^[a-z_]{1,40}$'),
                consultas integer NOT NULL DEFAULT 0 CHECK (consultas >= 0),
                proxima_en timestamptz,
                ultima_consulta_en timestamptz,
                ultimo_status integer,
                verificado_en timestamptz,
                decidido_por bigint REFERENCES core.usuarios (id),
                decidido_en timestamptz,
                motivo_decision text CHECK (motivo_decision IS NULL OR length(motivo_decision) <= 500),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((operacion = 'no_recuperado') = (intento_id IS NOT NULL)),
                CHECK ((operacion = 'cambio') = (cambio_id IS NOT NULL)),
                CHECK (estado <> 'pendiente' OR idempotency_key IS NOT NULL),
                CHECK (proxima_en IS NULL OR estado = 'pendiente'),
                CHECK ((estado IN ('aceptado', 'descartado')) = (decidido_en IS NOT NULL))
            );
            CREATE UNIQUE INDEX verificaciones_iris_clave ON inventario.verificaciones_iris (idempotency_key)
                WHERE idempotency_key IS NOT NULL;
            CREATE INDEX verificaciones_iris_proxima ON inventario.verificaciones_iris (proxima_en)
                WHERE estado = 'pendiente' AND proxima_en IS NOT NULL;

            CREATE TABLE inventario.avisos_recuperacion (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                dia date NOT NULL,
                intento_id bigint NOT NULL REFERENCES inventario.intentos_recuperacion (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (servicio_id, dia)
            );

            CREATE TABLE inventario.tecnicos_iris (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                iris_usuario_id text NOT NULL CHECK (iris_usuario_id ~ '^[A-Za-z0-9_-]{1,64}$'),
                iris_tecnico_id text CHECK (iris_tecnico_id IS NULL OR length(iris_tecnico_id) <= 100),
                id_externo text CHECK (id_externo IS NULL OR length(id_externo) <= 100),
                usuario_id bigint REFERENCES core.usuarios (id),
                estado text NOT NULL CHECK (estado IN ('vinculado', 'rechazado', 'desvinculado')),
                motivo text CHECK (motivo IS NULL OR motivo ~ '^[a-z_]{1,40}$'),
                version bigint NOT NULL CHECK (version >= 1),
                origen text NOT NULL CHECK (origen IN ('webhook', 'conciliacion')),
                reevaluar_en timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (empresa_id, iris_usuario_id),
                CHECK (estado <> 'vinculado' OR usuario_id IS NOT NULL)
            );
            CREATE UNIQUE INDEX tecnicos_iris_usuario_vigente ON inventario.tecnicos_iris (empresa_id, usuario_id)
                WHERE estado = 'vinculado';
            CREATE INDEX tecnicos_iris_reevaluar ON inventario.tecnicos_iris (reevaluar_en)
                WHERE reevaluar_en IS NOT NULL;

            CREATE TABLE inventario.alertas_tecnico (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                usuario_id bigint REFERENCES core.usuarios (id),
                actor_tecnico text,
                motivo text NOT NULL CHECK (motivo IN ('sin_orden', 'volumen_diario')),
                dia date NOT NULL,
                clave text NOT NULL,
                movimientos integer NOT NULL,
                umbral integer,
                movimiento_id bigint,
                created_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (empresa_id, motivo, dia, clave)
            );

            DROP INDEX IF EXISTS inventario.intentos_recuperacion_dia;
            CREATE INDEX intentos_recuperacion_unidad_dia ON inventario.intentos_recuperacion (unidad_id, dia);

            ALTER TABLE inventario.cobros_equipo
                DROP CONSTRAINT cobros_equipo_estado_check,
                ADD CONSTRAINT cobros_equipo_estado_check CHECK (estado IN (
                    'propuesto', 'aprobado', 'rechazado', 'por_verificar', 'no_verificado'
                )),
                DROP CONSTRAINT cobros_equipo_check1,
                ADD CONSTRAINT cobros_equipo_decidido CHECK ((estado IN ('propuesto', 'por_verificar')) = (decidido_en IS NULL));

            ALTER TABLE inventario.cambios_equipo
                ADD COLUMN foto_ref text CHECK (foto_ref IS NULL OR foto_ref ~ '^[A-Za-z0-9._:-]{1,128}$');
            ALTER TABLE inventario.movimientos
                ADD COLUMN idempotency_key text CHECK (idempotency_key IS NULL OR length(idempotency_key) <= 255);
            ALTER TABLE inventario.contactos_recuperacion ADD COLUMN actor_tipo text;
            ALTER TABLE inventario.configuracion
                ADD COLUMN iris_movimientos_diarios_alerta integer NOT NULL DEFAULT 40
                    CHECK (iris_movimientos_diarios_alerta BETWEEN 1 AND 10000);
            ALTER TABLE integraciones.iris_conector
                ADD COLUMN vinculos_cargados integer CHECK (vinculos_cargados IS NULL OR vinculos_cargados >= 0),
                ADD COLUMN vinculos_cargados_en timestamptz;

            -- intentos de Iris que ya estaban: «anteriores a la verificación» (§4.5)
            INSERT INTO inventario.verificaciones_iris (empresa_id, operacion, intento_id, estado)
            SELECT i.empresa_id, 'no_recuperado', i.id, 'anterior'
              FROM inventario.intentos_recuperacion i
             WHERE i.actor_tecnico IS NOT NULL OR i.origen_externo_tipo = 'iris_orden';

            CREATE TRIGGER avisos_recuperacion_sin_modificar BEFORE UPDATE OR DELETE ON inventario.avisos_recuperacion
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER alertas_tecnico_sin_modificar BEFORE UPDATE OR DELETE ON inventario.alertas_tecnico
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER verificaciones_iris_sin_borrar BEFORE DELETE ON inventario.verificaciones_iris
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER tecnicos_iris_sin_borrar BEFORE DELETE ON inventario.tecnicos_iris
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON inventario.avisos_recuperacion, inventario.alertas_tecnico TO argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON inventario.verificaciones_iris, inventario.tecnicos_iris TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON inventario.avisos_recuperacion, inventario.alertas_tecnico,
                        inventario.verificaciones_iris, inventario.tecnicos_iris FROM argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inventario TO argosisp_app;
                END IF;
            END $$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE integraciones.iris_conector
                DROP COLUMN IF EXISTS vinculos_cargados_en,
                DROP COLUMN IF EXISTS vinculos_cargados;
            ALTER TABLE inventario.configuracion DROP COLUMN IF EXISTS iris_movimientos_diarios_alerta;
            ALTER TABLE inventario.contactos_recuperacion DROP COLUMN IF EXISTS actor_tipo;
            ALTER TABLE inventario.movimientos DROP COLUMN IF EXISTS idempotency_key;
            ALTER TABLE inventario.cambios_equipo DROP COLUMN IF EXISTS foto_ref;
            ALTER TABLE inventario.cobros_equipo
                DROP CONSTRAINT IF EXISTS cobros_equipo_decidido,
                ADD CONSTRAINT cobros_equipo_check1 CHECK ((estado = 'propuesto') = (decidido_en IS NULL)) NOT VALID,
                DROP CONSTRAINT cobros_equipo_estado_check,
                ADD CONSTRAINT cobros_equipo_estado_check CHECK (estado IN ('propuesto', 'aprobado', 'rechazado')) NOT VALID;
            DROP INDEX IF EXISTS inventario.intentos_recuperacion_unidad_dia;
            DROP TABLE IF EXISTS inventario.alertas_tecnico;
            DROP TABLE IF EXISTS inventario.tecnicos_iris;
            DROP TABLE IF EXISTS inventario.avisos_recuperacion;
            DROP TABLE IF EXISTS inventario.verificaciones_iris;
        `)
    }
}
