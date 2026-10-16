import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tipo de actor `cliente` (semana 3, revisión de seguridad; pedido de A5): las acciones del portal
 * autenticado se auditan con el cliente que las hizo (`actor_id` = `core.clientes.id`), no como
 * `sistema`. Solo cambia la restricción CHECK de `audit.acciones` y `audit.cambios` (las
 * particiones la heredan); ninguna fila se toca.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE audit.acciones
                DROP CONSTRAINT acciones_actor_tipo_check,
                ADD CONSTRAINT acciones_actor_tipo_check
                    CHECK (actor_tipo IN ('usuario', 'token', 'agente', 'sistema', 'cliente'));
            ALTER TABLE audit.cambios
                DROP CONSTRAINT cambios_actor_tipo_check,
                ADD CONSTRAINT cambios_actor_tipo_check
                    CHECK (actor_tipo IN ('usuario', 'token', 'agente', 'sistema', 'cliente'));
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE audit.acciones
                DROP CONSTRAINT acciones_actor_tipo_check,
                ADD CONSTRAINT acciones_actor_tipo_check
                    CHECK (actor_tipo IN ('usuario', 'token', 'agente', 'sistema')) NOT VALID;
            ALTER TABLE audit.cambios
                DROP CONSTRAINT cambios_actor_tipo_check,
                ADD CONSTRAINT cambios_actor_tipo_check
                    CHECK (actor_tipo IN ('usuario', 'token', 'agente', 'sistema')) NOT VALID;
        `)
    }
}
