/**
 * Lista de verificación de cierre (A3, fase 6 PR B): los checks vigentes de un mes (o un año),
 * verificarlos y supervisar una anomalía con nota. La empresa es la activa (`X-Empresa-Id`); cada
 * acción manda su `Idempotency-Key`.
 */
export function useChecksCierre() {
    const api = useApi()

    /** `GET /libro/cierres/:tipo/:periodo/checks` (`libro.ver`): `periodo` AAAA-MM (o AAAA en los anuales). */
    function listar(tipo: TipoCheck, periodo: string, historial = false): Promise<Resultado<ChecksCierre>> {
        return resolver(api.GET('/api/v1/libro/cierres/{tipo}/{periodo}/checks', {
            params: { path: { tipo, periodo }, query: historial ? { historial: true } : {} },
        }))
    }

    /** `POST …/verificar` (`libro.cerrar_periodo`): corre los checks; fila nueva solo si el cálculo cambió. */
    function verificar(tipo: TipoCheck, periodo: string, claveIdempotencia: string): Promise<Resultado<VerificacionCierre>> {
        return resolver(api.POST('/api/v1/libro/cierres/{tipo}/{periodo}/verificar', {
            params: { path: { tipo, periodo }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: {},
        }))
    }

    /**
     * `POST /libro/cierres/checks/:id/revisar` (acción `cierres.revisar_check`, permiso
     * `libro.cerrar_periodo`): `supervisado` deja pasar el cierre con esa anomalía; `anomalia` retira la
     * supervisión. 409 `check_desactualizado`, 422 `check_en_orden`, 409 `check_sin_cambio`.
     */
    function revisar(id: number, estado: 'supervisado' | 'anomalia', nota: string, claveIdempotencia: string): Promise<Resultado<CheckCierre>> {
        return resolver(api.POST('/api/v1/libro/cierres/checks/{id}/revisar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { estado, nota },
        }))
    }

    return { listar, verificar, revisar }
}
