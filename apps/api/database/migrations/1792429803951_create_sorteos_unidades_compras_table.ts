import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · observaciones del auditor a `a3/sorteos` (premio en bienes ligado a su compra):
 *
 *  - `ledger.compras_lineas.cantidad` (unidades de la línea, 1 por defecto): una línea con varias
 *    unidades se reparte entre varios premios.
 *  - `lealtad.sorteos_ganadores`: `compra_linea_id` deja de ser único; cada entrega guarda
 *    `compra_unidades` (las que consume) y `compra_base` (la parte de la base que le toca,
 *    prorrateada por unidad: la última entrega lleva el resto para que la suma sea la base).
 *    Con `compra_linea_id` son obligatorias (CHECK). Que no se entreguen más unidades que las de la
 *    línea lo verifica la acción con un lock por línea.
 *  - H26: `lealtad.congelar_ganador` congela también `sustituye_a` y `premio_sustitucion` en cuanto
 *    dejan de ser null.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE ledger.compras_lineas
                ADD COLUMN cantidad integer NOT NULL DEFAULT 1 CHECK (cantidad >= 1);

            ALTER TABLE lealtad.sorteos_ganadores
                DROP CONSTRAINT IF EXISTS sorteos_ganadores_compra_linea_id_key,
                ADD COLUMN compra_unidades integer,
                ADD COLUMN compra_base numeric(14, 2);

            -- entregas ya ligadas a una compra: una unidad, toda la base (antes no había cantidad)
            ALTER TABLE lealtad.sorteos_ganadores DISABLE TRIGGER sorteos_ganadores_congelar;
            UPDATE lealtad.sorteos_ganadores g
               SET compra_unidades = 1, compra_base = l.base
              FROM ledger.compras_lineas l
             WHERE l.id = g.compra_linea_id;
            ALTER TABLE lealtad.sorteos_ganadores ENABLE TRIGGER sorteos_ganadores_congelar;

            ALTER TABLE lealtad.sorteos_ganadores
                ADD CONSTRAINT sorteos_ganadores_compra_unidades CHECK (
                    compra_linea_id IS NULL OR (compra_unidades >= 1 AND compra_base >= 0)
                );
            CREATE INDEX sorteos_ganadores_compra_linea_idx ON lealtad.sorteos_ganadores (compra_linea_id)
                WHERE compra_linea_id IS NOT NULL;

            CREATE OR REPLACE FUNCTION lealtad.congelar_ganador() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'Los ganadores del sorteo % no se borran', OLD.sorteo_id USING ERRCODE = '23514';
                END IF;
                IF NEW.sorteo_id IS DISTINCT FROM OLD.sorteo_id OR NEW.posicion IS DISTINCT FROM OLD.posicion
                   OR NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.participante_id IS DISTINCT FROM OLD.participante_id
                   OR NEW.premio_posicion IS DISTINCT FROM OLD.premio_posicion THEN
                    RAISE EXCEPTION 'El resultado del sorteo % no cambia (ganador %)', OLD.sorteo_id, OLD.id
                        USING ERRCODE = '23514';
                END IF;
                -- H26: la sustitución de un premio no reclamado, una vez asignada, tampoco cambia
                IF (OLD.sustituye_a IS NOT NULL AND NEW.sustituye_a IS DISTINCT FROM OLD.sustituye_a)
                   OR (OLD.premio_sustitucion IS NOT NULL AND NEW.premio_sustitucion IS DISTINCT FROM OLD.premio_sustitucion) THEN
                    RAISE EXCEPTION 'La sustitución del ganador % del sorteo % no cambia', OLD.id, OLD.sorteo_id
                        USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
        `)
    }

    async down() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION lealtad.congelar_ganador() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'Los ganadores del sorteo % no se borran', OLD.sorteo_id USING ERRCODE = '23514';
                END IF;
                IF NEW.sorteo_id IS DISTINCT FROM OLD.sorteo_id OR NEW.posicion IS DISTINCT FROM OLD.posicion
                   OR NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.participante_id IS DISTINCT FROM OLD.participante_id
                   OR NEW.premio_posicion IS DISTINCT FROM OLD.premio_posicion THEN
                    RAISE EXCEPTION 'El resultado del sorteo % no cambia (ganador %)', OLD.sorteo_id, OLD.id
                        USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
            DROP INDEX IF EXISTS lealtad.sorteos_ganadores_compra_linea_idx;
            ALTER TABLE lealtad.sorteos_ganadores
                DROP CONSTRAINT IF EXISTS sorteos_ganadores_compra_unidades,
                DROP COLUMN IF EXISTS compra_base,
                DROP COLUMN IF EXISTS compra_unidades;
            ALTER TABLE ledger.compras_lineas DROP COLUMN IF EXISTS cantidad;
            DO $$
            BEGIN
                ALTER TABLE lealtad.sorteos_ganadores
                    ADD CONSTRAINT sorteos_ganadores_compra_linea_id_key UNIQUE (compra_linea_id);
            EXCEPTION WHEN unique_violation THEN NULL; -- ya hay líneas repartidas: queda sin el único
            END
            $$;
        `)
    }
}
