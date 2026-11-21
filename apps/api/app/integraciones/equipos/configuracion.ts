import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { descifrar } from '#shared/cifrado'

/**
 * Configuración de equipos por empresa (`integraciones.equipos_config`): SmartOLT (fibra) y GenieACS
 * (TR-069), decisión del PM del 21 nov 2026. Se lee de la base en cada operación (son pocas y
 * asíncronas): no hay caché que invalidar.
 *
 * - Los secretos (token de SmartOLT, clave de GenieACS) se guardan cifrados y nunca salen del
 *   proceso: la vista del panel los muestra como `***` (`vistaConfig`).
 * - **Capacidad = configurado + probado.** `gestionDeEmpresa` da `ftth` solo con SmartOLT con URL,
 *   token y la última prueba en ok; `tr069` igual con GenieACS; `wireless` cuando la empresa tiene la
 *   gestión encendida y al menos una de las dos probada (un CPE sin TR-069 solo recibe IP y
 *   activación). Cambiar la URL o el secreto borra la prueba (`ConfigurarEquipos`).
 * - `http://` solo con `EQUIPOS_PERMITIR_HTTP=true` (laboratorio y pruebas; GenieACS en la LAN del
 *   servidor puede ir por la red interna de Docker). En producción, `https://`.
 */

export const TABLA_CONFIG = 'integraciones.equipos_config'
export const TABLA_PERFILES = 'integraciones.equipos_perfiles'

export interface FilaConfigEquipos {
    empresa_id: number
    activo: boolean
    smartolt_url: string | null
    smartolt_token_cifrado: string | null
    smartolt_probado_en: Date | null
    smartolt_prueba_ok: boolean | null
    smartolt_prueba_error: string | null
    genieacs_url: string | null
    genieacs_usuario: string | null
    genieacs_clave_cifrada: string | null
    genieacs_probado_en: Date | null
    genieacs_prueba_ok: boolean | null
    genieacs_prueba_error: string | null
    pppoe_por_acs: boolean
    version: number
    created_at: Date
    updated_at: Date
}

/** Credenciales en claro de SmartOLT. Nunca salen del proceso. */
export interface ConfigSmartOlt {
    url: string
    token: string
}

/** Credenciales en claro de GenieACS (usuario y clave del proxy con autenticación básica). */
export interface ConfigGenieAcs {
    url: string
    usuario: string | null
    clave: string | null
}

export interface ConfigEquipos {
    empresaId: number
    activo: boolean
    smartolt: ConfigSmartOlt | null
    genieacs: ConfigGenieAcs | null
    smartoltProbado: boolean
    genieacsProbado: boolean
    pppoePorAcs: boolean
}

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

function descifrarCampo(valor: string | null, campo: string, empresaId: number): string | null {
    if (valor === null) return null
    try {
        return descifrar(valor)
    } catch {
        logger.error({ campo, empresaId }, 'equipos: no se pudo descifrar un secreto (¿cambió AAA_PPP_KEY?)')
        return null
    }
}

export async function leerFilaConfig(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<FilaConfigEquipos | null> {
    return ((await cliente.from(TABLA_CONFIG).where('empresa_id', empresaId).first()) ??
        null) as FilaConfigEquipos | null
}

export function desdeFila(fila: FilaConfigEquipos | null, empresaId: number): ConfigEquipos {
    if (!fila) {
        return {
            empresaId,
            activo: false,
            smartolt: null,
            genieacs: null,
            smartoltProbado: false,
            genieacsProbado: false,
            pppoePorAcs: false,
        }
    }
    const token = descifrarCampo(fila.smartolt_token_cifrado, 'smartolt_token', empresaId)
    const smartolt = fila.smartolt_url && token ? { url: fila.smartolt_url, token } : null
    const genieacs = fila.genieacs_url
        ? {
              url: fila.genieacs_url,
              usuario: fila.genieacs_usuario,
              clave: descifrarCampo(fila.genieacs_clave_cifrada, 'genieacs_clave', empresaId),
          }
        : null
    return {
        empresaId,
        activo: fila.activo,
        smartolt,
        genieacs,
        smartoltProbado: Boolean(smartolt && fila.smartolt_prueba_ok),
        genieacsProbado: Boolean(genieacs && fila.genieacs_prueba_ok),
        pppoePorAcs: fila.pppoe_por_acs,
    }
}

export async function configDeEmpresa(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ConfigEquipos> {
    return desdeFila(await leerFilaConfig(empresaId, cliente), empresaId)
}

export interface GestionEmpresa {
    ftth: boolean
    wireless: boolean
    tr069: boolean
}

/** Qué gestiona Argos en una empresa (§4.3): configurado, encendido y probado. */
export function gestionDe(config: ConfigEquipos): GestionEmpresa {
    if (!config.activo) return { ftth: false, wireless: false, tr069: false }
    const ftth = config.smartoltProbado
    const tr069 = config.genieacsProbado
    return { ftth, tr069, wireless: ftth || tr069 }
}

export interface PerfilOlt {
    id: number
    smartolt_olt_id: string
    plan_id: number | null
    authorization_preset_id: number
    pon_type: 'gpon' | 'epon'
}

export async function perfilesDeEmpresa(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PerfilOlt[]> {
    const filas = (await cliente
        .from(TABLA_PERFILES)
        .where('empresa_id', empresaId)
        .orderBy('id')
        .select('id', 'smartolt_olt_id', 'plan_id', 'authorization_preset_id', 'pon_type')) as PerfilOlt[]
    return filas.map((f) => ({
        ...f,
        id: Number(f.id),
        plan_id: f.plan_id === null ? null : Number(f.plan_id),
        authorization_preset_id: Number(f.authorization_preset_id),
    }))
}

/** El perfil de esa OLT para el plan; si no hay, el de la OLT para cualquier plan. */
export function perfilPara(perfiles: PerfilOlt[], oltId: string, planId: number): PerfilOlt | null {
    return (
        perfiles.find((p) => p.smartolt_olt_id === oltId && p.plan_id === planId) ??
        perfiles.find((p) => p.smartolt_olt_id === oltId && p.plan_id === null) ??
        null
    )
}

/** Vista del panel: nunca los secretos (`***` si hay, null si no). */
export interface VistaConfigEquipos {
    empresa_id: number
    activo: boolean
    smartolt: {
        url: string | null
        token: '***' | null
        probado_en: string | null
        prueba_ok: boolean | null
        prueba_error: string | null
    }
    genieacs: {
        url: string | null
        usuario: string | null
        clave: '***' | null
        probado_en: string | null
        prueba_ok: boolean | null
        prueba_error: string | null
    }
    pppoe_por_acs: boolean
    perfiles: Array<Omit<PerfilOlt, 'id'>>
    capacidades: GestionEmpresa
    version: number
}

export async function vistaConfig(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<VistaConfigEquipos> {
    const fila = await leerFilaConfig(empresaId, cliente)
    const perfiles = await perfilesDeEmpresa(empresaId, cliente)
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null)
    return {
        empresa_id: empresaId,
        activo: fila?.activo ?? false,
        smartolt: {
            url: fila?.smartolt_url ?? null,
            token: fila?.smartolt_token_cifrado ? '***' : null,
            probado_en: iso(fila?.smartolt_probado_en ?? null),
            prueba_ok: fila?.smartolt_prueba_ok ?? null,
            prueba_error: fila?.smartolt_prueba_error ?? null,
        },
        genieacs: {
            url: fila?.genieacs_url ?? null,
            usuario: fila?.genieacs_usuario ?? null,
            clave: fila?.genieacs_clave_cifrada ? '***' : null,
            probado_en: iso(fila?.genieacs_probado_en ?? null),
            prueba_ok: fila?.genieacs_prueba_ok ?? null,
            prueba_error: fila?.genieacs_prueba_error ?? null,
        },
        pppoe_por_acs: fila?.pppoe_por_acs ?? false,
        perfiles: perfiles.map(({ id: _id, ...resto }) => resto),
        capacidades: gestionDe(desdeFila(fila, empresaId)),
        version: fila?.version ?? 0,
    }
}
