import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Cómo identifica el portal al suspendido de cada router (`contratos/corte-identificacion.md`, decisión
 * del PM P1, 8 nov):
 *
 * - `ip`: por la IP de origen que llega al portal (el comportamiento de antes). Solo sirve si no hay NAT
 *   ni proxy entre el router y el portal (túnel sin masquerade, ruta privada, IPv6 nativo).
 * - `codigo`: el router redirige el HTTP del suspendido a su web proxy (`/ip proxy`, puerto 3346) y una
 *   regla `/ip proxy access` por servicio lo manda a `/corte?c=<código>`. No depende de la IP que vea
 *   el servidor. Exige la API del router (lo valida `routers.crear` / `routers.editar`, 422).
 *
 * Los routers existentes quedan en `ip`: nada cambia hasta que el operador elige `codigo`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.routers
                ADD COLUMN corte_identificacion text NOT NULL DEFAULT 'ip'
                    CHECK (corte_identificacion IN ('ip', 'codigo'));
        `)
    }

    async down() {
        this.schema.raw(`ALTER TABLE network.routers DROP COLUMN IF EXISTS corte_identificacion;`)
    }
}
