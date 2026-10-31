import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Pedidos de Iris A12 y A13 (contrato Iris 0.5.0):
 *
 * - `referencia` en clientes y servicios: texto libre para llegar («casa verde frente a la iglesia»),
 *   hasta 300 caracteres.
 * - Contacto en sitio del servicio: `contacto_nombre` (200) y `contacto_telefono` (30, normalizado
 *   como `telefono` del cliente, `#core/telefonos`).
 *
 * Columnas nuevas y opcionales: no se tocan filas existentes. Los teléfonos viejos de clientes no se
 * normalizan aquí (pedido A14): se validan y normalizan solo cuando cambian (`#core/telefonos`).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.clientes
                ADD COLUMN referencia varchar(300);
            ALTER TABLE core.servicios
                ADD COLUMN referencia varchar(300),
                ADD COLUMN contacto_nombre varchar(200),
                ADD COLUMN contacto_telefono varchar(30);
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE core.servicios
                DROP COLUMN IF EXISTS contacto_telefono,
                DROP COLUMN IF EXISTS contacto_nombre,
                DROP COLUMN IF EXISTS referencia;
            ALTER TABLE core.clientes
                DROP COLUMN IF EXISTS referencia;
        `)
    }
}
