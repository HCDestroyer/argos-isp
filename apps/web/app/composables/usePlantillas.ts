import type { Schema } from '@argosisp/contracts'

export type PlantillaFacturacion = Schema<'PlantillaFacturacion'>
export type VistaPreviaSinPlantilla = Schema<'VistaPreviaSinPlantilla'>
export type AsignacionSinPlantilla = Schema<'AsignacionSinPlantilla'>

/** Plantillas de facturación (ciclo, corte, mora, reglas de promesas). */
export function usePlantillas() {
    const api = useApi()

    function listar(): Promise<Resultado<PlantillaFacturacion[]>> {
        return resolver(api.GET('/api/v1/plantillas-facturacion'))
    }

    function ver(id: number): Promise<Resultado<PlantillaFacturacion>> {
        return resolver(api.GET('/api/v1/plantillas-facturacion/{id}', { params: { path: { id } } }))
    }

    /** `POST /plantillas-facturacion` (`plantillas.crear`); 422 por campo, también las reglas de coherencia. */
    function crear(datos: DatosPlantilla): Promise<Resultado<PlantillaFacturacion>> {
        return resolver(api.POST('/api/v1/plantillas-facturacion', { body: datos }))
    }

    /**
     * `PUT /plantillas-facturacion/:id` (`plantillas.editar`) con la `version` leída (409 si cambió).
     * `reglas_promesa` reemplaza el objeto completo. Las facturas ya emitidas no cambian.
     */
    function editar(id: number, cambios: CambiosPlantilla): Promise<Resultado<PlantillaFacturacion>> {
        return resolver(api.PUT('/api/v1/plantillas-facturacion/{id}', { params: { path: { id } }, body: cambios }))
    }

    /**
     * `PUT /plantillas-facturacion/:id` (`plantillas.editar`) solo con el momento de certificar
     * (`certificar_al`) y la `version` leída; 409 si otra persona la cambió.
     */
    function cambiarCertificarAl(plantilla: Pick<PlantillaFacturacion, 'id' | 'version'>, certificarAl: PlantillaFacturacion['certificar_al']): Promise<Resultado<PlantillaFacturacion>> {
        return editar(plantilla.id, { version: plantilla.version, certificar_al: certificarAl })
    }

    /**
     * Marca la plantilla como la de por defecto (`PUT` con `por_defecto: true` y la `version` leída,
     * `plantillas.editar`): la API desmarca la anterior. 409 si otra persona la cambió.
     */
    function marcarPorDefecto(plantilla: Pick<PlantillaFacturacion, 'id' | 'version'>): Promise<Resultado<PlantillaFacturacion>> {
        return editar(plantilla.id, { version: plantilla.version, por_defecto: true })
    }

    /**
     * `GET /plantillas-facturacion/:id/servicios-sin-plantilla` (`plantillas.asignar_sin_plantilla`):
     * vista previa de solo lectura. Su `total` va como `total_esperado` al asignar. 404 si no existe,
     * 409 `plantilla_retirada`.
     */
    function vistaPreviaSinPlantilla(id: number): Promise<Resultado<VistaPreviaSinPlantilla>> {
        return resolver(api.GET('/api/v1/plantillas-facturacion/{id}/servicios-sin-plantilla', { params: { path: { id } } }))
    }

    /**
     * `POST /plantillas-facturacion/:id/asignar-servicios-sin-plantilla` (`plantillas.asignar_sin_plantilla`)
     * con el `total` de la vista previa. 409 `total_cambiado` si el conjunto cambió (no asigna nada:
     * se vuelve a pedir la vista previa) y 409 `plantilla_retirada`. Nada se cobra hacia atrás.
     */
    function asignarSinPlantilla(id: number, totalEsperado: number, idempotencyKey: string): Promise<Resultado<AsignacionSinPlantilla>> {
        return resolver(api.POST('/api/v1/plantillas-facturacion/{id}/asignar-servicios-sin-plantilla', {
            params: { path: { id }, header: { 'Idempotency-Key': idempotencyKey } },
            body: { total_esperado: totalEsperado },
        }))
    }

    return { listar, ver, crear, editar, cambiarCertificarAl, marcarPorDefecto, vistaPreviaSinPlantilla, asignarSinPlantilla }
}
