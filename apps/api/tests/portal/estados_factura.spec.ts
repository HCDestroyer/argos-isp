import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico } from '#tests/ayudas'
import { crearRouterFila } from '#tests/core/fabricas'
import { estadoServicio, facturasDe, servicioCortado } from '#tests/billing/ayudas_billing'
import { crearServicio, nitAleatorio, sesionDirecta } from '#tests/portal/ayudas_portal'
import CastigarCartera from '#ledger/actions/castigar_cartera'
import { saldoCobrable } from '#portal/consultas'
import { variablesAvisoCobro } from '#portal/documentos/variables'

/**
 * Saldo y estado de cada estado real de `billing.facturas` en el portal (A3 · fase 4, decisión g y
 * H16–H18): solo `emitida`, `parcial` y `vencida` son deuda (`ESTADOS_PENDIENTES` de A3). Una
 * factura **castigada** (incobrable) o **acreditada** (cubierta por notas) sale con su estado y
 * saldo 0.00, en la lista, en la cuenta, en `/corte`, en el PDF, en las promesas y en el pago en
 * línea. Una `por_certificar` no sale; la original de una sustitución es `anulada`.
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_LIMITE_PETICIONES', 'PORTAL_REDIS_PREFIJO'] as const

let ipSecuencia = 0
function ipNueva(): string {
    ipSecuencia += 1
    return `198.51.104.${(ipSecuencia % 250) + 1}`
}

interface FilaFactura {
    estado: string
    total: string
    pagado: string
    periodo: string
}

/** Cliente sin facturas y una factura por estado (inserción directa: el portal solo lee). */
async function clienteConTodosLosEstados() {
    const s = await crearServicio({ nit: nitAleatorio(), sinFacturas: true })
    const filas: FilaFactura[] = [
        { estado: 'emitida', total: '100.00', pagado: '0.00', periodo: '2099-01-01' },
        { estado: 'parcial', total: '200.00', pagado: '50.25', periodo: '2026-08-01' },
        { estado: 'vencida', total: '150.00', pagado: '0.00', periodo: '2026-07-01' },
        { estado: 'pagada', total: '150.00', pagado: '150.00', periodo: '2026-06-01' },
        { estado: 'anulada', total: '999.00', pagado: '0.00', periodo: '2026-05-01' },
        // castigada: `pagado` es solo lo cobrado; lo castigado (200.00) está en ledger.castigos_facturas
        { estado: 'castigada', total: '300.00', pagado: '100.00', periodo: '2026-04-01' },
        // acreditada: cubierta entera por notas internas (H16)
        { estado: 'acreditada', total: '80.00', pagado: '80.00', periodo: '2026-03-01' },
        { estado: 'por_certificar', total: '70.00', pagado: '0.00', periodo: '2026-02-01' },
    ]
    const ids = new Map<string, number>()
    for (const f of filas) {
        const [fila] = await db
            .table('billing.facturas')
            .insert({
                cliente_id: s.clienteId,
                servicio_id: s.servicioId,
                periodo: f.periodo,
                clave_unica: `${s.servicioId}-${f.periodo}-${unico('f')}`,
                vence_en: f.periodo.replace(/-01$/, '-10'),
                estado: f.estado,
                subtotal: f.total,
                iva: '0.00',
                total: f.total,
                pagado: f.pagado,
            })
            .returning('id')
        ids.set(f.estado, Number(fila.id))
    }
    return { ...s, ids }
}

test.group('Portal: saldo cobrable por estado de factura', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-estados-factura')
        delete process.env.PORTAL_LIMITE_PETICIONES
        return () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('saldoCobrable: solo emitida, parcial y vencida son deuda, nunca negativa', ({ assert }) => {
        const casos: Array<[string, string, string, string]> = [
            ['emitida', '100.00', '0.00', '100'],
            ['parcial', '200.00', '50.25', '149.75'],
            ['vencida', '150.00', '0.00', '150'],
            ['vencida', '150.00', '160.00', '0'],
            ['pagada', '150.00', '150.00', '0'],
            ['anulada', '999.00', '0.00', '0'],
            ['castigada', '300.00', '100.00', '0'],
            ['acreditada', '80.00', '80.00', '0'],
            ['acreditada', '80.00', '0.00', '0'],
            ['por_certificar', '70.00', '0.00', '0'],
        ]
        for (const [est, total, pagado, esperado] of casos) {
            assert.equal(saldoCobrable({ estado: est, total, pagado }).toString(), esperado, est)
        }
    })

    test('lista, detalle, cuenta y /corte: castigada y acreditada con su estado y sin saldo', async ({
        client,
        assert,
    }) => {
        const s = await clienteConTodosLosEstados()
        const { cookie } = await sesionDirecta(s.clienteId)

        const lista = await estado(
            client.get('/api/v1/portal/facturas?limit=50').header('Cookie', cookie),
            200,
        )
        const porId = new Map<number, { estado: string; saldo: string; tipo: string }>(
            lista.body().data.map((f: { id: number }) => [f.id, f]),
        )
        assert.lengthOf(lista.body().data, 7, 'por_certificar no sale en el portal')
        assert.isFalse(porId.has(s.ids.get('por_certificar')!))
        const esperado: Record<string, string> = {
            emitida: '100.00',
            parcial: '149.75',
            vencida: '150.00',
            pagada: '0.00',
            anulada: '0.00',
            castigada: '0.00',
            acreditada: '0.00',
        }
        for (const [est, saldo] of Object.entries(esperado)) {
            const factura = porId.get(s.ids.get(est)!)!
            assert.equal(factura.estado, est)
            assert.equal(factura.saldo, saldo, `saldo de la ${est}`)
        }

        const castigada = await estado(
            client.get(`/api/v1/portal/facturas/${s.ids.get('castigada')}`).header('Cookie', cookie),
            200,
        )
        assert.include(castigada.body(), { estado: 'castigada', saldo: '0.00', pagado: '100.00' })
        await estado(
            client.get(`/api/v1/portal/facturas/${s.ids.get('por_certificar')}`).header('Cookie', cookie),
            404,
        )

        // 100.00 + 149.75 + 150.00: ni la castigada (200.00) ni nada más
        const cuenta = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
        assert.equal(cuenta.body().monto_adeudado, '399.75')
        assert.equal(cuenta.body().servicios[0].monto_adeudado, '399.75')
        const pendientes = cuenta.body().empresas[0].facturas_pendientes as Array<{ id: number }>
        assert.sameMembers(
            pendientes.map((f) => f.id),
            ['emitida', 'parcial', 'vencida'].map((e) => s.ids.get(e)!),
        )

        const ip = ipNueva()
        await db.table('network.sesiones').insert({
            servicio_id: s.servicioId,
            router_id: s.routerId,
            nas_ip: '192.0.2.1',
            acct_session_id: unico('acct'),
            user_ppp: s.userPpp,
            ipv4: ip,
        })
        const quien = await estado(client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', ip), 200)
        assert.equal(quien.body().monto_adeudado, '399.75')
        // vencidas con saldo: la parcial (ya pasó su fecha) y la vencida
        assert.deepEqual(quien.body().facturas_vencidas, { cantidad: 2, total: '299.75' })
    })

    test('PDF del aviso: castigada «Dada de baja» y acreditada sin saldo a pagar', async ({ assert }) => {
        const s = await clienteConTodosLosEstados()
        const castigada = await variablesAvisoCobro(s.ids.get('castigada')!, { clienteId: s.clienteId })
        assert.equal(castigada.factura.estado, 'Dada de baja')
        assert.equal(castigada.factura.saldo, 'Q 0.00')
        const acreditada = await variablesAvisoCobro(s.ids.get('acreditada')!, { clienteId: s.clienteId })
        assert.equal(acreditada.factura.estado, 'Cubierta por notas de crédito')
        assert.equal(acreditada.factura.saldo, 'Q 0.00')
        const parcial = await variablesAvisoCobro(s.ids.get('parcial')!, { clienteId: s.clienteId })
        assert.equal(parcial.factura.saldo, 'Q 149.75')
    })

    test('pago en línea: una castigada o acreditada elegida a mano responde 422 factura_pendiente', async ({
        client,
        assert,
    }) => {
        const s = await clienteConTodosLosEstados()
        const { cookie } = await sesionDirecta(s.clienteId)
        for (const est of ['castigada', 'acreditada']) {
            const respuesta = await estado(
                client
                    .post('/api/v1/portal/pagos/iniciar')
                    .header('Cookie', cookie)
                    .header('X-Forwarded-For', ipNueva())
                    .json({ facturas: [s.ids.get(est)] }),
                422,
            )
            assert.equal(respuesta.body().errors[0].rule, 'factura_pendiente', est)
        }
    })

    test('castigo real de A3: /corte, cuenta, promesas y pago en línea dejan de cobrarla', async ({
        client,
        assert,
    }) => {
        const routerId = await crearRouterFila()
        const s = await servicioCortado({ servicio: { router_id: routerId } })
        assert.equal(await estadoServicio(s.servicioId), 'suspendido')
        const ip = ipNueva()
        await db.table('network.sesiones').insert({
            servicio_id: s.servicioId,
            router_id: routerId,
            nas_ip: '192.0.2.1',
            acct_session_id: unico('acct'),
            user_ppp: unico('ppp'),
            ipv4: ip,
        })
        const antes = await estado(client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', ip), 200)
        assert.equal(antes.body().monto_adeudado, '300.00')

        const iniciales = await facturasDe(s.servicioId)
        const vencidas = iniciales.filter((f) => f.estado === 'vencida')
        assert.lengthOf(vencidas, 2)
        await new CastigarCartera().execute(
            {
                facturas: vencidas.map((f) => Number(f.id)),
                motivo: 'cliente no localizado',
                evidencia: '3 llamadas y 2 cartas (prueba del portal)',
            },
            contextoPrueba(),
        )
        const castigadas = await facturasDe(s.servicioId)
        assert.sameMembers(
            castigadas.map((f) => f.estado),
            ['castigada', 'castigada'],
        )

        const despues = await estado(
            client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', ip),
            200,
        )
        assert.equal(despues.body().monto_adeudado, '0.00')
        assert.deepEqual(despues.body().facturas_vencidas, { cantidad: 0, total: '0.00' })

        const { cookie } = await sesionDirecta(s.clienteId)
        const cuenta = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
        assert.equal(cuenta.body().monto_adeudado, '0.00')
        assert.equal(cuenta.body().empresas[0].saldo, '0.00', 'el castigo sacó el saldo del auxiliar CxC')
        assert.lengthOf(cuenta.body().empresas[0].facturas_pendientes, 0)
        const lista = await estado(client.get('/api/v1/portal/facturas').header('Cookie', cookie), 200)
        for (const f of lista.body().data) assert.include(f, { estado: 'castigada', saldo: '0.00' })

        const condiciones = await estado(
            client.get('/api/v1/portal/promesas/condiciones').header('X-Forwarded-For', ip),
            200,
        )
        assert.isFalse(condiciones.body().disponible)
        assert.include(condiciones.body().motivo, 'No tienes saldo pendiente')

        const pago = await estado(
            client.post('/api/v1/portal/pagos/iniciar').header('X-Forwarded-For', ip).json({}),
            422,
        )
        assert.match(pago.body().type, /sin_deuda$/)
    })
})
