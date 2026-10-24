import { DomainAction, type Transaccion } from '#shared/domain_action'
import { anotarAccounting } from '#network/sesiones/contacto'
import type { RegistroAccounting } from '#network/sesiones/registro'
import { cerrarSesiones, emitirTerminada } from '#network/sesiones/sesiones'

export interface ResultadoCerrarNas {
    cerradas: number[]
}

/** Causa con la que se cierran las sesiones de un NAS que avisó Accounting-On/Off. */
export const CAUSA_NAS = 'NAS-Reboot'

/**
 * Accounting `Accounting-On` / `Accounting-Off`: el NAS arrancó o se apaga, así que ninguna de sus
 * sesiones abiertas sigue viva. Las cierra (solo las iniciadas antes del aviso) y emite
 * `sesion.terminada` por cada una.
 */
export default class CerrarSesionesNas extends DomainAction<RegistroAccounting, ResultadoCerrarNas> {
    readonly nombre = 'sesiones.cerrar_nas'

    protected async handle(r: RegistroAccounting, t: Transaccion): Promise<ResultadoCerrarNas> {
        // El NAS mandó accounting: contacto del router (Router.en_linea), a lo sumo cada 60 s.
        await anotarAccounting(t.trx, r)
        const cerradas = await cerrarSesiones(
            t,
            { sql: 'nas_ip = ?::inet AND inicio <= ?::timestamptz', valores: [r.nas_ip, r.evento_en] },
            r.evento_en,
            CAUSA_NAS,
        )
        for (const sesion of cerradas) await emitirTerminada(t, sesion)
        return { cerradas: cerradas.map((s) => s.id) }
    }
}
