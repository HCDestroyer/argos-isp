import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Multiempresa, paso 2 (`contratos/multiempresa.md`):
 *
 * - `core.servicios.empresa_id NOT NULL` (FK a `core.empresas`): los servicios existentes quedan en
 *   la empresa 1. Se agrega con DEFAULT (sin reescribir la tabla ni disparar triggers) y luego se
 *   quita el DEFAULT.
 * - Un INSERT sin `empresa_id` (filas de prueba o de herramientas que no pasan por `CrearServicio`)
 *   toma la única empresa activa; con varias, falla con `empresa_requerida`. Así, con una sola
 *   empresa nada cambia.
 * - `empresa_sugerida_id` (nulable) en `core.zonas` y `network.routers`: empresa por defecto de los
 *   servicios nuevos (servicio > zona > router > empresa activa).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.servicios
                ADD COLUMN empresa_id bigint NOT NULL DEFAULT 1 REFERENCES core.empresas (id);
            ALTER TABLE core.servicios ALTER COLUMN empresa_id DROP DEFAULT;
            CREATE INDEX servicios_empresa ON core.servicios (empresa_id);

            CREATE FUNCTION core.servicios_empresa_por_defecto() RETURNS trigger
            LANGUAGE plpgsql AS $$
            DECLARE
                activas bigint[];
            BEGIN
                IF NEW.empresa_id IS NULL THEN
                    SELECT array_agg(id ORDER BY id) INTO activas FROM core.empresas WHERE activa;
                    IF coalesce(array_length(activas, 1), 0) <> 1 THEN
                        RAISE EXCEPTION 'empresa_requerida: el servicio necesita empresa_id (hay % empresas activas)',
                            coalesce(array_length(activas, 1), 0)
                            USING ERRCODE = 'not_null_violation';
                    END IF;
                    NEW.empresa_id := activas[1];
                END IF;
                RETURN NEW;
            END
            $$;
            CREATE TRIGGER servicios_empresa_por_defecto
                BEFORE INSERT ON core.servicios
                FOR EACH ROW EXECUTE FUNCTION core.servicios_empresa_por_defecto();

            ALTER TABLE core.zonas ADD COLUMN empresa_sugerida_id bigint REFERENCES core.empresas (id);
            ALTER TABLE network.routers ADD COLUMN empresa_sugerida_id bigint REFERENCES core.empresas (id);
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE network.routers DROP COLUMN IF EXISTS empresa_sugerida_id;
            ALTER TABLE core.zonas DROP COLUMN IF EXISTS empresa_sugerida_id;
            DROP TRIGGER IF EXISTS servicios_empresa_por_defecto ON core.servicios;
            DROP FUNCTION IF EXISTS core.servicios_empresa_por_defecto();
            DROP INDEX IF EXISTS core.servicios_empresa;
            ALTER TABLE core.servicios DROP COLUMN IF EXISTS empresa_id;
        `)
    }
}
