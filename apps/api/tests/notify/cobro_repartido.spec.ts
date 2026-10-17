import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEmpresaFila, crearPlanFila, crearServicioFila } from '#tests/core/fabricas'
import { crearPlantillaFila, eventosDe, generar } from '#tests/billing/ayudas_billing'
import { ConsumidorNotify } from '#notify/consumidor'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { CanalFalso, ColaFalsa } from '#tests/notify/ayudas_notify'

/**
 * Cobro repartido (multiempresa): un cobro en caja que cubre facturas de dos empresas llega como
 * dos `pago.registrado` (uno por empresa, mismo `cobro_id`). Decisión de A6: un aviso por empresa,
 * cada uno con su marca, que dice que es parte de un cobro mayor; idempotente si el evento se
 * repite; la auditoría de `notificaciones.programar` queda en la empresa de cada pago.
 */

const A = 1

interface FilaOutbox {
    id: number
    evento: string
    payload: Record<string, unknown>
    request_id: string | null
}

async function cajaAbierta(client: any, token: string, empresaId: number): Promise<number> {
    const caja = await estado(
        client
            .post('/api/v1/cajas')
            .bearerToken(token)
            .header('X-Empresa-Id', String(empresaId))
            .json({ nombre: unico('Caja') }),
        201,
    )
    await estado(
        client
            .post(`/api/v1/cajas/${caja.body().id}/abrir`)
            .bearerToken(token)
            .header('X-Empresa-Id', String(empresaId))
            .json({ fondo_inicial: '0.00' }),
        201,
    )
    return caja.body().id as number
}

/** Cliente con correo y un servicio en la empresa 1 y otro en una nueva, con septiembre y octubre facturados. */
async function clienteDeDosEmpresas() {
    const nombreB = unico('Fibra Sur')
    const B = await crearEmpresaFila({ nombre_comercial: nombreB })
    const plantillaId = await crearPlantillaFila()
    const planId = await crearPlanFila({
        precio: '150.00',
        bajada_limitada_kbps: 1000,
        subida_limitada_kbps: 1000,
    })
    const clienteId = await crearClienteFila()
    await db
        .from('core.clientes')
        .where('id', clienteId)
        .update({ email: `${unico('c')}@prueba.local`, canal_preferido: 'correo' })
    const datos = {
        cliente_id: clienteId,
        plan_id: planId,
        plantilla_facturacion_id: plantillaId,
        fecha_instalacion: '2026-09-01',
    }
    const servicioA = await crearServicioFila({ ...datos, empresa_id: A })
    const servicioB = await crearServicioFila({ ...datos, empresa_id: B })
    await generar(servicioA, '2026-10-01')
    await generar(servicioB, '2026-10-01')
    const nombreA = (
        (await db.from('core.empresas').where('id', A).select('nombre_comercial').firstOrFail()) as {
            nombre_comercial: string
        }
    ).nombre_comercial
    return { A, B, nombreA, nombreB, clienteId }
}

async function entregar(consumidor: ConsumidorNotify, ...eventos: FilaOutbox[]) {
    for (const e of eventos) {
        await consumidor.procesar({ id: e.id, evento: e.evento, payload: e.payload, requestId: e.request_id })
    }
}

test.group('notify · cobro repartido entre empresas', (group) => {
    let correo: CanalFalso
    let consumidor: ConsumidorNotify

    group.each.setup(() => {
        correo = new CanalFalso('correo')
        registrarCanal('correo', correo)
        consumidor = new ConsumidorNotify(new ColaFalsa())
        return () => reiniciarCanales()
    })
    group.each.teardown(() => soloEmpresaPrincipal())

    test('un aviso por empresa con su marca y la mención del cobro; idempotente', async ({
        client,
        assert,
    }) => {
        const e = await clienteDeDosEmpresas()
        const { token } = await usuarioConRoles(['admin'])
        await cajaAbierta(client, token, e.A)
        await cajaAbierta(client, token, e.B)
        // 400: A-sep 150, B-sep 150, A-oct 100
        const cobro = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.A))
                .json({ cliente_id: e.clienteId, metodo: 'caja', monto: '400.00' }),
            201,
        )
        const pagos = cobro.body().pagos as Array<{ id: number; empresa_id: number; cobro_id: number }>
        assert.lengthOf(pagos, 2)
        const eventos: FilaOutbox[] = []
        for (const pago of pagos) {
            eventos.push(...((await eventosDe('pago.registrado', 'pago_id', pago.id)) as FilaOutbox[]))
        }
        assert.lengthOf(eventos, 2)
        assert.equal(eventos[0]!.payload.cobro_id, eventos[1]!.payload.cobro_id)

        // Cada evento llega dos veces y en desorden
        await entregar(consumidor, eventos[1]!, eventos[0]!, eventos[0]!, eventos[1]!)

        const envios = (await db
            .from('notify.envios')
            .where({ cliente_id: e.clienteId, evento: 'pago.registrado' })
            .orderBy('empresa_id', 'asc')
            .select('id', 'origen', 'empresa_id', 'cuerpo', 'asunto', 'variables')) as Array<{
            id: number
            origen: string
            empresa_id: number
            cuerpo: string
            asunto: string
            variables: { cobro: Record<string, unknown>; pago: Record<string, unknown> }
        }>
        assert.deepEqual(
            envios.map((x) => Number(x.empresa_id)),
            [e.A, e.B],
        )
        const [deA, deB] = envios as [(typeof envios)[0], (typeof envios)[0]]
        assert.equal(deA.asunto, 'Pago recibido: Q 250.00')
        assert.equal(deB.asunto, 'Pago recibido: Q 150.00')
        assert.include(
            deA.cuerpo,
            `parte de ${e.nombreA} de tu pago total de Q 400.00; el resto lo aplicó ${e.nombreB}`,
        )
        assert.include(
            deB.cuerpo,
            `parte de ${e.nombreB} de tu pago total de Q 400.00; el resto lo aplicó ${e.nombreA}`,
        )
        assert.include(deB.cuerpo, e.nombreB) // pie con la marca de su empresa
        assert.deepEqual(deA.variables.cobro, {
            id: pagos[0]!.cobro_id,
            monto: '400.00',
            monto_q: 'Q 400.00',
            partes: 2,
            repartido: true,
            otras_empresas: e.nombreB,
        })

        // Auditoría de la programación en la empresa de cada pago
        const auditoria = (await db
            .from('audit.acciones')
            .where({ accion: 'notificaciones.programar', entidad_tipo: 'cliente', entidad_id: e.clienteId })
            .whereIn(
                'request_id',
                eventos.map((x) => x.request_id!),
            )
            .distinct('empresa_id')) as Array<{ empresa_id: number }>
        assert.sameMembers(
            auditoria.map((x) => Number(x.empresa_id)),
            [e.A, e.B],
        )
    })

    test('cobro de una sola empresa: sin la mención del cobro repartido', async ({ client, assert }) => {
        const clienteId = await crearClienteFila()
        await db
            .from('core.clientes')
            .where('id', clienteId)
            .update({ email: `${unico('c')}@prueba.local`, canal_preferido: 'correo' })
        const planId = await crearPlanFila({
            precio: '150.00',
            bajada_limitada_kbps: 1000,
            subida_limitada_kbps: 1000,
        })
        const servicio = await crearServicioFila({
            cliente_id: clienteId,
            plan_id: planId,
            plantilla_facturacion_id: await crearPlantillaFila(),
            fecha_instalacion: '2026-09-01',
            empresa_id: A,
        })
        await generar(servicio, '2026-10-01')
        const { token } = await usuarioConRoles(['admin'])
        await cajaAbierta(client, token, A)
        const cobro = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .header('X-Empresa-Id', String(A))
                .json({ cliente_id: clienteId, metodo: 'caja', monto: '150.00' }),
            201,
        )
        const [evento] = (await eventosDe('pago.registrado', 'pago_id', cobro.body().id)) as FilaOutbox[]
        await entregar(consumidor, evento!)
        const [envio] = (await db
            .from('notify.envios')
            .where({ cliente_id: clienteId, evento: 'pago.registrado' })
            .select('cuerpo', 'variables')) as Array<{ cuerpo: string; variables: Record<string, any> }>
        assert.notInclude(envio!.cuerpo, 'pago total')
        if (envio!.variables.cobro) assert.isFalse(envio!.variables.cobro.repartido)
    })
})
