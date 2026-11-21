import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Accesos rápidos del panel por usuario (pedido del PM; contrato
 * `.claude/integration/contratos/accesos-rapidos.md`). Una fila por usuario que guardó su lista;
 * `secciones` null = volvió a los predeterminados por rol (la fila no se borra, así
 * `argosisp_app` no necesita DELETE y la `version` sigue creciendo).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.accesos_rapidos (
                usuario_id bigint PRIMARY KEY REFERENCES core.usuarios (id),
                secciones text[] CHECK (secciones IS NULL OR cardinality(secciones) <= 12),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON core.accesos_rapidos TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON core.accesos_rapidos FROM argosisp_app;
                END IF;
            END
            $$;
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.accesos_rapidos')
    }
}
