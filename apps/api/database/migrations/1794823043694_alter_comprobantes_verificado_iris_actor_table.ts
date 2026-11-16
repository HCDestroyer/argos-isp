import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.7.1 (aditivo): `billing.comprobantes.verificado_iris_actor` es el
 * `X-Iris-Actor` de quien aprobó o rechazó el comprobante cuando la decisión llegó desde Iris
 * (`POST /comprobantes/:id/aprobar|rechazar` con el token de Iris y la actuación vinculada,
 * 0.7.0 §7.7); null si se decidió en el panel o sigue pendiente. `iris_actor` sigue siendo el de
 * quien lo registró y no cambia.
 *
 * Sin asientos ni cambios en `ledger`. Las filas ya revisadas quedan en null.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.comprobantes
                ADD COLUMN verificado_iris_actor text
                    CHECK (length(verificado_iris_actor) BETWEEN 1 AND 80),
                ADD CONSTRAINT comprobantes_verificado_iris_actor CHECK (
                    verificado_iris_actor IS NULL OR estado <> 'pendiente'
                );
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.comprobantes
                DROP CONSTRAINT IF EXISTS comprobantes_verificado_iris_actor,
                DROP COLUMN IF EXISTS verificado_iris_actor;
        `)
    }
}
