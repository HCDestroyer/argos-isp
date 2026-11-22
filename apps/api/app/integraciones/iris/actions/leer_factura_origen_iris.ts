import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import {
    buscarFacturaOrigenIris,
    type BusquedaFacturaOrigenIris,
    type FacturaOrigenIris,
} from '#integraciones/iris/facturas_origen'

/** El mismo `404` para todo lo que no es una factura de esa orden en esa empresa (§3). */
export class FacturaNoEncontrada extends Problema {
    constructor() {
        super(
            404,
            'factura_no_encontrada',
            'Factura no encontrada',
            'No hay una factura de esa orden de Iris con ese número en esa empresa',
        )
    }
}

/**
 * `facturas.leer_origen_iris` (`GET /facturas/origen-iris`, contrato Iris 0.14.3 §3): la factura de
 * una orden de Iris por su número interno o por la serie y el número de su DTE, para conciliar un
 * «cobro por confirmar». Solo lectura, sin evento. Cada lectura queda en `audit.acciones` (también el
 * `404`) con los parámetros como entrada y el actor de Iris (`iris_actor`, canal `api`); la factura
 * queda como entidad solo si se encontró. Una factura que no es `iris_orden`, de otro `origen_id`, de
 * otra empresa o de una empresa fuera del alcance del token responde el mismo `404`.
 */
export default class LeerFacturaOrigenIris extends DomainAction<
    BusquedaFacturaOrigenIris,
    FacturaOrigenIris
> {
    readonly nombre = 'facturas.leer_origen_iris'

    protected async handle(input: BusquedaFacturaOrigenIris, t: Transaccion): Promise<FacturaOrigenIris> {
        const factura = await buscarFacturaOrigenIris(t.trx, input, t.ctx.empresasPermitidas ?? null)
        if (!factura) throw new FacturaNoEncontrada()
        t.fijarEmpresa(factura.empresa_id)
        t.fijarEntidad('factura', factura.factura_id)
        return factura
    }
}
