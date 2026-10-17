import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A2 (semana 3, tanda 2, tarea 2): `GET /routers/:id/resumen-sesiones` busca la última sesión de
 * cada servicio del router y si tuvo alguna viva desde una fecha. Sin este índice cada servicio
 * recorría todo el historial de `network.sesiones` (solo había índice parcial de las abiertas).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE INDEX sesiones_servicio_inicio ON network.sesiones (servicio_id, inicio DESC);
        `)
    }

    async down() {
        this.schema.raw(`DROP INDEX IF EXISTS network.sesiones_servicio_inicio;`)
    }
}
