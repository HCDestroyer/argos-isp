import type { Schema, paths } from '@argosisp/contracts'

export type CorreoExternoReportes = Schema<'CorreoExternoReportes'>
export type DatosCorreoExterno = paths['/api/v1/reportes/correos-externos']['post']['requestBody']['content']['application/json']

/**
 * Correos externos aprobados para los reportes contables programados (A3, decisión 6 del PM): un
 * contador o un socio. Solo el admin aprueba y retira; un retirado no se borra.
 */
export function useCorreosExternos() {
    const api = useApi()

    /** `GET /reportes/correos-externos` (`reportes.programar_envio`): activos y retirados. */
    function listar(): Promise<Resultado<CorreoExternoReportes[]>> {
        return resolver(api.GET('/api/v1/reportes/correos-externos')).then(r => (r.ok ? { ok: true, data: r.data.data ?? [] } : r))
    }

    /** `POST /reportes/correos-externos` (`reportes.aprobar_correo_externo`): reactiva uno retirado. */
    function aprobar(datos: DatosCorreoExterno): Promise<Resultado<CorreoExternoReportes>> {
        return resolver(api.POST('/api/v1/reportes/correos-externos', {
            params: { header: { 'Idempotency-Key': nuevaClaveIdempotencia() } },
            body: datos,
        }))
    }

    /** `POST /reportes/correos-externos/:id/retirar` (`reportes.retirar_correo_externo`): deja de recibir desde el siguiente envío. */
    function retirar(id: number): Promise<Resultado<CorreoExternoReportes>> {
        return resolver(api.POST('/api/v1/reportes/correos-externos/{id}/retirar', { params: { path: { id }, header: { 'Idempotency-Key': nuevaClaveIdempotencia() } } }))
    }

    return { listar, aprobar, retirar }
}
