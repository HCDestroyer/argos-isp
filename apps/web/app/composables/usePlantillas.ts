import type { Schema } from '@argosisp/contracts'

export type PlantillaFacturacion = Schema<'PlantillaFacturacion'>

/** Plantillas de facturación (ciclo, corte, mora, reglas de promesas). */
export function usePlantillas() {
    const api = useApi()

    function listar(): Promise<Resultado<PlantillaFacturacion[]>> {
        return resolver(api.GET('/api/v1/plantillas-facturacion'))
    }

    return { listar }
}
