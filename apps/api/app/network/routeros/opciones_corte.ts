import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { OpcionesCorte } from '#network/routeros/corte_router'
import { estrategiasEnUso, redesV4DeRouter, type RouterDispatcher } from '#network/routeros/consultas'
import type { ServicioRed } from '#network/routeros/estado_deseado'
import { gatewaysDeRedes, localAddressCorte } from '#network/routeros/velocidad_router'
import { pideFasttrack } from '#network/routeros/dispatcher'
import { corteTunelDeRouter } from '#network/conexion/tunel_corte'

/**
 * Opciones del estado de corte de un router (`estadoCorteRouter`), las mismas para el reconciliador, el
 * diagnóstico y la migración del control de velocidad: FastTrack, redes y gateways de clientes, modo de
 * identificación (`codigo` solo con credenciales de API) y corte por el túnel WireGuard
 * (`corteTunelDeRouter`, `contratos/corte-identificacion.md` §5 ter.3).
 */
export async function opcionesCorteRouter(
    routerId: number,
    router: RouterDispatcher,
    servicios: ServicioRed[],
    modoCodigo: boolean,
    cliente: QueryClientContract = db.connection(),
): Promise<OpcionesCorte> {
    return {
        fasttrack: pideFasttrack(estrategiasEnUso(router.velocidad, servicios)),
        redes_v4: await redesV4DeRouter(routerId, cliente),
        local_address: localAddressCorte(router.velocidad.redes_ipv4).gateway,
        gateways_v4: gatewaysDeRedes(router.velocidad.redes_ipv4),
        identificacion: modoCodigo ? 'codigo' : 'ip',
        tunel: modoCodigo ? null : await corteTunelDeRouter(routerId, cliente),
    }
}
