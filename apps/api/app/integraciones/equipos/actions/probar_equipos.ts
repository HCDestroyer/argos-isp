import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import {
    TABLA_CONFIG,
    desdeFila,
    gestionDe,
    type FilaConfigEquipos,
} from '#integraciones/equipos/configuracion'
import * as smartolt from '#integraciones/equipos/smartolt'
import * as genieacs from '#integraciones/equipos/genieacs'

export interface ResultadoSistema {
    ok: boolean
    latencia_ms: number | null
    error: string | null
    /** SmartOLT: las OLT que ve el token (id y nombre), para llenar los perfiles */
    olts?: Array<{ id: string; name: string }>
}

export interface ResultadoProbarEquipos {
    probado_en: string
    smartolt: ResultadoSistema | null
    genieacs: ResultadoSistema | null
    capacidades: { ftth: boolean; wireless: boolean; tr069: boolean }
}

async function medir<T>(
    fn: () => Promise<T>,
): Promise<{ ok: boolean; valor: T | null; error: string | null; ms: number }> {
    const inicio = Date.now()
    try {
        return { ok: true, valor: await fn(), error: null, ms: Date.now() - inicio }
    } catch (error) {
        return {
            ok: false,
            valor: null,
            error: (error as Error).message.slice(0, 500),
            ms: Date.now() - inicio,
        }
    }
}

/**
 * `equipos.probar`: «Probar conexión» de la empresa activa con la configuración **guardada**.
 *
 * - SmartOLT: `GET /api/system/get_olts` con el token (una sola llamada a pedido; SmartOLT pide
 *   no usarla como latido). Devuelve las OLT para armar los perfiles.
 * - GenieACS: una búsqueda de un dispositivo en el NBI con la autenticación básica guardada.
 * - Guarda el resultado de cada sistema (`*_probado_en`, `*_prueba_ok`, `*_prueba_error`) sin tocar
 *   la `version`: de eso sale `capacidades.aprovisionamiento`. No lanza si un sistema falla: devuelve
 *   el error real (sin secretos).
 */
export default class ProbarEquipos extends DomainAction<Record<string, never>, ResultadoProbarEquipos> {
    readonly nombre = 'equipos.probar'

    protected async handle(_input: Record<string, never>, t: Transaccion): Promise<ResultadoProbarEquipos> {
        const empresaId = exigirEmpresaActivaDelContexto(t.ctx)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('configuracion_equipos', empresaId)
        const fila = ((await t.trx.from(TABLA_CONFIG).where('empresa_id', empresaId).first()) ??
            null) as FilaConfigEquipos | null
        const config = desdeFila(fila, empresaId)
        const ahora = new Date()
        const cambios: Record<string, unknown> = {}

        let so: ResultadoSistema | null = null
        if (config.smartolt) {
            const r = await medir(() => smartolt.listarOlts(config.smartolt!))
            so = { ok: r.ok, latencia_ms: r.ms, error: r.error, ...(r.valor ? { olts: r.valor } : {}) }
            Object.assign(cambios, {
                smartolt_probado_en: ahora,
                smartolt_prueba_ok: r.ok,
                smartolt_prueba_error: r.error,
            })
        }
        let acs: ResultadoSistema | null = null
        if (config.genieacs) {
            const r = await medir(() => genieacs.probar(config.genieacs!))
            acs = { ok: r.ok, latencia_ms: r.ms, error: r.error }
            Object.assign(cambios, {
                genieacs_probado_en: ahora,
                genieacs_prueba_ok: r.ok,
                genieacs_prueba_error: r.error,
            })
        }
        if (fila && Object.keys(cambios).length > 0) {
            await t.trx.from(TABLA_CONFIG).where('empresa_id', empresaId).update(cambios)
        }
        const despues = desdeFila(fila ? ({ ...fila, ...cambios } as FilaConfigEquipos) : null, empresaId)
        return {
            probado_en: ahora.toISOString(),
            smartolt: so,
            genieacs: acs,
            capacidades: gestionDe(despues),
        }
    }
}
