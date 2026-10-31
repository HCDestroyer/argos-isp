import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.5.0 («Versión y compatibilidad», §2.3):
 *
 * - `integraciones.iris_conector.contrato`: versión del contrato que habla el Iris conectado
 *   (semver, la manda en el canje o con `PUT /integraciones/iris/contrato`). Null = Iris anterior
 *   a 0.5.0, que nunca la informó: no recibe los webhooks nuevos de 0.5.0 (`conectorAdmite`).
 * - `core.zonas.activo`: una zona se puede desactivar y reactivar (como planes y routers), y el
 *   cambio sale en `catalogo.cambiado` con `campos: ['activo']`. Todas las existentes quedan activas.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE integraciones.iris_conector
                ADD COLUMN contrato varchar(64)
                    CHECK (contrato IS NULL OR contrato ~ '^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+){0,1}$');
            ALTER TABLE core.zonas
                ADD COLUMN activo boolean NOT NULL DEFAULT true;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE core.zonas DROP COLUMN IF EXISTS activo;
            ALTER TABLE integraciones.iris_conector DROP COLUMN IF EXISTS contrato;
        `)
    }
}
