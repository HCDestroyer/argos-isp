import type { Schema, paths } from '@argosisp/contracts'

export type AjustesCobro = Schema<'AjustesCobro'>
export type CambiosAjustesCobro = Omit<paths['/api/v1/ajustes-cobro']['put']['requestBody']['content']['application/json'], 'version'>

/**
 * Reglas de cobro y libro de la empresa activa (A3, decisiones 10 y 16): aprobación de los asientos
 * manuales por otro usuario y tope de días de la pausa sin cobro. Sin guardar: los de fábrica y
 * `version` 0.
 */
export function useAjustesCobro() {
    const api = useApi()

    /** `GET /ajustes-cobro` (`ajustes_cobro.ver`); 422 `empresa_requerida` sin empresa activa. */
    function ver(): Promise<Resultado<AjustesCobro>> {
        return resolver(api.GET('/api/v1/ajustes-cobro'))
    }

    /** `PUT /ajustes-cobro` (`ajustes_cobro.editar`): solo cambia lo enviado; 409 si `version` cambió. */
    function editar(version: number, cambios: CambiosAjustesCobro): Promise<Resultado<AjustesCobro>> {
        return resolver(api.PUT('/api/v1/ajustes-cobro', {
            params: { header: { 'Idempotency-Key': nuevaClaveIdempotencia() } },
            body: { version, ...cambios },
        }))
    }

    return { ver, editar }
}
