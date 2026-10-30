import { test } from '@japa/runner'
import { unicoBd } from '#tests/billing/ayudas_billing'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { enmascararNumero } from '#ledger/bancos'

/**
 * GET /libro/bancos: bancos del libro para elegir el origen de un egreso con metodo banco.
 */

test.group('ledger · bancos del libro', () => {
    test('enmascararNumero deja solo los últimos 4 caracteres', ({ assert }) => {
        assert.equal(enmascararNumero('3-123-45678-9'), '•-•••-••678-9')
        assert.equal(enmascararNumero('1234'), '1234')
        assert.equal(enmascararNumero('****5678'), '****5678')
        assert.isNull(enmascararNumero(null))
        assert.isNull(enmascararNumero(''))
    })

    test('lista el banco principal y uno nuevo con banco del catálogo y número enmascarado', async ({
        client,
        assert,
    }) => {
        const cuenta = await db.from('ledger.cuentas').where('codigo', '1.1.02.01').select('id').firstOrFail()
        const catalogo = await db.from('billing.bancos').orderBy('id').select('id', 'nombre').firstOrFail()
        const nombre = await unicoBd('Banco de gastos')
        const [nuevo] = await db
            .table('ledger.bancos')
            .insert({
                nombre,
                cuenta_id: cuenta.id,
                banco_id: catalogo.id,
                numero_mascarado: '0012345678',
            })
            .returning('id')

        const { token } = await usuarioConRoles(['contabilidad'])
        const respuesta = await estado(client.get('/api/v1/libro/bancos').bearerToken(token), 200)
        const bancos = respuesta.body() as Array<Record<string, unknown>>

        const principal = bancos.find((b) => b.nombre === 'Banco principal')
        assert.exists(principal)
        assert.equal(principal!.cuenta_codigo, '1.1.02.01')
        assert.isNull(principal!.banco)

        const fila = bancos.find((b) => b.id === Number(nuevo.id))
        assert.deepEqual(fila, {
            id: Number(nuevo.id),
            empresa_id: 1,
            nombre,
            banco_id: Number(catalogo.id),
            banco: catalogo.nombre,
            numero_enmascarado: '••••••5678',
            cuenta_id: Number(cuenta.id),
            cuenta_codigo: '1.1.02.01',
            cuenta_nombre: fila!.cuenta_nombre,
        })

        // el id sirve como banco_id de un egreso
        await estado(
            client
                .post('/api/v1/egresos')
                .bearerToken(token)
                .header('Idempotency-Key', unico('e'))
                .json({
                    categoria: 'otros',
                    monto: '10.00',
                    metodo: 'banco',
                    banco_id: Number(nuevo.id),
                }),
            201,
        )
    })

    test('sin egresos.ver responde 403', async ({ client }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        await estado(client.get('/api/v1/libro/bancos').bearerToken(token), 403)
    })
})
