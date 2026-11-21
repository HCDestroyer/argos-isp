import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { solicitarVelocidad } from '#network/sesiones/velocidad'
import { datosServicioPromocion } from '#core/promociones_velocidad'

export interface EntradaCerrarTramoPromocion {
    tramo_id: number
    /** `fin`, `quitada`, `cancelada` o `retiro` */
    motivo: string
    ahora?: Date
}

export interface SalidaCerrarTramoPromocion {
    tramo_id: number
    cerrado: boolean
    coa: number
}

/**
 * Cierra un tramo abierto de una promoción de velocidad (`promociones_velocidad.cerrar_tramo`, acción
 * del sistema: el cron al llegar `fin`, y quitar o cancelar la promoción). El servicio vuelve a la
 * velocidad de su plan: CoA de velocidad a las sesiones vivas (`sesion.velocidad_solicitada`),
 * `servicio.promocion_velocidad_terminada` (RouterOS) y `aaa:user:*` al confirmar. Idempotente: un
 * tramo ya cerrado no cambia (sin auditoría).
 */
export default class CerrarTramoPromocion extends DomainAction<
    EntradaCerrarTramoPromocion,
    SalidaCerrarTramoPromocion
> {
    readonly nombre = 'promociones_velocidad.cerrar_tramo'

    protected auditarExito(salida: SalidaCerrarTramoPromocion): boolean {
        return salida.cerrado
    }

    protected async handle(
        input: EntradaCerrarTramoPromocion,
        t: Transaccion,
    ): Promise<SalidaCerrarTramoPromocion> {
        const ahora = input.ahora ?? new Date()
        const tramo = (await t.trx
            .from('core.promociones_velocidad_tramos as tr')
            .join('core.promociones_velocidad as p', 'p.id', 'tr.promocion_id')
            .where('tr.id', input.tramo_id)
            .forUpdate()
            .select(
                'tr.id',
                'tr.promocion_id',
                'tr.servicio_id',
                'tr.empresa_id',
                'tr.inicio',
                'tr.fin',
                'tr.estado',
                t.trx.raw('p.precio IS NOT NULL AS cambia_precio'),
            )
            .first()) as {
            id: number
            promocion_id: number
            servicio_id: number
            empresa_id: number
            inicio: Date
            fin: Date
            estado: string
            cambia_precio: boolean
        } | null
        if (!tramo) throw new NoEncontrado(`El tramo ${input.tramo_id} no existe`)
        const servicioId = Number(tramo.servicio_id)
        t.fijarEmpresa(Number(tramo.empresa_id))
        t.fijarEntidad('servicio', servicioId)
        if (tramo.estado !== 'abierto') return { tramo_id: Number(tramo.id), cerrado: false, coa: 0 }

        await t.trx
            .from('core.promociones_velocidad_tramos')
            .where('id', tramo.id)
            .update({ estado: 'cerrado', cerrado_en: ahora, motivo_cierre: input.motivo })
        await t.registrarCambios(
            { tipo: 'tramo_promocion', id: Number(tramo.id) },
            { estado: 'abierto', motivo_cierre: null },
            { estado: 'cerrado', motivo_cierre: input.motivo },
        )
        let coa = 0
        if (input.motivo !== 'retiro') {
            const { servicio } = await datosServicioPromocion(t.trx, servicioId)
            const velocidad = await solicitarVelocidad(t, servicio, 'promocion_velocidad_fin')
            coa = velocidad.coa
        }
        await t.emit('servicio.promocion_velocidad_terminada', {
            servicio_id: servicioId,
            empresa_id: Number(tramo.empresa_id),
            promocion_id: Number(tramo.promocion_id),
            tramo_id: Number(tramo.id),
            inicio: new Date(tramo.inicio).toISOString(),
            fin: new Date(tramo.fin).toISOString(),
            cambia_precio: Boolean(tramo.cambia_precio),
            motivo: input.motivo,
        })
        refrescarAaaAlConfirmar(t, { servicioId })
        return { tramo_id: Number(tramo.id), cerrado: true, coa }
    }
}
