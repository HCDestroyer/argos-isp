import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import { crearClienteFila } from '#tests/core/fabricas'

/**
 * Pedido A4 de Iris (`contratos/iris.md` §5.1): el cargo único de una orden de trabajo lleva
 * `origen_tipo = iris_orden` + `origen_id`. Se guarda en la factura (o en la bonificación de un Q0), sale
 * en la respuesta y en la auditoría, y el asiento es el mismo que sin origen. Iris manda
 * `Idempotency-Key: iris:cargo:<orden_id>`.
 */

async function idDe(tabla: string, empresaId: number, nombre: string) {
    const fila = (await db
        .from(tabla)
        .where({ empresa_id: empresaId, nombre })
        .select('id')
        .firstOrFail()) as {
        id: number
    }
    return Number(fila.id)
}

/** Partidas del asiento de una factura, sin ids, en orden. */
async function partidasDeFactura(facturaId: number) {
    return db
        .from('ledger.asientos as a')
        .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where({ 'a.origen_tipo': 'factura', 'a.origen_id': facturaId })
        .orderBy('m.id')
        .select('c.codigo', 'm.debe', 'm.haber')
}

test.group('Facturas · cargo único desde una orden de Iris (pedido A4)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('con origen: en la factura, la respuesta, el detalle y la auditoría; idempotente por iris:cargo:<orden>; mismo asiento', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresas()
        const clienteId = await crearClienteFila()
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const visita = await idDe('billing.conceptos_cargo', e.B, 'Visita técnica')
        const orden = randomUUID()
        const cuerpo = {
            cliente_id: clienteId,
            empresa_id: e.B,
            lineas: [{ concepto_id: visita, precio_unitario: '112.00' }],
            origen_tipo: 'iris_orden',
            origen_id: orden,
        }
        const pedir = (datos: Record<string, unknown>, clave: string) =>
            client
                .post('/api/v1/facturas/cargo-unico')
                .bearerToken(cajero)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', clave)
                .json(datos)

        const primera = await estado(pedir(cuerpo, `iris:cargo:${orden}`), 201)
        const repetida = await estado(pedir(cuerpo, `iris:cargo:${orden}`), 201)
        assert.equal(primera.body().documento, 'factura')
        const factura = primera.body().factura
        assert.include(factura, {
            origen_externo_tipo: 'iris_orden',
            origen_externo_id: orden,
            total: '112.00',
        })
        assert.equal(repetida.body().factura.id, factura.id)
        const deLaOrden = await db
            .from('billing.facturas')
            .where({ origen_externo_tipo: 'iris_orden', origen_externo_id: orden })
            .count('* as n')
            .firstOrFail()
        assert.equal(Number(deLaOrden.n), 1)

        const detalle = await estado(
            client
                .get(`/api/v1/facturas/${factura.id}`)
                .bearerToken(cajero)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.include(detalle.body(), { origen_externo_tipo: 'iris_orden', origen_externo_id: orden })
        const auditada = await db
            .from('audit.acciones')
            .where({ accion: 'facturas.emitir_cargo_unico', resultado: 'ok', entidad_id: factura.id })
            .select('entrada', 'entidad_tipo')
        assert.lengthOf(auditada, 1, 'la repetida no vuelve a ejecutar la acción')
        assert.include(auditada[0]!.entrada, { origen_tipo: 'iris_orden', origen_id: orden })

        // el mismo cargo sin origen deja exactamente el mismo asiento
        const sinOrigen = await estado(
            pedir({ ...cuerpo, origen_tipo: undefined, origen_id: undefined }, unico('cargo')),
            201,
        )
        assert.include(sinOrigen.body().factura, { origen_externo_tipo: null, origen_externo_id: null })
        const conOrigen = await partidasDeFactura(factura.id)
        assert.isAbove(conOrigen.length, 0)
        assert.deepEqual(conOrigen, await partidasDeFactura(sinOrigen.body().factura.id))

        // la lista de facturas también lo muestra
        const lista = await estado(
            client
                .get('/api/v1/facturas')
                .bearerToken(cajero)
                .header('X-Empresa-Id', String(e.B))
                .qs({ cliente_id: clienteId }),
            200,
        )
        const enLista = lista.body().data.find((f: { id: number }) => f.id === factura.id)
        assert.include(enLista, { origen_externo_tipo: 'iris_orden', origen_externo_id: orden })
        await afirmarLibro(assert, [e.B])
    })

    test('Q0 desde una orden: la bonificación guarda el origen', async ({ assert, client }) => {
        const e = await prepararEmpresas()
        const clienteId = await crearClienteFila()
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        const visita = await idDe('billing.conceptos_cargo', e.B, 'Visita técnica')
        const garantia = await idDe('billing.motivos_sin_costo', e.B, 'Garantía')
        const orden = randomUUID()
        const r = await estado(
            client
                .post('/api/v1/facturas/cargo-unico')
                .bearerToken(contador)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', `iris:cargo:${orden}`)
                .json({
                    cliente_id: clienteId,
                    empresa_id: e.B,
                    lineas: [
                        {
                            concepto_id: visita,
                            precio_unitario: '112.00',
                            descuentos: [{ concepto: 'Visita en garantía', monto: '112.00' }],
                        },
                    ],
                    motivo_sin_costo_id: garantia,
                    motivo_sin_costo_texto: 'falla del equipo en garantía',
                    origen_tipo: 'iris_orden',
                    origen_id: orden,
                }),
            201,
        )
        assert.equal(r.body().documento, 'bonificacion')
        assert.include(r.body().bonificacion, { origen_externo_tipo: 'iris_orden', origen_externo_id: orden })
        const vista = await estado(
            client
                .get(`/api/v1/bonificaciones/${r.body().bonificacion.id}`)
                .bearerToken(contador)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.include(vista.body(), { origen_externo_tipo: 'iris_orden', origen_externo_id: orden })
        await afirmarLibro(assert, [e.B])
    })

    test('validación: origen_tipo solo iris_orden y origen_id obligatorio con él (422, sin factura)', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresas()
        const clienteId = await crearClienteFila()
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const visita = await idDe('billing.conceptos_cargo', e.B, 'Visita técnica')
        const base = {
            cliente_id: clienteId,
            empresa_id: e.B,
            lineas: [{ concepto_id: visita, precio_unitario: '112.00' }],
        }
        const casos: Array<[Record<string, unknown>, string]> = [
            [{ origen_tipo: 'iris_orden' }, 'origen_id'],
            [{ origen_tipo: 'iris_orden', origen_id: null }, 'origen_id'],
            [{ origen_id: randomUUID() }, 'origen_tipo'],
            [{ origen_tipo: 'ticket', origen_id: randomUUID() }, 'origen_tipo'],
        ]
        for (const [extra, campo] of casos) {
            const r = await estado(
                client
                    .post('/api/v1/facturas/cargo-unico')
                    .bearerToken(cajero)
                    .header('X-Empresa-Id', String(e.B))
                    .header('Idempotency-Key', unico('cargo'))
                    .json({ ...base, ...extra }),
                422,
            )
            assert.include(
                r.body().errors.map((x: { field: string }) => x.field),
                campo,
                JSON.stringify(extra),
            )
        }
        const facturas = await db
            .from('billing.facturas')
            .where('cliente_id', clienteId)
            .count('* as n')
            .firstOrFail()
        assert.equal(Number(facturas.n), 0)
    })
})
