import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.14.3 §3 (`GET /facturas/origen-iris`): cada línea de un cargo único guarda el
 * concepto del catálogo (`billing.conceptos_cargo`) del que salió, para responder
 * `lineas[{ concepto_id, precio_unitario, cantidad }]` igual que el cuerpo del cargo que mandó Iris.
 *
 * Nullable: las líneas mensuales, de mora, de descuento y las de cargos emitidos antes de esta
 * migración no tienen concepto (la lectura responde `concepto_id: null` y Iris no concilia con ellas).
 * Solo trazabilidad: ningún asiento ni total cambia.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.facturas_lineas
                ADD COLUMN concepto_cargo_id bigint REFERENCES billing.conceptos_cargo (id);
            COMMENT ON COLUMN billing.facturas_lineas.concepto_cargo_id IS
                'Concepto de cargo (billing.conceptos_cargo) de la línea de un cargo único; null en las demás';
        `)
    }

    async down() {
        this.schema.raw(`ALTER TABLE billing.facturas_lineas DROP COLUMN IF EXISTS concepto_cargo_id`)
    }
}
