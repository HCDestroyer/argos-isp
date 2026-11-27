import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio } from '#shared/errores'
import { capacidadesDe, type ComponenteServicio, type TipoServicio } from '#core/tipos_servicio'

/**
 * 422 `tipo_sin_router` si el servicio no usa router (hoy: `cable`). Lo piden las acciones que
 * necesitan router, IP o velocidad (`servicios.reservar_ip`, `servicios.aprovisionar`,
 * `servicios.cambiar_plan_pendiente`, `servicios.editar`) y responden sin efectos: se llama antes de
 * escribir nada. Un servicio que no existe no es asunto de esta función (lo atiende quien llama).
 */
export async function exigirServicioConRouter(cliente: QueryClientContract, servicioId: number) {
    const fila = (await cliente
        .from('core.servicios as s')
        .join('network.planes as p', 'p.id', 's.plan_id')
        .where('s.id', servicioId)
        .select('s.tipo_servicio', 'p.componentes')
        .first()) as { tipo_servicio: TipoServicio; componentes: ComponenteServicio[] } | null
    if (!fila) return
    if (!capacidadesDe(fila.tipo_servicio, fila.componentes).requiereRouter) {
        throw new ReglaNegocio(
            `Un servicio de ${fila.tipo_servicio} no usa router: esta operación no aplica`,
            'tipo_sin_router',
        )
    }
}
