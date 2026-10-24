import { DomainAction, type Transaccion } from '#shared/domain_action'
import { anotarAccounting } from '#network/sesiones/contacto'
import type { RegistroAccounting } from '#network/sesiones/registro'
import {
    archivarSesionCerrada,
    actualizarSesionAbierta,
    buscarSesion,
    cerrarReemplazadas,
    emitirIniciada,
    insertarSesion,
    resolverContexto,
    type ResultadoAccounting,
} from '#network/sesiones/sesiones'

/**
 * Accounting `Start`: abre la sesión en `network.sesiones` y emite `sesion.iniciada`.
 *
 * - Start repetido (el NAS reintenta) sobre la sesión abierta: completa datos de red, sin evento.
 * - Start tardío de una sesión ya cerrada (llegó después de su Stop): se ignora.
 * - `acct_session_id` reutilizado por el NAS (sesión cerrada vieja, Start posterior a su fin): se
 *   archiva la vieja y se abre una nueva.
 * - Cierra otras sesiones abiertas más viejas del mismo `user_ppp` (Stop perdido).
 */
export default class IniciarSesion extends DomainAction<RegistroAccounting, ResultadoAccounting> {
    readonly nombre = 'sesiones.iniciar'

    protected async handle(r: RegistroAccounting, t: Transaccion): Promise<ResultadoAccounting> {
        // El NAS mandó accounting: contacto del router (Router.en_linea), a lo sumo cada 60 s.
        await anotarAccounting(t.trx, r)
        const ctx = await resolverContexto(t, r)
        let nueva = await insertarSesion(t, r, ctx, { inicio: r.evento_en })
        if (!nueva) {
            const existente = (await buscarSesion(t, r.nas_ip, r.acct_session_id))!
            t.fijarEntidad('sesion', existente.id)
            if (!existente.fin) {
                await actualizarSesionAbierta(t, existente.id, r, ctx)
                return { sesionId: existente.id, efecto: 'actualizada', eventos: [] }
            }
            if (existente.fin.getTime() >= new Date(r.evento_en).getTime()) {
                return { sesionId: existente.id, efecto: 'ignorada', eventos: [] }
            }
            await archivarSesionCerrada(t, existente)
            nueva = (await insertarSesion(t, r, ctx, { inicio: r.evento_en }))!
        }
        t.fijarEntidad('sesion', nueva.id)
        await emitirIniciada(t, nueva)
        await cerrarReemplazadas(t, nueva)
        return { sesionId: nueva.id, efecto: 'abierta', eventos: ['sesion.iniciada'] }
    }
}
