import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Apariencia de la instalación (pedido del PM: tema de la interfaz y logos del inicio de sesión;
 * contrato `.claude/integration/contratos/apariencia.md`). Una sola fila global (`id = 1`): el logo
 * de cada empresa sigue en `core.empresas`.
 *
 * Los archivos (logo y fondo del inicio de sesión) van al mismo volumen que los logos de empresa
 * (`COMPROBANTES_DIR/logos/apariencia/`); la fila guarda la ruta relativa, el tipo, el tamaño y el
 * ETag (sha256). `argosisp_app`: SELECT y UPDATE (la fila nace aquí; nunca se borra).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.apariencia (
                id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                tema text NOT NULL DEFAULT 'indigo'
                    CHECK (tema IN ('indigo', 'azul', 'violeta', 'esmeralda', 'naranja', 'rosa', 'pizarra')),
                modo_predeterminado text NOT NULL DEFAULT 'sistema'
                    CHECK (modo_predeterminado IN ('sistema', 'claro', 'oscuro')),
                nombre_marca text NOT NULL DEFAULT 'ArgosIsp' CHECK (length(nombre_marca) BETWEEN 1 AND 60),
                eslogan text CHECK (eslogan IS NULL OR length(eslogan) <= 120),
                logo_login text,
                logo_login_tipo text,
                logo_login_tamano integer,
                logo_login_etag text,
                fondo_login text,
                fondo_login_tipo text,
                fondo_login_tamano integer,
                fondo_login_etag text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((logo_login IS NULL) = (logo_login_etag IS NULL)),
                CHECK ((fondo_login IS NULL) = (fondo_login_etag IS NULL))
            );
            INSERT INTO core.apariencia (id) VALUES (1);

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, UPDATE ON core.apariencia TO argosisp_app;
                    REVOKE INSERT, DELETE, TRUNCATE ON core.apariencia FROM argosisp_app;
                END IF;
            END
            $$;
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.apariencia')
    }
}
