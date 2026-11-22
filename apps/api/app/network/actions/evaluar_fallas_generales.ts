import { DomainAction, type Transaccion } from '#shared/domain_action'
import { verAjustesOperacion } from '#core/ajustes_operacion'
import CerrarIncidenteRed from '#network/actions/cerrar_incidente_red'
import {
    ALCANCES_INCIDENTE,
    agregarAfectados,
    bloquearIncidente,
    emitirPorEmpresa,
    serviciosCaidos,
    serviciosDelAlcance,
    type AlcanceIncidente,
} from '#network/incidentes_red'

export interface EntradaEvaluarFallasGenerales {
    ahora?: Date
}

export interface SalidaEvaluarFallasGenerales {
    abiertos: number[]
    cerrados: number[]
    /** incidentes abiertos que sumaron servicios */
    ampliados: number[]
}

/**
 * Detecta fallas generales (`incidentes_red.evaluar`, acción del sistema; cron `fallas_generales` cada
 * minuto con lock). Ver `app/network/incidentes_red.ts`.
 *
 * 1. Incidentes automáticos abiertos: suma los servicios del alcance que siguen cayendo; se cierra
 *    (`incidentes_red.cerrar`, motivo `recuperado`) cuando los que siguen sin sesión ya no cumplen el umbral.
 * 2. Servicios caídos fuera de un incidente, agrupados por alcance (router, OLT, PON y zona, en ese
 *    orden: un servicio entra a un solo incidente): abre uno si cumplen el umbral.
 *
 * Auditoría solo si abrió, amplió o cerró algo (la llama el cron cada minuto).
 */
export default class EvaluarFallasGenerales extends DomainAction<
    EntradaEvaluarFallasGenerales,
    SalidaEvaluarFallasGenerales
> {
    readonly nombre = 'incidentes_red.evaluar'

    protected auditarExito(salida: SalidaEvaluarFallasGenerales): boolean {
        return salida.abiertos.length + salida.cerrados.length + salida.ampliados.length > 0
    }

    protected async handle(
        input: EntradaEvaluarFallasGenerales,
        t: Transaccion,
    ): Promise<SalidaEvaluarFallasGenerales> {
        const ahora = input.ahora ?? new Date()
        const salida: SalidaEvaluarFallasGenerales = { abiertos: [], cerrados: [], ampliados: [] }
        const { efectivo } = await verAjustesOperacion(null, t.trx)
        if (!efectivo['falla_general.activo']) return salida
        const modo = efectivo['falla_general.modo'] as 'porcentaje' | 'cantidad'
        const umbral = Number(efectivo['falla_general.umbral'])
        const minimo = Number(efectivo['falla_general.minimo_servicios'])
        const ventana = Number(efectivo['falla_general.ventana_min'])
        const cumple = (caidos: number, base: number) =>
            caidos >= minimo &&
            (modo === 'cantidad'
                ? caidos >= umbral
                : base > 0 && (caidos * 100) / base >= Math.min(umbral, 100))
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(4120, 0)')

        // 1. incidentes automáticos abiertos: ampliar o cerrar
        const caidosAhora = await serviciosCaidos(t.trx, ahora, ventana, { incluirEnIncidente: true })
        const abiertos = (await t.trx
            .from('network.incidentes_red')
            .where({ estado: 'abierto', origen: 'automatico' })
            .orderBy('id')
            .select('id', 'alcance', 'alcance_id')) as Array<{
            id: number
            alcance: AlcanceIncidente
            alcance_id: number
        }>
        for (const inc of abiertos) {
            const id = Number(inc.id)
            const delAlcance = caidosAhora.filter((c) => c[inc.alcance] === Number(inc.alcance_id))
            const nuevos = await agregarAfectados(t, id, delAlcance)
            if (nuevos.length > 0) salida.ampliados.push(id)
            const { rows } = (await t.trx.rawQuery(
                `SELECT count(*)::int AS sin_sesion FROM network.incidentes_red_servicios irs
                   JOIN core.servicios s ON s.id = irs.servicio_id
                  WHERE irs.incidente_id = ? AND s.estado IN ('activo', 'limitado')
                    AND NOT EXISTS (SELECT 1 FROM network.sesiones se WHERE se.servicio_id = s.id AND se.fin IS NULL)`,
                [id],
            )) as { rows: Array<{ sin_sesion: number }> }
            const delIncidente = await serviciosDelAlcance(t.trx, inc.alcance, Number(inc.alcance_id))
            if (!cumple(Number(rows[0]?.sin_sesion ?? 0), delIncidente.length)) {
                await new CerrarIncidenteRed().execute({ id, motivo: 'recuperado', ahora }, t.ctx, {
                    trx: t.trx,
                })
                salida.cerrados.push(id)
            }
        }

        // 2. abrir: caídos que no están en un incidente abierto, por alcance
        let libres = await serviciosCaidos(t.trx, ahora, ventana)
        for (const alcance of ALCANCES_INCIDENTE) {
            const grupos = new Map<number, typeof libres>()
            for (const c of libres) {
                const alcanceId = c[alcance]
                if (alcanceId === null) continue
                grupos.set(alcanceId, [...(grupos.get(alcanceId) ?? []), c])
            }
            for (const [alcanceId, caidos] of grupos) {
                const abierto = await t.trx
                    .from('network.incidentes_red')
                    .where({ alcance, alcance_id: alcanceId, estado: 'abierto' })
                    .first()
                if (abierto) continue
                const activos = await serviciosDelAlcance(t.trx, alcance, alcanceId)
                const base = activos.length
                if (!cumple(caidos.length, base)) continue
                const desde = new Date(ahora.getTime() - ventana * 60_000)
                const [fila] = (await t.trx
                    .insertQuery()
                    .table('network.incidentes_red')
                    .insert({ alcance, alcance_id: alcanceId, origen: 'automatico', desde, base })
                    .returning('id')) as Array<{ id: number }>
                const id = Number(fila!.id)
                await agregarAfectados(t, id, caidos)
                await t.registrarCambios({ tipo: 'incidente_red', id }, null, {
                    alcance,
                    alcance_id: alcanceId,
                    estado: 'abierto',
                    origen: 'automatico',
                    servicios_afectados: caidos.length,
                    base,
                })
                await emitirPorEmpresa(t, await bloquearIncidente(t, id), 'abierta')
                salida.abiertos.push(id)
                const tomados = new Set(caidos.map((c) => c.servicio_id))
                libres = libres.filter((c) => !tomados.has(c.servicio_id))
            }
        }
        if (salida.abiertos[0]) t.fijarEntidad('incidente_red', salida.abiertos[0])
        t.fijarEmpresa(null)
        return salida
    }
}
