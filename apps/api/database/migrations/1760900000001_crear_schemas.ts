import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Schemas por módulo y funciones compartidas por las demás migraciones.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE SCHEMA IF NOT EXISTS core;
            CREATE SCHEMA IF NOT EXISTS network;
            CREATE SCHEMA IF NOT EXISTS billing;
            CREATE SCHEMA IF NOT EXISTS ledger;
            CREATE SCHEMA IF NOT EXISTS notify;
            CREATE SCHEMA IF NOT EXISTS audit;

            -- Rechaza UPDATE, DELETE y TRUNCATE en tablas inmutables (ledger y audit).
            CREATE OR REPLACE FUNCTION audit.rechazar_modificacion() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'La tabla %.% es inmutable: % no permitido', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
                    USING ERRCODE = 'insufficient_privilege',
                          HINT = 'Corrige con un asiento de reverso o un nuevo registro, nunca editando.';
            END
            $fn$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP SCHEMA IF EXISTS audit CASCADE;
            DROP SCHEMA IF EXISTS notify CASCADE;
            DROP SCHEMA IF EXISTS ledger CASCADE;
            DROP SCHEMA IF EXISTS billing CASCADE;
            DROP SCHEMA IF EXISTS network CASCADE;
            DROP SCHEMA IF EXISTS core CASCADE;
        `)
    }
}
