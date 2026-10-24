import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { generar } from '#tests/billing/ayudas_billing'
import { prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import CrearPremio from '#lealtad/actions/crear_premio'
import Canjear from '#lealtad/actions/canjear'
import RevertirCanje from '#lealtad/actions/revertir_canje'
import CrearSorteo from '#lealtad/actions/crear_sorteo'
import { ConsumidorNotify } from '#notify/consumidor'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { tipoDeAviso } from '#notify/configuracion'
import { CanalFalso, ColaFalsa, eventoOutbox } from '#tests/notify/ayudas_notify'

/**
 * Avisos al cliente que faltaban (pedidos de A3, `a3.md`): canjes de lealtad (reservado, aplicado y
 * revertido, con el flujo real de A3), el ganador de un sorteo (código y fecha límite) y la entrega
 * del premio, y la bonificación de un periodo en Q0. Cada evento entregado dos veces deja un solo
 * envío; la marca y la empresa son las del evento.
 */

interface Envio {
    evento: string
    canal: string
    empresa_id: number | null
    asunto: string | null
    cuerpo: string
    estado: string
}

async function enviosDe(clienteId: number, evento: string): Promise<Envio[]> {
    return (await db
        .from('notify.envios')
        .where('cliente_id', clienteId)
        .where('evento', evento)
        .orderBy('id')
        .select('evento', 'canal', 'empresa_id', 'asunto', 'cuerpo', 'estado')) as Envio[]
}

async function conCorreo(clienteId: number) {
    await db
        .from('core.clientes')
        .where('id', clienteId)
        .update({ email: `${unico('canje')}@prueba.local`, canal_preferido: 'correo' })
}

/** Entrega dos veces al consumidor los eventos `evento` del outbox con `cliente_id`. */
async function entregarDelOutbox(evento: string, clienteId: number) {
    const filas = (await db
        .from('audit.outbox')
        .where('evento', evento)
        .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
        .orderBy('id')
        .select('id', 'payload')) as Array<{ id: number; payload: Record<string, unknown> }>
    const consumidor = new ConsumidorNotify(new ColaFalsa())
    for (let i = 0; i < 2; i++) {
        for (const f of filas) {
            await consumidor.procesar({ id: Number(f.id), evento, payload: f.payload, requestId: 'prueba' })
        }
    }
    return filas
}

async function entregar(evento: string, payload: Record<string, unknown>) {
    const id = await eventoOutbox(evento, payload)
    const consumidor = new ConsumidorNotify(new ColaFalsa())
    for (let i = 0; i < 2; i++) await consumidor.procesar({ id, evento, payload, requestId: 'prueba' })
}

test.group('notify · avisos de canjes, sorteos y bonificaciones', (group) => {
    group.each.setup(() => {
        registrarCanal('correo', new CanalFalso('correo'))
        return () => reiniciarCanales()
    })
    group.each.teardown(() => soloEmpresaPrincipal())

    test('tipos de aviso: sorteos con lealtad y la bonificación con factura', ({ assert }) => {
        assert.equal(tipoDeAviso('lealtad.canje_aplicado'), 'lealtad')
        assert.equal(tipoDeAviso('sorteo.ganador_notificado'), 'lealtad')
        assert.equal(tipoDeAviso('bonificacion.registrada'), 'factura')
    })

    test('canje reservado, aplicado en la factura y revertido: un aviso por evento con el flujo real de A3', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { programa } = await programaConReglas(e.B, e.ctx, {
            nombre: 'Puntos Fibra',
            diferimiento: true,
        })
        const s = await servicioEn(e.B, { precio: '200.00', instalacion: '2026-10-01' })
        await conCorreo(s.clienteId)
        await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 200, motivo: 'saldo inicial' },
            e.ctx,
        )
        const premio = await new CrearPremio().execute(
            {
                programa_id: programa.id,
                nombre: 'Q50 de descuento',
                tipo: 'descuento_factura',
                descuento_tipo: 'monto',
                descuento_valor: '50.00',
                costo_puntos: 60,
            },
            e.ctx,
        )
        const canje = await new Canjear().execute(
            { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: premio.id },
            e.ctx,
        )
        assert.equal(canje.estado, 'reservado')
        await entregarDelOutbox('lealtad.canje_reservado', s.clienteId)
        const [reservado, ...otros] = await enviosDe(s.clienteId, 'lealtad.canje_reservado')
        assert.lengthOf(otros, 0, 'la entrega doble no duplica')
        assert.equal(reservado!.asunto, 'Canje registrado: Q50 de descuento')
        assert.include(
            reservado!.cuerpo,
            'Canjeaste 60 puntos por Q50 de descuento. El descuento se aplicará en tu próxima factura. Tu saldo es de 140 puntos.',
        )
        assert.equal(reservado!.empresa_id, e.B)

        // la próxima factura lleva el descuento: canje aplicado
        await generar(s.servicioId, '2026-10-01')
        const aplicados = await entregarDelOutbox('lealtad.canje_aplicado', s.clienteId)
        assert.lengthOf(aplicados, 1)
        const [aplicado, ...repetidos] = await enviosDe(s.clienteId, 'lealtad.canje_aplicado')
        assert.lengthOf(repetidos, 0)
        assert.equal(aplicado!.asunto, 'Aplicamos tu canje: Q50 de descuento')
        assert.match(
            aplicado!.cuerpo,
            /Aplicamos un descuento de Q 50\.00 por tu canje de Q50 de descuento en tu factura \S+\./,
        )

        // otro canje, revertido: devuelve los puntos
        const otro = await new Canjear().execute(
            { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: premio.id },
            e.ctx,
        )
        await new RevertirCanje().execute({ id: otro.id, motivo: 'el cliente lo pidió' }, e.ctx)
        await entregarDelOutbox('lealtad.canje_revertido', s.clienteId)
        const [revertido, ...mas] = await enviosDe(s.clienteId, 'lealtad.canje_revertido')
        assert.lengthOf(mas, 0)
        assert.include(
            revertido!.cuerpo,
            'Revertimos tu canje de Q50 de descuento (motivo: el cliente lo pidió). Devolvimos 60 puntos a tu saldo, que ahora es de 140 puntos.',
        )
    })

    test('sorteo: el ganador recibe su código, su premio y la fecha límite; la entrega se avisa', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { programa } = await programaConReglas(e.B, e.ctx)
        const nombre = unico('Sorteo de aniversario')
        const sorteo = await new CrearSorteo().execute(
            {
                empresa_id: e.B,
                nombre,
                premios: [{ nombre: 'Router Wi-Fi 6', valor: '300.00', tipo: 'bien' }],
            },
            e.ctx,
        )
        assert.equal(Number(sorteo.programa_id ?? programa.id), programa.id)
        const s = await servicioEn(e.B)
        await conCorreo(s.clienteId)

        await entregar('sorteo.ganador_notificado', {
            sorteo_id: sorteo.id,
            empresa_id: e.B,
            ganador_id: 1,
            cliente_id: s.clienteId,
            posicion: 2,
            tipo: 'suplente',
            codigo: 'GAN-7Q4X',
            premio: { posicion: 1, nombre: 'Router Wi-Fi 6', valor: '300.00', tipo: 'bien' },
            reclamar_antes: '2026-11-30T23:00:00.000Z',
            sustituye_a: 9,
        })
        const [ganador, ...otros] = await enviosDe(s.clienteId, 'sorteo.ganador_notificado')
        assert.lengthOf(otros, 0)
        assert.equal(ganador!.asunto, `¡Ganaste en ${nombre}!`)
        assert.include(ganador!.cuerpo, 'como suplente: el premio no fue reclamado a tiempo y ahora es tuyo')
        assert.include(ganador!.cuerpo, 'Premio: Router Wi-Fi 6 (valor Q 300.00)')
        assert.include(ganador!.cuerpo, 'Tu código de ganador: GAN-7Q4X')
        // 23:00 UTC = 17:00 en Guatemala
        assert.include(ganador!.cuerpo, 'Reclámalo antes del 30/11/2026 17:00')
        assert.equal(ganador!.empresa_id, e.B)

        await entregar('sorteo.premio_entregado', {
            sorteo_id: sorteo.id,
            empresa_id: e.B,
            cliente_id: s.clienteId,
            posicion: 2,
        })
        const entregados = await enviosDe(s.clienteId, 'sorteo.premio_entregado')
        assert.lengthOf(entregados, 1)
        assert.include(entregados[0]!.cuerpo, `Registramos la entrega de tu premio del sorteo ${nombre}.`)
    })

    test('bonificación: avisa el periodo sin costo y no la que sale de un canje', async ({ assert }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B)
        await conCorreo(s.clienteId)

        await entregar('bonificacion.registrada', {
            bonificacion_id: 1_999_999_001,
            empresa_id: e.B,
            cliente_id: s.clienteId,
            servicio_id: s.servicioId,
            periodo: '2026-11-01',
            origen: 'mes_gratis',
            bruto: '150.00',
        })
        const [aviso, ...otros] = await enviosDe(s.clienteId, 'bonificacion.registrada')
        assert.lengthOf(otros, 0)
        assert.equal(aviso!.asunto, 'Sin costo: Mes gratis')
        assert.match(
            aviso!.cuerpo,
            /Tu servicio .* de noviembre 2026 no tiene costo \(Mes gratis\): te bonificamos Q 150\.00\. Por eso no recibirás factura/,
        )

        await entregar('bonificacion.registrada', {
            bonificacion_id: 1_999_999_002,
            empresa_id: e.B,
            cliente_id: s.clienteId,
            servicio_id: s.servicioId,
            periodo: '2026-12-01',
            origen: 'canje',
            bruto: '150.00',
        })
        assert.lengthOf(await enviosDe(s.clienteId, 'bonificacion.registrada'), 1, 'la de un canje no')
    })
})
