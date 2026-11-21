import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Varias plantillas por tipo de documento (pedido del PM: «poder tener también para impresoras POS»).
 *
 *  - Se quita la unicidad por `tipo`: cada plantilla tiene `nombre` (único por tipo, sin mayúsculas),
 *    `formato` (`carta` | `pos_80`: rollo térmico de 80 mm, alto según el contenido), `activa` y
 *    `predeterminada` (una por tipo, índice único parcial; nunca inactiva). La predeterminada es la
 *    que usan el portal, el correo y los procesos automáticos; el panel puede imprimir con otra.
 *  - `html` NULL = la plantilla de fábrica de su tipo y formato (`app/portal/documentos/plantilla_base.ts`),
 *    que sigue a la versión instalada hasta que alguien la edite.
 *  - Tipo nuevo `recibo_cobro` (recibo de un cobro de caja, con una sección por empresa).
 *  - La fila que ya existía de cada tipo queda como predeterminada con el nombre «Carta». Los tipos
 *    sin fila reciben su «Carta» de fábrica como predeterminada, y el aviso de cobro y el recibo de
 *    cobro su «POS 80 mm» de fábrica (activa, no predeterminada), para elegirla al imprimir.
 *  - `argosisp_app` ya lee y escribe la tabla (privilegios por defecto de `core`); se repite el
 *    `GRANT` por si la instalación los cambió (sin DELETE: las plantillas se desactivan).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.plantillas_documentos DROP CONSTRAINT plantillas_documentos_tipo_key;
            ALTER TABLE core.plantillas_documentos DROP CONSTRAINT plantillas_documentos_tipo_check;
            ALTER TABLE core.plantillas_documentos
                ADD CONSTRAINT plantillas_documentos_tipo_check
                    CHECK (tipo IN ('aviso_cobro', 'nota_credito', 'recibo_cobro')),
                ADD COLUMN nombre text,
                ADD COLUMN formato text NOT NULL DEFAULT 'carta'
                    CONSTRAINT plantillas_documentos_formato_check CHECK (formato IN ('carta', 'pos_80')),
                ADD COLUMN predeterminada boolean NOT NULL DEFAULT false,
                ADD COLUMN activa boolean NOT NULL DEFAULT true,
                ALTER COLUMN html DROP NOT NULL;

            -- la plantilla que ya tenía cada tipo sigue siendo la que se usa
            UPDATE core.plantillas_documentos SET nombre = 'Carta', predeterminada = true;

            ALTER TABLE core.plantillas_documentos
                ALTER COLUMN nombre SET NOT NULL,
                ADD CONSTRAINT plantillas_documentos_nombre_check
                    CHECK (nombre = btrim(nombre) AND length(nombre) BETWEEN 1 AND 80),
                ADD CONSTRAINT plantillas_documentos_predeterminada_activa
                    CHECK (activa OR NOT predeterminada);
            CREATE UNIQUE INDEX plantillas_documentos_predeterminada
                ON core.plantillas_documentos (tipo) WHERE predeterminada;
            CREATE UNIQUE INDEX plantillas_documentos_nombre
                ON core.plantillas_documentos (tipo, lower(nombre));

            INSERT INTO core.plantillas_documentos (tipo, nombre, formato, predeterminada, html)
            SELECT t.tipo, 'Carta', 'carta', true, NULL
              FROM (VALUES ('aviso_cobro'), ('nota_credito'), ('recibo_cobro')) AS t (tipo)
             WHERE NOT EXISTS (SELECT 1 FROM core.plantillas_documentos p WHERE p.tipo = t.tipo);

            INSERT INTO core.plantillas_documentos (tipo, nombre, formato, predeterminada, html)
            SELECT t.tipo, 'POS 80 mm', 'pos_80', false, NULL
              FROM (VALUES ('aviso_cobro'), ('recibo_cobro')) AS t (tipo)
             WHERE NOT EXISTS (
                    SELECT 1 FROM core.plantillas_documentos p
                     WHERE p.tipo = t.tipo AND (p.formato = 'pos_80' OR lower(p.nombre) = 'pos 80 mm'));

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON core.plantillas_documentos TO argosisp_app;
                END IF;
            END $$;
        `)
    }

    async down() {
        this.schema.raw(`
            -- vuelve a una fila por tipo: la predeterminada editada (la de fábrica es «sin fila»)
            DELETE FROM core.plantillas_documentos
             WHERE NOT predeterminada OR html IS NULL OR tipo = 'recibo_cobro';
            DROP INDEX core.plantillas_documentos_nombre;
            DROP INDEX core.plantillas_documentos_predeterminada;
            ALTER TABLE core.plantillas_documentos
                DROP CONSTRAINT plantillas_documentos_predeterminada_activa,
                DROP CONSTRAINT plantillas_documentos_nombre_check,
                DROP CONSTRAINT plantillas_documentos_tipo_check,
                DROP COLUMN nombre,
                DROP COLUMN formato,
                DROP COLUMN predeterminada,
                DROP COLUMN activa,
                ALTER COLUMN html SET NOT NULL,
                ADD CONSTRAINT plantillas_documentos_tipo_key UNIQUE (tipo),
                ADD CONSTRAINT plantillas_documentos_tipo_check CHECK (tipo IN ('aviso_cobro', 'nota_credito'));
        `)
    }
}
