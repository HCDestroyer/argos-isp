import { DomainAction, type Transaccion } from '#shared/domain_action'
import * as smartolt from '#integraciones/equipos/smartolt'
import {
    TABLA_INSTANCIAS,
    TABLA_OLTS,
    empresaQueMira,
    instanciaAdministrable,
    instanciaDesdeFila,
    vistaInstancia,
    type FilaInstancia,
    type FilaOltSmartOlt,
    type VistaInstancia,
} from '#integraciones/equipos/smartolt_instancias'

export interface ResultadoProbarInstancia {
    ok: boolean
    latencia_ms: number | null
    error: string | null
    instancia: VistaInstancia
    /** OLT nuevas que se vincularon solas a la OLT de Argos del mismo nombre */
    vinculadas_por_nombre: Array<{ id: number; smartolt_olt_id: string; olt_id: number }>
}

/**
 * `smartolt.probar_instancia` (`POST /integraciones/smartolt/instancias/:id/probar`, §5.1): una sola
 * llamada a `GET /api/system/get_olts` con lo **guardado**, que sirve a la vez de prueba y de
 * sincronización (SmartOLT pide no usarla como latido: solo a pedido). No llama a otras instancias.
 *
 * - Guarda la prueba (`probado_en`, `prueba_ok`, `prueba_error`) sin tocar la `version`; no lanza si
 *   SmartOLT falla (devuelve su error, sin el token).
 * - Con éxito sincroniza `smartolt_olts`: agrega las nuevas, actualiza nombre, hardware e IP, y marca
 *   `presente = false` las que ya no vinieron (no se borran: pueden tener perfiles).
 * - Una OLT sin vínculo y sin sincronizar antes cuyo nombre coincide (sin mayúsculas) con **una sola**
 *   OLT de Argos visible y libre se vincula sola (`vinculadas_por_nombre`).
 * - Emite `equipos.config_cambiada` solo si cambió `operativa` o la lista de OLT.
 */
export default class ProbarInstanciaSmartOlt extends DomainAction<{ id: number }, ResultadoProbarInstancia> {
    readonly nombre = 'smartolt.probar_instancia'

    protected async handle(input: { id: number }, t: Transaccion): Promise<ResultadoProbarInstancia> {
        const fila = await instanciaAdministrable(t.trx, t.ctx, input.id)
        t.fijarEntidad('instancia_smartolt', input.id)
        t.fijarEmpresa(fila.empresa_id === null ? null : Number(fila.empresa_id))
        const antes = instanciaDesdeFila(fila)

        const inicio = Date.now()
        let olts: smartolt.OltSmartOlt[] | null = null
        let error: string | null = null
        if (antes.config) {
            try {
                olts = await smartolt.listarOlts(antes.config)
            } catch (e) {
                error = (e as Error).message.slice(0, 500)
            }
        } else {
            error = 'No se pudo leer el token guardado: vuelve a escribirlo'
        }
        const latencia = Date.now() - inicio
        const ahora = new Date()
        const cambios: Record<string, unknown> = {
            probado_en: ahora,
            prueba_ok: error === null,
            prueba_error: error,
        }
        let listaCambio = false
        const vinculadas: ResultadoProbarInstancia['vinculadas_por_nombre'] = []
        if (olts) {
            cambios.olts_sincronizadas_en = ahora
            const r = await this.sincronizar(t, fila, olts, ahora)
            listaCambio = r.cambio
            vinculadas.push(...r.vinculadas)
        }
        await t.trx.from(TABLA_INSTANCIAS).where('id', input.id).update(cambios)
        const despues = (await t.trx.from(TABLA_INSTANCIAS).where('id', input.id).first()) as FilaInstancia
        const operativa = instanciaDesdeFila(despues).operativa
        if (operativa !== antes.operativa || listaCambio) {
            await t.emit('equipos.config_cambiada', {
                sistema: 'smartolt',
                empresa_id: fila.empresa_id === null ? null : Number(fila.empresa_id),
                instancia_id: input.id,
                accion: listaCambio ? 'olts_sincronizadas' : 'probada',
                campos: [
                    ...(operativa !== antes.operativa ? ['prueba_ok'] : []),
                    ...(listaCambio ? ['olts'] : []),
                    ...(vinculadas.length > 0 ? ['olt_id'] : []),
                ],
                operativa,
            })
        }
        if (vinculadas.length > 0) t.anotarAuditoria({ vinculadas_por_nombre: vinculadas })
        return {
            ok: error === null,
            latencia_ms: antes.config ? latencia : null,
            error,
            instancia: await vistaInstancia(despues, t.trx, empresaQueMira(t.ctx)),
            vinculadas_por_nombre: vinculadas,
        }
    }

    private async sincronizar(
        t: Transaccion,
        instancia: FilaInstancia,
        olts: smartolt.OltSmartOlt[],
        ahora: Date,
    ): Promise<{ cambio: boolean; vinculadas: ResultadoProbarInstancia['vinculadas_por_nombre'] }> {
        const previas = (await t.trx
            .from(TABLA_OLTS)
            .where('instancia_id', instancia.id)) as FilaOltSmartOlt[]
        const porId = new Map(previas.map((o) => [o.smartolt_olt_id, o]))
        let cambio = false
        const candidatas: FilaOltSmartOlt[] = []
        for (const o of olts) {
            const previa = porId.get(o.id)
            const datos = { nombre: o.name || null, hardware: o.hardware, ip: o.ip }
            if (!previa) {
                const [nueva] = (await t.trx
                    .insertQuery()
                    .table(TABLA_OLTS)
                    .insert({
                        instancia_id: instancia.id,
                        smartolt_olt_id: o.id,
                        ...datos,
                        presente: true,
                        origen: 'sincronizada',
                        sincronizada_en: ahora,
                    })
                    .returning('*')) as FilaOltSmartOlt[]
                cambio = true
                candidatas.push(nueva!)
                continue
            }
            const distinto =
                previa.nombre !== datos.nombre ||
                previa.hardware !== datos.hardware ||
                previa.ip !== datos.ip ||
                !previa.presente ||
                previa.origen !== 'sincronizada'
            if (distinto) cambio = true
            await t.trx
                .from(TABLA_OLTS)
                .where('id', previa.id)
                .update({ ...datos, presente: true, origen: 'sincronizada', sincronizada_en: ahora })
            if (previa.origen === 'manual' && previa.olt_id === null) {
                candidatas.push({ ...previa, ...datos })
            }
        }
        const vistas = new Set(olts.map((o) => o.id))
        const ausentes = previas.filter((o) => o.presente && !vistas.has(o.smartolt_olt_id))
        if (ausentes.length > 0) {
            cambio = true
            await t.trx
                .from(TABLA_OLTS)
                .whereIn(
                    'id',
                    ausentes.map((o) => o.id),
                )
                .update({ presente: false })
        }

        // Vincular solas las nuevas por nombre (una sola OLT de Argos visible y libre con ese nombre)
        const vinculadas: ResultadoProbarInstancia['vinculadas_por_nombre'] = []
        for (const o of candidatas) {
            if (!o.nombre) continue
            const q = t.trx
                .from('network.olts as n')
                .whereRaw('lower(n.nombre) = lower(?)', [o.nombre])
                .whereNotExists((s) => s.from(TABLA_OLTS).whereRaw('olt_id = n.id'))
            if (instancia.empresa_id !== null) {
                q.where((w) => w.where('n.empresa_id', instancia.empresa_id!).orWhereNull('n.empresa_id'))
            }
            const iguales = (await q.select('n.id')) as Array<{ id: number }>
            if (iguales.length !== 1) continue
            await t.trx.from(TABLA_OLTS).where('id', o.id).update({ olt_id: iguales[0]!.id })
            vinculadas.push({
                id: Number(o.id),
                smartolt_olt_id: o.smartolt_olt_id,
                olt_id: Number(iguales[0]!.id),
            })
        }
        return { cambio, vinculadas }
    }
}
