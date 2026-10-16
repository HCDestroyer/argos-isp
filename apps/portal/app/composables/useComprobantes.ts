import type { Schema, paths } from '@argosisp/contracts'

export type ComprobantePortal = Schema<'PortalComprobante'>
export type BancoPortal = Schema<'PortalBanco'>
export type CamposComprobante = paths['/api/v1/portal/comprobantes']['post']['requestBody']['content']['application/json']

/** Comprobantes de depósito del cliente de la sesión (lista de `/cuenta`, con estado y motivo). */
export function useComprobantes() {
    const api = useApi()
    return useListaCursor<ComprobantePortal>(cursor => resolver(api.GET('/api/v1/portal/comprobantes', {
        params: { query: { limit: LIMITE_LISTA_PORTAL, ...(cursor ? { cursor } : {}) } },
    })))
}

/**
 * Subir un comprobante (tarea 5): `POST /portal/comprobantes` en `multipart/form-data`. La acción
 * es de A3 (`RegistrarComprobante`, canal `portal`); el portal solo arma el formulario.
 *
 * Sin `servicio_id` el cliente se identifica por la IP de origen (`/corte`); con `servicio_id`,
 * por la sesión del portal (`/cuenta`). El OpenAPI declara los campos como JSON (el generador aún
 * no conoce multipart): el tipo sale de ahí y `bodySerializer` arma el `FormData` con el archivo.
 */
export function useSubirComprobante() {
    const api = useApi()

    function bancos(): Promise<Resultado<BancoPortal[]>> {
        return resolver(api.GET('/api/v1/portal/bancos'))
    }

    /** `clave` va en `Idempotency-Key`: la misma en los reintentos del mismo envío. */
    function subir(campos: CamposComprobante, archivo: File, clave: string): Promise<Resultado<ComprobantePortal>> {
        return resolver(api.POST('/api/v1/portal/comprobantes', {
            params: { header: { 'Idempotency-Key': clave } },
            body: campos,
            bodySerializer: (cuerpo) => {
                const formulario = new FormData()
                for (const [nombre, valor] of Object.entries(cuerpo)) {
                    if (valor !== undefined && valor !== null) {
                        formulario.append(nombre, String(valor))
                    }
                }
                formulario.append('archivo', archivo, archivo.name)
                return formulario
            },
            headers: { 'X-Canal': 'portal' },
        }))
    }

    return { bancos, subir }
}
