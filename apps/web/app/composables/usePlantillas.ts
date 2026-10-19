import type { Schema } from '@argosisp/contracts'

export type PlantillaFacturacion = Schema<'PlantillaFacturacion'>

/** Plantillas de facturación (ciclo, corte, mora, reglas de promesas). */
export function usePlantillas() {
    const api = useApi()

    function listar(): Promise<Resultado<PlantillaFacturacion[]>> {
        return resolver(api.GET('/api/v1/plantillas-facturacion'))
    }

    /**
     * `PUT /plantillas-facturacion/:id` (`plantillas.editar`) solo con el momento de certificar
     * (`certificar_al`) y la `version` leída; 409 si otra persona la cambió.
     */
    function cambiarCertificarAl(plantilla: Pick<PlantillaFacturacion, 'id' | 'version'>, certificarAl: PlantillaFacturacion['certificar_al']): Promise<Resultado<PlantillaFacturacion>> {
        return resolver(api.PUT('/api/v1/plantillas-facturacion/{id}', {
            params: { path: { id: plantilla.id } },
            body: { version: plantilla.version, certificar_al: certificarAl },
        }))
    }

    return { listar, cambiarCertificarAl }
}
