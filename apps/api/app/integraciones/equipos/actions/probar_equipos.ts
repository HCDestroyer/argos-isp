import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { gestionDe } from '#integraciones/equipos/configuracion'
import { TABLA_ACS, acsDesdeFila, type FilaAcs } from '#integraciones/equipos/acs'
import { TABLA_INSTANCIAS, instanciaDesdeFila } from '#integraciones/equipos/smartolt_instancias'
import { instanciaPropia } from '#integraciones/equipos/actions/configurar_equipos'
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
 * `equipos.probar` (**compatibilidad**, se borra al terminar el lote 3 de `contratos/equipos-olt-acs.md`):
 * prueba la instancia propia de SmartOLT (`get_olts`) y el ACS de la empresa activa con lo guardado y
 * guarda el resultado de cada uno en su fila, sin tocar su `version`. No lanza si un sistema falla.
 */
export default class ProbarEquipos extends DomainAction<Record<string, never>, ResultadoProbarEquipos> {
    readonly nombre = 'equipos.probar'

    protected async handle(_input: Record<string, never>, t: Transaccion): Promise<ResultadoProbarEquipos> {
        const empresaId = exigirEmpresaActivaDelContexto(t.ctx)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('configuracion_equipos', empresaId)
        const ahora = new Date()

        let so: ResultadoSistema | null = null
        const inst = await instanciaPropia(t.trx, empresaId)
        const config = inst ? instanciaDesdeFila(inst).config : null
        if (inst && config) {
            const r = await medir(() => smartolt.listarOlts(config))
            so = {
                ok: r.ok,
                latencia_ms: r.ms,
                error: r.error,
                ...(r.valor ? { olts: r.valor.map((o) => ({ id: o.id, name: o.name })) } : {}),
            }
            await t.trx
                .from(TABLA_INSTANCIAS)
                .where('id', inst.id)
                .update({ probado_en: ahora, prueba_ok: r.ok, prueba_error: r.error })
        }
        let acs: ResultadoSistema | null = null
        const filaAcs = ((await t.trx.from(TABLA_ACS).where('empresa_id', empresaId).first()) ??
            null) as FilaAcs | null
        const genie = acsDesdeFila(filaAcs, empresaId).genieacs
        if (genie) {
            const r = await medir(() => genieacs.probar(genie))
            acs = { ok: r.ok, latencia_ms: r.ms, error: r.error }
            await t.trx
                .from(TABLA_ACS)
                .where('empresa_id', empresaId)
                .update({ probado_en: ahora, prueba_ok: r.ok, prueba_error: r.error })
        }
        return {
            probado_en: ahora.toISOString(),
            smartolt: so,
            genieacs: acs,
            capacidades: await gestionDe(empresaId, t.trx),
        }
    }
}
