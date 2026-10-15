import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `audit.crear_particiones` corre con los permisos de su dueño (SECURITY DEFINER).
 *
 * El cron mensual que la llama (A6, `notify:worker`) conecta con el usuario de la aplicación,
 * miembro de `argosisp_app`, que no puede crear tablas en `audit` ni es dueño de las tablas
 * particionadas. Como SECURITY DEFINER la función crea las particiones con el usuario de
 * migraciones, sin dar a la aplicación permisos de DDL. `search_path` fijo (los nombres ya van
 * calificados con `audit.`) y EXECUTE solo para `argosisp_app`, no para PUBLIC.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER FUNCTION audit.crear_particiones(date, integer)
                SECURITY DEFINER
                SET search_path = pg_catalog, pg_temp;
            REVOKE EXECUTE ON FUNCTION audit.crear_particiones(date, integer) FROM PUBLIC;
            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT EXECUTE ON FUNCTION audit.crear_particiones(date, integer) TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER FUNCTION audit.crear_particiones(date, integer) SECURITY INVOKER RESET search_path;
            GRANT EXECUTE ON FUNCTION audit.crear_particiones(date, integer) TO PUBLIC;
        `)
    }
}
