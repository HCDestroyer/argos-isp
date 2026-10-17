import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import RegistrarAsiento, { type OrigenAsiento } from '#ledger/actions/registrar_asiento'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, cerrarMes, crearCliente, saldoTexto } from '#tests/ledger/ayudas_libro'

/**
 * `POST /libro/asientos/:id/revertir` (`libro.revertir_asiento`): asiento espejo con motivo, sin
 * editar el original; una sola vez; nunca un reverso; nunca dentro de un mes cerrado; los asientos
 * de un documento (pago, factura…) se corrigen anulando el documento.
 */

/** Faltante de caja: Faltantes / Caja principal. */
function faltante(fecha = hoyGuatemala(), monto = '15.00') {
    return new RegistrarAsiento().execute(
        {
            fecha,
            descripcion: unico('Faltante de caja'),
            origen_tipo: 'cierre_caja',
            origen_id: 1,
            movimientos: [
                { cuenta: CUENTAS.FALTANTES_CAJA, debe: monto },
                { cuenta: CUENTAS.CAJA_PRINCIPAL, haber: monto },
            ],
        },
        contextoPrueba(),
    )
}

function asientoCliente(clienteId: number, origen: OrigenAsiento, origenId: number | null) {
    return new RegistrarAsiento().execute(
        {
            descripcion: unico(`Asiento ${origen}`),
            origen_tipo: origen,
            origen_id: origenId,
            movimientos: [
                { cuenta: CUENTAS.CXC_CLIENTES, debe: '56.00', cliente_id: clienteId },
                { cuenta: CUENTAS.SALDOS_APERTURA, haber: '56.00' },
            ],
        },
        contextoPrueba(),
    )
}

function revertir(
    client: ApiClient,
    token: string,
    id: number,
    cuerpo: Record<string, unknown>,
    clave = unico('rev'),
) {
    return client
        .post(`/api/v1/libro/asientos/${id}/revertir`)
        .bearerToken(token)
        .header('Idempotency-Key', clave)
        .json(cuerpo)
}

test.group('ledger · revertir asiento (API)', () => {
    test('revierte un cierre de caja: espejo, auditoría, una sola vez y nunca el reverso', async ({
        client,
        assert,
    }) => {
        const original = await faltante()
        const { token, usuario } = await usuarioConRoles(['contabilidad'])

        const clave = unico('rev')
        const respuesta = await estado(
            revertir(client, token, original.id, { motivo: 'contado mal digitado' }, clave),
            201,
        )
        const reverso = respuesta.body()
        assert.equal(reverso.reversa_de, original.id)
        assert.equal(reverso.origen_tipo, 'cierre_caja')
        assert.equal(reverso.fecha, hoyGuatemala())
        assert.equal(reverso.descripcion, `Reverso del asiento ${original.id}: contado mal digitado`)
        assert.isFalse(reverso.revertible)
        assert.deepEqual(
            reverso.movimientos.map((m: { cuenta_codigo: string; debe: string; haber: string }) => [
                m.cuenta_codigo,
                m.debe,
                m.haber,
            ]),
            [
                [CUENTAS.FALTANTES_CAJA, '0.00', '15.00'],
                [CUENTAS.CAJA_PRINCIPAL, '15.00', '0.00'],
            ],
        )

        // el original no cambió y ahora dice quién lo revirtió
        const visto = await estado(
            client.get(`/api/v1/libro/asientos/${original.id}`).bearerToken(token),
            200,
        )
        assert.equal(visto.body().revertido_por, reverso.id)
        assert.isFalse(visto.body().revertible)
        assert.match(visto.body().motivo_no_revertible, /Revertido por el asiento/)
        assert.deepEqual(
            visto.body().movimientos.map((m: { debe: string; haber: string }) => [m.debe, m.haber]),
            [
                ['15.00', '0.00'],
                ['0.00', '15.00'],
            ],
        )

        // auditoría con el usuario y el asiento original
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'libro.revertir_asiento')
            .where('entidad_id', original.id)
            .where('resultado', 'ok')
            .firstOrFail()
        assert.equal(auditoria.actor_id, usuario.id)
        assert.equal(auditoria.entidad_tipo, 'asiento')

        // la misma Idempotency-Key devuelve la misma respuesta, sin un segundo reverso
        const repetida = await estado(
            revertir(client, token, original.id, { motivo: 'contado mal digitado' }, clave),
            201,
        )
        assert.equal(repetida.body().id, reverso.id)

        const otraVez = await estado(revertir(client, token, original.id, { motivo: 'de nuevo' }), 422)
        assert.equal(otraVez.body().type, 'urn:argosisp:problema:asiento_revertido')
        const delReverso = await estado(
            revertir(client, token, reverso.id, { motivo: 'revertir el reverso' }),
            422,
        )
        assert.equal(delReverso.body().type, 'urn:argosisp:problema:asiento_es_reverso')

        const reversos = await db.from('ledger.asientos').where('reversa_de', original.id).count('* as n')
        assert.equal(Number(reversos[0].n), 1)
        await afirmarLibroCuadrado(assert)
    })

    test('motivo obligatorio; 404 si no existe; 403 sin el permiso', async ({ client, assert }) => {
        const original = await faltante()
        const { token } = await usuarioConRoles(['contabilidad'])

        const sinMotivo = await estado(revertir(client, token, original.id, {}), 422)
        assert.equal(sinMotivo.body().errors[0].field, 'motivo')
        await estado(revertir(client, token, original.id, { motivo: '  ' }), 422)
        await estado(revertir(client, token, 999_999_999, { motivo: 'no existe' }), 404)

        const cajero = await usuarioConRoles(['cajero'])
        await estado(revertir(client, cajero.token, original.id, { motivo: 'sin permiso' }), 403)

        const sigue = await db.from('ledger.asientos').where('reversa_de', original.id).first()
        assert.isNull(sigue)
    })

    test('asientos de pago, factura, mora, nota de crédito, egreso y saldo inicial: 422 con la acción a usar', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearCliente()
        const { token } = await usuarioConRoles(['contabilidad'])
        const casos: Array<[OrigenAsiento, number | null, RegExp]> = [
            ['pago', 10, /anula el pago/],
            ['factura', 11, /anula la factura/],
            ['mora', 12, /anula la factura de mora/],
            ['nota_credito', 13, /nota de crédito/],
            ['egreso', 14, /anula el egreso/],
            ['ajuste', 15, /saldo inicial/],
        ]
        for (const [origen, origenId, mensaje] of casos) {
            const asiento = await asientoCliente(clienteId, origen, origenId)
            const listado = await estado(
                client.get(`/api/v1/libro/asientos/${asiento.id}`).bearerToken(token),
                200,
            )
            assert.isFalse(listado.body().revertible, origen)

            const respuesta = await estado(
                revertir(client, token, asiento.id, { motivo: 'corrección directa' }),
                422,
            )
            assert.equal(respuesta.body().type, 'urn:argosisp:problema:reverso_por_documento', origen)
            assert.match(respuesta.body().detail, mensaje, origen)
        }
        // nada se revirtió: el saldo del cliente sigue con los seis cargos
        assert.equal(await saldoTexto(clienteId), '336.00')

        // un ajuste manual (sin origen) sí se revierte directo
        const manual = await asientoCliente(clienteId, 'ajuste', null)
        const diario = await estado(
            client
                .get('/api/v1/libro/diario')
                .qs({ origen_tipo: 'ajuste', desde: manual.fecha, hasta: manual.fecha, limit: 100 })
                .bearerToken(token),
            200,
        )
        const fila = diario.body().data.find((a: { id: number }) => a.id === manual.id)
        assert.isTrue(fila.revertible)
        assert.isNull(fila.motivo_no_revertible)
        await estado(revertir(client, token, manual.id, { motivo: 'ajuste duplicado' }), 201)
        assert.equal(await saldoTexto(clienteId), '336.00')
        await afirmarLibroCuadrado(assert)
    })

    test('original en un mes cerrado: el reverso va con fecha de hoy, nunca dentro del cierre ni antes del original', async ({
        client,
        assert,
    }) => {
        const original = await faltante('2016-08-14', '40.00')
        const posterior = await faltante('2016-11-10', '5.00')
        await cerrarMes('2016-08-01')
        const { token } = await usuarioConRoles(['contabilidad'])

        const dentro = await estado(
            revertir(client, token, original.id, { motivo: 'dentro del cierre', fecha: '2016-08-31' }),
            422,
        )
        assert.equal(dentro.body().type, 'urn:argosisp:problema:periodo_cerrado')

        const antes = await estado(
            revertir(client, token, posterior.id, { motivo: 'antes del original', fecha: '2016-11-01' }),
            422,
        )
        assert.equal(antes.body().errors[0].field, 'fecha')

        const reverso = await estado(revertir(client, token, original.id, { motivo: 'corrección' }), 201)
        assert.equal(reverso.body().fecha, hoyGuatemala())

        // con una fecha de un mes abierto (posterior al original) también
        const conFecha = await estado(
            revertir(client, token, posterior.id, { motivo: 'mismo mes', fecha: '2016-11-30' }),
            201,
        )
        assert.equal(conFecha.body().fecha, '2016-11-30')
        await afirmarLibroCuadrado(assert)
    })
})
