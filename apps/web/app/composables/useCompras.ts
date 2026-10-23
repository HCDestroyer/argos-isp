import type { Schema, paths } from '@argosisp/contracts'

export type Compra = Schema<'Compra'>
export type LineaCompra = Schema<'LineaCompra'>
export type ConstanciaRetencion = Schema<'ConstanciaRetencion'>
export type FiltrosCompras = Omit<NonNullable<paths['/api/v1/compras']['get']['parameters']['query']>, 'cursor' | 'empresas'>
export type CuerpoCompra = paths['/api/v1/compras']['post']['requestBody']['content']['application/json']
export type CuerpoCompraDesdeEgreso = paths['/api/v1/compras/desde-egreso/{egresoId}']['post']['requestBody']['content']['application/json']
export type CuerpoConstanciaCompra = paths['/api/v1/compras/{id}/constancias']['post']['requestBody']['content']['application/json']

/**
 * Compras (A3, fase 5; contrato fiscal §19). Solo inserción: al contado crea el egreso que la paga, al
 * crédito queda en el auxiliar del proveedor; una línea `activo_fijo` da de alta el activo y una con
 * `diferir_meses`, su diferimiento. Se corrige anulando (reverso) o con una NCRE del proveedor.
 */
export function useCompras() {
    const api = useApi()

    /** `GET /compras` (`compras.ver`). */
    function listar(filtros: FiltrosCompras = {}, cursor?: string): Promise<Resultado<Pagina<Compra>>> {
        return resolver(api.GET('/api/v1/compras', { params: { query: { limit: 50, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    /** `GET /compras/:id` (`compras.ver`). */
    function ver(id: number): Promise<Resultado<Compra>> {
        return resolver(api.GET('/api/v1/compras/{id}', { params: { path: { id } } }))
    }

    /** `POST /compras` (`compras.registrar`): 409 `compra_duplicada`, 422 `credito_fiscal_extemporaneo`, `ncre_excede_saldo`. */
    function registrar(cuerpo: CuerpoCompra, idempotencia: string): Promise<Resultado<Compra>> {
        return resolver(api.POST('/api/v1/compras', { params: { header: { 'Idempotency-Key': idempotencia } }, body: cuerpo }))
    }

    /** `POST /compras/desde-egreso/:egresoId` (`compras.registrar`): el neto debe ser el monto del egreso. */
    function registrarDesdeEgreso(egresoId: number, cuerpo: CuerpoCompraDesdeEgreso, idempotencia: string): Promise<Resultado<Compra>> {
        return resolver(api.POST('/api/v1/compras/desde-egreso/{egresoId}', { params: { path: { egresoId }, header: { 'Idempotency-Key': idempotencia } }, body: cuerpo }))
    }

    /** `POST /compras/:id/anular` (`compras.anular`): reverso con fecha de hoy; 409 si tiene NCRE, pagos, constancia o cuotas. */
    function anular(id: number, motivo: string, idempotencia: string): Promise<Resultado<Compra>> {
        return resolver(api.POST('/api/v1/compras/{id}/anular', { params: { path: { id }, header: { 'Idempotency-Key': idempotencia } }, body: { motivo } }))
    }

    /** `POST /compras/:id/constancias` (`compras.registrar`): número de la constancia de una retención emitida. */
    function registrarConstancia(id: number, cuerpo: CuerpoConstanciaCompra, idempotencia: string): Promise<Resultado<ConstanciaRetencion>> {
        return resolver(api.POST('/api/v1/compras/{id}/constancias', { params: { path: { id }, header: { 'Idempotency-Key': idempotencia } }, body: cuerpo }))
    }

    return { listar, ver, registrar, registrarDesdeEgreso, anular, registrarConstancia }
}
