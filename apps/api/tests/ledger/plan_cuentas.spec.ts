import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { CATEGORIAS_EGRESO, CUENTAS, PLAN_CUENTAS, sembrarPlanCuentas } from '#ledger/plan_cuentas'
import { estado, usuarioConRoles } from '#tests/ayudas'

interface FilaCuenta {
    id: number
    codigo: string
    nombre: string
    tipo: string
    padre_id: number | null
    imputable: boolean
    auxiliar_cliente: boolean
}

async function cuentasDelPlan(): Promise<Map<string, FilaCuenta>> {
    const filas = (await db
        .from('ledger.cuentas')
        .whereIn(
            'codigo',
            PLAN_CUENTAS.map((c) => c.codigo),
        )
        .select(
            'id',
            'codigo',
            'nombre',
            'tipo',
            'padre_id',
            'imputable',
            'auxiliar_cliente',
        )) as FilaCuenta[]
    return new Map(filas.map((f) => [f.codigo, f]))
}

test.group('Plan de cuentas (seed)', () => {
    test('el seed crea todas las cuentas con su jerarquía y banderas', async ({ assert }) => {
        const cuentas = await cuentasDelPlan()
        assert.equal(cuentas.size, PLAN_CUENTAS.length)

        for (const definicion of PLAN_CUENTAS) {
            const fila = cuentas.get(definicion.codigo)!
            assert.equal(fila.nombre, definicion.nombre)
            assert.equal(fila.tipo, definicion.tipo)
            assert.equal(fila.imputable, definicion.imputable, definicion.codigo)
            assert.equal(fila.auxiliar_cliente, definicion.auxiliar_cliente ?? false, definicion.codigo)
            assert.equal(fila.padre_id, definicion.padre ? cuentas.get(definicion.padre)!.id : null)
        }

        // las cuentas del brief
        assert.equal(cuentas.get(CUENTAS.CXC_CLIENTES)!.nombre, 'Cuentas por cobrar clientes')
        assert.isTrue(cuentas.get(CUENTAS.CXC_CLIENTES)!.auxiliar_cliente)
        assert.isTrue(cuentas.get(CUENTAS.ANTICIPOS_CLIENTES)!.auxiliar_cliente)
        assert.equal(cuentas.get(CUENTAS.IVA_DEBITO)!.tipo, 'pasivo')
        assert.equal(cuentas.get(CUENTAS.RECARGOS_MORA)!.tipo, 'ingreso')
        assert.equal(cuentas.get(CUENTAS.COMISIONES_PASARELAS)!.tipo, 'gasto')
        assert.isFalse(cuentas.get(CUENTAS.CAJAS)!.imputable)
        assert.isFalse(cuentas.get(CUENTAS.BANCOS)!.imputable)
    })

    test('categorías de egreso apuntan a su cuenta de gasto; caja y banco iniciales con su cuenta', async ({
        assert,
    }) => {
        const cuentas = await cuentasDelPlan()
        const categorias = (await db
            .from('ledger.egresos_categorias')
            .select('nombre', 'cuenta_id')) as Array<{
            nombre: string
            cuenta_id: number
        }>
        for (const categoria of CATEGORIAS_EGRESO) {
            const fila = categorias.find((c) => c.nombre === categoria.nombre)
            assert.exists(fila, categoria.nombre)
            assert.equal(fila!.cuenta_id, cuentas.get(categoria.cuenta)!.id)
        }

        const caja = await db.from('ledger.cajas').where('nombre', 'Caja principal').firstOrFail()
        assert.equal(caja.cuenta_id, cuentas.get(CUENTAS.CAJA_PRINCIPAL)!.id)
        const banco = await db.from('ledger.bancos').where('nombre', 'Banco principal').firstOrFail()
        assert.equal(banco.cuenta_id, cuentas.get(CUENTAS.BANCO_PRINCIPAL)!.id)
    })

    test('sembrar dos veces no duplica nada', async ({ assert }) => {
        const contar = async () => {
            const [cuentas, categorias, cajas, bancos] = await Promise.all(
                ['ledger.cuentas', 'ledger.egresos_categorias', 'ledger.cajas', 'ledger.bancos'].map(
                    async (tabla) => Number((await db.from(tabla).count('* as n').first())!.n),
                ),
            )
            return { cuentas, categorias, cajas, bancos }
        }
        const antes = await contar()
        await db.transaction((trx) => sembrarPlanCuentas(trx))
        await db.transaction((trx) => sembrarPlanCuentas(trx))
        assert.deepEqual(await contar(), antes)
    })

    test('GET /libro/cuentas devuelve el plan ordenado por código; sin libro.ver → 403', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const respuesta = await estado(client.get('/api/v1/libro/cuentas').bearerToken(token), 200)
        const cuentas = respuesta.body() as Array<{ codigo: string; imputable: boolean }>
        const codigos = cuentas.map((c) => c.codigo)
        assert.includeMembers(
            codigos,
            PLAN_CUENTAS.map((c) => c.codigo),
        )
        assert.deepEqual(codigos, [...codigos].sort())
        assert.isTrue(cuentas.find((c) => c.codigo === CUENTAS.CXC_CLIENTES)!.imputable)

        const cajero = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/libro/cuentas').bearerToken(cajero.token), 403)
    })
})
