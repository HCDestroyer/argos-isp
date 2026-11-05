import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.6.2: `integraciones.iris_conector.receptor_argos`, lo último que informó Iris
 * sobre el receptor de webhooks de Argos (la `url` y el `secreto` que entrega el canje).
 *
 * - true: Iris lo guardó (con B1, el canje siempre manda true).
 * - false: Iris no lo tiene (un conector canjeado antes de B1, informado con
 *   `PUT /integraciones/iris/contrato`): el panel pide volver a conectar.
 * - null: Iris nunca lo informó (un Iris anterior a 0.6.2). Las filas existentes quedan así.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`ALTER TABLE integraciones.iris_conector ADD COLUMN receptor_argos boolean`)
    }

    async down() {
        this.schema.raw(`ALTER TABLE integraciones.iris_conector DROP COLUMN IF EXISTS receptor_argos`)
    }
}
