import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Catálogo de campos personalizados del cliente (pedido de A4, `a4.md`): qué claves de
 * `core.clientes.campos_personalizados` existen, con qué etiqueta y de qué tipo. Global (los
 * clientes no son de una empresa). `clave` y `tipo` no cambian después de crear el campo; un campo
 * no se borra, se desactiva. Las claves fuera del catálogo (las del importador, `mikrowisp_id`)
 * se siguen guardando tal cual.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.campos_personalizados (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                clave text NOT NULL UNIQUE CHECK (clave ~ '^[a-z][a-z0-9_]{0,39}$'),
                etiqueta text NOT NULL CHECK (length(btrim(etiqueta)) BETWEEN 1 AND 80),
                tipo text NOT NULL CHECK (tipo IN ('texto', 'numero', 'fecha', 'booleano', 'opcion')),
                opciones jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(opciones) = 'array'),
                requerido boolean NOT NULL DEFAULT false,
                orden integer NOT NULL DEFAULT 0,
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((tipo = 'opcion') = (jsonb_array_length(opciones) > 0))
            );
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.campos_personalizados')
    }
}
