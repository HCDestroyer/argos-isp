import type { Transaccion } from '#shared/domain_action'
import type { ClienteRouterOS } from '#network/routeros/cliente'
import { bitacoraRed } from '#network/routeros/dispatcher'

/**
 * Identidad del equipo (A1, `contratos/routers.md`): con un router que ya respondió al sondeo, lee
 * su número de serie (`/system/routerboard` `serial-number`, o `software-id` de `/system/license`
 * en un CHR) y lo guarda en `network.routers.serial` si cambió, con su diff en `audit.cambios`
 * (sin subir `version`: es un dato del equipo, no una edición). Sirve para detectar el mismo
 * MikroTik registrado dos veces (`GET /routers/duplicados`); nunca bloquea: si el equipo no lo
 * informa o la lectura falla, el serial queda como estaba.
 *
 * La lectura queda en `audit.red` (`comando.operacion = identificar`, `comando.ruta` = la que
 * respondió: `/system/routerboard` o `/system/license`) con su resultado. El sondeo solo la hace
 * cuando el serial no se conoce o el router vuelve de estar caído (nota de A2, 29 oct).
 */
export async function identificarRouter(
    t: Transaccion,
    cliente: ClienteRouterOS,
    routerId: number,
): Promise<string | null> {
    const comando = {
        operacion: 'identificar',
        metodo: 'GET',
        ruta: '/system/routerboard',
        request_id: t.ctx.requestId,
        host: cliente.host,
    }
    let leido: Awaited<ReturnType<ClienteRouterOS['identificar']>>
    try {
        leido = await cliente.identificar()
    } catch (error) {
        const e = error as Error & { status?: number | null; tipo?: string }
        await bitacoraRed.registrar({
            tipo: 'routeros',
            router_id: routerId,
            servicio_id: null,
            comando,
            respuesta: { status: e.status ?? null, error: e.message, tipo_error: e.tipo ?? 'inalcanzable' },
            ok: false,
        })
        return null
    }
    const serial = leido?.serial ?? null
    await bitacoraRed.registrar({
        tipo: 'routeros',
        router_id: routerId,
        servicio_id: null,
        // sin dato se leyeron las dos rutas; la última fue `/system/license`
        comando: { ...comando, ruta: leido?.ruta ?? '/system/license' },
        respuesta: { status: 200, serial },
        ok: true,
    })
    if (serial === null) return null

    const fila = (await t.trx.from('network.routers').where('id', routerId).select('serial').first()) as {
        serial: string | null
    } | null
    if (!fila || fila.serial === serial) return serial
    await t.trx.from('network.routers').where('id', routerId).update({ serial })
    await t.registrarCambios({ tipo: 'router', id: routerId }, { serial: fila.serial }, { serial })
    return serial
}
