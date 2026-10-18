import type { Schema } from '@argosisp/contracts'

export type LocalizacionFiscal = Schema<'LocalizacionFiscal'>
export type LocalizacionEmpresa = Schema<'LocalizacionEmpresa'>
export type ResultadoInstalacionFiscal = Schema<'ResultadoInstalacionFiscal'>

/**
 * Paquete de localización fiscal de una empresa (A3, fase 2): versión instalada, la más reciente
 * del país y su historial de instalaciones.
 */
export function useLocalizacionFiscal() {
    const api = useApi()

    /** `GET /fiscal/localizaciones` (`fiscal.ver`): versiones publicadas por país. */
    function versiones(): Promise<Resultado<LocalizacionFiscal[]>> {
        return resolver(api.GET('/api/v1/fiscal/localizaciones'))
    }

    /** `GET /fiscal/empresas/:id/localizacion` (`fiscal.ver`). */
    function deEmpresa(empresaId: number): Promise<Resultado<LocalizacionEmpresa>> {
        return resolver(api.GET('/api/v1/fiscal/empresas/{id}/localizacion', { params: { path: { id: empresaId } } }))
    }

    /** `POST /fiscal/empresas/:id/actualizar-localizacion` (`fiscal.instalar`): solo agrega lo que falta. */
    function actualizar(empresaId: number, clave: string, codigo?: string): Promise<Resultado<ResultadoInstalacionFiscal>> {
        return resolver(api.POST('/api/v1/fiscal/empresas/{id}/actualizar-localizacion', {
            params: { path: { id: empresaId }, header: { 'Idempotency-Key': clave } },
            body: codigo ? { codigo } : {},
        }))
    }

    return { versiones, deEmpresa, actualizar }
}
