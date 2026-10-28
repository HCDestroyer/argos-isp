import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Servicio pendiente de instalación (pedido A1 de Iris, decisión del PM del 28 oct;
 * `.claude/integration/contratos/instalacion.md` §4).
 *
 * - `estado` suma `pendiente_instalacion`: el servicio vendido desde Iris nace así y solo sale con
 *   `servicios.activar_instalacion` (→ activo) o `servicios.retirar`.
 * - `instalado_en`: cuándo se activó la instalación; la facturación cuenta el primer periodo desde
 *   aquí. Los servicios existentes toman su `created_at`, así que nada cambia para ellos. El valor
 *   por defecto `now()` deja igual a quien inserta un servicio ya activo; `CrearServicio` lo pone en
 *   null solo para un pendiente.
 * - Un pendiente nunca tiene `instalado_en` (`servicios_pendiente_sin_instalar`).
 * - `planta` (pedido A9 de Iris, contrato 0.2.0): referencia de la planta de fibra que dejó la
 *   instalación (`caja`, `puerto`, `olt`, `slot`, `pon`, `potencia_dbm`), de solo lectura. La planta
 *   vive en OZmap; Argos no la valida contra nada.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.servicios DROP CONSTRAINT servicios_estado_check;
            ALTER TABLE core.servicios ADD CONSTRAINT servicios_estado_check
                CHECK (estado IN ('pendiente_instalacion', 'activo', 'limitado', 'suspendido', 'retirado'));

            ALTER TABLE core.servicios ADD COLUMN instalado_en timestamptz;
            UPDATE core.servicios SET instalado_en = created_at;
            SET CONSTRAINTS ALL IMMEDIATE;
            ALTER TABLE core.servicios ALTER COLUMN instalado_en SET DEFAULT now();
            ALTER TABLE core.servicios ADD CONSTRAINT servicios_pendiente_sin_instalar
                CHECK (estado <> 'pendiente_instalacion' OR instalado_en IS NULL);
            COMMENT ON COLUMN core.servicios.instalado_en IS
                'Activación de la instalación (inicio de facturación); null mientras está pendiente_instalacion';

            ALTER TABLE core.servicios ADD COLUMN planta jsonb
                CONSTRAINT servicios_planta_objeto CHECK (planta IS NULL OR jsonb_typeof(planta) = 'object');
            COMMENT ON COLUMN core.servicios.planta IS
                'Referencia de planta de la instalación (caja, puerto, olt, slot, pon, potencia_dbm); solo lectura, la fuente es OZmap vía Iris';
        `)
    }

    async down() {
        // sin el estado, un pendiente queda suspendido: sigue sin navegar (no se pierde la fila)
        this.schema.raw(`
            ALTER TABLE core.servicios DROP CONSTRAINT IF EXISTS servicios_pendiente_sin_instalar;
            UPDATE core.servicios SET estado = 'suspendido' WHERE estado = 'pendiente_instalacion';
            SET CONSTRAINTS ALL IMMEDIATE;
            ALTER TABLE core.servicios DROP COLUMN IF EXISTS planta;
            ALTER TABLE core.servicios DROP COLUMN IF EXISTS instalado_en;
            ALTER TABLE core.servicios DROP CONSTRAINT servicios_estado_check;
            ALTER TABLE core.servicios ADD CONSTRAINT servicios_estado_check
                CHECK (estado IN ('activo', 'limitado', 'suspendido', 'retirado'));
        `)
    }
}
