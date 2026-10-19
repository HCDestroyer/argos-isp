import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Adicionales de un servicio suspendido y primer periodo de un cobrado (decisión del PM, 19 oct;
 * `contratos/adicionales.md`).
 *
 * - `core.servicios_adicionales.bloqueo` (`vigente` | `bloqueado`) y `bloqueado_en`: un servicio
 *   `suspendido` tiene todos sus adicionales bloqueados; se desbloquean al salir de `suspendido`.
 * - `core.servicios_adicionales_bloqueos`: historial de bloqueos y desbloqueos, **solo inserción**
 *   (trigger y `REVOKE` para `argosisp_app`).
 * - `primer_periodo` (`prorrateado` | `sin_costo`) y `cobrado_desde`: solo con `cobrado`. A3 cobra
 *   el primer periodo desde `cobrado_desde` según `primer_periodo`. Los cobrados que ya existían
 *   quedan `prorrateado` desde su `alta_en`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.servicios_adicionales
                ADD COLUMN bloqueo text NOT NULL DEFAULT 'vigente' CHECK (bloqueo IN ('vigente', 'bloqueado')),
                ADD COLUMN bloqueado_en timestamptz,
                ADD COLUMN primer_periodo text CHECK (primer_periodo IN ('prorrateado', 'sin_costo')),
                ADD COLUMN cobrado_desde timestamptz;
            UPDATE core.servicios_adicionales
               SET primer_periodo = 'prorrateado', cobrado_desde = alta_en
             WHERE modalidad = 'cobrado';
            -- un adicional de un servicio ya suspendido nace bloqueado
            UPDATE core.servicios_adicionales sa
               SET bloqueo = 'bloqueado', bloqueado_en = now()
              FROM core.servicios s
             WHERE s.id = sa.servicio_id AND s.estado = 'suspendido' AND sa.estado = 'activo';
            ALTER TABLE core.servicios_adicionales
                ADD CONSTRAINT servicios_adicionales_bloqueo
                    CHECK ((bloqueo = 'bloqueado') = (bloqueado_en IS NOT NULL)),
                ADD CONSTRAINT servicios_adicionales_primer_periodo
                    CHECK ((modalidad = 'cobrado') = (primer_periodo IS NOT NULL)
                       AND (modalidad = 'cobrado') = (cobrado_desde IS NOT NULL));

            CREATE TABLE core.servicios_adicionales_bloqueos (
                id bigserial PRIMARY KEY,
                asignacion_id bigint NOT NULL REFERENCES core.servicios_adicionales (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                accion text NOT NULL CHECK (accion IN ('bloqueado', 'desbloqueado')),
                estado_servicio text NOT NULL,
                motivo text,
                request_id text,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX servicios_adicionales_bloqueos_asignacion
                ON core.servicios_adicionales_bloqueos (asignacion_id, id DESC);
            CREATE TRIGGER servicios_adicionales_bloqueos_inmutable
                BEFORE UPDATE OR DELETE ON core.servicios_adicionales_bloqueos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER servicios_adicionales_bloqueos_sin_truncate
                BEFORE TRUNCATE ON core.servicios_adicionales_bloqueos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON core.servicios_adicionales_bloqueos TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON core.servicios_adicionales_bloqueos FROM argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS core.servicios_adicionales_bloqueos;
            ALTER TABLE core.servicios_adicionales
                DROP CONSTRAINT IF EXISTS servicios_adicionales_bloqueo,
                DROP CONSTRAINT IF EXISTS servicios_adicionales_primer_periodo,
                DROP COLUMN IF EXISTS bloqueo,
                DROP COLUMN IF EXISTS bloqueado_en,
                DROP COLUMN IF EXISTS primer_periodo,
                DROP COLUMN IF EXISTS cobrado_desde;
        `)
    }
}
