import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { descifrar } from '#shared/cifrado'
import { acsDeEmpresa, type AcsEmpresa } from '#integraciones/equipos/acs'
import { instanciasDeEmpresa, type InstanciaSmartOlt } from '#integraciones/equipos/smartolt_instancias'

/**
 * Configuración común de equipos (`contratos/equipos-olt-acs.md`): SmartOLT y el ACS van por separado.
 *
 * - ACS (GenieACS): uno por empresa en `integraciones.acs_config` (`#integraciones/equipos/acs`).
 * - SmartOLT: 0..n instancias por empresa (o compartidas) con sus OLT
 *   (`#integraciones/equipos/smartolt_instancias`).
 * - Aquí quedan `normalizarUrl`, `permiteHttp`, el descifrado y `gestionDe` (§4.1): cada marca mira solo
 *   su sistema; no hay un `activo` común. Se lee de la base en cada operación: no hay caché que invalidar.
 * - `http://` solo con `EQUIPOS_PERMITIR_HTTP=true` (laboratorio y pruebas). En producción, `https://`.
 */

/** Credenciales en claro de una instancia de SmartOLT. Nunca salen del proceso. */
export interface ConfigSmartOlt {
    url: string
    token: string
}

export type { ConfigGenieAcs } from '#integraciones/equipos/acs'

export function permiteHttp(): boolean {
    const valor = process.env.EQUIPOS_PERMITIR_HTTP
    return valor === 'true' || valor === '1'
}

/**
 * Origen (`https://host[:puerto]`, sin barra final) de SmartOLT o GenieACS, o el error para la
 * persona. SmartOLT se escribe como `https://<subdominio>.smartolt.com` (se tolera `/api` al final);
 * GenieACS como la URL del NBI (`http://acs.lan:7557` o el proxy `https://acs.isp.gt/nbi`).
 */
export function normalizarUrl(
    valor: string,
    sistema: 'smartolt' | 'genieacs',
): { url: string; error: null } | { url: null; error: string } {
    let url: URL
    try {
        url = new URL(valor)
    } catch {
        return { url: null, error: 'No es una URL válida' }
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && permiteHttp())) {
        return {
            url: null,
            error:
                url.protocol === 'http:'
                    ? 'Solo https:// (http:// solo en laboratorio con EQUIPOS_PERMITIR_HTTP)'
                    : 'Solo https://',
        }
    }
    if (url.username || url.password) {
        return { url: null, error: 'La URL no lleva usuario ni contraseña: van en sus campos' }
    }
    if (url.search || url.hash) return { url: null, error: 'La URL no lleva consulta ni fragmento' }
    let ruta = url.pathname.replace(/\/+$/, '')
    if (sistema === 'smartolt') {
        if (ruta === '/api') ruta = ''
        if (ruta !== '') {
            return { url: null, error: 'La URL de SmartOLT es https://<subdominio>.smartolt.com' }
        }
    }
    return { url: `${url.origin}${ruta}`, error: null }
}

/** Descifra un secreto guardado; null (y un error en el log, sin el valor) si no se puede. */
export function descifrarCampo(
    valor: string | null,
    campo: string,
    empresaId: number | null,
    instanciaId: number | null = null,
): string | null {
    if (valor === null) return null
    try {
        return descifrar(valor)
    } catch {
        logger.error(
            { campo, empresaId, instanciaId },
            'equipos: no se pudo descifrar un secreto (¿cambió AAA_PPP_KEY?)',
        )
        return null
    }
}

export interface GestionEmpresa {
    ftth: boolean
    wireless: boolean
    tr069: boolean
}

/**
 * Qué gestiona Argos en una empresa (§4.1):
 * - `ftth`: al menos una instancia de SmartOLT **operativa** (suya o compartida);
 * - `tr069`: el ACS de la empresa encendido y probado;
 * - `wireless`: `ftth || tr069` (P2 sigue abierta: se conserva el valor de antes).
 */
export async function gestionDe(
    empresaId: number | null,
    cliente: QueryClientContract = db.connection(),
): Promise<GestionEmpresa> {
    if (empresaId === null) return { ftth: false, wireless: false, tr069: false }
    const instancias = await instanciasDeEmpresa(empresaId, cliente)
    const acs = await acsDeEmpresa(empresaId, cliente)
    return gestionCon(instancias, acs)
}

export function gestionCon(instancias: InstanciaSmartOlt[], acs: AcsEmpresa): GestionEmpresa {
    const ftth = instancias.some((i) => i.operativa)
    const tr069 = acs.operativo
    return { ftth, tr069, wireless: ftth || tr069 }
}
