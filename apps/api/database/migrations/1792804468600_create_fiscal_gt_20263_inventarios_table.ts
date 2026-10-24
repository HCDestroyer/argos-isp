import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'
import { instalarPaquete, instalacionVigente, paqueteDePais } from '#fiscal/instalador'

/**
 * A3 · inventario, fase A (`contratos/inventario.md` §3): actualiza cada empresa instalada a la
 * versión más reciente del paquete de su país (`gt-2026.3`: agrega `1.1.14 Inventarios`, `5.2.07
 * Materiales de instalación y mantenimiento`, `4.2.04 Sobrantes de inventario` y el grupo `5.6 Costo
 * de ventas` con `5.6.01` y `5.6.02`). Aditivo e idempotente: una empresa ya en la versión no
 * cambia; ninguna fila del libro se toca.
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
