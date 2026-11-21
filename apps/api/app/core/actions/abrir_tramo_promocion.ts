import { DomainAction, type Transaccion } from '#shared/domain_action'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { solicitarVelocidad } from '#network/sesiones/velocidad'
import { Problema } from '#shared/errores'
import {
    bloquearPromocion,
    datosServicioPromocion,
    definicionTiempo,
    exigirPromocionAplicable,
    promocionComoVigente,
    tramoEn,
} from '#core/promociones_velocidad'

export interface EntradaAbrirTramoPromocion {
    promocion_id: number
    servicio_id: number
    /** reloj de la corrida (cron); por defecto, ahora */
    ahora?: Date
}

export interface SalidaAbrirTramoPromocion {
    tramo_id: number | null
    /** `abierto`, o por qué no: `sin_tramo`, `ya_abierto`, `otro_abierto`, `no_vigente`, `rechazado` */
    resultado: 'abierto' | 'sin_tramo' | 'ya_abierto' | 'otro_abierto' | 'no_vigente' | 'rechazado'
    detalle: string | null
    /** sesiones a las que se pidió CoA de velocidad */
    coa: number
}

/**
 * Abre el tramo de ahora de una promoción de velocidad en un servicio
 * (`promociones_velocidad.abrir_tramo`, acción del sistema: la llaman el cron y la asignación).
 *
 * - Idempotente por `(promocion_id, servicio_id, inicio)`: si el tramo ya existe (abierto o cerrado) no
 *   hace nada. Solo un tramo abierto por servicio.
 * - Revisa otra vez que la promoción se pueda aplicar (estrategia del router y capacidad): si ya no,
 *   no la abre y queda auditado (`rechazado`).
 * - Pide CoA de velocidad (`sesion.velocidad_solicitada`, sin cortar la sesión) a las sesiones vivas
 *   que lo admiten, emite `servicio.promocion_velocidad_iniciada` (RouterOS recalcula la cola simple)
 *   y reescribe `aaa:user:*` al confirmar.
 * - Auditoría solo cuando abre o rechaza (el cron la llama cada minuto).
 */
export default class AbrirTramoPromocion extends DomainAction<
    EntradaAbrirTramoPromocion,
    SalidaAbrirTramoPromocion
> {
    readonly nombre = 'promociones_velocidad.abrir_tramo'

    protected auditarExito(salida: SalidaAbrirTramoPromocion): boolean {
        return salida.resultado === 'abierto' || salida.resultado === 'rechazado'
    }

    protected async handle(
        input: EntradaAbrirTramoPromocion,
        t: Transaccion,
    ): Promise<SalidaAbrirTramoPromocion> {
        const ahora = input.ahora ?? new Date()
        const nada = (resultado: SalidaAbrirTramoPromocion['resultado'], detalle: string | null = null) => ({
            tramo_id: null,
            resultado,
            detalle,
            coa: 0,
        })
        const promocion = await bloquearPromocion(t.trx, input.promocion_id)
        t.fijarEmpresa(promocion.empresa_id)
        t.fijarEntidad('servicio', input.servicio_id)
        if (promocion.estado !== 'activa') return nada('no_vigente')
        const asignada = await t.trx
            .from('core.promociones_velocidad_servicios')
            .where({ promocion_id: promocion.id, servicio_id: input.servicio_id, estado: 'vigente' })
            .first()
        if (!asignada) return nada('no_vigente')
        const tramo = tramoEn(definicionTiempo(promocion), ahora)
        if (!tramo) return nada('sin_tramo')

        await t.trx.from('core.servicios').where('id', input.servicio_id).forUpdate().select('id').first()
        const abierto = (await t.trx
            .from('core.promociones_velocidad_tramos')
            .where({ servicio_id: input.servicio_id, estado: 'abierto' })
            .select('promocion_id')
            .first()) as { promocion_id: number } | null
        if (abierto) {
            return nada(Number(abierto.promocion_id) === promocion.id ? 'ya_abierto' : 'otro_abierto')
        }
        const existe = await t.trx
            .from('core.promociones_velocidad_tramos')
            .where({ promocion_id: promocion.id, servicio_id: input.servicio_id })
            .where('inicio', tramo.inicio)
            .first()
        if (existe) return nada('ya_abierto')

        const { datos } = await datosServicioPromocion(t.trx, input.servicio_id)
        if (datos.estado === 'retirado') return nada('no_vigente')
        try {
            exigirPromocionAplicable(datos, await promocionComoVigente(t.trx, promocion))
        } catch (error) {
            if (error instanceof Problema) return nada('rechazado', error.detalle ?? error.message)
            throw error
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('core.promociones_velocidad_tramos')
            .insert({
                promocion_id: promocion.id,
                servicio_id: input.servicio_id,
                empresa_id: promocion.empresa_id,
                inicio: tramo.inicio,
                fin: tramo.fin,
                abierto_en: ahora,
            })
            .returning('id')) as Array<{ id: number }>
        const tramoId = Number(fila!.id)
        await t.registrarCambios({ tipo: 'tramo_promocion', id: tramoId }, null, {
            promocion_id: promocion.id,
            servicio_id: input.servicio_id,
            inicio: tramo.inicio.toISOString(),
            fin: tramo.fin.toISOString(),
            estado: 'abierto',
        })

        // ya con el tramo abierto: la velocidad efectiva del servicio es la de la promoción
        const { servicio } = await datosServicioPromocion(t.trx, input.servicio_id)
        const velocidad = await solicitarVelocidad(t, servicio, 'promocion_velocidad')
        await t.emit('servicio.promocion_velocidad_iniciada', {
            servicio_id: input.servicio_id,
            empresa_id: promocion.empresa_id,
            promocion_id: promocion.id,
            tramo_id: tramoId,
            inicio: tramo.inicio.toISOString(),
            fin: tramo.fin.toISOString(),
            cambia_precio: promocion.precio !== null,
        })
        refrescarAaaAlConfirmar(t, { servicioId: input.servicio_id })
        return { tramo_id: tramoId, resultado: 'abierto', detalle: null, coa: velocidad.coa }
    }
}
