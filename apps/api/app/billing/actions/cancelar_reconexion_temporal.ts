import type { Transaccion } from '#shared/domain_action'
import { ResolverPromesa, type FilaPromesa } from '#billing/cierre_promesa'

/**
 * `promesas.cancelar_reconexion`: caja rechazó el comprobante de una reconexión temporal activa
 * (contrato Iris 0.6.0 §7.3). La promesa queda `cancelada` al instante, sale `promesa.cancelada`
 * con `motivo = comprobante_rechazado` y el servicio se re-evalúa en la misma transacción: vuelve
 * a cortarse, pero si la plantilla tiene hora de corte y aún no llega, espera a esa hora (como
 * cualquier corte). No cuenta en el historial de cumplimiento. La llama `RechazarComprobante`
 * anidada; sobre una promesa ya cerrada no hace nada.
 */
export default class CancelarReconexionTemporal extends ResolverPromesa {
    readonly nombre = 'promesas.cancelar_reconexion'

    protected async decidir(_t: Transaccion, promesa: FilaPromesa) {
        if (promesa.tipo !== 'reconexion_temporal' || promesa.estado !== 'activa') return null
        return {
            estado: 'cancelada' as const,
            detalle: { motivo: 'caja rechazó el comprobante', comprobante_id: promesa.comprobante_id },
            cancelacion: { motivo: 'comprobante_rechazado' as const, detalle: null },
        }
    }
}
