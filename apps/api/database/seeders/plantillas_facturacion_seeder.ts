import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { sembrarPlantillasFabrica } from '#billing/plantillas_fabrica'

/**
 * Plantillas de facturación de fábrica (A3, decisión del PM del 18 nov): «Genera 1 · vence 15» (por
 * defecto si no hay otra marcada), «Genera 14 · vence 29» y «Genera 1 · vence 5». Pasan por la
 * acción `CrearPlantilla` con actor sistema (auditadas). Idempotente: no duplica ni modifica una
 * plantilla que ya tenga ese nombre. El contenido vive en `app/billing/plantillas_fabrica.ts`.
 */
export default class PlantillasFacturacionSeeder extends BaseSeeder {
    async run() {
        await sembrarPlantillasFabrica()
    }
}
