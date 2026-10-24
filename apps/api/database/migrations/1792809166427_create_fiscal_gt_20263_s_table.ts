import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'
import { instalarPaquete, instalacionVigente, paqueteDePais } from '#fiscal/instalador'

/**
 * A3 · decisión del PM (egresos del cajero): actualiza cada empresa a la versión más reciente del
 * paquete de su país (`gt-2026.3`: agrega el parámetro `egreso_cajero_maximo`, Q500.00). Aditivo e
 * idempotente: una empresa ya en la versión no cambia; ninguna fila del libro se toca.
 */
export default class extends BaseSchema {
    async up() {
        this.defer(async (cliente) => {
            const hoy = DateTime.now().setZone('America/Guatemala').toISODate()!
            const empresas = (await cliente
                .from('core.empresas')
                .orderBy('id')
                .select('id', 'pais')) as Array<{ id: number; pais: string }>
            for (const empresa of empresas) {
                const vigente = await instalacionVigente(cliente, Number(empresa.id))
                if (!vigente) continue
                await instalarPaquete(cliente, paqueteDePais(empresa.pais.trim()), Number(empresa.id), {
                    instaladaPor: null,
                    hoy,
                })
            }
        })
    }

    async down() {
        // las instalaciones y el catálogo son de solo inserción: la versión 2026.3 se queda
    }
}
