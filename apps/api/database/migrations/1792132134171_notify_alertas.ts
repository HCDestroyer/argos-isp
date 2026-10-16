import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * notify (A6, tarea 7): alertas internas al chat del equipo.
 *
 *  - `incidentes`: un problema en curso (RADIUS caído, CoA fallando en un router, cron atrasado)
 *    o un hecho puntual (cierre de caja con diferencia). `clave` identifica el problema
 *    (`aaa:<nodo>`, `coa:<nas_ip>`, `cron:<nombre>`); solo puede haber un incidente `abierto` por
 *    clave, así que repetir el evento no repite la alerta.
 *  - `alertas_eventos`: qué eventos ya se procesaron (`outbox:<id>`). Un evento entregado dos
 *    veces no vuelve a contar ni a avisar.
 *
 * Los envíos al chat van en `notify.envios` con `cliente_id` nulo y origen `alerta:<id>:<fase>`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE notify.incidentes (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                clave text NOT NULL,
                tipo text NOT NULL,
                estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
                abierto_en timestamptz NOT NULL DEFAULT now(),
                ultimo_en timestamptz NOT NULL DEFAULT now(),
                cerrado_en timestamptz,
                eventos integer NOT NULL DEFAULT 1,
                detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((estado = 'cerrado') = (cerrado_en IS NOT NULL))
            );
            CREATE UNIQUE INDEX incidentes_abierto_unico ON notify.incidentes (clave) WHERE estado = 'abierto';
            CREATE INDEX incidentes_clave ON notify.incidentes (clave, id DESC);

            CREATE TABLE notify.alertas_eventos (
                origen text PRIMARY KEY,
                evento text NOT NULL,
                incidente_id bigint REFERENCES notify.incidentes (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS notify.alertas_eventos;
            DROP TABLE IF EXISTS notify.incidentes;
        `)
    }
}
