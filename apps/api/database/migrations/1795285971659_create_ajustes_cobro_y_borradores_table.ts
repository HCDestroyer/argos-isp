import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · decisiones del PM del 21 nov (10 y 16).
 *
 * - `billing.ajustes_cobro`: ajustes por empresa con su valor de fábrica. Sin fila = fábrica.
 *   - `asientos_requieren_aprobacion` (decisión 10, false de fábrica): un asiento manual queda como
 *     borrador hasta que **otro** usuario lo aprueba.
 *   - `pausa_tope_dias` (decisión 16, 90 de fábrica): días máximos de una pausa sin cobro.
 * - `billing.asientos_borradores`: el asiento manual que espera aprobación. No toca el libro (por eso
 *   no vive en `ledger`): el asiento real se registra al aprobarlo. Solo inserción (trigger y REVOKE):
 *   la decisión (aprobado o rechazado) es una fila de `billing.asientos_borradores_decisiones` (una
 *   por borrador).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.ajustes_cobro (
                empresa_id bigint PRIMARY KEY REFERENCES core.empresas (id),
                asientos_requieren_aprobacion boolean NOT NULL DEFAULT false,
                pausa_tope_dias integer NOT NULL DEFAULT 90 CHECK (pausa_tope_dias BETWEEN 1 AND 365),
                version integer NOT NULL DEFAULT 1,
                updated_by bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE billing.asientos_borradores (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                fecha date,
                descripcion text NOT NULL CHECK (length(btrim(descripcion)) BETWEEN 3 AND 500),
                movimientos jsonb NOT NULL CHECK (jsonb_typeof(movimientos) = 'array'),
                total numeric(14, 2) NOT NULL CHECK (total > 0),
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX asientos_borradores_empresa ON billing.asientos_borradores (empresa_id, id DESC);

            CREATE TABLE billing.asientos_borradores_decisiones (
                borrador_id bigint PRIMARY KEY REFERENCES billing.asientos_borradores (id),
                decision text NOT NULL CHECK (decision IN ('aprobado', 'rechazado')),
                asiento_id bigint REFERENCES ledger.asientos (id),
                motivo text,
                decidido_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT borradores_decision CHECK (
                    (decision = 'aprobado' AND asiento_id IS NOT NULL)
                    OR (decision = 'rechazado' AND asiento_id IS NULL AND motivo IS NOT NULL)
                )
            );
            CREATE UNIQUE INDEX asientos_borradores_asiento ON billing.asientos_borradores_decisiones (asiento_id)
                WHERE asiento_id IS NOT NULL;

            -- como el resto del libro: solo inserción (trigger y REVOKE)
            CREATE TRIGGER asientos_borradores_inmutable BEFORE UPDATE OR DELETE ON billing.asientos_borradores
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER asientos_borradores_sin_truncate BEFORE TRUNCATE ON billing.asientos_borradores
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER borradores_decisiones_inmutable
                BEFORE UPDATE OR DELETE ON billing.asientos_borradores_decisiones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER borradores_decisiones_sin_truncate BEFORE TRUNCATE ON billing.asientos_borradores_decisiones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON billing.asientos_borradores, billing.asientos_borradores_decisiones
                        TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON billing.asientos_borradores,
                        billing.asientos_borradores_decisiones FROM argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON billing.ajustes_cobro TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.asientos_borradores_decisiones;
            DROP TABLE IF EXISTS billing.asientos_borradores;
            DROP TABLE IF EXISTS billing.ajustes_cobro;
        `)
    }
}
