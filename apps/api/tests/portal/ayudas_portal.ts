import db from '@adonisjs/lucid/services/db'
import { unico } from '#tests/ayudas'

/**
 * Datos de prueba del portal: cliente, servicio con facturas y sesiones de red.
 * Insertan directo en las tablas porque las acciones de A1/A3 que los crean no son del portal.
 */

let contador = 0

/** Cliente + servicio con facturas: adeudado 399.75, vencidas 2 por 299.75. */
export async function crearServicio(opciones: { estado?: string; nombre?: string; promesa?: boolean } = {}) {
    contador += 1
    const sufijo = unico('portal')
    const [router] = await db
        .table('network.routers')
        .insert({ nombre: `router-${sufijo}`, host: 'lab', nas_ip: `192.0.2.${100 + contador}` })
        .returning('id')
    const [plan] = await db
        .table('network.planes')
        .insert({ nombre: `plan-${sufijo}`, precio: '150.00', bajada_kbps: 20000, subida_kbps: 5000 })
        .returning('id')
    const [cliente] = await db
        .table('core.clientes')
        .insert({
            nombre: opciones.nombre ?? 'María José García López',
            email: 'maria@example.com',
            telefono: '5555-1234',
            nit_cui: '1234567-8',
            direccion: '5a avenida 10-20 zona 1',
        })
        .returning('id')
    const [servicio] = await db
        .table('core.servicios')
        .insert({
            cliente_id: cliente.id,
            router_id: router.id,
            plan_id: plan.id,
            estado: opciones.estado ?? 'suspendido',
            user_ppp: `ppp-${sufijo}`,
            pass_ppp: 'cifrado',
        })
        .returning('id')

    const factura = (periodo: string, vence: string, est: string, total: string, pagado = '0.00') => ({
        cliente_id: cliente.id,
        servicio_id: servicio.id,
        periodo,
        clave_unica: `${servicio.id}-${periodo}`,
        vence_en: vence,
        estado: est,
        subtotal: total,
        iva: '0.00',
        total,
        pagado,
    })
    await db.table('billing.facturas').multiInsert([
        factura('2026-07-01', '2026-07-10', 'vencida', '150.00'),
        // parcial ya pasada su fecha aunque el cron aún no la marque vencida
        factura('2026-08-01', '2026-08-10', 'parcial', '200.00', '50.25'),
        factura('2099-01-01', '2099-01-10', 'emitida', '100.00'),
        factura('2026-06-01', '2026-06-10', 'pagada', '150.00', '150.00'),
        factura('2026-05-01', '2026-05-10', 'anulada', '999.00'),
    ])
    if (opciones.promesa) {
        await db.table('billing.promesas').insert({
            servicio_id: servicio.id,
            cliente_id: cliente.id,
            vence_en: '2099-01-01T00:00:00Z',
            monto: '100.00',
            canal: 'portal',
        })
    }
    return { servicioId: Number(servicio.id), routerId: Number(router.id), sufijo }
}

export async function crearSesion(
    s: { servicioId: number; routerId: number; sufijo: string },
    datos: { ipv4?: string; enlace?: string; delegado?: string; fin?: string },
) {
    await db.table('network.sesiones').insert({
        servicio_id: s.servicioId,
        router_id: s.routerId,
        nas_ip: '192.0.2.1',
        acct_session_id: unico('acct'),
        user_ppp: `ppp-${s.sufijo}`,
        ipv4: datos.ipv4 ?? null,
        prefijo_enlace_v6: datos.enlace ?? null,
        prefijo_delegado_v6: datos.delegado ?? null,
        fin: datos.fin ?? null,
    })
}
