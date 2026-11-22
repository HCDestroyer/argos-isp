import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Panel financiero y reportes (decisiones del PM 2, 4, 6 y 7 del 21 nov; `contratos/reportes.md`).
 *
 * - `billing.panel_ajustes`: ajustes del panel por empresa. Hoy solo `dias_baja` (decisión 4: un
 *   servicio suspendido por más de estos días cuenta como baja; 60 de fábrica). Sin fila = fábrica.
 * - `billing.inicio_roles` / `billing.inicio_usuarios`: pantalla de inicio por rol y por usuario
 *   (decisión 2). Sin fila = fábrica (admin y dueño: panel financiero; los demás: día a día).
 * - `billing.reportes_favoritos` / `billing.reportes_vistas`: favoritos y vistas guardadas del
 *   catálogo de reportes, por usuario (preferencias propias: se pueden borrar).
 * - `billing.reportes_correos_externos`: lista de correos externos que aprobó el admin (decisión 6).
 *   Retirar = `activo = false`; la fila se conserva (los envíos pasados la nombran).
 * - `billing.reportes_envios` + `billing.reportes_envios_destinatarios`: envíos programados. Cada
 *   destinatario es un usuario o un correo de la lista aprobada.
 * - `billing.reportes_envios_corridas`: una fila por envío y hora programada (`programado_para`
 *   único): repetir el cron no repite el correo. `resultados` dice qué recibió cada destinatario y
 *   por qué se omitió a los demás (sin datos del reporte).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.panel_ajustes (
                empresa_id bigint PRIMARY KEY REFERENCES core.empresas (id),
                dias_baja integer NOT NULL DEFAULT 60 CHECK (dias_baja BETWEEN 1 AND 365),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE billing.inicio_roles (
                role_id bigint PRIMARY KEY REFERENCES core.roles (id) ON DELETE CASCADE,
                inicio text NOT NULL CHECK (inicio IN ('panel_financiero', 'dia_a_dia')),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE billing.inicio_usuarios (
                usuario_id bigint PRIMARY KEY REFERENCES core.usuarios (id) ON DELETE CASCADE,
                inicio text NOT NULL CHECK (inicio IN ('panel_financiero', 'dia_a_dia')),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE billing.reportes_favoritos (
                usuario_id bigint NOT NULL REFERENCES core.usuarios (id) ON DELETE CASCADE,
                reporte text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (usuario_id, reporte)
            );

            CREATE TABLE billing.reportes_vistas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                usuario_id bigint NOT NULL REFERENCES core.usuarios (id) ON DELETE CASCADE,
                reporte text NOT NULL,
                nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
                filtros jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filtros) = 'object'),
                columnas text[],
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX reportes_vistas_nombre
                ON billing.reportes_vistas (usuario_id, reporte, lower(btrim(nombre)));

            CREATE TABLE billing.reportes_correos_externos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                correo text NOT NULL CHECK (correo = lower(btrim(correo)) AND length(correo) BETWEEN 3 AND 254),
                nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 120),
                activo boolean NOT NULL DEFAULT true,
                aprobado_por bigint REFERENCES core.usuarios (id),
                aprobado_en timestamptz NOT NULL DEFAULT now(),
                retirado_por bigint REFERENCES core.usuarios (id),
                retirado_en timestamptz,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT reportes_correos_externos_correo UNIQUE (correo),
                CHECK (activo = (retirado_en IS NULL))
            );

            CREATE TABLE billing.reportes_envios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                -- null = consolidado de todas las empresas (solo con alcance global)
                empresa_id bigint REFERENCES core.empresas (id),
                nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 120),
                reporte text NOT NULL,
                filtros jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filtros) = 'object'),
                formato text NOT NULL CHECK (formato IN ('pdf', 'xlsx', 'csv')),
                frecuencia text NOT NULL CHECK (frecuencia IN ('diaria', 'semanal', 'mensual')),
                -- semanal: 1 (lunes) a 7 (domingo); mensual: 1 a 28; diaria: null
                dia integer CHECK (dia BETWEEN 1 AND 28),
                hora integer NOT NULL CHECK (hora BETWEEN 0 AND 23),
                activo boolean NOT NULL DEFAULT true,
                proximo_en timestamptz NOT NULL,
                ultimo_envio_en timestamptz,
                creado_por bigint REFERENCES core.usuarios (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((frecuencia = 'diaria') = (dia IS NULL)),
                CHECK (frecuencia <> 'semanal' OR dia BETWEEN 1 AND 7)
            );
            CREATE INDEX reportes_envios_pendientes ON billing.reportes_envios (proximo_en) WHERE activo;

            CREATE TABLE billing.reportes_envios_destinatarios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                envio_id bigint NOT NULL REFERENCES billing.reportes_envios (id) ON DELETE CASCADE,
                usuario_id bigint REFERENCES core.usuarios (id),
                correo_externo_id bigint REFERENCES billing.reportes_correos_externos (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((usuario_id IS NULL) <> (correo_externo_id IS NULL))
            );
            CREATE UNIQUE INDEX reportes_envios_dest_usuario
                ON billing.reportes_envios_destinatarios (envio_id, usuario_id) WHERE usuario_id IS NOT NULL;
            CREATE UNIQUE INDEX reportes_envios_dest_correo
                ON billing.reportes_envios_destinatarios (envio_id, correo_externo_id)
                WHERE correo_externo_id IS NOT NULL;

            CREATE TABLE billing.reportes_envios_corridas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                envio_id bigint NOT NULL REFERENCES billing.reportes_envios (id) ON DELETE CASCADE,
                programado_para timestamptz NOT NULL,
                enviados integer NOT NULL DEFAULT 0,
                omitidos integer NOT NULL DEFAULT 0,
                fallidos integer NOT NULL DEFAULT 0,
                resultados jsonb NOT NULL DEFAULT '[]'::jsonb,
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT reportes_envios_corridas_unica UNIQUE (envio_id, programado_para)
            );
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.reportes_envios_corridas;
            DROP TABLE IF EXISTS billing.reportes_envios_destinatarios;
            DROP TABLE IF EXISTS billing.reportes_envios;
            DROP TABLE IF EXISTS billing.reportes_correos_externos;
            DROP TABLE IF EXISTS billing.reportes_vistas;
            DROP TABLE IF EXISTS billing.reportes_favoritos;
            DROP TABLE IF EXISTS billing.inicio_usuarios;
            DROP TABLE IF EXISTS billing.inicio_roles;
            DROP TABLE IF EXISTS billing.panel_ajustes;
        `)
    }
}
