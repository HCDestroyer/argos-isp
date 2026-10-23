import type { Schema } from '@argosisp/contracts'

export type ComparadorRegimenes = Schema<'ComparadorRegimenes'>
export type ComparadorEmpresa = ComparadorRegimenes['empresas'][number]

/**
 * Comparador de regímenes (A3, fase 8 PR B; contrato de localización fiscal §22). Es una simulación:
 * no escribe nada ni cambia el régimen (eso es `POST /fiscal/regimen`, en Configuración → Fiscal). Una
 * sección por empresa (con «Todas», todas) con seis bloques calculados por separado; uno cuyo insumo
 * falló trae 422 `bloque_dependiente`.
 */
export function useComparadorRegimenes() {
    const api = useApi()

    /**
     * `GET /fiscal/comparador?crecimiento=` (`fiscal.ver`): `crecimiento` en por ciento mensual (hasta 2
     * decimales, mayor que −100; 422 si no); sin él, la tendencia de los meses leídos.
     */
    function comparar(crecimiento?: string): Promise<Resultado<ComparadorRegimenes>> {
        return resolver(api.GET('/api/v1/fiscal/comparador', { params: { query: crecimiento ? { crecimiento } : {} } }))
    }

    return { comparar }
}
