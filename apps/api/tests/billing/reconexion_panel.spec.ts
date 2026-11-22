import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import RegistrarComprobante from '#billing/actions/registrar_comprobante'
import {
    cuentaBancariaPrueba,
    estadoServicio,
    eventosDe,
    servicioCortado,
    unicoBd,
} from '#tests/billing/ayudas_billing'

/**
 * Reconexión temporal desde el panel (decisión del PM 15): `POST /comprobantes/:id/reconectar` con
 * permiso propio (cajero y soporte de fábrica), mismas reglas y mismo cupo que Iris.
 */

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-datos-de-prueba'),
])

async function comprobante(clienteId: number, servicioId: number) {
    const cuenta = await cuentaBancariaPrueba()
    return new RegistrarComprobante().execute(
        {
            cliente_id: clienteId,
            servicio_id: servicioId,
            metodo: 'deposito',
            cuenta_bancaria_id: cuenta.id,
            referencia: await unicoBd('boleta'),
            monto: '300.00',
            fecha_deposito: '2026-10-08',
            canal: 'portal',
            archivo: { contenido: PNG, nombre: 'boleta.png' },
        },
        { actor: { tipo: 'sistema', id: null }, canal: 'portal', requestId: randomUUID() },
    )
}

test.group('billing · reconexión temporal desde el panel (decisión 15)', () => {
    test('el cajero reconecta con las reglas de la plantilla; cupo compartido y permiso propio', async ({
        client,
        assert,
    }) => {
        const e = await servicioCortado()
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: soporte } = await usuarioConRoles(['soporte'])
        const k1 = await comprobante(e.clienteId, e.servicioId)
        const reconectar = (token: string, id: number) =>
            client
                .post(`/api/v1/comprobantes/${id}/reconectar`)
                .bearerToken(token)
                .json({ motivo: 'sin_personal' })

        await estado(reconectar(tecnico, k1.id), 403)
        // la plantilla no la permite (de fábrica)
        const apagada = await estado(reconectar(cajero, k1.id), 422)
        assert.equal(apagada.body().errors[0].rule, 'no_habilitada')

        await db
            .from('billing.plantillas_facturacion')
            .where('id', e.plantillaId)
            .update({
                reglas_promesa: JSON.stringify(
                    normalizarReglasPromesa({
                        no_exceder_siguiente_facturacion: false,
                        reconexion_temporal: { permitida: true, max_por_periodo: 1 },
                    }),
                ),
            })
        const r = await estado(reconectar(cajero, k1.id), 201)
        assert.equal(r.body().servicio.estado, 'activo')
        const promesa = await db.from('billing.promesas').where('id', r.body().promesa_id).first()
        assert.equal(promesa.tipo, 'reconexion_temporal')
        assert.equal(promesa.canal, 'operador')
        assert.isNull(promesa.sistema_origen)
        assert.lengthOf(await eventosDe('promesa.creada', 'promesa_id', r.body().promesa_id), 1)
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'comprobantes.reconectar')
            .orderBy('id', 'desc')
            .first()
        assert.equal(accion.resultado, 'ok')

        // misma regla de promesa abierta que Iris
        const k2 = await comprobante(e.clienteId, e.servicioId)
        const abierta = await estado(reconectar(soporte, k2.id), 422)
        assert.equal(abierta.body().errors[0].rule, 'promesa_abierta')

        // al rechazar el comprobante la reconexión se cancela y el servicio vuelve a cortarse
        await estado(
            client
                .post(`/api/v1/comprobantes/${k1.id}/rechazar`)
                .bearerToken(cajero)
                .json({ causa: 'no_aparece', motivo: 'No aparece en el banco' }),
            200,
        )
        assert.equal(await estadoServicio(e.servicioId), 'suspendido')
        // cupo de 1 por periodo, ya usado
        const cupo = await estado(reconectar(soporte, k2.id), 422)
        assert.equal(cupo.body().errors[0].rule, 'cupo_agotado')
    })
})
