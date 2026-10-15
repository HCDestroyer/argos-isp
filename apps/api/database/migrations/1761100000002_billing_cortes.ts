import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · tarea 7: `billing.cortes_ejecutados`, una fila por (día, hora de corte) que el cron de
 * corte ya procesó. Si el worker estuvo caído a esa hora, la siguiente corrida la procesa ("todo
 * lo pendiente hasta ahora") y nunca dos veces el mismo día.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.cortes_ejecutados (
                -- "YYYY-MM-DD HH:MM": día y hora de corte de Guatemala
                clave text PRIMARY KEY,
                evaluados integer NOT NULL DEFAULT 0,
                cambiados integer NOT NULL DEFAULT 0,
                ejecutado_en timestamptz NOT NULL DEFAULT now()
            );
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS billing.cortes_ejecutados;`)
    }
}
