import type { Schema, paths } from '@argosisp/contracts'

export type ConfiguracionInventario = Schema<'ConfiguracionInventario'>
export type ConfiguracionIa = Schema<'ConfiguracionIa'>
export type CuerpoConfiguracionIa = paths['/api/v1/inventario/ia/configuracion']['post']['requestBody']['content']['application/json']

/**
 * Configuración del inventario por empresa (A3, `contratos/inventario.md` D.1 y D.5): si la
 * recepción de traslados exige firma (`inventario.configurar`) y la IA que lee facturas de compra
 * (`inventario.configurar_ia`). La clave de la IA se escribe y nunca vuelve: la API solo dice
 * `clave_configurada`.
 */
export function useConfiguracionInventario() {
    const api = useApi()

    /** `GET /inventario/configuracion` (`inventario.ver`): sin fila, los valores por defecto (`version` 0). */
    function ver(): Promise<Resultado<ConfiguracionInventario>> {
        return resolver(api.GET('/api/v1/inventario/configuracion', { params: { query: {} } }))
    }

    function guardar(trasladoFirmaObligatoria: boolean, version: number, clave: string): Promise<Resultado<ConfiguracionInventario>> {
        return resolver(api.POST('/api/v1/inventario/configuracion', { params: { header: { 'Idempotency-Key': clave } }, body: { traslado_firma_obligatoria: trasladoFirmaObligatoria, version } }))
    }

    /** `GET /inventario/ia/configuracion` (`inventario.configurar_ia`): la de la empresa o, sin ella, la global. */
    function verIa(): Promise<Resultado<ConfiguracionIa>> {
        return resolver(api.GET('/api/v1/inventario/ia/configuracion', { params: { query: {} } }))
    }

    /** `POST /inventario/ia/configuracion`: sin `api_key` se conserva la clave; `null` la borra. */
    function guardarIa(cuerpo: CuerpoConfiguracionIa, clave: string): Promise<Resultado<ConfiguracionIa>> {
        return resolver(api.POST('/api/v1/inventario/ia/configuracion', { params: { header: { 'Idempotency-Key': clave } }, body: cuerpo }))
    }

    return { ver, guardar, verIa, guardarIa }
}
