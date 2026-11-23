import type { Schema, paths } from '@argosisp/contracts'

export type EnvioReporte = Schema<'EnvioReporte'>
export type CorridaEnvioReporte = Schema<'CorridaEnvioReporte'>
export type CambiosEnvioReporte = paths['/api/v1/reportes/envios/{id}']['put']['requestBody']['content']['application/json']

/**
 * Envíos programados de reportes por correo (A3, decisión 6 del PM): de las empresas de la
 * petición (los consolidados, solo con alcance global). Se programan desde cada reporte; aquí se
 * ven, se pausan o se reanudan y se revisan sus corridas.
 */
export function useEnviosReportes() {
    const api = useApi()

    /** `GET /reportes/envios` (`reportes.programar_envio`). */
    function listar(): Promise<Resultado<EnvioReporte[]>> {
        return resolver(api.GET('/api/v1/reportes/envios')).then(r => (r.ok ? { ok: true, data: r.data.data } : r))
    }

    /** `GET /reportes/envios/:id/corridas` (`reportes.programar_envio`): las últimas, quién recibió y por qué se omitió a los demás. */
    function corridas(id: number, limit = 5): Promise<Resultado<CorridaEnvioReporte[]>> {
        return resolver(api.GET('/api/v1/reportes/envios/{id}/corridas', { params: { path: { id }, query: { limit } } })).then(r => (r.ok ? { ok: true, data: r.data.data } : r))
    }

    /**
     * Pausar o reanudar (`PUT /reportes/envios/:id`, `reportes.editar_envio`): el PUT pide el
     * envío completo, así que se manda tal como está con solo `activo` cambiado. 409 si `version` cambió.
     */
    function cambiarActivo(envio: EnvioReporte, activo: boolean): Promise<Resultado<EnvioReporte>> {
        const cuerpo: CambiosEnvioReporte = {
            nombre: envio.nombre,
            filtros: envio.filtros as CambiosEnvioReporte['filtros'],
            formato: envio.formato,
            frecuencia: envio.frecuencia,
            dia: envio.dia,
            hora: envio.hora,
            destinatarios: {
                usuarios: envio.destinatarios.flatMap(d => (d.tipo === 'usuario' && d.usuario_id !== null ? [d.usuario_id] : [])),
                correos_externos: envio.destinatarios.flatMap(d => (d.tipo === 'correo_externo' && d.correo_externo_id !== null ? [d.correo_externo_id] : [])),
            },
            activo,
            version: envio.version,
        }
        return resolver(api.PUT('/api/v1/reportes/envios/{id}', {
            params: { path: { id: envio.id }, header: { 'Idempotency-Key': nuevaClaveIdempotencia() } },
            body: cuerpo,
        }))
    }

    return { listar, corridas, cambiarActivo }
}
