import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · plantillas de fábrica (decisión del PM, 18 nov): **facturar desde** un día por servicio.
 *
 * `plantillas.asignar_sin_plantilla` da plantilla a servicios vigentes que no tenían. Sin más,
 * `generarFacturas` («todo lo pendiente hasta ahora») emitiría todos los periodos desde la
 * instalación. Esta tabla guarda, por servicio, el primer periodo que se puede facturar: el
 * primer inicio de ciclo mayor o igual al día de la asignación. `generarFacturas` y `EmitirFactura` no emiten
 * un periodo que empiece antes (`periodosDesde` de `#billing/periodos`).
 *
 * - Una fila por servicio (la asignación la crea; una asignación posterior solo la mueve hacia
 *   adelante, nunca hacia atrás). Sin fila, el servicio factura como siempre (desde
 *   `inicioFacturacionSql`).
 * - `ON DELETE CASCADE`: un servicio que nunca se usó se puede eliminar (`servicios.eliminar`) y
 *   esta fila depende solo de él.
 * - No es parte del libro (`ledger`): no mueve dinero.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.servicios_facturar_desde (
                servicio_id bigint PRIMARY KEY REFERENCES core.servicios (id) ON DELETE CASCADE,
                facturar_desde date NOT NULL,
                plantilla_id bigint NOT NULL REFERENCES billing.plantillas_facturacion (id),
                origen text NOT NULL CHECK (origen IN ('asignacion_sin_plantilla')),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS billing.servicios_facturar_desde;`)
    }
}
