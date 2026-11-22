import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import RegistrarComprobante from '#billing/actions/registrar_comprobante'
import {
    cuentaBancariaPrueba,
    estadoServicio,
    facturasDe,
    servicioCortado,
    unicoBd,
} from '#tests/billing/ayudas_billing'

/**
 * Comprobante con menos dinero (decisión del PM 14): se aplica como abono a las facturas más viejas,
 * la respuesta dice cuánto falta y el servicio se reevalúa. Con `rechazar_monto_distinto` en la
 * plantilla, 422 `monto_distinto` y nada se registra.
 */

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-datos-de-prueba'),
])

async function comprobante(clienteId: number, servicioId: number, monto: string) {
    const cuenta = await cuentaBancariaPrueba()
    return new RegistrarComprobante().execute(
        {
            cliente_id: clienteId,
            servicio_id: servicioId,
            metodo: 'deposito',
            cuenta_bancaria_id: cuenta.id,
            referencia: await unicoBd('boleta'),
            monto,
            fecha_deposito: '2026-10-08',
            canal: 'portal',
            archivo: { contenido: PNG, nombre: 'boleta.png' },
        },
        { actor: { tipo: 'sistema', id: null }, canal: 'portal', requestId: randomUUID() },
    )
}

test.group('billing · comprobante con menos dinero (decisión 14)', () => {
    test('abona a la más vieja, informa cuánto falta y reevalúa (suspendido → limitado)', async ({
        client,
        assert,
    }) => {
        const e = await servicioCortado()
        assert.equal(await estadoServicio(e.servicioId), 'suspendido')
        const k = await comprobante(e.clienteId, e.servicioId, '200.00')
        const { token } = await usuarioConRoles(['cajero'])
        const r = await estado(
            client.post(`/api/v1/comprobantes/${k.id}/aprobar`).bearerToken(token).json({}),
            200,
        )
        assert.deepEqual(r.body().cobertura, { deuda: '300.00', aplicado: '200.00', falta: '100.00' })
        assert.equal(r.body().estado, 'aprobado')
        const facturas = await facturasDe(e.servicioId)
        assert.deepEqual(
            facturas.map((f) => [f.periodo, f.estado, f.pagado]),
            [
                ['2026-09-01', 'pagada', '150.00'],
                ['2026-10-01', 'vencida', '50.00'],
            ],
        )
        assert.equal(await estadoServicio(e.servicioId), 'limitado')
        await afirmarLibroCuadrado(assert)
    })

    test('con rechazar_monto_distinto en la plantilla: 422 monto_distinto y no registra el pago', async ({
        client,
        assert,
    }) => {
        const e = await servicioCortado({ plantilla: { rechazar_monto_distinto: true } })
        const k = await comprobante(e.clienteId, e.servicioId, '200.00')
        const { token } = await usuarioConRoles(['cajero'])
        const r = await estado(
            client.post(`/api/v1/comprobantes/${k.id}/aprobar`).bearerToken(token).json({}),
            422,
        )
        assert.match(r.body().type, /monto_distinto$/)
        assert.equal(r.body().errors[0].message, 'faltan Q100.00')
        const fila = await db.from('billing.comprobantes').where('id', k.id).first()
        assert.equal(fila.estado, 'pendiente')
        assert.isNull(fila.pago_id)
        assert.equal(await estadoServicio(e.servicioId), 'suspendido')

        // el monto exacto sí se aprueba
        const exacto = await comprobante(e.clienteId, e.servicioId, '300.00')
        const ok = await estado(
            client.post(`/api/v1/comprobantes/${exacto.id}/aprobar`).bearerToken(token).json({}),
            200,
        )
        assert.deepEqual(ok.body().cobertura, { deuda: '300.00', aplicado: '300.00', falta: '0.00' })
        assert.equal(await estadoServicio(e.servicioId), 'activo')
        // y la causa de rechazo existe para el otro
        await estado(
            client
                .post(`/api/v1/comprobantes/${k.id}/rechazar`)
                .bearerToken(token)
                .json({ causa: 'monto_distinto', motivo: 'El monto no cubre lo vencido' }),
            200,
        )
    })

    test('la plantilla guarda y devuelve rechazar_monto_distinto', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const creada = await estado(
            client
                .post('/api/v1/plantillas-facturacion')
                .bearerToken(token)
                .json({
                    nombre: await unicoBd('Estricta', 'billing.plantillas_facturacion'),
                    ciclo: 'dia_fijo',
                    dia: 1,
                }),
            201,
        )
        assert.isFalse(creada.body().rechazar_monto_distinto)
        const editada = await estado(
            client
                .put(`/api/v1/plantillas-facturacion/${creada.body().id}`)
                .bearerToken(token)
                .json({ version: creada.body().version, rechazar_monto_distinto: true }),
            200,
        )
        assert.isTrue(editada.body().rechazar_monto_distinto)
    })
})
