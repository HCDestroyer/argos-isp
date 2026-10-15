import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Rol `argosisp_app` (NOLOGIN). En producción la API conecta con un usuario miembro de este rol
 * (`GRANT argosisp_app TO argosisp_api`), distinto del dueño de las tablas que corre las migraciones.
 *
 *  - DML completo en core, network, billing, ledger y notify.
 *  - Sin UPDATE/DELETE/TRUNCATE en ledger.asientos, ledger.movimientos ni audit.*.
 *  - En audit.outbox solo UPDATE de (publicado_en, intentos).
 *
 * Si el usuario de migraciones no puede crear roles, se omite con un NOTICE (los triggers de
 * inmutabilidad siguen protegiendo las tablas). El rol es de todo el clúster: el down no lo borra.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            DO $do$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    BEGIN
                        CREATE ROLE argosisp_app NOLOGIN;
                    EXCEPTION WHEN insufficient_privilege THEN
                        RAISE NOTICE 'Sin privilegio para crear el rol argosisp_app; se omiten los GRANT';
                    END;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    RETURN;
                END IF;

                GRANT USAGE ON SCHEMA core, network, billing, ledger, notify, audit TO argosisp_app;

                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, network, billing, ledger, notify
                    TO argosisp_app;
                GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO argosisp_app;
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core, network, billing, ledger, notify, audit
                    TO argosisp_app;

                REVOKE UPDATE, DELETE, TRUNCATE ON ledger.asientos, ledger.movimientos FROM argosisp_app;
                REVOKE UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA audit FROM argosisp_app;
                GRANT UPDATE (publicado_en, intentos) ON audit.outbox TO argosisp_app;

                GRANT EXECUTE ON FUNCTION audit.crear_particiones(date, integer) TO argosisp_app;

                -- Tablas que agreguen los módulos después heredan los mismos permisos.
                ALTER DEFAULT PRIVILEGES IN SCHEMA core, network, billing, ledger, notify
                    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO argosisp_app;
                ALTER DEFAULT PRIVILEGES IN SCHEMA core, network, billing, ledger, notify, audit
                    GRANT USAGE, SELECT ON SEQUENCES TO argosisp_app;
                ALTER DEFAULT PRIVILEGES IN SCHEMA audit
                    GRANT SELECT, INSERT ON TABLES TO argosisp_app;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DO $do$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    RETURN;
                END IF;

                ALTER DEFAULT PRIVILEGES IN SCHEMA core, network, billing, ledger, notify
                    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM argosisp_app;
                ALTER DEFAULT PRIVILEGES IN SCHEMA core, network, billing, ledger, notify, audit
                    REVOKE USAGE, SELECT ON SEQUENCES FROM argosisp_app;
                ALTER DEFAULT PRIVILEGES IN SCHEMA audit
                    REVOKE SELECT, INSERT ON TABLES FROM argosisp_app;

                REVOKE ALL ON ALL TABLES IN SCHEMA core, network, billing, ledger, notify, audit FROM argosisp_app;
                REVOKE ALL ON ALL SEQUENCES IN SCHEMA core, network, billing, ledger, notify, audit FROM argosisp_app;
                REVOKE EXECUTE ON FUNCTION audit.crear_particiones(date, integer) FROM argosisp_app;
                REVOKE USAGE ON SCHEMA core, network, billing, ledger, notify, audit FROM argosisp_app;
            END
            $do$;
        `)
    }
}
