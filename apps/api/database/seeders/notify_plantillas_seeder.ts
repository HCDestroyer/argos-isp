import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'
import { PLANTILLAS_BASE, RECORDATORIOS_BASE } from '#notify/plantillas_base'

/**
 * Plantillas y recordatorios iniciales de notificaciones (A6). Idempotente: inserta los que
 * falten (`evento + canal`, `orden`) y nunca pisa lo editado desde el panel.
 */
export default class NotifyPlantillasSeeder extends BaseSeeder {
    async run() {
        await db
            .knexQuery()
            .table('notify.plantillas')
            .insert(PLANTILLAS_BASE)
            .onConflict(['evento', 'canal'])
            .ignore()
        await db
            .knexQuery()
            .table('notify.recordatorios')
            .insert(RECORDATORIOS_BASE)
            .onConflict('orden')
            .ignore()
    }
}
