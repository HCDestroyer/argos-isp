import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A6 · importador: `billing.servicios_facturar_desde` admite el origen `importacion`.
 *
 * Con las plantillas de fábrica (A3, 18 nov) el importador encuentra una plantilla por defecto y los
 * servicios importados entran con ella. Sin `facturar_desde`, `generarFacturas` les emitiría todos
 * los periodos desde `fecha_instalacion`, incluidos los que el origen ya cobró o que entran como
 * facturas pendientes importadas. La acción `importacion.fijar_facturar_desde`
 * (`app/importacion/actions/fijar_facturar_desde.ts`) deja la fila con `origen = 'importacion'`.
 *
 * Solo amplía el CHECK: las filas existentes no cambian.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.servicios_facturar_desde
                DROP CONSTRAINT IF EXISTS servicios_facturar_desde_origen_check,
                ADD CONSTRAINT servicios_facturar_desde_origen_check
                    CHECK (origen IN ('asignacion_sin_plantilla', 'importacion'));
        `)
    }

    async down() {
        this.schema.raw(`
            DELETE FROM billing.servicios_facturar_desde WHERE origen = 'importacion';
            ALTER TABLE billing.servicios_facturar_desde
                DROP CONSTRAINT IF EXISTS servicios_facturar_desde_origen_check,
                ADD CONSTRAINT servicios_facturar_desde_origen_check
                    CHECK (origen IN ('asignacion_sin_plantilla'));
        `)
    }
}
