import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * notify y multiempresa (`contratos/multiempresa.md`), ahora que existe `core.empresas` (A1):
 *
 *  - **FK** de `notify.configuracion_canales.empresa_id` y `notify.envios.empresa_id` a
 *    `core.empresas`. Una configuración de una empresa que no existe es un error de datos: la
 *    migración falla con el id para que se revise (no se borra nada). En `envios` (bitácora) una
 *    empresa inexistente queda en null con un aviso.
 *  - **Telegram por empresa.** Cada empresa puede tener su propio bot (configuración propia) o
 *    heredar el global. `notify.telegram_vinculos` dice qué bots puede usar cada cliente: uno por
 *    (cliente, bot), con el chat que lo vinculó. Un cliente con servicios en dos empresas con bots
 *    distintos queda vinculado a los dos. `core.clientes.telegram_chat_id` (A1) sigue siendo el
 *    interruptor general: sin él no se envía por ningún bot. Un cliente sin filas aquí y con
 *    `telegram_chat_id` (vinculado antes de este cambio o desde el panel) vale para el bot global.
 *  - `telegram_codigos` guarda el bot (`bot_id`) y la empresa para la que se pidió el código: el
 *    código solo se canjea en ese bot. Un pendiente por cliente **y bot**.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            DO $do$
            DECLARE
                huerfanas text;
            BEGIN
                SELECT string_agg(DISTINCT empresa_id::text, ', ') INTO huerfanas
                  FROM notify.configuracion_canales c
                 WHERE empresa_id IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM core.empresas e WHERE e.id = c.empresa_id);
                IF huerfanas IS NOT NULL THEN
                    RAISE EXCEPTION 'notify.configuracion_canales tiene configuración de empresas que no existen en core.empresas: %', huerfanas;
                END IF;

                SELECT string_agg(DISTINCT empresa_id::text, ', ') INTO huerfanas
                  FROM notify.envios v
                 WHERE empresa_id IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM core.empresas e WHERE e.id = v.empresa_id);
                IF huerfanas IS NOT NULL THEN
                    RAISE NOTICE 'notify.envios: empresa_id % no existe en core.empresas; queda en null', huerfanas;
                    UPDATE notify.envios v SET empresa_id = NULL
                     WHERE empresa_id IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM core.empresas e WHERE e.id = v.empresa_id);
                END IF;
            END
            $do$;

            ALTER TABLE notify.configuracion_canales
                ADD CONSTRAINT configuracion_canales_empresa_fk
                FOREIGN KEY (empresa_id) REFERENCES core.empresas (id);
            ALTER TABLE notify.envios
                ADD CONSTRAINT envios_empresa_fk
                FOREIGN KEY (empresa_id) REFERENCES core.empresas (id);
            CREATE INDEX envios_empresa ON notify.envios (empresa_id) WHERE empresa_id IS NOT NULL;

            CREATE TABLE notify.telegram_vinculos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                bot_id text NOT NULL CHECK (bot_id ~ '^\\d{1,20}$'),
                chat_id text NOT NULL CHECK (chat_id ~ '^-{0,1}\\d{1,20}$'),
                empresa_id bigint REFERENCES core.empresas (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT telegram_vinculos_unico UNIQUE (cliente_id, bot_id)
            );
            CREATE INDEX telegram_vinculos_chat ON notify.telegram_vinculos (bot_id, chat_id);

            ALTER TABLE notify.telegram_codigos ADD COLUMN bot_id text;
            ALTER TABLE notify.telegram_codigos
                ADD COLUMN empresa_id bigint REFERENCES core.empresas (id);
            DROP INDEX notify.telegram_codigos_pendiente_unico;
            CREATE UNIQUE INDEX telegram_codigos_pendiente_unico
                ON notify.telegram_codigos (cliente_id, coalesce(bot_id, ''))
                WHERE estado = 'pendiente';
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX notify.telegram_codigos_pendiente_unico;
            UPDATE notify.telegram_codigos c SET estado = 'reemplazado'
             WHERE estado = 'pendiente'
               AND id <> (SELECT max(id) FROM notify.telegram_codigos x
                           WHERE x.cliente_id = c.cliente_id AND x.estado = 'pendiente');
            CREATE UNIQUE INDEX telegram_codigos_pendiente_unico
                ON notify.telegram_codigos (cliente_id) WHERE estado = 'pendiente';
            ALTER TABLE notify.telegram_codigos DROP COLUMN empresa_id;
            ALTER TABLE notify.telegram_codigos DROP COLUMN bot_id;
            DROP TABLE IF EXISTS notify.telegram_vinculos;
            DROP INDEX IF EXISTS notify.envios_empresa;
            ALTER TABLE notify.envios DROP CONSTRAINT envios_empresa_fk;
            ALTER TABLE notify.configuracion_canales DROP CONSTRAINT configuracion_canales_empresa_fk;
        `)
    }
}
