import type { Schema, paths } from '@argosisp/contracts'

export type AjustesOperacion = Schema<'AjustesOperacion'>
export type ValoresAjustesOperacion = paths['/api/v1/ajustes-operacion']['put']['requestBody']['content']['application/json']['valores']

/**
 * Ajustes de operación (A1, decisiones 17, 19, 22, 28 y 31): globales («Todas las empresas», sin
 * `empresa_id`) o de una empresa (solo las claves `por_empresa`). Lo de la empresa manda sobre lo
 * global y lo global sobre el valor de fábrica.
 */
export function useAjustesOperacion() {
    const api = useApi()

    /** `GET /ajustes-operacion` (`ajustes_operacion.ver`): con `efectivo`, `global`, `empresa`, `fabrica` y `definiciones`. */
    function ver(empresaId: number | null): Promise<Resultado<AjustesOperacion>> {
        return resolver(api.GET('/api/v1/ajustes-operacion', { params: { query: empresaId ? { empresa_id: empresaId } : {} } }))
    }

    /**
     * `PUT /ajustes-operacion` (`ajustes_operacion.editar`): `null` borra el valor guardado (vuelve al
     * global o al de fábrica); 422 por clave (`valores.<clave>`) si no cumple sus límites.
     */
    function guardar(empresaId: number | null, valores: ValoresAjustesOperacion): Promise<Resultado<AjustesOperacion>> {
        return resolver(api.PUT('/api/v1/ajustes-operacion', { body: { ...(empresaId ? { empresa_id: empresaId } : {}), valores } }))
    }

    return { ver, guardar }
}
