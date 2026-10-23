import type { Schema, paths } from '@argosisp/contracts'

export type CierreAnual = Schema<'CierreAnual'>
export type CuerpoCerrarEjercicio = paths['/api/v1/libro/ejercicios/cerrar']['post']['requestBody']['content']['application/json']
export type CuerpoReabrirEjercicio = paths['/api/v1/libro/ejercicios/reabrir']['post']['requestBody']['content']['application/json']

/**
 * Cierre anual del ejercicio (A3, fase 6 PR C y fase 7 PR C): cierres y reaperturas, cerrar (con el ISR de
 * la declaración ISR anual o escrito a mano) y reabrir. Consolidable con «Todas».
 */
export function useEjercicios() {
    const api = useApi()

    /** `GET /libro/ejercicios` (`libro.ver`): el más reciente primero. */
    function listar(cursor?: string): Promise<Resultado<Pagina<CierreAnual>>> {
        return resolver(api.GET('/api/v1/libro/ejercicios', { params: { query: { limit: 25, ...(cursor ? { cursor } : {}) } } }))
    }

    /**
     * `POST /libro/ejercicios/cerrar` (`libro.cerrar_ejercicio`): con declaración ISR anual sin `isr` (422
     * `isr_de_declaracion`, `declaracion_sin_revisar`; 409 `declaracion_desactualizada`); sin ella, con el
     * ISR escrito a mano. 422 `ejercicio_requisitos`, `isr_acreditable`; 409 `ejercicio_cerrado`.
     */
    function cerrar(cuerpo: CuerpoCerrarEjercicio, clave: string): Promise<Resultado<CierreAnual>> {
        return resolver(api.POST('/api/v1/libro/ejercicios/cerrar', { params: { header: { 'Idempotency-Key': clave } }, body: cuerpo }))
    }

    /** `POST /libro/ejercicios/reabrir` (`libro.reabrir_ejercicio`): 409 `ejercicio_abierto`, `reapertura_fuera_de_orden`. */
    function reabrir(cuerpo: CuerpoReabrirEjercicio, clave: string): Promise<Resultado<CierreAnual>> {
        return resolver(api.POST('/api/v1/libro/ejercicios/reabrir', { params: { header: { 'Idempotency-Key': clave } }, body: cuerpo }))
    }

    return { listar, cerrar, reabrir }
}
