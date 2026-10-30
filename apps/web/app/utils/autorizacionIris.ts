import type { Problem, Schema, paths } from '@argosisp/contracts'

/**
 * «Conectar con un botón» (`contratos/iris.md` §1.4, API de A1): Iris abre
 * `/integraciones/iris/autorizar?iris=&state=&code_challenge=&code_challenge_method=S256` y el admin
 * aprueba o rechaza. Aquí van las reglas puras de la pantalla, para probarlas sin montarla.
 */

export type VistaPreviaAutorizacionIris = Schema<'VistaPreviaAutorizacionIris'>
export type AutorizacionIris = Schema<'AutorizacionIris'>
export type DatosAutorizarIris = paths['/api/v1/integraciones/iris/autorizar']['post']['requestBody']['content']['application/json']

/** Ruta de Iris a la que vuelve el panel tras aprobar o rechazar (la misma que arma la API). */
export const RUTA_VUELTA_IRIS = '/administracion/integraciones/argos/vuelta'

/** Los cuatro parámetros que manda Iris, ya leídos de la query. */
export interface ParametrosAutorizacionIris {
    iris: string
    state: string
    code_challenge: string
    code_challenge_method: 'S256'
}

export type LecturaParametrosIris
    = | { ok: true, parametros: ParametrosAutorizacionIris }
        | { ok: false, motivo: 'incompleto' | 'metodo', faltan: string[] }

type ValorQuery = string | null | undefined | (string | null)[]

function textoDe(valor: ValorQuery): string {
    const unico = Array.isArray(valor) ? valor[0] : valor
    return typeof unico === 'string' ? unico.trim() : ''
}

/**
 * Lee los parámetros de la query. Faltan → «enlace incompleto» (y no se llama a la API); un método
 * distinto de S256 tampoco se manda, porque la API solo acepta S256.
 */
export function leerParametrosAutorizacion(query: Record<string, ValorQuery>): LecturaParametrosIris {
    const iris = textoDe(query.iris)
    const state = textoDe(query.state)
    const challenge = textoDe(query.code_challenge)
    const metodo = textoDe(query.code_challenge_method)
    const faltan = ([['iris', iris], ['state', state], ['code_challenge', challenge], ['code_challenge_method', metodo]] as const)
        .filter(([, valor]) => valor === '')
        .map(([nombre]) => nombre)
    if (faltan.length) {
        return { ok: false, motivo: 'incompleto', faltan }
    }
    if (metodo !== 'S256') {
        return { ok: false, motivo: 'metodo', faltan: [] }
    }
    return { ok: true, parametros: { iris, state, code_challenge: challenge, code_challenge_method: 'S256' } }
}

/** `iris.isp.gt` o `iris.isp.gt:8443` de `https://iris.isp.gt[:puerto]`: lo que el admin escribe. */
export function hostDeOrigen(origen: string): string {
    try {
        return new URL(origen).host
    }
    catch {
        return ''
    }
}

/** Igual que `origenConfirmado` de la API: el host (con puerto si lo lleva), sin distinguir mayúsculas. */
export function dominioCoincide(origen: string, escrito: string): boolean {
    const host = hostDeOrigen(origen)
    return host !== '' && escrito.trim().toLowerCase() === host.toLowerCase()
}

/** Rechazar: vuelve a Iris sin llamar a la API, con el `state` en el fragmento (nunca en la query). */
export function urlRechazoIris(origen: string, state: string): string {
    return `${origen}${RUTA_VUELTA_IRIS}#error=rechazado&state=${encodeURIComponent(state)}`
}

/**
 * Solo se navega a una URL de vuelta dentro del origen que el admin vio y aprobó. La API ya la arma
 * así; esto evita salir del panel hacia otro lado si alguna vez no fuera así.
 */
export function destinoDentroDeIris(destino: string, origen: string): boolean {
    try {
        const url = new URL(destino)
        return url.origin === origen && url.pathname === RUTA_VUELTA_IRIS
    }
    catch {
        return false
    }
}

/** Texto de las empresas que verá Iris (`alcance_global` o la lista). */
export function textoEmpresasIris(vista: VistaPreviaAutorizacionIris): string {
    if (vista.alcance_global) {
        return 'Todas las empresas, también las futuras'
    }
    return vista.empresas.length === 1 ? '1 empresa' : `${vista.empresas.length} empresas`
}

/** Sin `iris.configurar`: nunca se redirige a Iris. */
export const MENSAJE_SIN_PERMISO_IRIS = 'Pídele a un administrador que apruebe esta conexión desde su usuario, o que te dé el permiso iris.configurar.'

/** Mensaje en español de un error de la vista previa o de «Aprobar». */
export interface MensajeAutorizacionIris {
    titulo: string
    detalle: string
    /** Error de red o del servidor: se puede volver a intentar tal cual. */
    reintentable: boolean
}

export function mensajeErrorAutorizacion(problema: Problem): MensajeAutorizacionIris {
    const codigo = codigoProblema(problema)
    if (problema.status === 0) {
        return { titulo: 'Sin conexión con Argos', detalle: 'No se pudo contactar al servidor. Revisa tu conexión e intenta de nuevo.', reintentable: true }
    }
    if (problema.status === 403) {
        return { titulo: 'Sin permiso para conectar Iris', detalle: MENSAJE_SIN_PERMISO_IRIS, reintentable: false }
    }
    if (problema.status === 422) {
        switch (codigo) {
            case 'iris_origen_invalido':
                return { titulo: 'La dirección de Iris no es válida', detalle: `${problema.detail ?? 'La dirección de Iris del enlace no es válida.'} Vuelve a pulsar «Conectar con Argos» en Iris.`, reintentable: false }
            case 'iris_origen_no_confirmado':
                return { titulo: 'Confirma el dominio de Iris', detalle: 'Escribe el dominio de Iris tal como aparece arriba para aprobar la conexión.', reintentable: false }
            case 'code_challenge_invalido':
                return { titulo: 'El enlace de Iris no es válido', detalle: 'Su código de verificación no tiene el formato esperado. Vuelve a pulsar «Conectar con Argos» en Iris.', reintentable: false }
            default: {
                const campos = (problema.errors ?? []).map(error => error.message).filter(Boolean)
                return {
                    titulo: 'El enlace de Iris no es válido',
                    detalle: `${campos.length ? `${campos.join('. ')}. ` : ''}Vuelve a pulsar «Conectar con Argos» en Iris.`,
                    reintentable: false,
                }
            }
        }
    }
    return { titulo: problema.title, detalle: problema.detail ?? 'Intenta de nuevo en un momento.', reintentable: problema.status >= 500 || problema.status === 0 }
}
