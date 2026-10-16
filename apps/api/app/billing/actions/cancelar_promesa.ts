import type { Transaccion } from '#shared/domain_action'
import { ResolverPromesa, type EntradaResolverPromesa, type FilaPromesa } from '#billing/cierre_promesa'
import { detalleOperador, exigirEstadoPromesa, motivoDeCierre } from '#billing/cierre_promesa_operador'

/**
 * `promesas.cancelar` (`POST /promesas/:id/cancelar { motivo }`): un supervisor cancela una
 * promesa `activa` o `pendiente_aprobacion` → `cancelada` (motivo y quién en
 * `resultado_evaluacion.cierre`). Si estaba activa, `evaluarEstadoServicio` corre en la misma
 * transacción: el servicio vuelve a limitarse o cortarse si sigue con vencidas (respetando la
 * hora de corte). 409 `promesa_no_pendiente` si ya estaba cerrada. Ver `cierre_promesa.ts`.
 */
export default class CancelarPromesa extends ResolverPromesa {
    readonly nombre = 'promesas.cancelar'

    protected async decidir(
        t: Transaccion,
        promesa: FilaPromesa,
        _ahora: Date,
        input: EntradaResolverPromesa,
    ) {
        const motivo = motivoDeCierre(input)
        exigirEstadoPromesa(promesa, ['activa', 'pendiente_aprobacion'], 'cancelar')
        return { estado: 'cancelada' as const, detalle: detalleOperador(t, motivo) }
    }
}
