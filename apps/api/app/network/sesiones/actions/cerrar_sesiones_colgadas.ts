import { DomainAction, type Transaccion } from '#shared/domain_action'
import { cerrarColgadas, emitirTerminada } from '#network/sesiones/sesiones'

export interface EntradaCerrarColgadas {
    /** Instante de la corrida (ISO); el corte es `ahora − umbral_s` */
    ahora: string
    /** Segundos sin accounting para considerar colgada una sesión (N × Acct-Interim-Interval) */
    umbral_s: number
    /** Máximo de sesiones por transacción; el cron repite hasta que no quede ninguna */
    limite: number
}

export interface ResultadoCerrarColgadas {
    corte: string
    cerradas: number[]
    /** NAS con sesiones colgadas que no se tocaron porque ese NAS no manda accounting reciente */
    nas_silenciosos: string[]
}

/**
 * Cierra sesiones abiertas sin Stop ni Interim-Update desde hace `umbral_s` (el NAS perdió el
 * Stop: corte de energía del CPE, reinicio sin `Accounting-On`, paquete perdido). Cada una queda
 * con `fin` = su último accounting y causa `sin_interim`, y emite `sesion.terminada` con
 * `motivo: 'sin_interim'`; cada una deja su fila en `audit.cambios` (`fin`, `causa_fin`). Salvaguarda de NAS silenciosos y orden de lock en `cerrarColgadas`.
 *
 * Auditoría: solo cuando cerró algo (`auditarExito`). El cron corre cada 5 minutos y casi siempre
 * no encuentra nada: una fila por corrida vacía sería ruido, como la evaluación sin cambio de
 * estado (excepción de la regla 9, anotada para el líder en `a2.md`). Los errores se auditan.
 */
export default class CerrarSesionesColgadas extends DomainAction<
    EntradaCerrarColgadas,
    ResultadoCerrarColgadas
> {
    readonly nombre = 'sesiones.cerrar_colgadas'

    protected override auditarExito(salida: ResultadoCerrarColgadas): boolean {
        return salida.cerradas.length > 0
    }

    protected async handle(input: EntradaCerrarColgadas, t: Transaccion): Promise<ResultadoCerrarColgadas> {
        const corte = new Date(new Date(input.ahora).getTime() - input.umbral_s * 1000)
        const { cerradas, nasSilenciosos } = await cerrarColgadas(t, corte, input.limite)
        for (const sesion of cerradas) {
            // Una fila de `audit.cambios` por sesión (regla 9: actualización masiva fila por fila).
            await t.registrarCambios(
                { tipo: 'sesion', id: sesion.id },
                { fin: null, causa_fin: null },
                { fin: sesion.fin?.toISOString() ?? null, causa_fin: sesion.causa_fin },
            )
            await emitirTerminada(t, sesion)
        }
        return {
            corte: corte.toISOString(),
            cerradas: cerradas.map((s) => s.id).sort((a, b) => a - b),
            nas_silenciosos: nasSilenciosos,
        }
    }
}
