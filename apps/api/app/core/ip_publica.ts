import type { Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { asignarIpv4, liberarIpv4 } from '#network/ipam_v4'
import { registrarTramo } from '#network/historial'
import { asignacionesVigentes, requiereIpPublica } from '#core/asignaciones_servicio'
import { refrescarAaaAlConfirmar } from '#core/aaa'

/**
 * IP pública de un servicio (decisión del PM 30), de dos formas:
 *
 * - **Adicional cobrado** (`core.adicionales.tipo = 'ip_publica'`, precio en el catálogo): al agregarlo
 *   el servicio cambia su IPv4 por una de una red `publica` de su router (la asignación guarda la IP en
 *   `servicios_adicionales.ip_publica`); al quitarlo vuelve a una privada y la pública queda libre. Al
 *   retirar el servicio se liberan todas sus IPs (`liberarAsignaciones`).
 * - **Incluida en el plan** (`network.planes.incluye_ip_publica`): `reconciliarAsignaciones` la asigna
 *   al crear, activar o pasar el servicio a ese plan, y la devuelve al salir de él.
 *
 * Cambiar la IP emite `servicio.config_cambiada` (`campos: ['ips']`: `coa` desconecta para que la sesión
 * entre con la IP nueva) y `asignacion.cambiada`, abre un tramo del historial y reescribe `aaa:user:*`.
 * Un servicio pendiente de instalación no tiene IP: la toma al activarse.
 */

/** Pone (`quiere`) o quita la IP pública del servicio; devuelve la IPv4 vigente después. */
export async function aplicarIpPublica(
    t: Transaccion,
    servicioId: number,
    quiere: boolean,
): Promise<string | null> {
    const servicio = (await t.trx
        .from('core.servicios')
        .where('id', servicioId)
        .forUpdate()
        .select('router_id', 'plan_id', 'estado', 'empresa_id', 'tipo_conexion')
        .first()) as {
        router_id: number
        plan_id: number
        estado: string
        empresa_id: number
        tipo_conexion: string
    }
    const antes = await asignacionesVigentes(t.trx, servicioId)
    if (servicio.estado === 'retirado' || servicio.estado === 'pendiente_instalacion') return antes.ipv4
    const routerId = Number(servicio.router_id)
    if (quiere) {
        await asignarIpv4(t.trx, { servicioId, routerId, publica: true })
    } else {
        if (await requiereIpPublica(t.trx, servicioId, Number(servicio.plan_id))) return antes.ipv4
        const privada = await t.trx
            .from('network.redes_ipv4')
            .where('router_id', routerId)
            .where('publica', false)
            .first()
        if (privada) await asignarIpv4(t.trx, { servicioId, routerId, publica: false })
        else if (servicio.tipo_conexion === 'pppoe') await liberarIpv4(t.trx, servicioId)
        else {
            throw new ReglaNegocio(
                'El router no tiene redes IPv4 privadas a las que devolver el servicio',
                'sin_ipv4_libres',
            )
        }
    }
    const despues = await asignacionesVigentes(t.trx, servicioId)
    if (despues.ipv4 === antes.ipv4) return despues.ipv4
    const empresaId = Number(servicio.empresa_id)
    await t.registrarCambios(
        { tipo: 'servicio', id: servicioId },
        { ipv4: antes.ipv4 },
        { ipv4: despues.ipv4 },
    )
    await registrarTramo(t.trx, servicioId, quiere ? 'ip pública' : 'ip pública devuelta')
    await t.emit('servicio.config_cambiada', {
        servicio_id: servicioId,
        empresa_id: empresaId,
        campos: ['ips'],
    })
    await t.emit('asignacion.cambiada', {
        servicio_id: servicioId,
        empresa_id: empresaId,
        ipv4: despues.ipv4 ? [despues.ipv4] : [],
        prefijo_enlace_v6: despues.prefijo_enlace_v6,
        prefijo_delegado_v6: despues.prefijo_delegado_v6,
        inicio: new Date().toISOString(),
        fin: null,
    })
    refrescarAaaAlConfirmar(t, { servicioId })
    return despues.ipv4
}

/** Tipo del adicional del catálogo (`general` o `ip_publica`). */
export async function tipoAdicional(t: Transaccion, adicionalId: number): Promise<string> {
    const fila = (await t.trx.from('core.adicionales').where('id', adicionalId).select('tipo').first()) as {
        tipo: string
    } | null
    return fila?.tipo ?? 'general'
}
