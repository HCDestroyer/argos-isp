import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import {
    TABLA_ACS,
    acsDesdeFila,
    vistaAcsDeFila,
    type FilaAcs,
    type VistaAcs,
} from '#integraciones/equipos/acs'
import * as genieacs from '#integraciones/equipos/genieacs'

export interface ResultadoProbarAcs {
    ok: boolean
    latencia_ms: number | null
    error: string | null
    config: VistaAcs
}

/**
 * `acs.probar` (`POST /integraciones/acs/probar`, `contratos/equipos-olt-acs.md` §5.1): «Probar
 * conexión» del ACS de la empresa activa con la configuración **guardada**: una búsqueda de un
 * dispositivo en el NBI con la autenticación básica guardada. **No llama a SmartOLT.**
 *
 * - Guarda el resultado (`probado_en`, `prueba_ok`, `prueba_error`) sin tocar la `version`. No lanza
 *   si el ACS falla: devuelve el error real (sin secretos). Sin URL guardada: `ok: false`.
 * - Emite `equipos.config_cambiada` (`accion: probada`) solo si cambió `operativo`.
 */
export default class ProbarAcs extends DomainAction<Record<string, never>, ResultadoProbarAcs> {
    readonly nombre = 'acs.probar'

    protected async handle(_input: Record<string, never>, t: Transaccion): Promise<ResultadoProbarAcs> {
        const empresaId = exigirEmpresaActivaDelContexto(t.ctx)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('configuracion_acs', empresaId)
        const fila = ((await t.trx.from(TABLA_ACS).where('empresa_id', empresaId).forUpdate().first()) ??
            null) as FilaAcs | null
        const antes = acsDesdeFila(fila, empresaId)
        if (!fila || !antes.genieacs) {
            return {
                ok: false,
                latencia_ms: null,
                error: 'El ACS de la empresa no tiene URL guardada',
                config: await vistaAcsDeFila(fila, empresaId, t.trx),
            }
        }
        const inicio = Date.now()
        let error: string | null = null
        try {
            await genieacs.probar(antes.genieacs)
        } catch (e) {
            error = (e as Error).message.slice(0, 500)
        }
        const latencia = Date.now() - inicio
        const ahora = new Date()
        const cambios = {
            probado_en: ahora,
            prueba_ok: error === null,
            prueba_error: error,
            prueba_latencia_ms: latencia,
            probado_por_id: t.ctx.actor.tipo === 'usuario' ? t.ctx.actor.id : null,
        }
        await t.trx.from(TABLA_ACS).where('empresa_id', empresaId).update(cambios)
        const despues = { ...fila, ...cambios } as FilaAcs
        const operativo = acsDesdeFila(despues, empresaId).operativo
        if (operativo !== antes.operativo) {
            await t.emit('equipos.config_cambiada', {
                sistema: 'acs',
                empresa_id: empresaId,
                instancia_id: null,
                accion: 'probada',
                campos: ['prueba_ok'],
                operativa: operativo,
            })
        }
        return {
            ok: error === null,
            latencia_ms: latencia,
            error,
            config: await vistaAcsDeFila(despues, empresaId, t.trx),
        }
    }
}
