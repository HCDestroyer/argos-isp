import type { paths } from '@argosisp/contracts'

export type CambiosImpresionCaja = Omit<paths['/api/v1/cajas/{id}/impresion']['put']['requestBody']['content']['application/json'], 'version'>

/**
 * Formato de impresión de cada caja (decisión 20 del PM, A3): el recibo en ticket de 80 mm o carta
 * y la factura en carta o ticket. Se guarda en la caja (`Caja.formato_recibo` y `formato_factura`),
 * nunca en el navegador.
 */
export function useImpresionCajas() {
    const api = useApi()

    /** `PUT /cajas/:id/impresion` (`cajas.configurar_impresion`): solo cambia lo enviado; 409 si `version` cambió. */
    function configurar(caja: Pick<Caja, 'id' | 'version'>, cambios: CambiosImpresionCaja): Promise<Resultado<Caja>> {
        return resolver(api.PUT('/api/v1/cajas/{id}/impresion', {
            params: { path: { id: caja.id }, header: { 'Idempotency-Key': nuevaClaveIdempotencia() } },
            body: { version: caja.version, ...cambios },
        }))
    }

    return { configurar }
}
