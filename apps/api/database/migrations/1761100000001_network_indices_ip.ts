import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Índices para `GET /ip/{ip}` (tarea 13 de A1): prefijos IPv6 de las sesiones activas por
 * contención (`>>=`). Las asignaciones IPv6 ya tienen GiST y la IPv4 de sesiones y asignaciones
 * sus índices por igualdad.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE INDEX sesiones_enlace_v6_activa ON network.sesiones
                USING gist (prefijo_enlace_v6 inet_ops) WHERE fin IS NULL;
            CREATE INDEX sesiones_delegado_v6_activa ON network.sesiones
                USING gist (prefijo_delegado_v6 inet_ops) WHERE fin IS NULL;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS network.sesiones_delegado_v6_activa;
            DROP INDEX IF EXISTS network.sesiones_enlace_v6_activa;
        `)
    }
}
