import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.9.0 §1.2: el `token_portal` (otro `iris_pat_` recortado a `portal_argos.*`) con el
 * que el servidor del portal del cliente de Argos llama a §11. Iris lo entrega en el canje y en
 * `PUT /integraciones/iris/contrato` (contrato ≥ 0.9.0); Argos lo guarda **cifrado** (v1, como
 * `token_cifrado`) y de solo escritura: no sale en ninguna respuesta, y en `audit.cambios` queda
 * como `***`. Se rota con cada canje y se borra al desconectar. Lo lee A5
 * (`app/portal/soporte/iris_portal.ts`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw('ALTER TABLE integraciones.iris_conector ADD COLUMN token_portal_cifrado text')
    }

    async down() {
        this.schema.raw('ALTER TABLE integraciones.iris_conector DROP COLUMN IF EXISTS token_portal_cifrado')
    }
}
