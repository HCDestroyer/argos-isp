import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { leerDumpMysql, ErrorDumpSql } from '#importacion/mysql_dump'
import { leerDumpMikrowisp } from '#importacion/origenes/mikrowisp'
import { normalizarMac } from '#importacion/canonico'
import { importar } from '#importacion/importador'
import type { ReporteImportacion } from '#importacion/reporte'
import { lineasDiferencias, reporteCsv, reporteMarkdown } from '#importacion/reporte_salidas'
import type { CargaFinanciera, EntradaPagoHistorico } from '#importacion/carga_financiera'
import { cargaFinancieraA3 } from '#importacion/carga_financiera'
import { crearPlantillaFila } from '#tests/billing/ayudas_billing'

/**
 * Fixture SQL sintético con el esquema supuesto de Mikrowisp
 * (`scripts/importacion/mikrowisp-sintetico.sql`, redes 198.18.0.0/16): los casos difíciles del
 * dump real. Las corridas reales van en una transacción externa que se revierte al final.
 */

const FIXTURE = fileURLToPath(
    new URL('../../../../scripts/importacion/mikrowisp-sintetico.sql', import.meta.url),
)

/** El reporte sin lo que cambia de una corrida a otra (request_id y horas). */
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
               (SELECT count(*) FROM core.zonas)::int AS zonas,
               (SELECT count(*) FROM core.ids_externos)::int AS ids_externos,
               (SELECT count(*) FROM billing.facturas)::int AS facturas,
               (SELECT count(*) FROM billing.saldos_iniciales)::int AS saldos,
               (SELECT count(*) FROM ledger.asientos)::int AS asientos,
               (SELECT count(*) FROM audit.outbox)::int AS outbox`)) as {
        rows: Array<Record<string, number>>
    }
    return resultado.rows[0]
}

test.group('importacion · volcado MySQL', () => {
    test('lee CREATE TABLE e INSERT con escapes, NULL, columnas explícitas y comentarios', ({ assert }) => {
        const tablas = leerDumpMysql(`
            -- comentario
            /*!40101 SET NAMES utf8mb4 */;
            CREATE TABLE \`t\` (
              \`id\` int NOT NULL,
              \`monto\` decimal(10,2) DEFAULT '0.00',
              \`nota\` text COMMENT 'a; b',
              PRIMARY KEY (\`id\`),
              KEY \`x\` (\`monto\`,\`id\`)
            ) ENGINE=InnoDB;
            INSERT INTO \`t\` VALUES (1,10.50,'O\\'Brien; \\"jefe\\"\\nlínea 2'),(2,NULL,'it''s');
            # otro comentario
            INSERT INTO t (nota, id) VALUES ('sin monto', 3);
        `)
        const t = tablas.get('t')!
        assert.deepEqual(t.columnas, ['id', 'monto', 'nota'])
        assert.deepEqual(t.filas, [
            { id: '1', monto: '10.50', nota: 'O\'Brien; "jefe"\nlínea 2' },
            { id: '2', monto: null, nota: "it's" },
            { nota: 'sin monto', id: '3' },
        ])
        assert.throws(() => leerDumpMysql('INSERT INTO z VALUES (1);'), ErrorDumpSql)
        assert.throws(() => leerDumpMysql('CREATE TABLE a (x int); INSERT INTO a VALUES (1,2);'), /2 valores/)
    })

    test('normaliza la MAC en sus distintos formatos', ({ assert }) => {
        for (const mac of [
            'aa:bb:cc:00:01:01',
            'AA-BB-CC-00-01-01',
            'aabb.cc00.0101',
            'aabbcc000101',
            ' AABBCC000101 ',
        ]) {
            assert.equal(normalizarMac(mac), 'AA:BB:CC:00:01:01', mac)
        }
        for (const mala of ['aa:bb:cc:00:01', 'aabb.cc00.01', 'zz:bb:cc:00:01:01', 'aa:bbcc:00:01:01']) {
            assert.isNull(normalizarMac(mala), mala)
        }
    })

    test('lleva el fixture a la fuente del importador con los casos difíciles', async ({ assert }) => {
        const fuente = await leerDumpMikrowisp(FIXTURE)
        assert.lengthOf(fuente.routers, 2)
        assert.deepEqual(
            fuente.routers.map((r) => [r.id, r.nas_ip, r.api_usuario, r.radius_secret]),
            [
                ['1', '198.18.0.11', 'argos', 'secreto-lab-norte'],
                ['2', '198.18.0.2', null, null],
            ],
        )
        assert.deepEqual(
            fuente.planes.map((p) => [p.id, p.precio, p.bajada_kbps, p.subida_kbps]),
            [
                ['1', '150.00', 10_000, 5000],
                ['2', '600.00', 50_000, 25_000],
            ],
        )
        assert.lengthOf(fuente.clientes, 10)
        assert.equal(fuente.clientes.find((c) => c.id === '3')!.direccion, "Km. 14.5, 'La Ceiba'")
        assert.equal(fuente.clientes.find((c) => c.id === '1')!.zona, 'MW Centro')

        const s = (id: string) => fuente.servicios.find((x) => x.id === id)
        assert.isNull(s('107')!.plan_id) // sin plan
        assert.containSubset(s('108'), {
            tipo_conexion: 'ip_estatica',
            mac: 'AA:BB:CC:00:08:01',
            amarre_ip_mac: true,
        })
        assert.containSubset(s('109'), { tipo_conexion: 'dhcp_fija', mac: 'AA:BB:CC:00:09:01', ip: null })
        assert.containSubset(s('110'), { tipo_conexion: 'pppoe', mac: 'AA:BB:CC:00:09:02' })
        assert.equal(s('101')!.mac, 'AA:BB:CC:00:01:01')
        assert.isNull(s('103')!.fecha_instalacion) // 0000-00-00
        assert.isUndefined(s('113')) // ESTATICO sin IP: fila omitida

        // Facturas: la anulada no viene; la pagada con pendiente 0; las abonadas, lo que falta
        const pendiente = Object.fromEntries(fuente.facturas.map((f) => [f.id, f.pendiente]))
        assert.deepEqual(pendiente, {
            '5001': '150.00',
            '5002': '0.00',
            '5003': '350.00',
            '5004': '200.00',
            '5005': '150.00',
            '5006': '600.00',
            '5007': '150.00',
            '5008': '150.00',
            '5010': '150.00',
        })
        assert.equal(fuente.facturas.find((f) => f.id === '5001')!.periodo, '2026-09-01')
        // Saldo a favor: 4 sin facturas (−50) y 5 con 150 pendientes (150 − 20)
        assert.deepEqual(
            fuente.saldos.map((x) => [x.cliente_id, x.saldo]),
            [
                ['4', '-50.00'],
                ['5', '130.00'],
            ],
        )
        assert.lengthOf(fuente.pagos, 3)
        assert.deepInclude(
            fuente.problemas.map((p) => [p.archivo, p.id, p.aviso]),
            ['mikrowisp-sintetico.sql:tblservicios', '113', false],
        )
        assert.deepInclude(
            fuente.problemas.map((p) => [p.archivo, p.id, p.aviso]),
            ['mikrowisp-sintetico.sql:usuarios', '7', true], // correo inválido
        )
    })
})

test.group('importacion · Mikrowisp desde volcado SQL', () => {
    test('en seco: dos corridas dan el mismo reporte, la suma de saldos cuadra y la base queda igual', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const antes = await contar()
        const fuente = await leerDumpMikrowisp(FIXTURE)
        const r1 = await importar(fuente, {
            sistema: 'mikrowisp',
            dryRun: true,
            plantillaId,
            fuente: 'fixture',
        })
        const r2 = await importar(await leerDumpMikrowisp(FIXTURE), {
            sistema: 'mikrowisp',
            dryRun: true,
            plantillaId,
            fuente: 'fixture',
        })
        assert.deepEqual(await contar(), antes)

        assert.deepEqual(estable(r2), estable(r1))
        assert.equal(reporteMarkdown(r2), reporteMarkdown(r1))
        assert.equal(reporteCsv(r2), reporteCsv(r1))
        assert.notEqual(r1.request_id, r2.request_id)

        assert.deepEqual(r1.errores, [])
        assert.equal(r1.ids_externos, 'tabla')
        assert.deepEqual(r1.saldos, {
            clientes: 9,
            suma_origen: '1830.00',
            suma_importada: '1830.00',
            diferencia: '0.00',
            cuadra: true,
        })
        assert.deepInclude(r1.resumen, {
            routers: { origen: 2, creados: 2, existentes: 0, omitidos: 0 },
            clientes: { origen: 10, creados: 10, existentes: 0, omitidos: 0 },
            // 12 filas válidas: 107 sin plan, 111 IP repetida y 112 retirado no entran
            servicios: { origen: 12, creados: 9, existentes: 0, omitidos: 3 },
            // 5002 pagada, 5005 (servicio sin plan) y 5007 (cliente con dos servicios) al saldo
            facturas: { origen: 9, creados: 6, existentes: 0, omitidos: 3 },
            // 4: −50; 5: 130 − 150 = −20; 7: 150; 9: 150
            saldos: { origen: 4, creados: 4, existentes: 0, omitidos: 0 },
            pagos: { origen: 3, creados: 0, existentes: 0, omitidos: 3 },
        })

        const d = r1.diferencias
        assert.deepEqual(d.clientes_nit_duplicado, [{ nit: '76543218', clientes_origen: ['2', '3'] }])
        assert.deepEqual(d.servicios_sin_plan, [
            { servicio_origen: '107', cliente_origen: '7', etiqueta: 'mw.ernesto' },
        ])
        assert.deepEqual(d.routers_sin_credenciales, [
            {
                router_origen: '2',
                nombre: 'Torre Sur',
                faltan: ['api_usuario', 'api_password', 'radius_secret'],
            },
        ])
        assert.deepEqual(d.pagos_cruzados, [
            {
                pago_origen: '9003',
                pagador_origen: '5',
                factura_origen: '5004',
                dueno_origen: '6',
                monto: '100.00',
            },
        ])
        assert.deepEqual(d.ips_duplicadas, [
            { ip: '198.18.10.10', servicios_origen: ['101', '111'], importado_origen: '101' },
        ])
        assert.sameMembers(
            d.ips_nuevas.map((x) => x.servicio_origen),
            ['103', '109'],
        )
        assert.deepEqual(
            d.facturas_a_saldo.map((x) => x.factura_origen),
            ['5005', '5007'],
        )
        assert.deepEqual(
            d.nit_invalidos.map((x) => x.cliente_origen),
            ['9'],
        )
        assert.deepEqual(d.saldos_distintos, [])
        assert.isTrue(r1.pendiente.some((p) => p.startsWith('Pagos históricos: 3 pagos')))

        // Reporte legible: una línea por diferencia, con su causa, por entidad
        const lineas = lineasDiferencias(r1)
        assert.isTrue(lineas.every((x) => x.causa && x.detalle && x.accion))
        assert.deepInclude(
            lineas.map((x) => [x.entidad, x.id_origen, x.tipo]),
            ['servicio', '111', 'ip_duplicada'],
        )
        assert.deepInclude(
            lineas.map((x) => [x.entidad, x.id_origen, x.tipo]),
            ['cliente', '3', 'nit_duplicado'],
        )
        assert.deepInclude(
            lineas.map((x) => [x.entidad, x.id_origen, x.tipo]),
            ['pago', '9003', 'pago_cruzado'],
        )
        assert.deepInclude(
            lineas.map((x) => [x.entidad, x.id_origen, x.tipo]),
            ['router', '2', 'router_sin_credenciales'],
        )
        const csv = reporteCsv(r1)
        assert.isTrue(csv.startsWith('﻿entidad,id_origen,tipo,gravedad,detalle,causa,accion\r\n'))
        assert.equal(csv.trimEnd().split('\r\n').length, lineas.length + 1)
        const md = reporteMarkdown(r1)
        assert.include(md, '- **Cuadra**')
        assert.include(md, '### servicio (')
        assert.notInclude(md, r1.request_id)
    })

    test('real dos veces: crea por las acciones, importa tipo_conexion y MAC, y la segunda no duplica nada', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const trx = await db.transaction()
        try {
            const primera = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
            })
            assert.deepEqual(primera.errores, [])
            assert.isTrue(primera.saldos.cuadra)
            const despues = await contar(trx)

            // WISP: tipo de conexión, MAC normalizada y amarre, sin credenciales PPP
            const wisp = (await trx
                .from('core.servicios as s')
                .join('core.ids_externos as e', (q) =>
                    q
                        .on('e.entidad_id', 's.id')
                        .andOnVal('e.entidad_tipo', 'servicio')
                        .andOnVal('e.sistema', 'mikrowisp'),
                )
                .whereIn('e.externo_id', ['108', '109', '110'])
                .select(
                    'e.externo_id',
                    's.tipo_conexion',
                    db.raw('s.mac::text AS mac'),
                    's.amarre_ip_mac',
                    's.user_ppp',
                )
                .orderBy('e.externo_id')) as Array<Record<string, unknown>>
            assert.deepEqual(
                wisp.map((x) => [
                    x.externo_id,
                    x.tipo_conexion,
                    String(x.mac).toUpperCase(),
                    x.amarre_ip_mac,
                ]),
                [
                    ['108', 'ip_estatica', 'AA:BB:CC:00:08:01', true],
                    ['109', 'dhcp_fija', 'AA:BB:CC:00:09:01', false],
                    ['110', 'pppoe', 'AA:BB:CC:00:09:02', false],
                ],
            )
            assert.isNull(wisp[0]!.user_ppp)

            // Todo por acciones: auditoría con el request_id de la corrida
            const auditadas = (await trx
                .from('audit.acciones')
                .where('request_id', primera.request_id)
                .count('* as n')
                .first()) as { n: string }
            assert.isAbove(Number(auditadas.n), 20)

            const segunda = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
            })
            assert.deepEqual(await contar(trx), despues)
            for (const [entidad, c] of Object.entries(segunda.resumen)) {
                assert.equal(c.creados, 0, `${entidad} no debe crear nada en la segunda corrida`)
            }
            assert.deepInclude(segunda.resumen, {
                routers: { origen: 2, creados: 0, existentes: 2, omitidos: 0 },
                clientes: { origen: 10, creados: 0, existentes: 10, omitidos: 0 },
                servicios: { origen: 12, creados: 0, existentes: 9, omitidos: 3 },
                facturas: { origen: 9, creados: 0, existentes: 6, omitidos: 3 },
                saldos: { origen: 4, creados: 0, existentes: 4, omitidos: 0 },
            })
            assert.deepEqual(segunda.errores, [])
            assert.isTrue(segunda.saldos.cuadra)
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

    test('pagos históricos por el puerto de A3 cuando exista la acción (idempotente por clave)', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const registrados = new Map<string, EntradaPagoHistorico>()
        const carga: CargaFinanciera = {
            ...cargaFinancieraA3,
            registrarPagoHistorico: async (entrada) => {
                registrados.set(entrada.clave_externa, entrada)
            },
            existePagoHistorico: async (clave) => registrados.has(clave),
        }
        const trx = await db.transaction()
        try {
            const r = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
                carga,
            })
            assert.deepEqual(r.resumen.pagos, { origen: 3, creados: 3, existentes: 0, omitidos: 0 })
            assert.isFalse(r.pendiente.some((p) => p.startsWith('Pagos históricos')))
            const cruzado = registrados.get('mikrowisp:pago:9003')!
            assert.equal(cruzado.monto, '100.00')
            assert.equal(cruzado.factura_clave_externa, 'mikrowisp:factura:5004')
            assert.isTrue(r.saldos.cuadra) // el pago histórico no mueve saldos

            const r2 = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
                carga,
            })
            assert.deepEqual(r2.resumen.pagos, { origen: 3, creados: 0, existentes: 3, omitidos: 0 })
        } finally {
            await trx.rollback()
        }
    })
})
