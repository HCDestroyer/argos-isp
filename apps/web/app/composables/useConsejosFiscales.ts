import type { Schema, paths } from '@argosisp/contracts'

export type ConsejosFiscales = Schema<'ConsejosFiscales'>
export type ConsejoFiscal = Schema<'ConsejoFiscal'>
export type ConsejoOcultado = Schema<'ConsejoOcultado'>
export type CuerpoOcultarConsejo = NonNullable<paths['/api/v1/fiscal/consejos/{clave}/ocultar']['post']['requestBody']>['content']['application/json']

/**
 * Consejos fiscales (A3, fase 8 PR C): salen de los bloques del tablero y del comparador, nunca de cifras
 * propias. `aplica` con su texto, `no_aplica` con su motivo o `sin_datos` con el problema del bloque
 * fuente. Ocultar y mostrar son una preferencia de pantalla auditada (`fiscal.ocultar_consejo`).
 */
export function useConsejosFiscales() {
    const api = useApi()

    /** `GET /fiscal/consejos` (`fiscal.ver`); con «Todas», una sección por empresa. */
    function listar(): Promise<Resultado<ConsejosFiscales>> {
        return resolver(api.GET('/api/v1/fiscal/consejos'))
    }

    /** `POST /fiscal/consejos/:clave/ocultar` (`fiscal.configurar`): para la empresa o solo para quien lo pide. */
    function ocultar(clave: string, cuerpo: CuerpoOcultarConsejo, idempotencia: string): Promise<Resultado<ConsejoOcultado>> {
        return resolver(api.POST('/api/v1/fiscal/consejos/{clave}/ocultar', {
            params: { path: { clave }, header: { 'Idempotency-Key': idempotencia } },
            body: cuerpo,
        }))
    }

    /** `POST /fiscal/consejos/:clave/mostrar` (`fiscal.configurar`): vuelve a mostrarlo en el mismo alcance. */
    function mostrar(clave: string, cuerpo: CuerpoOcultarConsejo, idempotencia: string): Promise<Resultado<ConsejoOcultado>> {
        return resolver(api.POST('/api/v1/fiscal/consejos/{clave}/mostrar', {
            params: { path: { clave }, header: { 'Idempotency-Key': idempotencia } },
            body: cuerpo,
        }))
    }

    return { listar, ocultar, mostrar }
}
