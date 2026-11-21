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
 * Servicio a cargo (A46, contrato Iris 0.12.1 §11.10): la persona pide como contacto del dueño.
 * Sin él, como titular.
 */
export interface ACargoTicket {
    contactoId: number
    servicioId: number
}

function consultaACargo(empresaId?: number, aCargo?: ACargoTicket) {
    if (aCargo) {
        return { contacto_id: aCargo.contactoId, servicio_id: aCargo.servicioId }
    }
    return empresaId ? { empresa_id: empresaId } : {}
}

/**
 * Tickets de soporte del cliente en Iris (`/portal/soporte/tickets`, contrato Iris 0.9.0 §11.3 a
 * §11.6). La lógica es de Iris; el portal solo arma las peticiones. `clave` va en `Idempotency-Key`:
 * un UUID por envío del formulario que se repite en los reintentos.
 */
export function useTickets() {
    const api = useApi()

    function lista(empresaId?: number, aCargo?: ACargoTicket) {
        return useListaCursor<TicketSoporte>(cursor => resolver(api.GET('/api/v1/portal/soporte/tickets', {
            params: { query: { limit: 20, ...consultaACargo(empresaId, aCargo), ...(cursor ? { cursor } : {}) } },
        })))
    }

    function categorias(empresaId?: number, aCargo?: ACargoTicket) {
        return resolver(api.GET('/api/v1/portal/soporte/categorias', {
            params: { query: consultaACargo(empresaId, aCargo) },
        }))
    }

    function ver(id: number, empresaId?: number, aCargo?: ACargoTicket) {
        return resolver(api.GET('/api/v1/portal/soporte/tickets/{ticketId}', {
            params: { path: { ticketId: id }, query: consultaACargo(empresaId, aCargo) },
        }))
    }

    function mensajes(id: number, empresaId?: number, aCargo?: ACargoTicket) {
        return useListaCursor<MensajeTicket>(cursor => resolver(api.GET('/api/v1/portal/soporte/tickets/{ticketId}/mensajes', {
            params: {
                path: { ticketId: id },
                query: { limit: 50, ...consultaACargo(empresaId, aCargo), ...(cursor ? { cursor } : {}) },
            },
        })))
    }

    /** Enlace de descarga de un adjunto (lo sirve Argos: mismo origen, cookie de la sesión). */
    function urlAdjunto(ticketId: number, adjuntoId: string, empresaId?: number, aCargo?: ACargoTicket): string {
        const consulta = new URLSearchParams(Object.entries(consultaACargo(empresaId, aCargo)).map(([k, v]) => [k, String(v)])).toString()
        return `/api/v1/portal/soporte/tickets/${ticketId}/adjuntos/${encodeURIComponent(adjuntoId)}${consulta ? `?${consulta}` : ''}`
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
        campos: { cuerpo: string, version?: number, empresa_id?: number, contacto_id?: number, servicio_id?: number },
        archivos: readonly File[],
        clave: string,
    ) {
        return resolver(api.POST('/api/v1/portal/soporte/tickets/{ticketId}/responder', {
            params: { path: { ticketId: id }, header: { 'Idempotency-Key': clave } },
            body: { ...campos, archivos: archivos[0]?.name ?? '' },
            bodySerializer: cuerpo => formulario(cuerpo as Record<string, unknown>, archivos),
        }))
    }

    function confirmar(id: number, version: number, empresaId?: number, aCargo?: ACargoTicket) {
        return resolver(api.POST('/api/v1/portal/soporte/tickets/{ticketId}/confirmar-solucion', {
            params: { path: { ticketId: id } },
            body: { version, ...consultaACargo(empresaId, aCargo) },
        }))
    }

    return { lista, categorias, ver, mensajes, urlAdjunto, abrir, responder, confirmar }
}
