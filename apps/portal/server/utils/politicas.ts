import type { H3Event } from 'h3'
import type { Schema } from '@argosisp/contracts'

/**
 * Páginas públicas de políticas (Política de privacidad, Términos del servicio e Instrucciones para
 * eliminar datos) que pide la revisión de apps de Meta. Se renderizan en el servidor con el texto
 * completo y los datos de la empresa ya puestos, para que el revisor y su rastreador las lean sin
 * JavaScript.
 */
export const RUTAS_POLITICAS = new Set(['/privacidad', '/terminos', '/eliminar-datos'])

/** Lo que la página recibe en `event.context.politicasEmpresa` (espejo de `Resultado` del portal). */
export type EmpresaPoliticas
    = | { ok: true, data: Schema<'EmpresaPublica'> }
        | { ok: false, status: number }

/** Espera máxima de la API antes de renderizar la página sin los datos de la empresa. */
const ESPERA_EMPRESA_MS = 5_000

/** `?empresa=<id>` válido (como `/contacto`), o null. */
export function empresaDeLaConsulta(valor: unknown): number | null {
    const numero = Number(Array.isArray(valor) ? valor[0] : valor)
    return Number.isSafeInteger(numero) && numero > 0 ? numero : null
}

/**
 * `GET /portal/empresa` desde el servidor del portal con las mismas cabeceras que el proxy del
 * navegador (`cabecerasReenvio`: IP de origen o token del nodo) y la cookie de la sesión, si la hay.
 * Así la API resuelve la misma empresa que vería el navegador: con `empresaId`, esa; sin él, la del
 * servicio de la IP de origen, si no la principal del cliente de la sesión, si no la principal de
 * la instalación (la que verá el revisor de Meta, que llega desde fuera de la red).
 */
export async function leerEmpresaPoliticas(event: H3Event, empresaId: number | null): Promise<EmpresaPoliticas> {
    const { apiBaseInternal, nodoPortalToken, portal } = useRuntimeConfig(event)
    const token = String(nodoPortalToken ?? '').trim()
    if (!apiBaseInternal || (token && !apiAdmiteToken(apiBaseInternal))) {
        return { ok: false, status: 502 }
    }
    const headers = cabecerasReenvio({
        token,
        proxiesConfiables: String(portal?.proxiesConfiables ?? ''),
        ipSocket: getRequestIP(event),
        protoSocket: getRequestProtocol(event, { xForwardedProto: false }),
        xff: token ? undefined : getRequestHeader(event, 'x-forwarded-for'),
        xfProto: token ? undefined : getRequestHeader(event, 'x-forwarded-proto'),
        host: getRequestHost(event, { xForwardedHost: false }),
    })
    const cookie = getRequestHeader(event, 'cookie')
    if (cookie) {
        headers.cookie = cookie
    }
    try {
        const data = await $fetch<Schema<'EmpresaPublica'>>(`${apiBaseInternal.replace(/\/$/, '')}/api/v1/portal/empresa`, {
            headers,
            query: empresaId === null ? {} : { empresa_id: empresaId },
            signal: AbortSignal.timeout(ESPERA_EMPRESA_MS),
        })
        if (!data || typeof data.nombre !== 'string') {
            return { ok: false, status: 502 }
        }
        return { ok: true, data }
    }
    catch (error) {
        const status = Number((error as { statusCode?: unknown } | null)?.statusCode)
        return { ok: false, status: Number.isInteger(status) && status > 0 ? status : 502 }
    }
}
