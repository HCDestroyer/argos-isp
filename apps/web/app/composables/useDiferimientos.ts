import type { Schema, paths } from '@argosisp/contracts'

export type Diferimiento = Schema<'Diferimiento'>
export type FiltrosDiferimientos = Omit<NonNullable<paths['/api/v1/diferimientos']['get']['parameters']['query']>, 'cursor' | 'empresas'>
export type CuerpoDiferimiento = paths['/api/v1/diferimientos']['post']['requestBody']['content']['application/json']

/**
 * Diferimientos (A3, fase 5; §10.10): gastos pagados por anticipado (1.1.13) e ingresos diferidos
 * (2.1.12) que se amortizan por mes (cron diario o «Amortizar pendiente»).
 */
export function useDiferimientos() {
    const api = useApi()

    /** `GET /diferimientos` (`libro.ver`). */
    function listar(filtros: FiltrosDiferimientos = {}, cursor?: string): Promise<Resultado<Pagina<Diferimiento>>> {
        return resolver(api.GET('/api/v1/diferimientos', { params: { query: { limit: 50, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    /** `GET /diferimientos/:id` (`libro.ver`). */
    function ver(id: number): Promise<Resultado<Diferimiento>> {
        return resolver(api.GET('/api/v1/diferimientos/{id}', { params: { path: { id } } }))
    }

    /** `POST /diferimientos` (`libro.registrar_asiento`): sobre una línea ya registrada; 409 `linea_diferida`. */
    function registrar(cuerpo: CuerpoDiferimiento, idempotencia: string): Promise<Resultado<Diferimiento>> {
        return resolver(api.POST('/api/v1/diferimientos', { params: { header: { 'Idempotency-Key': idempotencia } }, body: cuerpo }))
    }

    /** `POST /diferimientos/amortizar` (`libro.registrar_asiento`): las cuotas pendientes hasta el mes anterior. */
    function amortizar(hasta?: string): Promise<Resultado<ResultadoCuotasMes>> {
        return resolver(api.POST('/api/v1/diferimientos/amortizar', { body: hasta ? { hasta } : {} }))
    }

    return { listar, ver, registrar, amortizar }
}
