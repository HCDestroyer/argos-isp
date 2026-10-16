import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * notify (A6, tarea 7): `VigilarCrons` mide un cron que nunca corrió desde el último despliegue
 * (`adonis_schema.migration_time`). El usuario de la aplicación necesita leer esa tabla; solo
 * lectura, la escriben las migraciones con el dueño.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`GRANT SELECT ON TABLE public.adonis_schema TO argosisp_app`)
    }

    async down() {
        this.schema.raw(`REVOKE SELECT ON TABLE public.adonis_schema FROM argosisp_app`)
    }
}
