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
 * - Prefijos: si el NAS reporta un /64 o un /56 que la sesión no tenía (modo `radius_pool`, el /56
 *   llega después del Start), se guarda y se audita.
 * - Auditoría: solo cuando abre la sesión o aprende un prefijo. Una actualización de contadores llega cada 5 minutos
 *   por cliente (≈ 576 000 al día con 2 000 clientes) y es telemetría, no una acción de nadie
 *   (decisión del líder BE, excepción de la regla 9 en `.claude/CLAUDE.md`).
 */
export default class ActualizarSesion extends DomainAction<RegistroAccounting, ResultadoAccounting> {
    readonly nombre = 'sesiones.actualizar'

    protected override auditarExito(salida: ResultadoAccounting): boolean {
        return salida.efecto === 'abierta' || salida.prefijoNuevo === true
    }

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
        const despues = await actualizarSesionAbierta(t, existente.id, r, ctx)
        const prefijoNuevo =
            (existente.prefijo_delegado_v6 === null && despues.prefijo_delegado_v6 !== null) ||
            (existente.prefijo_enlace_v6 === null && despues.prefijo_enlace_v6 !== null)
        if (prefijoNuevo) {
            await t.registrarCambios(
                { tipo: 'sesion', id: existente.id },
                {
                    prefijo_enlace_v6: existente.prefijo_enlace_v6,
                    prefijo_delegado_v6: existente.prefijo_delegado_v6,
                },
                {
                    prefijo_enlace_v6: despues.prefijo_enlace_v6,
                    prefijo_delegado_v6: despues.prefijo_delegado_v6,
                },
            )
        }
        return { sesionId: existente.id, efecto: 'actualizada', eventos: [], prefijoNuevo }
    }
}
