import type { paths } from '@argosisp/contracts'

type CuerpoTicket = paths['/api/v1/portal/soporte/tickets']['post']['requestBody']['content']['multipart/form-data']
/** Campos del formulario «Reportar un problema» (sin los archivos). */
export type CamposTicket = Omit<CuerpoTicket, 'archivos'>

/** Arma el `FormData`: los campos y cada archivo en la parte `archivos` (hasta 3). */
function formulario(campos: Record<string, unknown>, archivos: readonly File[]): FormData {
    const datos = new FormData()
    for (const [nombre, valor] of Object.entries(campos)) {
        if (nombre !== 'archivos' && valor !== undefined && valor !== null && valor !== '') {
            datos.append(nombre, String(valor))
        }
    }
    for (const archivo of archivos) {
        datos.append('archivos', archivo, archivo.name)
    }
    return datos
}

/**
 * Tickets de soporte del cliente en Iris (`/portal/soporte/tickets`, contrato Iris 0.9.0 §11.3 a
 * §11.6). La lógica es de Iris; el portal solo arma las peticiones. `clave` va en `Idempotency-Key`:
 * un UUID por envío del formulario que se repite en los reintentos.
 */
export function useTickets() {
    const api = useApi()

    function lista(empresaId?: number) {
        return useListaCursor<TicketSoporte>(cursor => resolver(api.GET('/api/v1/portal/soporte/tickets', {
            params: { query: { limit: 20, ...(empresaId ? { empresa_id: empresaId } : {}), ...(cursor ? { cursor } : {}) } },
        })))
    }

    function categorias(empresaId?: number) {
        return resolver(api.GET('/api/v1/portal/soporte/categorias', {
            params: { query: empresaId ? { empresa_id: empresaId } : {} },
        }))
    }

    function ver(id: number, empresaId?: number) {
        return resolver(api.GET('/api/v1/portal/soporte/tickets/{ticketId}', {
            params: { path: { ticketId: id }, query: empresaId ? { empresa_id: empresaId } : {} },
        }))
    }

    function mensajes(id: number, empresaId?: number) {
        return useListaCursor<MensajeTicket>(cursor => resolver(api.GET('/api/v1/portal/soporte/tickets/{ticketId}/mensajes', {
            params: {
                path: { ticketId: id },
                query: { limit: 50, ...(empresaId ? { empresa_id: empresaId } : {}), ...(cursor ? { cursor } : {}) },
            },
        })))
    }

    /** Enlace de descarga de un adjunto (lo sirve Argos: mismo origen, cookie de la sesión). */
    function urlAdjunto(ticketId: number, adjuntoId: string, empresaId?: number): string {
        const consulta = empresaId ? `?empresa_id=${empresaId}` : ''
        return `/api/v1/portal/soporte/tickets/${ticketId}/adjuntos/${encodeURIComponent(adjuntoId)}${consulta}`
    }

    function abrir(campos: CamposTicket, archivos: readonly File[], clave: string) {
        return resolver(api.POST('/api/v1/portal/soporte/tickets', {
            params: { header: { 'Idempotency-Key': clave } },
            body: { ...campos, archivos: archivos[0]?.name ?? '' },
            bodySerializer: cuerpo => formulario(cuerpo as Record<string, unknown>, archivos),
        }))
    }

    function responder(
        id: number,
        campos: { cuerpo: string, version?: number, empresa_id?: number },
        archivos: readonly File[],
        clave: string,
    ) {
        return resolver(api.POST('/api/v1/portal/soporte/tickets/{ticketId}/responder', {
            params: { path: { ticketId: id }, header: { 'Idempotency-Key': clave } },
            body: { ...campos, archivos: archivos[0]?.name ?? '' },
            bodySerializer: cuerpo => formulario(cuerpo as Record<string, unknown>, archivos),
        }))
    }

    function confirmar(id: number, version: number, empresaId?: number) {
        return resolver(api.POST('/api/v1/portal/soporte/tickets/{ticketId}/confirmar-solucion', {
            params: { path: { ticketId: id } },
            body: { version, ...(empresaId ? { empresa_id: empresaId } : {}) },
        }))
    }

    return { lista, categorias, ver, mensajes, urlAdjunto, abrir, responder, confirmar }
}
