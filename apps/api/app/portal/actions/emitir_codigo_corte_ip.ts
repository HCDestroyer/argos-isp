import { DomainAction, type Transaccion } from '#shared/domain_action'
import { LOCK_ROUTEROS_SERVICIO } from '#network/routeros/dispatcher'
import { sincronizarCodigoCorte } from '#portal/codigos_corte'

export interface EntradaEmitirCodigoCorteIp {
    servicio_id: number
    /** IP con la que el portal identificó al servicio (solo para la auditoría) */
    ip: string
}

export interface CodigoCorteEmitido {
    /** código abierto de la suspensión; null si el servicio ya no está suspendido */
    codigo: string | null
    /** se creó ahora (con `portal.codigo_corte_emitido`) */
    creado: boolean
}

/**
 * Primer salto del corte (`contratos/corte-identificacion.md` §5 ter.1): el portal identificó al
 * suspendido por una IP de cliente (túnel WireGuard, LAN del ISP o IPv6, sin NAT) y le entrega el código
 * de su suspensión para el segundo salto (`/corte?c=`), que puede volver a salir por Internet.
 *
 * - Solo un servicio `suspendido` (P5: un código por suspensión). Reutiliza el abierto o crea uno con
 *   `sincronizarCodigoCorte` (emite `portal.codigo_corte_emitido`, nunca el código).
 * - Toma el candado del servicio de `routeros.aplicar_servicio` y relee el estado: un código nunca queda
 *   abierto en un servicio reactivado (si ganó la carrera, el `servicio.estado_cambiado` siguiente lo cierra).
 * - Auditoría solo cuando crea un código (reutilizar el abierto es una lectura que se repite en cada sonda
 *   del sistema operativo). La entrada no lleva el código.
 */
export default class EmitirCodigoCortePorIp extends DomainAction<
    EntradaEmitirCodigoCorteIp,
    CodigoCorteEmitido
> {
    readonly nombre = 'portal.codigo_corte.emitir'

    protected auditarExito(salida: CodigoCorteEmitido): boolean {
        return salida.creado
    }

    protected async handle(input: EntradaEmitirCodigoCorteIp, t: Transaccion): Promise<CodigoCorteEmitido> {
        t.fijarEntidad('servicio', input.servicio_id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [
            LOCK_ROUTEROS_SERVICIO,
            input.servicio_id,
        ])
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .select('estado', 'router_id', 'empresa_id')
            .first()) as { estado: string; router_id: number | string; empresa_id: number | string } | null
        if (!servicio || servicio.estado !== 'suspendido') return { codigo: null, creado: false }
        t.fijarEmpresa(Number(servicio.empresa_id))
        const abierto = (await t.trx
            .from('core.codigos_corte')
            .where('servicio_id', input.servicio_id)
            .whereNull('cerrado_en')
            .select('codigo')
            .first()) as { codigo: string } | null
        if (abierto) return { codigo: abierto.codigo, creado: false }
        const c = await sincronizarCodigoCorte(
            t,
            {
                servicio_id: input.servicio_id,
                estado: servicio.estado,
                router_id: Number(servicio.router_id),
            },
            true,
        )
        return { codigo: c.codigo, creado: c.codigo !== null }
    }
}
