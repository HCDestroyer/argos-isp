import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { descifrar } from '#shared/cifrado'
import { importar } from '#importacion/importador'
import type { ReporteImportacion } from '#importacion/reporte'
import { lineasDiferencias, reporteCsv, reporteMarkdown } from '#importacion/reporte_salidas'
import { leerOrigen } from '#importacion/origenes/index'
import { crearPlantillaFila } from '#tests/billing/ayudas_billing'
import { archivoSintetico } from '#tests/importacion/ayudas_importacion'

/**
 * SmartISP desde su volcado: estructura real (`scripts/importacion/esquemas/smartisp.sql`) más
 * los datos inventados de `scripts/importacion/smartisp-sintetico.sql` (redes 198.18.70.0/24 a
 * 198.18.100.0/24). Las mismas garantías que Mikrowisp: dos corridas en seco iguales, la segunda
 * corrida real no duplica y la suma de saldos cuadra con el origen.
 */

let FIXTURE: string

function estable(r: ReporteImportacion) {
    const copia: Partial<ReporteImportacion> = { ...r }
    delete copia.request_id
    delete copia.inicio
    delete copia.fin
    return copia
}

async function contar(trx?: TransactionClientContract) {
    const q = trx ?? db
    const resultado = (await q.rawQuery(`
        SELECT (SELECT count(*) FROM core.clientes)::int AS clientes,
               (SELECT count(*) FROM core.servicios)::int AS servicios,
               (SELECT count(*) FROM network.routers)::int AS routers,
               (SELECT count(*) FROM network.planes)::int AS planes,
               (SELECT count(*) FROM network.redes_ipv4)::int AS redes,
               (SELECT count(*) FROM core.ids_externos)::int AS ids_externos,
               (SELECT count(*) FROM billing.facturas)::int AS facturas,
               (SELECT count(*) FROM billing.pagos)::int AS pagos,
               (SELECT count(*) FROM billing.saldos_iniciales)::int AS saldos,
               (SELECT count(*) FROM ledger.asientos)::int AS asientos,
               (SELECT count(*) FROM audit.outbox)::int AS outbox`)) as {
        rows: Array<Record<string, number>>
    }
    return resultado.rows[0]
}

test.group('importacion · SmartISP desde volcado SQL', (group) => {
    group.setup(async () => {
        FIXTURE = await archivoSintetico('smartisp')
    })

    test('traduce el volcado real con los casos difíciles', async ({ assert }) => {
        const fuente = await leerOrigen('smartisp', FIXTURE)
        assert.deepEqual(
            fuente.routers.map((r) => [r.id, r.nas_ip, r.api_usuario, r.radius_secret]),
            [
                ['1', '198.18.70.1', 'argos', 'secreto-si-norte'],
                ['2', '198.18.80.1', null, null],
                ['3', '198.18.90.1', null, null],
                ['4', '198.18.100.1', null, null],
            ],
        )
        assert.deepEqual(
            fuente.redes.map((r) => [r.router_id, r.cidr, r.gateway]),
            [
                ['1', '198.18.70.0/24', '198.18.70.1'],
                ['2', '198.18.80.0/24', '198.18.80.1'], // mask '/24'
                ['3', '198.18.90.0/24', '198.18.90.1'], // network con /24
            ],
        )
        assert.deepEqual(
            fuente.planes.map((p) => [p.id, p.precio, p.bajada_kbps, p.subida_kbps]),
            [
                ['1', '150.00', 10_240, 5120],
                ['2', '535.71', 51_200, 25_600],
            ],
        )
        assert.equal(fuente.clientes.find((c) => c.id === '3')!.direccion, "Km. 15, 'La Ceiba'")
        assert.equal(fuente.clientes.find((c) => c.id === '4')!.zona, 'SI Aldea')

        const s = (id: string) => fuente.servicios.find((x) => x.id === id)
        assert.containSubset(s('1'), { tipo_conexion: 'pppoe', user_ppp: 'si.sofia', mac: null })
        assert.containSubset(s('3'), {
            tipo_conexion: 'ip_estatica',
            amarre_ip_mac: true,
            mac: 'AA:BB:CC:00:80:30',
        })
        assert.containSubset(s('5'), { estado: 'suspendido' })
        assert.containSubset(s('6'), { tipo_conexion: 'dhcp_fija', ip: null, mac: 'AA:BB:CC:00:90:60' })
        for (const omitido of ['7', '9', '10']) assert.isUndefined(s(omitido), omitido) // hotspot, xx, sin usuario

        // Anulada (105) y status desconocido (107) no vienen; pagada 102 con pendiente 0
        assert.deepEqual(
            Object.fromEntries(fuente.facturas.map((f) => [f.id, [f.servicio_id, f.total, f.pendiente]])),
            {
                '101': ['1', '150.00', '150.00'],
                '102': ['1', '150.00', '0.00'],
                '103': ['2', '600.00', '350.00'],
                '104': ['5', '150.00', '100.00'],
                '106': [null, '150.00', '150.00'], // total_pay NULL = cost + iva
                '108': ['3', '150.00', '0.00'],
                '109': ['3', '150.00', '150.00'],
                '110': ['8', '75.00', '75.00'],
            },
        )
        // El pago borrado (504) no viene
        assert.deepEqual(
            fuente.pagos.map((p) => [p.id, p.cliente_id, p.factura_id]),
            [
                ['501', '1', '102'],
                ['502', '2', '103'],
                ['503', '4', '104'],
            ],
        )
        assert.deepEqual(
            fuente.saldos.map((x) => [x.cliente_id, x.saldo]),
            [
                ['4', '-40.00'],
                ['6', '140.00'],
            ],
        )
        const problemas = fuente.problemas.map((p) => [p.archivo.split(':')[1], p.id, p.aviso])
        for (const esperado of [
            ['client_services', '7', false], // hotspot
            ['client_services', '9', false], // status xx
            ['client_services', '10', false], // PPPoE sin user_hot
            ['bill_customers', '107', false], // status 9
            ['bill_customers', '108', true], // pagada sin paid_on
            ['bill_customers', '109', true], // pendiente con paid_on
            ['clients.balance', '5', true], // balance ≠ pendiente
            ['plans', '2', true], // iva aparte
            ['invoices', null, true], // tabla vieja con filas
        ]) {
            assert.deepInclude(problemas, esperado)
        }
    })

    test('en seco: dos corridas dan el mismo reporte, la suma de saldos cuadra y la base queda igual', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const antes = await contar()
        const r1 = await importar(await leerOrigen('smartisp', FIXTURE), {
            sistema: 'smartisp',
            dryRun: true,
            plantillaId,
            fuente: 'fixture',
        })
        const r2 = await importar(await leerOrigen('smartisp', FIXTURE), {
            sistema: 'smartisp',
            dryRun: true,
            plantillaId,
            fuente: 'fixture',
        })
        assert.deepEqual(await contar(), antes)
        assert.deepEqual(estable(r2), estable(r1))
        assert.equal(reporteMarkdown(r2), reporteMarkdown(r1))
        assert.equal(reporteCsv(r2), reporteCsv(r1))

        assert.deepEqual(r1.errores, [])
        assert.deepEqual(r1.saldos, {
            clientes: 6,
            suma_origen: '925.00',
            suma_importada: '925.00',
            diferencia: '0.00',
            cuadra: true,
        })
        assert.deepInclude(r1.resumen, {
            routers: { origen: 4, creados: 4, existentes: 0, omitidos: 0 },
            clientes: { origen: 7, creados: 7, existentes: 0, omitidos: 0 },
            // 7 filas válidas: 4 (IP repetida) y 8 (sin plan) no entran
            servicios: { origen: 7, creados: 5, existentes: 0, omitidos: 2 },
            pagos: { origen: 3, creados: 3, existentes: 0, omitidos: 0 },
        })

        const d = r1.diferencias
        assert.deepEqual(d.clientes_nit_duplicado, [{ nit: '76543218', clientes_origen: ['2', '3'] }])
        assert.deepEqual(d.ips_duplicadas, [
            { ip: '198.18.70.10', servicios_origen: ['1', '4'], importado_origen: '1' },
        ])
        assert.deepEqual(
            d.servicios_sin_plan.map((x) => x.servicio_origen),
            ['8'],
        )
        assert.deepEqual(
            d.pagos_cruzados.map((x) => [x.pago_origen, x.pagador_origen, x.dueno_origen]),
            [['503', '4', '5']],
        )
        assert.deepEqual(
            d.facturas_a_saldo.map((x) => x.factura_origen),
            ['110'],
        )
        assert.deepEqual(d.saldos_distintos, [])

        const lineas = lineasDiferencias(r1).map((x) => [x.entidad, x.id_origen, x.tipo])
        for (const esperada of [
            ['servicio', '7', 'formato_fila'],
            ['factura', '107', 'formato_fila'],
            ['factura', '108', 'formato_campo'],
            ['saldo', '5', 'formato_campo'],
            ['plan', '2', 'formato_campo'],
            ['router', '2', 'router_sin_credenciales'],
        ]) {
            assert.deepInclude(lineas, esperada)
        }
    })

    test('real dos veces: crea por las acciones, cifra la clave PPPoE y la segunda no duplica nada', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const trx = await db.transaction()
        try {
            const primera = await importar(await leerOrigen('smartisp', FIXTURE), {
                sistema: 'smartisp',
                dryRun: false,
                trx,
                plantillaId,
            })
            assert.deepEqual(primera.errores, [])
            assert.isTrue(primera.saldos.cuadra)
            const despues = await contar(trx)

            const servicios = (await trx
                .from('core.servicios as s')
                .join('core.ids_externos as e', (q) =>
                    q
                        .on('e.entidad_id', 's.id')
                        .andOnVal('e.entidad_tipo', 'servicio')
                        .andOnVal('e.sistema', 'smartisp'),
                )
                .select(
                    'e.externo_id',
                    's.tipo_conexion',
                    's.amarre_ip_mac',
                    's.pass_ppp',
                    db.raw('s.mac::text AS mac'),
                )
                .orderBy('e.externo_id')) as Array<Record<string, string | boolean | null>>
            assert.deepEqual(
                servicios.map((x) => [x.externo_id, x.tipo_conexion, x.amarre_ip_mac]),
                [
                    ['1', 'pppoe', false],
                    ['2', 'pppoe', false],
                    ['3', 'ip_estatica', true],
                    ['5', 'pppoe', false],
                    ['6', 'dhcp_fija', false],
                ],
            )
            const sofia = servicios.find((x) => x.externo_id === '1')!
            assert.notEqual(sofia.pass_ppp, 'clave-si-1')
            assert.equal(descifrar(String(sofia.pass_ppp)), 'clave-si-1')
            const salidas = [JSON.stringify(primera), reporteMarkdown(primera), reporteCsv(primera)].join(
                '\n',
            )
            for (const secreto of ['clave-si', 'secreto-si-norte', 'portal-']) {
                assert.notInclude(salidas, secreto)
            }

            const auditadas = (await trx
                .from('audit.acciones')
                .where('request_id', primera.request_id)
                .count('* as n')
                .first()) as { n: string }
            assert.isAbove(Number(auditadas.n), 20)

            const segunda = await importar(await leerOrigen('smartisp', FIXTURE), {
                sistema: 'smartisp',
                dryRun: false,
                trx,
                plantillaId,
            })
            assert.deepEqual(await contar(trx), despues)
            for (const [entidad, c] of Object.entries(segunda.resumen)) {
                assert.equal(c.creados, 0, `${entidad} no debe crear nada en la segunda corrida`)
            }
            assert.deepEqual(segunda.errores, [])
            assert.isTrue(segunda.saldos.cuadra)
            assert.equal(segunda.saldos.suma_importada, '925.00')
            const auditadas2 = (await trx
                .from('audit.acciones')
                .where('request_id', segunda.request_id)
                .count('* as n')
                .first()) as { n: string }
            assert.equal(Number(auditadas2.n), 0)
        } finally {
            await trx.rollback()
        }
    })
})
