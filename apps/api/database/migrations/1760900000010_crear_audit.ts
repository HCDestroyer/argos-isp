import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Schema `audit`: bitácora de acciones, cambios por campo, comandos de red y outbox.
 *
 *  - `acciones`, `cambios` y `red` están particionadas por mes (RANGE en created_at) con una
 *    partición DEFAULT. `audit.crear_particiones(desde, meses)` crea las mensuales; la migración
 *    crea el mes actual + 12. Un cron mensual debe seguir llamándola (A6).
 *  - Son inmutables: UPDATE, DELETE y TRUNCATE se rechazan por trigger.
 *  - `outbox` admite UPDATE solo de `publicado_en` e `intentos` (relay); nunca DELETE.
 *
 * PostgreSQL 16 no permite IDENTITY en tablas particionadas: se usan secuencias.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE SEQUENCE audit.acciones_id_seq;
            CREATE TABLE audit.acciones (
                id bigint NOT NULL DEFAULT nextval('audit.acciones_id_seq'),
                actor_tipo text NOT NULL CHECK (actor_tipo IN ('usuario', 'token', 'agente', 'sistema')),
                actor_id bigint,
                canal text NOT NULL,
                accion text NOT NULL,
                entidad_tipo text,
                entidad_id bigint,
                entrada jsonb,
                resultado text NOT NULL CHECK (resultado IN ('ok', 'error')),
                error text,
                request_id text,
                created_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (id, created_at)
            ) PARTITION BY RANGE (created_at);
            ALTER SEQUENCE audit.acciones_id_seq OWNED BY audit.acciones.id;
            CREATE TABLE audit.acciones_default PARTITION OF audit.acciones DEFAULT;
            CREATE INDEX acciones_entidad ON audit.acciones (entidad_tipo, entidad_id, created_at);
            CREATE INDEX acciones_actor ON audit.acciones (actor_tipo, actor_id, created_at);
            CREATE INDEX acciones_accion ON audit.acciones (accion, created_at);
            CREATE INDEX acciones_request ON audit.acciones (request_id);

            CREATE SEQUENCE audit.cambios_id_seq;
            CREATE TABLE audit.cambios (
                id bigint NOT NULL DEFAULT nextval('audit.cambios_id_seq'),
                entidad_tipo text NOT NULL,
                entidad_id bigint NOT NULL,
                campo text NOT NULL,
                antes jsonb,
                despues jsonb,
                actor_tipo text CHECK (actor_tipo IN ('usuario', 'token', 'agente', 'sistema')),
                actor_id bigint,
                request_id text,
                created_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (id, created_at)
            ) PARTITION BY RANGE (created_at);
            ALTER SEQUENCE audit.cambios_id_seq OWNED BY audit.cambios.id;
            CREATE TABLE audit.cambios_default PARTITION OF audit.cambios DEFAULT;
            CREATE INDEX cambios_entidad ON audit.cambios (entidad_tipo, entidad_id, created_at);
            CREATE INDEX cambios_request ON audit.cambios (request_id);

            CREATE SEQUENCE audit.red_id_seq;
            CREATE TABLE audit.red (
                id bigint NOT NULL DEFAULT nextval('audit.red_id_seq'),
                tipo text NOT NULL CHECK (tipo IN ('coa', 'disconnect', 'routeros')),
                router_id bigint,
                servicio_id bigint,
                comando jsonb NOT NULL,
                respuesta jsonb,
                ok boolean NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (id, created_at)
            ) PARTITION BY RANGE (created_at);
            ALTER SEQUENCE audit.red_id_seq OWNED BY audit.red.id;
            CREATE TABLE audit.red_default PARTITION OF audit.red DEFAULT;
            CREATE INDEX red_servicio ON audit.red (servicio_id, created_at);
            CREATE INDEX red_router ON audit.red (router_id, created_at);

            -- Crea particiones mensuales (UTC) desde el mes de "desde" y los "meses" siguientes.
            CREATE OR REPLACE FUNCTION audit.crear_particiones(desde date, meses integer) RETURNS void
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_tabla text;
                v_inicio date;
                v_fin date;
                v_nombre text;
                i integer;
            BEGIN
                FOREACH v_tabla IN ARRAY ARRAY['acciones', 'cambios', 'red'] LOOP
                    FOR i IN 0..meses LOOP
                        v_inicio := (date_trunc('month', desde) + make_interval(months => i))::date;
                        v_fin := (v_inicio + interval '1 month')::date;
                        v_nombre := format('%s_%s', v_tabla, to_char(v_inicio, 'YYYY_MM'));
                        IF to_regclass(format('audit.%I', v_nombre)) IS NULL THEN
                            EXECUTE format(
                                'CREATE TABLE audit.%I PARTITION OF audit.%I FOR VALUES FROM (%L) TO (%L)',
                                v_nombre,
                                v_tabla,
                                (v_inicio::timestamp AT TIME ZONE 'UTC'),
                                (v_fin::timestamp AT TIME ZONE 'UTC')
                            );
                        END IF;
                    END LOOP;
                END LOOP;
            END
            $fn$;

            SELECT audit.crear_particiones((now() AT TIME ZONE 'UTC')::date, 12);

            CREATE TRIGGER acciones_inmutable BEFORE UPDATE OR DELETE ON audit.acciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER acciones_sin_truncate BEFORE TRUNCATE ON audit.acciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER cambios_inmutable BEFORE UPDATE OR DELETE ON audit.cambios
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER cambios_sin_truncate BEFORE TRUNCATE ON audit.cambios
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER red_inmutable BEFORE UPDATE OR DELETE ON audit.red
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER red_sin_truncate BEFORE TRUNCATE ON audit.red
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TABLE audit.outbox (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                evento text NOT NULL,
                payload jsonb NOT NULL,
                request_id text,
                created_at timestamptz NOT NULL DEFAULT now(),
                publicado_en timestamptz,
                intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0)
            );
            CREATE INDEX outbox_pendientes ON audit.outbox (id) WHERE publicado_en IS NULL;
            CREATE INDEX outbox_evento ON audit.outbox (evento, created_at);

            -- outbox: solo el relay actualiza publicado_en e intentos; nunca se borra.
            CREATE OR REPLACE FUNCTION audit.proteger_outbox() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF TG_OP <> 'UPDATE' THEN
                    RAISE EXCEPTION 'La tabla audit.outbox es inmutable: % no permitido', TG_OP
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                IF (to_jsonb(NEW) - 'publicado_en' - 'intentos') IS DISTINCT FROM
                   (to_jsonb(OLD) - 'publicado_en' - 'intentos') THEN
                    RAISE EXCEPTION 'En audit.outbox solo se pueden actualizar publicado_en e intentos'
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                RETURN NEW;
            END
            $fn$;

            CREATE TRIGGER outbox_proteger BEFORE UPDATE OR DELETE ON audit.outbox
                FOR EACH ROW EXECUTE FUNCTION audit.proteger_outbox();
            CREATE TRIGGER outbox_sin_truncate BEFORE TRUNCATE ON audit.outbox
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS audit.outbox;
            DROP FUNCTION IF EXISTS audit.proteger_outbox();
            DROP FUNCTION IF EXISTS audit.crear_particiones(date, integer);
            DROP TABLE IF EXISTS audit.red;
            DROP TABLE IF EXISTS audit.cambios;
            DROP TABLE IF EXISTS audit.acciones;
        `)
    }
}
