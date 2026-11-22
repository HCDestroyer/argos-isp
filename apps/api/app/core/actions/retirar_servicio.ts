import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import type { EstadoServicioConPendiente } from '#shared/eventos'
import { verServicio, type ServicioVista } from '#core/consultas/servicios'
import { liberarAsignaciones } from '#core/asignaciones_servicio'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { registrarTramo } from '#network/historial'
import { cancelarPorRetiro } from '#core/planes_temporales'
import { darDeBajaPorRetiro } from '#core/adicionales'
import { ajusteBooleano } from '#core/ajustes_operacion'
import { usuarioDelActor } from '#shared/contexto'
import { cerrarTramosAbiertos } from '#core/actions/quitar_promocion_velocidad'

export interface EntradaRetirarServicio {
    id: number
    motivo: string
    /**
     * Casilla «el equipo ya se entregó» (decisión del PM 17): no se pide la orden de retiro a Iris ni
     * quedan equipos «por recuperar». Por defecto false.
     */
    equipo_entregado?: boolean
}

/**
 * Retira un servicio (baja definitiva): estado `retirado` desde cualquier estado, libera su IPv4
 * y sus prefijos IPv6 (quedan en el historial) y emite `servicio.estado_cambiado` y
 * `asignacion.cambiada`. El `user_ppp` se conserva para la bitácora; en Redis su clave
 * `aaa:user:<user_ppp>` queda con una lápida. Un plan temporal programado o activo queda
 * `cancelado` (motivo `retiro`) y el servicio vuelve a su plan base. Sus adicionales activos pasan a
 * `baja` (`servicio.adicional_quitado`, `origen: retiro`).
 *
 * Decisión del PM 17: de fábrica (`retiro.orden_iris`) se pide a Iris la orden de retiro y los equipos
 * en comodato quedan «por recuperar» (`recuperar_equipo: true` en `servicio.estado_cambiado`); con
 * `equipo_entregado` o el ajuste apagado, `recuperar_equipo: false`. La decisión queda en
 * `core.servicios_retiros`. Las promociones de velocidad del servicio se quitan (tramo cerrado).
 */
export default class RetirarServicio extends DomainAction<EntradaRetirarServicio, ServicioVista> {
    readonly nombre = 'servicios.retirar'

    protected async handle(input: EntradaRetirarServicio, t: Transaccion): Promise<ServicioVista> {
        t.fijarEntidad('servicio', input.id)
        const fila = (await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .forUpdate()
            .select('estado', 'empresa_id')
            .first()) as { estado: EstadoServicioConPendiente; empresa_id: number } | null
        if (!fila) throw new NoEncontrado(`El servicio ${input.id} no existe`)
        const empresaId = Number(fila.empresa_id)
        t.fijarEmpresa(empresaId)
        if (fila.estado === 'retirado') {
            throw new ReglaNegocio('El servicio ya está retirado', 'servicio_retirado')
        }

        const antes = await verServicio(input.id, t.trx)
        await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .update({
                estado: 'retirado',
                // A38: la IP reservada en sitio de un pendiente se libera con el resto
                ip_reservada_en: null,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await cancelarPorRetiro(t, input.id)
        await darDeBajaPorRetiro(
            t,
            { id: input.id, empresa_id: empresaId, cliente_id: antes.cliente_id },
            input.motivo,
        )
        await quitarPromocionesPorRetiro(t, input.id)
        await liberarAsignaciones(t.trx, input.id)
        const equipoEntregado = input.equipo_entregado ?? false
        const recuperarEquipo = !equipoEntregado && (await ajusteBooleano('retiro.orden_iris', null, t.trx))
        await t.trx
            .insertQuery()
            .table('core.servicios_retiros')
            .insert({
                servicio_id: input.id,
                empresa_id: empresaId,
                motivo: input.motivo,
                equipo_entregado: equipoEntregado,
                recuperar_equipo: recuperarEquipo,
                creado_por: usuarioDelActor(t.ctx.actor),
            })
        // cierra el tramo vigente del historial (un retirado no abre otro)
        await registrarTramo(t.trx, input.id, `retiro: ${input.motivo}`)

        const despues = await verServicio(input.id, t.trx)
        await t.registrarCambios({ tipo: 'servicio', id: input.id }, antes, despues)
        const ahora = new Date().toISOString()
        await t.emit('servicio.estado_cambiado', {
            servicio_id: input.id,
            empresa_id: empresaId,
            de: fila.estado,
            a: 'retirado',
            motivo: input.motivo,
            recuperar_equipo: recuperarEquipo,
            equipo_entregado: equipoEntregado,
        })
        await t.emit('asignacion.cambiada', {
            servicio_id: input.id,
            empresa_id: empresaId,
            ipv4: [],
            prefijo_enlace_v6: null,
            prefijo_delegado_v6: null,
            inicio: ahora,
            fin: ahora,
        })
        // retirado → lápida en aaa:user:<user_ppp>
        refrescarAaaAlConfirmar(t, { servicioId: input.id })
        return despues
    }
}

/** Promociones de velocidad del servicio retirado: cierra el tramo abierto y quita las asignaciones. */
async function quitarPromocionesPorRetiro(t: Transaccion, servicioId: number) {
    await cerrarTramosAbiertos(t, { servicioId }, 'retiro')
    const asignaciones = (await t.trx
        .from('core.promociones_velocidad_servicios')
        .where({ servicio_id: servicioId, estado: 'vigente' })
        .update(
            {
                estado: 'quitada',
                quitada_en: t.trx.knexRawQuery('now()'),
                motivo: 'retiro',
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>,
            ['id'],
        )) as Array<{ id: number }>
    for (const a of asignaciones) {
        await t.registrarCambios(
            { tipo: 'promocion_servicio', id: Number(a.id) },
            { estado: 'vigente' },
            { estado: 'quitada' },
        )
    }
}
