import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'
import { instalarPaquete, instalacionVigente, paqueteDePais } from '#fiscal/instalador'

/**
 * A3 · decisión 12 del PM (21 nov 2026): actualiza cada empresa instalada a la versión más reciente
 * del paquete de su país (`gt-2026.5`: `pc_alertas` = 80, 95 y 100 % desde el 21 nov 2026). Aditivo
 * e idempotente: una empresa ya en la versión no cambia; un valor que la empresa eligió sigue
 * mandando; ninguna fila del libro se toca.
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
        // las instalaciones y el catálogo son de solo inserción: la versión 2026.5 se queda
    }
}
