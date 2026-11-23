import type { Schema, paths } from '@argosisp/contracts'

export type BancoOrigen = Schema<'BancoOrigen'>
export type DatosBancoOrigen = paths['/api/v1/bancos-origen']['post']['requestBody']['content']['application/json']
export type CambiosBancoOrigen = Omit<paths['/api/v1/bancos-origen/{id}']['put']['requestBody']['content']['application/json'], 'version'>

/**
 * Catálogo de bancos de origen (A3, decisión 23 del PM): uno para todo el sistema; el admin agrega y
 * edita, y cada empresa oculta los que no usa (`oculto` es de la empresa activa). Para elegir un
 * banco al cobrar, `useBancos().listar()` ya trae solo los visibles.
 */
export function useBancosOrigen() {
    const api = useApi()

    /** `GET /bancos-origen` (`cuentas_bancarias.ver`): con los inactivos y `oculto` de la empresa activa. */
    function listar(): Promise<Resultado<BancoOrigen[]>> {
        return resolver(api.GET('/api/v1/bancos-origen'))
    }

    /** `POST /bancos-origen` (`bancos_origen.crear`): 409 `banco_duplicado` si el nombre ya existe. */
    function crear(datos: DatosBancoOrigen): Promise<Resultado<BancoOrigen>> {
        return resolver(api.POST('/api/v1/bancos-origen', {
            params: { header: { 'Idempotency-Key': nuevaClaveIdempotencia() } },
            body: datos,
        }))
    }

    /** `PUT /bancos-origen/:id` (`bancos_origen.editar`): afecta a todas las empresas; 409 por versión o nombre. */
    function editar(banco: Pick<BancoOrigen, 'id' | 'version'>, cambios: CambiosBancoOrigen): Promise<Resultado<BancoOrigen>> {
        return resolver(api.PUT('/api/v1/bancos-origen/{id}', {
            params: { path: { id: banco.id }, header: { 'Idempotency-Key': nuevaClaveIdempotencia() } },
            body: { version: banco.version, ...cambios },
        }))
    }

    /** `POST /bancos-origen/:id/ocultar` (`bancos_origen.ocultar`): solo en la empresa activa. */
    function ocultar(id: number): Promise<Resultado<BancoOrigen>> {
        return resolver(api.POST('/api/v1/bancos-origen/{id}/ocultar', { params: { path: { id }, header: { 'Idempotency-Key': nuevaClaveIdempotencia() } } }))
    }

    /** `POST /bancos-origen/:id/mostrar` (`bancos_origen.mostrar`): vuelve a mostrarlo en la empresa activa. */
    function mostrar(id: number): Promise<Resultado<BancoOrigen>> {
        return resolver(api.POST('/api/v1/bancos-origen/{id}/mostrar', { params: { path: { id }, header: { 'Idempotency-Key': nuevaClaveIdempotencia() } } }))
    }

    return { listar, crear, editar, ocultar, mostrar }
}
