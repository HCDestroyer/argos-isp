import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · fase 4 (decisión (g) del líder, contrato §18): estado propio **`castigada`** de la factura.
 * `pagado` sigue siendo solo lo cobrado (pagos, notas, saldos a favor); lo castigado se lee de
 * `ledger.castigos_facturas`. Solo DDL: ninguna factura ni fila del libro cambia (antes de esta
 * migración no hay castigos fuera de las pruebas).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.facturas DROP CONSTRAINT facturas_estado_check;
            ALTER TABLE billing.facturas ADD CONSTRAINT facturas_estado_check CHECK (estado IN (
                'por_certificar', 'emitida', 'parcial', 'pagada', 'vencida', 'anulada', 'castigada'));
        `)
    }

    async down() {
        // al bajar, una castigada vuelve a «cubierta» como se guardaba antes de esta migración
        this.schema.raw(`
            ALTER TABLE billing.facturas DROP CONSTRAINT facturas_estado_check;
            UPDATE billing.facturas f SET estado = 'pagada',
                   pagado = f.total
             WHERE f.estado = 'castigada';
            ALTER TABLE billing.facturas ADD CONSTRAINT facturas_estado_check CHECK (estado IN (
                'por_certificar', 'emitida', 'parcial', 'pagada', 'vencida', 'anulada')) NOT VALID;
        `)
    }
}
