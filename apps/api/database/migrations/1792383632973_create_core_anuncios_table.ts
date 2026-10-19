import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Anuncios del portal (A5, contrato `anuncios.md`): promociones por empresa que el panel publica en
 * el inicio del portal y en la página de corte.
 *
 * - `core.anuncios`: texto plano (sin HTML), imagen opcional en el almacenamiento de archivos (la
 *   fila guarda ruta, tipo, tamaño y ETag; nunca el archivo), botón opcional, vigencia, audiencia y
 *   lugares. Estado por acción (`borrador` → `publicado` → `archivado`) y `version`.
 * - `core.anuncios_eventos`: vistas y clics. Sin datos personales: `visitante` es un UUID que el
 *   navegador genera por sesión; la clave única lo hace idempotente (una vista y un clic por
 *   visitante y anuncio). Telemetría: solo inserción.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.anuncios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 80),
                texto text NOT NULL DEFAULT '' CHECK (length(texto) <= 500),
                imagen text,
                imagen_tipo text CHECK (imagen_tipo IN ('image/png', 'image/jpeg', 'image/webp')),
                imagen_etag text,
                imagen_ancho integer CHECK (imagen_ancho > 0),
                imagen_alto integer CHECK (imagen_alto > 0),
                imagen_alt text CHECK (length(imagen_alt) <= 200),
                boton_texto text CHECK (length(btrim(boton_texto)) BETWEEN 1 AND 40),
                boton_url text CHECK (length(boton_url) <= 500),
                inicio timestamptz,
                fin timestamptz,
                audiencia text NOT NULL DEFAULT 'todos'
                    CHECK (audiencia IN ('todos', 'suspendidos', 'con_puntos', 'al_dia')),
                lugares text[] NOT NULL DEFAULT ARRAY['portal_inicio']::text[]
                    CHECK (cardinality(lugares) BETWEEN 1 AND 2
                        AND lugares <@ ARRAY['portal_inicio', 'pagina_corte']::text[]),
                orden integer NOT NULL DEFAULT 0,
                estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'publicado', 'archivado')),
                publicado_en timestamptz,
                archivado_en timestamptz,
                creado_por bigint REFERENCES core.usuarios (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (fin IS NULL OR inicio IS NULL OR fin > inicio),
                CHECK ((boton_texto IS NULL) = (boton_url IS NULL)),
                CHECK ((imagen IS NULL) = (imagen_tipo IS NULL)),
                CHECK (imagen IS NULL OR (imagen_etag IS NOT NULL AND imagen_ancho IS NOT NULL AND imagen_alto IS NOT NULL))
            );
            CREATE INDEX anuncios_empresa ON core.anuncios (empresa_id, id DESC);
            CREATE INDEX anuncios_publicados ON core.anuncios (empresa_id, orden DESC, id DESC) WHERE estado = 'publicado';

            CREATE TABLE core.anuncios_eventos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                anuncio_id bigint NOT NULL REFERENCES core.anuncios (id),
                tipo text NOT NULL CHECK (tipo IN ('vista', 'clic')),
                visitante uuid NOT NULL,
                lugar text NOT NULL CHECK (lugar IN ('portal_inicio', 'pagina_corte')),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT anuncios_eventos_unico UNIQUE (anuncio_id, tipo, visitante)
            );
            CREATE INDEX anuncios_eventos_dia ON core.anuncios_eventos (anuncio_id, created_at);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS core.anuncios_eventos;
            DROP TABLE IF EXISTS core.anuncios;
        `)
    }
}
