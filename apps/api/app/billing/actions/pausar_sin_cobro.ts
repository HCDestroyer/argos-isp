import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import { bloquearCliente } from '#billing/cobros'
import { leerAjustesCobro } from '#billing/ajustes_cobro'
import { masDias, verPausa, type PausaVista } from '#billing/pausas'
import SuspenderServicio from '#core/actions/suspender_servicio'

/**
 * `servicios.pausar_sin_cobro` (`POST /servicios/:id/pausar-sin-cobro`, decisión del PM 16): pausa a
 * pedido del cliente (viaje, temporada). La suspensión manual de siempre (`servicios.suspender`) sigue
 * facturando; esta no.
 *
 * - Pide permiso propio, `motivo` y `dias` (1 a `pausa_tope_dias` de la empresa, 90 de fábrica; si no,
 *   422 `tope_pausa`). Empieza hoy (Guatemala) y termina `hoy + dias` (exclusivo).
 * - Suspende el servicio con `SuspenderServicio` de A1, anidada (misma transacción): marca
 *   `suspension_manual` y emite `servicio.estado_cambiado` (A2 corta). Así `evaluarEstadoServicio` no
 *   lo toca mientras dure y la máquina de estados no cambia.
 * - Los periodos que empiezan dentro de la pausa no se facturan (`#billing/pausas`).
 * - 422 `pausa_activa` si ya tiene una; 422 `suspension_manual` si ya estaba suspendido a mano (su
 *   suspensión es de otra persona y otro motivo); retirado o pendiente de instalación: 422 de A1.
 * - Al terminar (`hasta`), el cron `pausas` lo reactiva solo (`TerminarPausas`).
 *
 * Evento `servicio.pausa_iniciada`.
 */

export interface EntradaPausarSinCobro {
    servicio_id: number
    motivo: string
    dias: number
    /** día de Guatemala que cuenta como hoy (pruebas); por defecto el real */
    hoy?: string
}

export default class PausarSinCobro extends DomainAction<EntradaPausarSinCobro, PausaVista> {
    readonly nombre = 'servicios.pausar_sin_cobro'

    protected async handle(input: EntradaPausarSinCobro, t: Transaccion): Promise<PausaVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([{ field: 'motivo', message: 'Indica el motivo', rule: 'minLength' }])
        }
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .select('id', 'empresa_id', 'cliente_id', 'estado', 'suspension_manual')
            .first()) as {
            id: number
            empresa_id: number
            cliente_id: number
            estado: string
            suspension_manual: boolean
        } | null
        if (!servicio) throw new NoEncontrado(`El servicio ${input.servicio_id} no existe`)
        const empresaId = Number(servicio.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await bloquearCliente(t.trx, Number(servicio.cliente_id))

        const { pausa_tope_dias: tope } = await leerAjustesCobro(empresaId, t.trx)
        if (!Number.isInteger(input.dias) || input.dias < 1 || input.dias > tope) {
            throw new ValidacionFallida([
                {
                    field: 'dias',
                    message: `La pausa sin cobro dura de 1 a ${tope} días (ajuste de la empresa)`,
                    rule: 'tope_pausa',
                },
            ])
        }
        const abierta = await t.trx
            .from('billing.pausas_servicio')
            .where('servicio_id', servicio.id)
            .where('estado', 'activa')
            .select('id')
            .first()
        if (abierta) {
            throw new ReglaNegocio(
                `El servicio ${servicio.id} ya está en pausa (${abierta.id})`,
                'pausa_activa',
            )
        }
        if (servicio.suspension_manual) {
            throw new ReglaNegocio(
                `El servicio ${servicio.id} ya está suspendido manualmente: reactívalo antes de pausarlo`,
                'suspension_manual',
            )
        }

        // A1: valida el estado (retirado, pendiente de instalación) y pone la marca manual
        await new SuspenderServicio().execute(
            { id: servicio.id, motivo: `Pausa sin cobro (${input.dias} días): ${motivo}` },
            t.ctx,
            { trx: t.trx },
        )
        t.fijarEntidad('servicio', servicio.id)
        t.fijarEmpresa(empresaId)

        const desde = input.hoy ?? hoyGuatemala()
        const hasta = masDias(desde, input.dias)
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.pausas_servicio')
            .insert({
                empresa_id: empresaId,
                servicio_id: servicio.id,
                cliente_id: Number(servicio.cliente_id),
                desde,
                hasta,
                dias: input.dias,
                motivo,
                creada_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const pausa = await verPausa(Number(fila!.id), t.trx)
        await t.emit('servicio.pausa_iniciada', {
            pausa_id: pausa.id,
            servicio_id: pausa.servicio_id,
            empresa_id: empresaId,
            cliente_id: pausa.cliente_id,
            desde,
            hasta,
            dias: input.dias,
        })
        return pausa
    }
}
