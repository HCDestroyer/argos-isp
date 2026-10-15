import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { RegistroAccounting } from '#network/sesiones/registro'
import {
    actualizarSesionAbierta,
    buscarSesion,
    cerrarReemplazadas,
    emitirIniciada,
    inicioEstimado,
    insertarSesion,
    resolverContexto,
    type ResultadoAccounting,
} from '#network/sesiones/sesiones'

/**
 * Accounting `Interim-Update`: actualiza contadores y datos de red de la sesión abierta.
 *
 * - Sin Start previo (se perdió, o `aaa` arrancó con sesiones vivas): abre la sesión con
 *   `inicio = evento − Acct-Session-Time` y emite `sesion.iniciada`.
 * - Sobre una sesión cerrada: se ignora (Interim tardío).
 */
export default class ActualizarSesion extends DomainAction<RegistroAccounting, ResultadoAccounting> {
    readonly nombre = 'sesiones.actualizar'

    protected async handle(r: RegistroAccounting, t: Transaccion): Promise<ResultadoAccounting> {
        const ctx = await resolverContexto(t, r)
        const nueva = await insertarSesion(t, r, ctx, { inicio: inicioEstimado(r) })
        if (nueva) {
            t.fijarEntidad('sesion', nueva.id)
            await emitirIniciada(t, nueva)
            await cerrarReemplazadas(t, nueva)
            return { sesionId: nueva.id, efecto: 'abierta', eventos: ['sesion.iniciada'] }
        }
        const existente = (await buscarSesion(t, r.nas_ip, r.acct_session_id))!
        t.fijarEntidad('sesion', existente.id)
        if (existente.fin) return { sesionId: existente.id, efecto: 'ignorada', eventos: [] }
        await actualizarSesionAbierta(t, existente.id, r, ctx)
        return { sesionId: existente.id, efecto: 'actualizada', eventos: [] }
    }
}
