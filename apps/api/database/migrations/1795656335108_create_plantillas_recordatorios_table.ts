import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * notify (A6) · R1 del plan v3 (`contratos/recordatorios.md` §2 a §4): plantillas de recordatorio con
 * nombre, por empresa, con sus pasos, y su asignación por servicio o por suscripción.
 *
 * - `notify.plantillas_recordatorio`: una por defecto por empresa (índice único parcial). Con
 *   `servicio_id` es la plantilla **personalizada** de ese servicio (única por servicio, nunca por
 *   defecto ni retirada, no se asigna a otros). Nombre único por empresa entre las que no son
 *   personalizadas. Se retiran (`retirada_en`, `motivo_retiro`), nunca se borran (salvo la
 *   personalizada al quitarla o al eliminar su servicio).
 * - `notify.plantillas_recordatorio_pasos`: hasta 8 por plantilla (`orden` 1 a 8, único). `dias`
 *   respecto al disparador (−60 a 60; `corte_proximo` y `promesa_por_vencer` solo antes o el día).
 * - `notify.recordatorios_asignaciones`: exactamente uno de `servicio_id` o `suscripcion_id`, única
 *   por cada uno. `suscripcion_id` queda sin FK: `billing.suscripciones` la crea I1 (A3), que agrega
 *   la referencia. Sin fila = la por defecto de la empresa.
 * - Triggers: la plantilla de una asignación es de la misma empresa, no es personalizada y no está
 *   retirada (al asignarla); el servicio de una asignación o de una personalizada es de esa empresa.
 *   Respaldo de las validaciones de las acciones (cualquier camino: importador, SQL).
 * - Siembra: cada empresa recibe «Estándar», por defecto, con los tres recordatorios actuales de
 *   `notify.recordatorios` como pasos de `vencimiento` (mismos `dias`, `hora` y `activo`; si la tabla
 *   aún está vacía, los valores de fábrica del seeder). Una empresa nueva la recibe en la misma
 *   transacción de su alta (trigger en `core.empresas`): no hay evento de empresa creada.
 *   `notify.recordatorios` no se toca: el cron sigue leyéndola hasta R2.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE notify.plantillas_recordatorio (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 120),
                descripcion text,
                por_defecto boolean NOT NULL DEFAULT false,
                servicio_id bigint REFERENCES core.servicios (id) ON DELETE CASCADE,
                retirada_en timestamptz,
                retirada_por bigint REFERENCES core.usuarios (id),
                motivo_retiro text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT plantillas_recordatorio_retiro CHECK (
                    (retirada_en IS NULL AND motivo_retiro IS NULL)
                    OR (retirada_en IS NOT NULL AND length(btrim(coalesce(motivo_retiro, ''))) >= 3)
                ),
                CONSTRAINT plantillas_recordatorio_defecto_vigente CHECK (
                    NOT (por_defecto AND (retirada_en IS NOT NULL OR servicio_id IS NOT NULL))
                ),
                CONSTRAINT plantillas_recordatorio_personalizada_vigente CHECK (
                    servicio_id IS NULL OR retirada_en IS NULL
                )
            );
            CREATE UNIQUE INDEX plantillas_recordatorio_una_por_defecto
                ON notify.plantillas_recordatorio (empresa_id) WHERE por_defecto;
            CREATE UNIQUE INDEX plantillas_recordatorio_nombre
                ON notify.plantillas_recordatorio (empresa_id, lower(btrim(nombre))) WHERE servicio_id IS NULL;
            CREATE UNIQUE INDEX plantillas_recordatorio_personalizada
                ON notify.plantillas_recordatorio (servicio_id) WHERE servicio_id IS NOT NULL;

            CREATE TABLE notify.plantillas_recordatorio_pasos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                plantilla_id bigint NOT NULL REFERENCES notify.plantillas_recordatorio (id) ON DELETE CASCADE,
                orden smallint NOT NULL CHECK (orden BETWEEN 1 AND 8),
                disparador text NOT NULL
                    CHECK (disparador IN ('vencimiento', 'corte_proximo', 'promesa_por_vencer')),
                dias integer NOT NULL CHECK (dias BETWEEN -60 AND 60),
                hora time NOT NULL DEFAULT '09:00',
                aviso text NOT NULL CHECK (
                    aviso IN ('factura_por_vencer', 'factura_vencida', 'corte_proximo', 'promesa_por_vencer')
                ),
                evento_plantilla text NOT NULL CHECK (
                    evento_plantilla IN (
                        'recordatorio.1', 'recordatorio.2', 'recordatorio.3',
                        'recordatorio.corte_proximo', 'recordatorio.promesa_por_vencer'
                    )
                ),
                canales text[] NOT NULL DEFAULT '{}'
                    CHECK (canales <@ ARRAY['whatsapp', 'correo', 'telegram']::text[]),
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT plantillas_recordatorio_pasos_orden UNIQUE (plantilla_id, orden),
                CONSTRAINT plantillas_recordatorio_pasos_antes CHECK (disparador = 'vencimiento' OR dias <= 0)
            );

            CREATE TABLE notify.recordatorios_asignaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                plantilla_id bigint NOT NULL REFERENCES notify.plantillas_recordatorio (id),
                servicio_id bigint REFERENCES core.servicios (id) ON DELETE CASCADE,
                suscripcion_id bigint,
                asignada_por bigint REFERENCES core.usuarios (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT recordatorios_asignaciones_un_destino CHECK (num_nonnulls(servicio_id, suscripcion_id) = 1)
            );
            CREATE UNIQUE INDEX recordatorios_asignaciones_servicio
                ON notify.recordatorios_asignaciones (servicio_id) WHERE servicio_id IS NOT NULL;
            CREATE UNIQUE INDEX recordatorios_asignaciones_suscripcion
                ON notify.recordatorios_asignaciones (suscripcion_id) WHERE suscripcion_id IS NOT NULL;
            CREATE INDEX recordatorios_asignaciones_plantilla
                ON notify.recordatorios_asignaciones (plantilla_id);

            -- La asignación: plantilla de la misma empresa, no personalizada y vigente al asignarla;
            -- el servicio, de esa empresa.
            CREATE FUNCTION notify.validar_asignacion_recordatorio() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                p notify.plantillas_recordatorio%ROWTYPE;
                v_empresa bigint;
            BEGIN
                SELECT * INTO p FROM notify.plantillas_recordatorio WHERE id = NEW.plantilla_id;
                IF p.empresa_id <> NEW.empresa_id THEN
                    RAISE EXCEPTION 'La plantilla de recordatorio % es de otra empresa', NEW.plantilla_id
                        USING ERRCODE = 'check_violation';
                END IF;
                IF p.servicio_id IS NOT NULL THEN
                    RAISE EXCEPTION 'La plantilla de recordatorio % es personalizada de un servicio: no se asigna', NEW.plantilla_id
                        USING ERRCODE = 'check_violation';
                END IF;
                IF p.retirada_en IS NOT NULL
                    AND (TG_OP = 'INSERT' OR NEW.plantilla_id IS DISTINCT FROM OLD.plantilla_id) THEN
                    RAISE EXCEPTION 'La plantilla de recordatorio % está retirada: no se asigna', NEW.plantilla_id
                        USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.servicio_id IS NOT NULL THEN
                    SELECT empresa_id INTO v_empresa FROM core.servicios WHERE id = NEW.servicio_id;
                    IF v_empresa IS DISTINCT FROM NEW.empresa_id THEN
                        RAISE EXCEPTION 'El servicio % no es de la empresa %', NEW.servicio_id, NEW.empresa_id
                            USING ERRCODE = 'check_violation';
                    END IF;
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER recordatorios_asignaciones_validar
                BEFORE INSERT OR UPDATE ON notify.recordatorios_asignaciones
                FOR EACH ROW EXECUTE FUNCTION notify.validar_asignacion_recordatorio();

            -- La personalizada es de la empresa de su servicio.
            CREATE FUNCTION notify.validar_plantilla_recordatorio() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_empresa bigint;
            BEGIN
                IF NEW.servicio_id IS NOT NULL THEN
                    SELECT empresa_id INTO v_empresa FROM core.servicios WHERE id = NEW.servicio_id;
                    IF v_empresa IS DISTINCT FROM NEW.empresa_id THEN
                        RAISE EXCEPTION 'El servicio % no es de la empresa %', NEW.servicio_id, NEW.empresa_id
                            USING ERRCODE = 'check_violation';
                    END IF;
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER plantillas_recordatorio_validar
                BEFORE INSERT OR UPDATE OF servicio_id, empresa_id ON notify.plantillas_recordatorio
                FOR EACH ROW EXECUTE FUNCTION notify.validar_plantilla_recordatorio();

            -- «Estándar» de una empresa: los tres recordatorios de hoy como pasos de vencimiento.
            CREATE FUNCTION notify.sembrar_recordatorios_estandar(p_empresa bigint) RETURNS bigint
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_id bigint;
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM notify.plantillas_recordatorio WHERE empresa_id = p_empresa AND por_defecto
                ) THEN
                    RETURN NULL;
                END IF;
                INSERT INTO notify.plantillas_recordatorio (empresa_id, nombre, descripcion, por_defecto)
                VALUES (
                    p_empresa,
                    'Estándar',
                    'Recordatorios de pago antes, el día y después del vencimiento',
                    true
                )
                RETURNING id INTO v_id;
                INSERT INTO notify.plantillas_recordatorio_pasos
                    (plantilla_id, orden, disparador, dias, hora, aviso, evento_plantilla, canales, activo)
                SELECT v_id,
                       b.orden,
                       'vencimiento',
                       coalesce(r.dias, b.dias),
                       coalesce(r.hora, b.hora),
                       CASE WHEN coalesce(r.dias, b.dias) <= 0 THEN 'factura_por_vencer' ELSE 'factura_vencida' END,
                       'recordatorio.' || b.orden,
                       '{}',
                       coalesce(r.activo, true)
                  FROM (VALUES (1, -3, time '09:00'), (2, 0, time '09:00'), (3, 3, time '09:00'))
                       AS b (orden, dias, hora)
                  LEFT JOIN notify.recordatorios r ON r.orden = b.orden
                 ORDER BY b.orden;
                RETURN v_id;
            END
            $fn$;

            CREATE FUNCTION notify.sembrar_recordatorios_empresa_nueva() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                PERFORM notify.sembrar_recordatorios_estandar(NEW.id);
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER empresas_recordatorios_estandar
                AFTER INSERT ON core.empresas
                FOR EACH ROW EXECUTE FUNCTION notify.sembrar_recordatorios_empresa_nueva();

            SELECT notify.sembrar_recordatorios_estandar(id) FROM core.empresas ORDER BY id;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS empresas_recordatorios_estandar ON core.empresas;
            DROP FUNCTION IF EXISTS notify.sembrar_recordatorios_empresa_nueva();
            DROP FUNCTION IF EXISTS notify.sembrar_recordatorios_estandar(bigint);
            DROP TABLE IF EXISTS notify.recordatorios_asignaciones;
            DROP FUNCTION IF EXISTS notify.validar_asignacion_recordatorio();
            DROP TABLE IF EXISTS notify.plantillas_recordatorio_pasos;
            DROP TABLE IF EXISTS notify.plantillas_recordatorio;
            DROP FUNCTION IF EXISTS notify.validar_plantilla_recordatorio();
        `)
    }
}
