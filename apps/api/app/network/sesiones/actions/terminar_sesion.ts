import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { RegistroAccounting } from '#network/sesiones/registro'
import {
    actualizarSesionAbierta,
    buscarSesion,
    CAUSA_SIN_INTERIM,
    corregirCierre,
    emitirTerminada,
    inicioEstimado,
    insertarSesion,
    resolverContexto,
    type ResultadoAccounting,
} from '#network/sesiones/sesiones'

/**
 * Accounting `Stop`: cierra la sesión (fin, contadores finales, `Acct-Terminate-Cause`) y emite
 * `sesion.terminada`.
 *
 * - Sin Start previo: crea la fila ya cerrada (`inicio = fin − Acct-Session-Time`) y emite solo
 *   `sesion.terminada`.
 * - Stop repetido sobre una sesión cerrada: no hace nada.
 * - Stop de una sesión que el cron cerró por `sin_interim`: corrige `fin`, causa y contadores con
 *   los del NAS (auditado) sin repetir `sesion.terminada`.
 */
export default class TerminarSesion extends DomainAction<RegistroAccounting, ResultadoAccounting> {
    readonly nombre = 'sesiones.terminar'

    protected async handle(r: RegistroAccounting, t: Transaccion): Promise<ResultadoAccounting> {
        const ctx = await resolverContexto(t, r)
        const causa = r.causa_fin ?? 'Desconocida'
        const creada = await insertarSesion(t, r, ctx, {
            inicio: inicioEstimado(r),
            fin: r.evento_en,
            causaFin: causa,
        })
        if (creada) {
            t.fijarEntidad('sesion', creada.id)
            await emitirTerminada(t, creada)
            return { sesionId: creada.id, efecto: 'creada_cerrada', eventos: ['sesion.terminada'] }
        }
        const existente = (await buscarSesion(t, r.nas_ip, r.acct_session_id))!
        t.fijarEntidad('sesion', existente.id)
        if (existente.fin) {
            if (existente.causa_fin !== CAUSA_SIN_INTERIM) {
                return { sesionId: existente.id, efecto: 'ignorada', eventos: [] }
            }
            const corregida = await corregirCierre(t, existente.id, r, causa)
            await t.registrarCambios(
                { tipo: 'sesion', id: existente.id },
                { fin: existente.fin.toISOString(), causa_fin: existente.causa_fin },
                { fin: corregida.fin?.toISOString() ?? null, causa_fin: corregida.causa_fin },
            )
            return { sesionId: existente.id, efecto: 'corregida', eventos: [] }
        }
        const cerrada = await actualizarSesionAbierta(t, existente.id, r, ctx, { fin: r.evento_en, causa })
        await emitirTerminada(t, cerrada)
        return { sesionId: cerrada.id, efecto: 'cerrada', eventos: ['sesion.terminada'] }
    }
}
