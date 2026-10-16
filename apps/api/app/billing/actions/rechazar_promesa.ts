import type { Transaccion } from '#shared/domain_action'
import { ResolverPromesa, type EntradaResolverPromesa, type FilaPromesa } from '#billing/cierre_promesa'
import { detalleOperador, exigirEstadoPromesa, motivoDeCierre } from '#billing/cierre_promesa_operador'

/**
 * `promesas.rechazar` (`POST /promesas/:id/rechazar { motivo }`): un supervisor rechaza una
 * promesa `pendiente_aprobacion` → `rechazada`; `resultado_evaluacion.cierre` guarda motivo y
 * quién. No cambia el servicio (una pendiente no lo protegía). 409 `promesa_no_pendiente` en
 * otro estado. Ver `cierre_promesa.ts`.
 */
export default class RechazarPromesa extends ResolverPromesa {
    readonly nombre = 'promesas.rechazar'

    protected async decidir(
        t: Transaccion,
        promesa: FilaPromesa,
        _ahora: Date,
        input: EntradaResolverPromesa,
    ) {
        const motivo = motivoDeCierre(input)
        exigirEstadoPromesa(promesa, ['pendiente_aprobacion'], 'rechazar')
        return { estado: 'rechazada' as const, detalle: detalleOperador(t, motivo) }
    }
}
