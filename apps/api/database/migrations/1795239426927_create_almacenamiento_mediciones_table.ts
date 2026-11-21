import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Mediciones de almacenamiento (pedido del PM; contrato `salud.md` §6). Una fila por cálculo de
 * `sistema.recalcular_almacenamiento` (botón o cron diario): desglose de carpetas, base de datos y
 * Redis en `resultado`. Solo se agregan filas (historial para ver crecimiento); `argosisp_app` tiene
 * SELECT e INSERT, sin UPDATE ni DELETE.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.almacenamiento_mediciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                calculado_en timestamptz NOT NULL DEFAULT now(),
                duracion_ms integer NOT NULL CHECK (duracion_ms >= 0),
                origen text NOT NULL CHECK (origen IN ('manual', 'cron')),
                parcial boolean NOT NULL DEFAULT false,
                estado_disco text NOT NULL CHECK (estado_disco IN ('ok', 'degradado', 'caido', 'desconocido')),
                porcentaje_disco numeric(5, 1),
                resultado jsonb NOT NULL
            );
            CREATE INDEX almacenamiento_mediciones_disco
                ON core.almacenamiento_mediciones (calculado_en DESC)
                WHERE estado_disco IN ('degradado', 'caido');

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON core.almacenamiento_mediciones TO argosisp_app;
                    GRANT USAGE, SELECT ON SEQUENCE core.almacenamiento_mediciones_id_seq TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON core.almacenamiento_mediciones FROM argosisp_app;
                END IF;
            END
            $$;
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.almacenamiento_mediciones')
    }
}
