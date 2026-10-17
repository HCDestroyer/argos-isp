import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import type { EstadoServicio } from '#shared/eventos'
import { usuarioDelActor } from '#shared/contexto'
import CambiarEstadoServicio, { type EstadoOperativo } from '#core/actions/cambiar_estado_servicio'
import { verServicio, type ServicioVista } from '#core/consultas/servicios'

export interface EntradaTransicionManual {
    id: number
    motivo: string
}

/**
 * Base de las acciones manuales del operador (`POST /servicios/:id/suspender|reactivar|limitar|
 * quitar-limite`). Cada una tiene su permiso con el mismo nombre (`servicios.suspender`), valida
 * el estado de origen y ejecuta la transición con `CambiarEstadoServicio` anidada (misma
 * transacción, evento `servicio.estado_cambiado` y auditoría de ambas acciones).
 *
 * No decide nada por facturas: la decisión automática es de `evaluarEstadoServicio` (A3).
 * Si el servicio ya está en el estado destino no hace nada y devuelve el servicio (idempotente).
 *
 * Suspensión manual (decisión del PM): `suspender` pone la marca `suspension_manual` con el
 * motivo y el operador; mientras esté puesta, `evaluarEstadoServicio` no toca el servicio y solo
 * `reactivar` la quita. `limitar` y `quitar-limite` no la cambian y se rechazan sobre un servicio
 * suspendido a mano (422 `suspension_manual`), para que no se salte la marca por otro camino.
 */
export abstract class TransicionManual extends DomainAction<EntradaTransicionManual, ServicioVista> {
    abstract readonly destino: EstadoOperativo
    /** Estados desde los que el operador puede pedir esta acción (además del propio destino). */
    abstract readonly origenes: readonly EstadoServicio[]
    /** Verbo para los mensajes de error (`suspender`). */
    protected abstract readonly verbo: string
    /** Qué hace con la marca de suspensión manual: ponerla, quitarla o respetarla (por defecto). */
    protected readonly marcaManual: 'poner' | 'quitar' | 'respetar' = 'respetar'

    protected async handle(input: EntradaTransicionManual, t: Transaccion): Promise<ServicioVista> {
        t.fijarEntidad('servicio', input.id)
        const fila = (await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .forUpdate()
            .select('estado', 'suspension_manual')
            .first()) as { estado: EstadoServicio; suspension_manual: boolean } | null
        if (!fila) throw new NoEncontrado(`El servicio ${input.id} no existe`)
        if (fila.estado === 'retirado') {
            throw new ReglaNegocio('El servicio está retirado y no cambia de estado', 'servicio_retirado')
        }
        if (fila.estado !== this.destino && !this.origenes.includes(fila.estado)) {
            throw new ReglaNegocio(
                `No se puede ${this.verbo} un servicio en estado ${fila.estado}`,
                'transicion_invalida',
            )
        }
        if (fila.suspension_manual && this.marcaManual === 'respetar') {
            throw new ReglaNegocio(
                'El servicio está suspendido manualmente: reactívalo antes de cambiar su estado',
                'suspension_manual',
            )
        }
        if (this.marcaManual !== 'respetar') await this.aplicarMarca(t, input)
        await new CambiarEstadoServicio().execute(
            { servicioId: input.id, nuevo: this.destino, motivo: input.motivo },
            t.ctx,
            { trx: t.trx },
        )
        return verServicio(input.id, t.trx)
    }

    private async aplicarMarca(t: Transaccion, input: EntradaTransicionManual) {
        const poner = this.marcaManual === 'poner'
        await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .update({
                suspension_manual: poner,
                suspension_manual_motivo: poner ? input.motivo : null,
                suspension_manual_en: poner ? t.trx.knexRawQuery('now()') : null,
                suspension_manual_por: poner ? usuarioDelActor(t.ctx.actor) : null,
            } as Record<string, unknown>)
    }
}
