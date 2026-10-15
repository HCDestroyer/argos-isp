import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'
import { PLANTILLAS_BASE } from '#notify/plantillas_base'

/**
 * Plantillas iniciales de notificaciones (A6). Idempotente: inserta las que falten por
 * `(evento, canal)` y nunca pisa las editadas desde el panel.
 */
export default class NotifyPlantillasSeeder extends BaseSeeder {
    async run() {
        await db
            .knexQuery()
            .table('notify.plantillas')
            .insert(PLANTILLAS_BASE)
            .onConflict(['evento', 'canal'])
            .ignore()
    }
}
