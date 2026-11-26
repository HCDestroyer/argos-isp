import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { descifrarCampo } from '#integraciones/equipos/configuracion'

/**
 * ACS (GenieACS, TR-069) de la empresa: `integraciones.acs_config`, una fila por empresa (decisión del
 * PM, P7: un ACS por empresa; `contratos/equipos-olt-acs.md` §3.4). Independiente de SmartOLT: su
 * propio `activo`, su propia prueba y su propia `version`.
 *
 * - La clave se guarda cifrada y nunca sale del proceso (`***` en la vista).
 * - **Operativo** = encendido, con URL y la última prueba en ok. Cambiar URL, usuario, clave o
 *   certificado borra la prueba (`acs.configurar`).
 * - `pppoe_por_acs` es del ACS: solo aplica si el ACS está operativo.
 */

export const TABLA_ACS = 'integraciones.acs_config'

export interface FilaAcs {
    empresa_id: number
    activo: boolean
    url: string | null
    usuario: string | null
    clave_cifrada: string | null
    ca: string | null
    probado_en: Date | null
    prueba_ok: boolean | null
    prueba_error: string | null
    prueba_latencia_ms: number | null
    probado_por_id: number | null
    pppoe_por_acs: boolean
    version: number
    created_at: Date
    updated_at: Date
}

/** Credenciales en claro de GenieACS (usuario y clave del proxy con autenticación básica). */
export interface ConfigGenieAcs {
    url: string
    usuario: string | null
    clave: string | null
    /** certificado raíz propio (PEM) del proxy HTTPS del NBI, o null (autoridades del sistema) */
    ca: string | null
}

export interface AcsEmpresa {
    empresaId: number
    activo: boolean
    /** null sin URL */
    genieacs: ConfigGenieAcs | null
    /** encendido, con URL y la última prueba en ok */
    operativo: boolean
    pppoePorAcs: boolean
}

export async function leerFilaAcs(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<FilaAcs | null> {
    return ((await cliente.from(TABLA_ACS).where('empresa_id', empresaId).first()) ?? null) as FilaAcs | null
}

export function acsDesdeFila(fila: FilaAcs | null, empresaId: number): AcsEmpresa {
    if (!fila) return { empresaId, activo: false, genieacs: null, operativo: false, pppoePorAcs: false }
    const genieacs = fila.url
        ? {
              url: fila.url,
              usuario: fila.usuario,
              clave: descifrarCampo(fila.clave_cifrada, 'acs_clave', empresaId),
              ca: fila.ca ?? null,
          }
        : null
    return {
        empresaId,
        activo: fila.activo,
        genieacs,
        operativo: Boolean(fila.activo && genieacs && fila.prueba_ok),
        pppoePorAcs: fila.pppoe_por_acs,
    }
}

export async function acsDeEmpresa(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<AcsEmpresa> {
    return acsDesdeFila(await leerFilaAcs(empresaId, cliente), empresaId)
}

/** `ConfigAcs` del panel (§5.1): nunca la clave (`***` si hay, null si no). */
export interface VistaAcs {
    empresa_id: number
    activo: boolean
    operativo: boolean
    url: string | null
    usuario: string | null
    clave: '***' | null
    /** hay un certificado raíz propio guardado */
    ca: boolean
    probado_en: string | null
    prueba_ok: boolean | null
    prueba_error: string | null
    /** en cuánto respondió la última prueba */
    prueba_latencia_ms: number | null
    /** quién hizo la última prueba (nombre), o null */
    probado_por: string | null
    pppoe_por_acs: boolean
    /** 0 = nunca guardada */
    version: number
}

export async function vistaAcsDeFila(
    fila: FilaAcs | null,
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<VistaAcs> {
    return {
        empresa_id: empresaId,
        activo: fila?.activo ?? false,
        operativo: acsDesdeFila(fila, empresaId).operativo,
        url: fila?.url ?? null,
        usuario: fila?.usuario ?? null,
        clave: fila?.clave_cifrada ? '***' : null,
        ca: Boolean(fila?.ca),
        probado_en: fila?.probado_en ? new Date(fila.probado_en).toISOString() : null,
        prueba_ok: fila?.prueba_ok ?? null,
        prueba_error: fila?.prueba_error ?? null,
        prueba_latencia_ms: fila?.prueba_latencia_ms ?? null,
        probado_por: await nombreUsuario(fila?.probado_por_id ?? null, cliente),
        pppoe_por_acs: fila?.pppoe_por_acs ?? false,
        version: fila?.version ?? 0,
    }
}

export async function vistaAcs(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<VistaAcs> {
    return vistaAcsDeFila(await leerFilaAcs(empresaId, cliente), empresaId, cliente)
}

/** Nombre de un usuario (quién probó), o null. */
export async function nombreUsuario(id: number | null, cliente: QueryClientContract): Promise<string | null> {
    if (id === null) return null
    const fila = (await cliente.from('core.usuarios').where('id', id).select('nombre').first()) as {
        nombre: string
    } | null
    return fila?.nombre ?? null
}
