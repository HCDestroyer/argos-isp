import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { RegistroAccounting } from '#network/sesiones/registro'
import {
    actualizarSesionAbierta,
    buscarSesion,
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
        if (existente.fin) return { sesionId: existente.id, efecto: 'ignorada', eventos: [] }
        const cerrada = await actualizarSesionAbierta(t, existente.id, r, ctx, { fin: r.evento_en, causa })
        await emitirTerminada(t, cerrada)
        return { sesionId: cerrada.id, efecto: 'cerrada', eventos: ['sesion.terminada'] }
    }
}
