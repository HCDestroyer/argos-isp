import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico } from '#tests/ayudas'
import { ConsumidorNotify } from '#notify/consumidor'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import RegistrarComprobante from '#billing/actions/registrar_comprobante'
import AprobarComprobante from '#billing/actions/aprobar_comprobante'
import RegistrarPago from '#billing/actions/registrar_pago'
import { CanalFalso, ColaFalsa, cuentaBancariaUnica } from '#tests/notify/ayudas_notify'
import { bancoId, eventosDe, facturasDe, servicioCortado } from '#tests/billing/ayudas_billing'

/**
 * Avisos de comprobantes y de pagos de terceros (día 4, tanda 2). Los eventos salen de las
 * acciones reales de A3 (`audit.outbox`) y se entregan a `ConsumidorNotify` como lo hace el relay.
 */

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-datos-de-prueba'),
])

interface FilaOutbox {
    id: number
    evento: string
    payload: Record<string, unknown>
    request_id: string | null
}

/** Cliente con correo y nombre conocidos (los escenarios de billing no traen correo). */
async function conCorreo(clienteId: number, nombre = unico('Cliente')): Promise<string> {
    await db
        .from('core.clientes')
        .where('id', clienteId)
        .update({ nombre, email: `${unico('c')}@prueba.local`, canal_preferido: 'correo' })
    return nombre
}

async function entregar(consumidor: ConsumidorNotify, ...eventos: FilaOutbox[]) {
    for (const e of eventos) {
        await consumidor.procesar({ id: e.id, evento: e.evento, payload: e.payload, requestId: e.request_id })
    }
}

function enviosDe(clienteId: number) {
    return db
        .from('notify.envios')
        .where('cliente_id', clienteId)
        .orderBy('id', 'asc')
        .select('id', 'origen', 'evento', 'canal', 'asunto', 'cuerpo', 'estado')
}

async function subirComprobante(clienteId: number, servicioId: number, referencia = unico('boleta')) {
    const cuenta = await cuentaBancariaUnica()
    return new RegistrarComprobante().execute(
        {
            cliente_id: clienteId,
            servicio_id: servicioId,
            metodo: 'deposito',
            cuenta_bancaria_id: cuenta.id,
            referencia,
            monto: '300.00',
            fecha_deposito: '2026-10-08',
            canal: 'portal',
            archivo: { contenido: PNG, nombre: 'boleta.png' },
        },
        { actor: { tipo: 'sistema', id: null }, canal: 'portal', requestId: unico('req') },
    )
}

/** Comprobante aprobado: devuelve sus dos eventos (`pago.registrado` y `comprobante.aprobado`). */
async function comprobanteAprobado() {
    const { clienteId, servicioId } = await servicioCortado()
    await conCorreo(clienteId)
    const comprobante = await subirComprobante(clienteId, servicioId)
    const aprobado = await new AprobarComprobante().execute(
        { comprobante_id: comprobante.id },
        contextoPrueba(),
    )
    const [pago] = (await eventosDe('pago.registrado', 'pago_id', aprobado.pago.id)) as FilaOutbox[]
    const [aprobacion] = (await eventosDe(
        'comprobante.aprobado',
        'comprobante_id',
        comprobante.id,
    )) as FilaOutbox[]
    return { clienteId, pagoId: aprobado.pago.id, pago: pago!, aprobacion: aprobacion! }
}

test.group('notify · avisos de comprobantes y pagos de terceros', (group) => {
    let correo: CanalFalso
    let consumidor: ConsumidorNotify

    group.each.setup(() => {
        correo = new CanalFalso('correo')
        registrarCanal('correo', correo)
        consumidor = new ConsumidorNotify(new ColaFalsa())
        return () => reiniciarCanales()
    })

    test('comprobante.recibido: acusa recibo con el monto y la referencia', async ({ assert }) => {
        const { clienteId, servicioId } = await servicioCortado()
        const nombre = await conCorreo(clienteId)
        const referencia = unico('boleta')
        const comprobante = await subirComprobante(clienteId, servicioId, referencia)
        const eventos = (await eventosDe(
            'comprobante.recibido',
            'comprobante_id',
            comprobante.id,
        )) as FilaOutbox[]
        assert.lengthOf(eventos, 1)

        await entregar(consumidor, eventos[0]!, eventos[0]!)

        const envios = await enviosDe(clienteId)
        assert.lengthOf(envios, 1)
        assert.containsSubset(envios[0], {
            origen: `outbox:${eventos[0]!.id}`,
            evento: 'comprobante.recibido',
            canal: 'correo',
            estado: 'encolado',
            asunto: 'Recibimos tu comprobante de pago',
        })
        assert.include(envios[0].cuerpo, `Hola ${nombre}:`)
        assert.include(
            envios[0].cuerpo,
            `Recibimos tu comprobante de pago por Q 300.00 (referencia ${referencia}). Lo revisaremos`,
        )
    })

    test('aprobar comprobante: un solo aviso de pago (comprobante.aprobado), en cualquier orden y repetido', async ({
        assert,
    }) => {
        for (const orden of ['pago-primero', 'aprobado-primero'] as const) {
            const { clienteId, pago, aprobacion } = await comprobanteAprobado()
            const eventos = orden === 'pago-primero' ? [pago, aprobacion] : [aprobacion, pago]
            await entregar(consumidor, ...eventos, ...eventos)

            const envios = await enviosDe(clienteId)
            const avisos = envios.filter((e) =>
                ['pago.registrado', 'comprobante.aprobado'].includes(e.evento),
            )
            assert.lengthOf(avisos, 1, orden)
            assert.equal(avisos[0].evento, 'comprobante.aprobado', orden)
            assert.equal(avisos[0].origen, `outbox:${aprobacion.id}`, orden)
            assert.include(
                avisos[0].cuerpo,
                'Verificamos tu comprobante de pago por Q 300.00. Ya está aplicado a tu cuenta.',
                orden,
            )
        }
    })

    test('con la plantilla de comprobante.aprobado desactivada, el aviso sale por pago.registrado (uno)', async ({
        assert,
    }) => {
        await db.from('notify.plantillas').where('evento', 'comprobante.aprobado').update({ activa: false })
        try {
            const { clienteId, pago, aprobacion } = await comprobanteAprobado()
            await entregar(consumidor, aprobacion, pago, pago)
            const avisos = await enviosDe(clienteId)
            const dePago = avisos.filter((e) =>
                ['pago.registrado', 'comprobante.aprobado'].includes(e.evento),
            )
            assert.lengthOf(dePago, 1)
            assert.equal(dePago[0].evento, 'pago.registrado')
            assert.equal(dePago[0].asunto, 'Pago recibido: Q 300.00')
        } finally {
            await db
                .from('notify.plantillas')
                .where('evento', 'comprobante.aprobado')
                .update({ activa: true })
        }
    })

    test('pago de terceros: el pagador recibe su aviso y cada dueño distinto el suyo, una vez', async ({
        assert,
    }) => {
        const pagador = await servicioCortado()
        const familiar = await servicioCortado()
        const otro = await servicioCortado()
        const nombrePagador = await conCorreo(pagador.clienteId, unico('Pagador'))
        await conCorreo(familiar.clienteId)
        await conCorreo(otro.clienteId)
        const [septiembreF, octubreF] = await facturasDe(familiar.servicioId)
        const [septiembreO] = await facturasDe(otro.servicioId)
        const cuenta = await cuentaBancariaUnica()

        const pago = await new RegistrarPago().execute(
            {
                cliente_id: pagador.clienteId,
                metodo: 'transferencia',
                monto: '450.00',
                referencia: unico('trf'),
                cuenta_bancaria_id: cuenta.id,
                banco_origen_id: await bancoId(),
                facturas: [septiembreF!.id, octubreF!.id, septiembreO!.id],
            },
            contextoPrueba(),
        )
        const [evento] = (await eventosDe('pago.registrado', 'pago_id', pago.id)) as FilaOutbox[]
        assert.sameMembers(evento!.payload.clientes as number[], [
            pagador.clienteId,
            familiar.clienteId,
            otro.clienteId,
        ])

        await entregar(consumidor, evento!, evento!)

        const delPagador = await enviosDe(pagador.clienteId)
        assert.lengthOf(delPagador, 1)
        assert.containsSubset(delPagador[0], {
            evento: 'pago.registrado',
            asunto: 'Pago recibido: Q 450.00',
        })

        const delFamiliar = await enviosDe(familiar.clienteId)
        assert.lengthOf(delFamiliar, 1)
        assert.containsSubset(delFamiliar[0], {
            origen: `outbox:${evento!.id}`,
            evento: 'pago.registrado.tercero',
            asunto: `Pago recibido de tu factura ${septiembreF!.id}, ${octubreF!.id}`,
        })
        assert.include(
            delFamiliar[0].cuerpo,
            `Recibimos el pago de tus facturas ${septiembreF!.id}, ${octubreF!.id} por Q 300.00, hecho por ${nombrePagador}.`,
        )

        const delOtro = await enviosDe(otro.clienteId)
        assert.lengthOf(delOtro, 1)
        assert.include(
            delOtro[0].cuerpo,
            `Recibimos el pago de tu factura ${septiembreO!.id} por Q 150.00, hecho por ${nombrePagador}.`,
        )
    })

    test('evento sin clientes[] (anterior al pago de terceros): solo avisa al pagador', async ({
        assert,
    }) => {
        const pagador = await servicioCortado()
        const familiar = await servicioCortado()
        await conCorreo(pagador.clienteId)
        await conCorreo(familiar.clienteId)
        const [septiembreF] = await facturasDe(familiar.servicioId)
        const cuenta = await cuentaBancariaUnica()
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: pagador.clienteId,
                metodo: 'transferencia',
                monto: '150.00',
                referencia: unico('trf'),
                cuenta_bancaria_id: cuenta.id,
                banco_origen_id: await bancoId(),
                facturas: [septiembreF!.id],
            },
            contextoPrueba(),
        )
        const [evento] = (await eventosDe('pago.registrado', 'pago_id', pago.id)) as FilaOutbox[]
        const viejo = { ...evento!.payload }
        delete viejo.clientes

        await entregar(consumidor, { ...evento!, payload: viejo })

        const delPagador = await enviosDe(pagador.clienteId)
        const delFamiliar = await enviosDe(familiar.clienteId)
        assert.lengthOf(delPagador, 1)
        assert.lengthOf(delFamiliar, 0)
    })
})
