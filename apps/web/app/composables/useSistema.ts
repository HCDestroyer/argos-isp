import type { Schema, paths } from '@argosisp/contracts'

export type SaludSistema = Schema<'SaludSistema'>
export type ComponenteSalud = Schema<'ComponenteSalud'>
export type EntradaRegistro = Schema<'EntradaRegistro'>
export type AlmacenamientoSistema = Schema<'Almacenamiento'>
export type FiltrosRegistro = Omit<NonNullable<paths['/api/v1/sistema/registro']['get']['parameters']['query']>, 'cursor'>

/**
 * Salud, registro y almacenamiento del sistema (A6, `contratos/salud.md`). Solo leen; el
 * recálculo del almacenamiento solo suma (no borra). Cada pantalla comprueba su permiso.
 */
export function useSistema() {
    const api = useApi()

    /** `GET /sistema/salud` (`sistema.ver_salud`): nunca 500 por un componente caído. */
    function salud(): Promise<Resultado<SaludSistema>> {
        return resolver(api.GET('/api/v1/sistema/salud'))
    }

    /** `GET /sistema/registro` (`sistema.ver_registro`), del más nuevo al más viejo. */
    function registro(filtros: FiltrosRegistro = {}, cursor?: string): Promise<Resultado<Pagina<EntradaRegistro>>> {
        return resolver(api.GET('/api/v1/sistema/registro', { params: { query: { limit: 50, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    /** `GET /sistema/almacenamiento` (`sistema.ver_almacenamiento`). */
    function almacenamiento(): Promise<Resultado<AlmacenamientoSistema>> {
        return resolver(api.GET('/api/v1/sistema/almacenamiento'))
    }

    /** `POST /sistema/almacenamiento/recalcular` (`sistema.recalcular_almacenamiento`): la medición nueva; 409 si ya corre una. */
    function recalcularAlmacenamiento(): Promise<Resultado<Schema<'MedicionAlmacenamiento'>>> {
        return resolver(api.POST('/api/v1/sistema/almacenamiento/recalcular'))
    }

    return { salud, registro, almacenamiento, recalcularAlmacenamiento }
}
