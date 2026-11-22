import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.14.3: `billing.conceptos_cargo.codigo_sistema` marca los conceptos que el sistema
 * reconoce por código y no por nombre (el nombre lo edita el usuario). Hoy solo `instalacion`: el
 * concepto sembrado de instalación de cada empresa, el que Iris cobra en la línea de instalación de
 * `cargo-unico` (`cobro_equipo`).
 *
 * - Único por empresa (índice parcial) y fijo: un trigger impide cambiarlo, quitarlo o borrar la fila
 *   que lo lleva. Desactivarlo lo impide la acción (`422 concepto_de_sistema`), no el trigger.
 * - Backfill: el concepto de instalación de cada empresa es su primer concepto (el menor `id`). La
 *   siembra (`billing.sembrar_catalogos_cargo`, trigger al crear la empresa y la migración de cargos
 *   únicos) inserta «Instalación» como primera fila de su `VALUES`, antes de que exista cualquier
 *   concepto creado a mano, así que el menor `id` es esa fila aunque después la hayan renombrado.
 * - Una empresa sin conceptos recibe la siembra completa, ahora con el código.
 * - La siembra de empresas nuevas crea «Instalación» con `codigo_sistema = 'instalacion'` y no vuelve
 *   a crearlo si la empresa ya tiene su concepto de sistema (aunque lo hayan renombrado).
 */
/** La siembra por empresa, ahora con el concepto de sistema de instalación. */
export const SQL_SEMBRAR = `
            CREATE OR REPLACE FUNCTION billing.sembrar_catalogos_cargo(empresa bigint) RETURNS void LANGUAGE plpgsql AS $$
            DECLARE
                nombre_instalacion text := 'Instalación';
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM billing.conceptos_cargo
                                WHERE empresa_id = empresa AND codigo_sistema = 'instalacion') THEN
                    IF EXISTS (SELECT 1 FROM billing.conceptos_cargo
                                WHERE empresa_id = empresa AND nombre = nombre_instalacion) THEN
                        nombre_instalacion := 'Instalación (sistema)';
                    END IF;
                    INSERT INTO billing.conceptos_cargo (empresa_id, nombre, tipo, cuenta_codigo, codigo_sistema)
                    VALUES (empresa, nombre_instalacion, 'otro', '4.1.03', 'instalacion');
                END IF;
                INSERT INTO billing.conceptos_cargo (empresa_id, nombre, tipo, cuenta_codigo)
                VALUES (empresa, 'Equipo', 'producto', '4.1.03'), (empresa, 'Visita técnica', 'otro', '4.1.03'),
                       (empresa, 'Otro', 'otro', '4.1.03')
                ON CONFLICT (empresa_id, nombre) DO NOTHING;
                INSERT INTO billing.motivos_sin_costo (empresa_id, nombre)
                VALUES (empresa, 'Promoción'), (empresa, 'Cortesía'), (empresa, 'Garantía'),
                       (empresa, 'Compensación por falla'), (empresa, 'Convenio'), (empresa, 'Canje de lealtad')
                ON CONFLICT (empresa_id, nombre) DO NOTHING;
            END $$;
`

/**
 * Backfill idempotente (lo reusa la prueba): marca el primer concepto de cada empresa que aún no tiene
 * su concepto de sistema y siembra las empresas que siguen sin él (sin conceptos).
 */
export const SQL_BACKFILL = `
            UPDATE billing.conceptos_cargo k
               SET codigo_sistema = 'instalacion'
              FROM (SELECT DISTINCT ON (c.empresa_id) c.id
                      FROM billing.conceptos_cargo c
                     WHERE NOT EXISTS (SELECT 1 FROM billing.conceptos_cargo m
                                        WHERE m.empresa_id = c.empresa_id AND m.codigo_sistema IS NOT NULL)
                     ORDER BY c.empresa_id, c.id) p
             WHERE k.id = p.id;

            SELECT billing.sembrar_catalogos_cargo(e.id)
              FROM core.empresas e
             WHERE NOT EXISTS (SELECT 1 FROM billing.conceptos_cargo k
                                WHERE k.empresa_id = e.id AND k.codigo_sistema = 'instalacion')
             ORDER BY e.id;
`

export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.conceptos_cargo
                ADD COLUMN codigo_sistema text
                    CONSTRAINT conceptos_cargo_codigo_sistema CHECK (codigo_sistema IN ('instalacion'));
            CREATE UNIQUE INDEX conceptos_cargo_empresa_codigo_sistema
                ON billing.conceptos_cargo (empresa_id, codigo_sistema) WHERE codigo_sistema IS NOT NULL;

            ${SQL_SEMBRAR}
            ${SQL_BACKFILL}
            CREATE FUNCTION billing.proteger_codigo_sistema() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.codigo_sistema IS NOT NULL THEN
                        RAISE EXCEPTION 'El concepto de sistema % (%) no se puede borrar', OLD.id, OLD.codigo_sistema
                            USING ERRCODE = 'check_violation';
                    END IF;
                    RETURN OLD;
                END IF;
                IF NEW.codigo_sistema IS DISTINCT FROM OLD.codigo_sistema THEN
                    RAISE EXCEPTION 'codigo_sistema del concepto % no se puede cambiar', OLD.id
                        USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER conceptos_cargo_codigo_sistema BEFORE UPDATE OR DELETE ON billing.conceptos_cargo
                FOR EACH ROW EXECUTE FUNCTION billing.proteger_codigo_sistema();
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS conceptos_cargo_codigo_sistema ON billing.conceptos_cargo;
            DROP FUNCTION IF EXISTS billing.proteger_codigo_sistema();
            CREATE OR REPLACE FUNCTION billing.sembrar_catalogos_cargo(empresa bigint) RETURNS void LANGUAGE plpgsql AS $$
            BEGIN
                INSERT INTO billing.conceptos_cargo (empresa_id, nombre, tipo, cuenta_codigo)
                VALUES (empresa, 'Instalación', 'otro', '4.1.03'), (empresa, 'Equipo', 'producto', '4.1.03'),
                       (empresa, 'Visita técnica', 'otro', '4.1.03'), (empresa, 'Otro', 'otro', '4.1.03')
                ON CONFLICT (empresa_id, nombre) DO NOTHING;
                INSERT INTO billing.motivos_sin_costo (empresa_id, nombre)
                VALUES (empresa, 'Promoción'), (empresa, 'Cortesía'), (empresa, 'Garantía'),
                       (empresa, 'Compensación por falla'), (empresa, 'Convenio'), (empresa, 'Canje de lealtad')
                ON CONFLICT (empresa_id, nombre) DO NOTHING;
            END $$;
            DROP INDEX IF EXISTS billing.conceptos_cargo_empresa_codigo_sistema;
            ALTER TABLE billing.conceptos_cargo DROP COLUMN IF EXISTS codigo_sistema;
        `)
    }
}
