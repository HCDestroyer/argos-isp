import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · correcciones del auditor a los sorteos (H22–H25 y observaciones, rama `a3/sorteos`):
 *
 * - H24: `lealtad.sorteos_ganadores` congela quién ganó (`sorteo_id`, `posicion`, `tipo`,
 *   `participante_id`, `premio_posicion`) y no se borra; solo cambia su entrega (estado, asiento…).
 * - El estado del sorteo nunca retrocede (trigger). Única excepción: anular una entrega
 *   (`sorteos.anular_entrega`) reabre `premios_entregados → ejecutado` con `SET LOCAL
 *   lealtad.reabrir_entrega = 'on'` en su transacción.
 * - Riesgo de manipulación: `valor_publico_evidencia` (cómo se obtuvo el valor público en el acto); la
 *   fuente del valor queda en las bases (`bases.fuente_valor_publico`, congelada con `bases_hash`).
 *   El valor y su evidencia no cambian después de ejecutar.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE lealtad.sorteos ADD COLUMN valor_publico_evidencia text;

            CREATE FUNCTION lealtad.sorteo_estado_avanza() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                orden CONSTANT text[] := ARRAY['borrador', 'bases_publicadas', 'participacion_abierta',
                    'corte_cerrado', 'ejecutado', 'premios_entregados'];
                de integer;
                a integer;
            BEGIN
                IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
                    IF OLD.resultado IS NOT NULL
                       AND NEW.valor_publico_evidencia IS DISTINCT FROM OLD.valor_publico_evidencia THEN
                        RAISE EXCEPTION 'El sorteo % ya se ejecutó', OLD.id USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END IF;
                IF OLD.estado = 'cancelado' THEN
                    RAISE EXCEPTION 'El sorteo % está cancelado', OLD.id USING ERRCODE = '23514';
                END IF;
                IF NEW.estado = 'cancelado' THEN
                    IF OLD.estado IN ('ejecutado', 'premios_entregados') THEN
                        RAISE EXCEPTION 'El sorteo % ya se ejecutó: no se cancela', OLD.id USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END IF;
                de := array_position(orden, OLD.estado);
                a := array_position(orden, NEW.estado);
                IF OLD.estado = 'premios_entregados' AND NEW.estado = 'ejecutado'
                   AND coalesce(current_setting('lealtad.reabrir_entrega', true), '') = 'on' THEN
                    RETURN NEW;
                END IF;
                IF a IS NULL OR de IS NULL OR a <= de THEN
                    RAISE EXCEPTION 'El sorteo % no vuelve de % a %', OLD.id, OLD.estado, NEW.estado
                        USING ERRCODE = '23514';
                END IF;
                IF OLD.valor_publico_evidencia IS NOT NULL
                   AND NEW.valor_publico_evidencia IS DISTINCT FROM OLD.valor_publico_evidencia THEN
                    RAISE EXCEPTION 'El sorteo % ya se ejecutó', OLD.id USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER sorteos_estado_avanza BEFORE UPDATE ON lealtad.sorteos
                FOR EACH ROW EXECUTE FUNCTION lealtad.sorteo_estado_avanza();

            CREATE FUNCTION lealtad.congelar_ganador() RETURNS trigger LANGUAGE plpgsql AS $$
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
            CREATE TRIGGER sorteos_ganadores_congelar BEFORE UPDATE OR DELETE ON lealtad.sorteos_ganadores
                FOR EACH ROW EXECUTE FUNCTION lealtad.congelar_ganador();
            CREATE TRIGGER sorteos_ganadores_sin_truncate BEFORE TRUNCATE ON lealtad.sorteos_ganadores
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS sorteos_ganadores_sin_truncate ON lealtad.sorteos_ganadores;
            DROP TRIGGER IF EXISTS sorteos_ganadores_congelar ON lealtad.sorteos_ganadores;
            DROP FUNCTION IF EXISTS lealtad.congelar_ganador();
            DROP TRIGGER IF EXISTS sorteos_estado_avanza ON lealtad.sorteos;
            DROP FUNCTION IF EXISTS lealtad.sorteo_estado_avanza();
            ALTER TABLE lealtad.sorteos DROP COLUMN IF EXISTS valor_publico_evidencia;
        `)
    }
}
