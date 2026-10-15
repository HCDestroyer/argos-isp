import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { leerCsv, ErrorCsv } from '#importacion/csv'
import { leerDirectorio } from '#importacion/fuente'
import { importarMikrowisp } from '#importacion/importador'
import { formatearReporte } from '#importacion/reporte'
import { descifrar } from '#shared/cifrado'

/**
 * Pruebas con el ejemplo de `scripts/importacion/ejemplo/` (redes 198.19.0.0/16 y NAS en
 * 198.51.100.0/24, lejos de los datos de otras pruebas). La importación real corre dentro de una
 * transacción externa que se revierte al final, para no dejar datos en la BD de pruebas.
 */

const EJEMPLO = fileURLToPath(new URL('../../../../scripts/importacion/ejemplo/', import.meta.url))

test.group('importacion · CSV', () => {
    test('lee comillas, comas y saltos de línea dentro de campos, CRLF y BOM', ({ assert }) => {
        const filas = leerCsv('﻿Id,Nombre,Nota\r\n1,"López, Ana","dijo ""hola""\nadiós"\r\n\r\n2,Beto,\n')
        assert.deepEqual(filas, [
            { linea: 2, valores: { id: '1', nombre: 'López, Ana', nota: 'dijo "hola"\nadiós' } },
            { linea: 5, valores: { id: '2', nombre: 'Beto', nota: '' } },
        ])
    })

    test('rechaza filas con más campos que el encabezado y comillas sin cerrar', ({ assert }) => {
        assert.throws(() => leerCsv('a,b\n1,2,3\n'), ErrorCsv)
        assert.throws(() => leerCsv('a,b\n"1,2\n'), /Comillas sin cerrar/)
    })
})

test.group('importacion · formato de entrada', () => {
    test('normaliza el ejemplo y lista los problemas de formato', async ({ assert }) => {
        const fuente = await leerDirectorio(EJEMPLO)
        assert.lengthOf(fuente.routers, 2)
        assert.lengthOf(fuente.redes, 2)
        assert.deepEqual(
            fuente.planes.map((p) => [p.id, p.precio, p.bajada_kbps, p.subida_kbps, p.bajada_limitada_kbps]),
            [
                ['1', '150.00', 10_000, 5000, 512],
                ['2', '1250.50', 20_000, 10_000, 1000],
                ['3', '900.00', 50_000, 50_000, 512],
            ],
        )
        assert.lengthOf(fuente.clientes, 5)
        assert.lengthOf(fuente.servicios, 10)

        const s1001 = fuente.servicios.find((s) => s.id === '1001')!
        assert.equal(s1001.mac, 'AA:BB:CC:DD:EE:01')
        assert.equal(s1001.coordenadas, '14.6349,-90.5069')
        assert.equal(s1001.fecha_instalacion, '2024-03-15')
        assert.equal(fuente.servicios.find((s) => s.id === '1002')!.fecha_instalacion, '2024-04-15')
        assert.equal(fuente.servicios.find((s) => s.id === '1008')!.estado, 'retirado')

        const problemas = fuente.problemas.map((p) => `${p.archivo}:${p.id}:${p.aviso ? 'aviso' : 'omitida'}`)
        assert.sameMembers(problemas, [
            'clientes.csv:105:aviso', // email
            'clientes.csv:105:aviso', // coordenadas
            'clientes.csv:106:omitida', // sin nombre
            'servicios.csv:1005:aviso', // fecha 2024-13-40
            'servicios.csv:1011:omitida', // IP 300.1.1.1
        ])
    })
})

test.group('importacion · Mikrowisp', () => {
    test('en seco: reporte de diferencias y la base queda igual', async ({ assert }) => {
        const antes = await contar()
        const fuente = await leerDirectorio(EJEMPLO)
        const r = await importarMikrowisp(fuente, { dryRun: true, directorio: EJEMPLO })

        assert.equal(r.modo, 'en_seco')
        assert.deepEqual(r.errores, [])
        assert.deepInclude(r.resumen, {
            routers: { origen: 2, creados: 2, existentes: 0, omitidos: 0 },
            redes: { origen: 2, creados: 2, existentes: 0, omitidos: 0 },
            planes: { origen: 3, creados: 2, existentes: 0, omitidos: 1 },
            zonas: { origen: 2, creados: 2, existentes: 0, omitidos: 0 },
            clientes: { origen: 5, creados: 5, existentes: 0, omitidos: 0 },
            implementaciones: { origen: 3, creados: 3, existentes: 0, omitidos: 0 },
            servicios: { origen: 10, creados: 3, existentes: 0, omitidos: 7 },
        })

        const d = r.diferencias
        assert.deepEqual(d.ips_duplicadas, [
            { ip: '198.19.10.11', servicios_mw: ['1002', '1003'], importado_mw: '1002' },
        ])
        assert.deepEqual(d.ips_fuera_de_red, [{ servicio_mw: '1004', ip: '198.19.99.5', router_mw: '2' }])
        assert.deepEqual(
            d.ips_nuevas.map((x) => x.servicio_mw),
            ['1005'],
        )
        assert.match(d.ips_nuevas[0]!.ip!, /^198\.19\.20\.\d+$/)
        assert.sameDeepMembers(
            d.planes_sin_equivalente.map((p) => [p.plan_mw, p.servicios]),
            [
                ['3', 1],
                ['9', 1],
            ],
        )
        assert.deepEqual(
            d.clientes_sin_nit.map((c) => c.cliente_mw),
            ['103'],
        )
        assert.deepEqual(
            d.nit_invalidos.map((c) => [c.cliente_mw, c.nit]),
            [['104', '12345678-0']],
        )
        assert.deepEqual(
            d.user_ppp_duplicados.map((u) => u.servicios_mw),
            [['1001', '1009']],
        )
        assert.deepEqual(
            d.servicios_suspendidos_origen.map((s) => s.servicio_mw),
            ['1002'],
        )
        assert.deepEqual(
            d.servicios_retirados_origen.map((s) => s.servicio_mw),
            ['1008'],
        )
        assert.deepInclude(d.referencias_faltantes, {
            entidad: 'servicio',
            id_mw: '1010',
            falta: 'cliente',
            id_falta_mw: '999',
        })
        assert.isNotEmpty(r.pendiente)

        const texto = formatearReporte(r)
        assert.include(texto, 'EN SECO')
        assert.include(texto, '198.19.10.11: servicios 1002, 1003; se importa 1002')

        assert.deepEqual(await contar(), antes)
    })

    test('real: crea por las acciones (auditoría y outbox) y es idempotente', async ({ assert }) => {
        const trx = await db.transaction()
        try {
            const fuente = await leerDirectorio(EJEMPLO)
            const primera = await importarMikrowisp(fuente, { dryRun: false, trx })
            assert.equal(primera.modo, 'real')
            assert.deepEqual(primera.errores, [])
            assert.equal(primera.resumen.servicios.creados, 3)

            const servicio = await trx
                .from('core.servicios as s')
                .join('core.clientes as c', 'c.id', 's.cliente_id')
                .join('network.ipv4_asignaciones as a', (q) =>
                    q.on('a.servicio_id', 's.id').andOnNull('a.fin'),
                )
                .where('s.user_ppp', 'mw.ana.lopez')
                .select(
                    's.id',
                    's.pass_ppp',
                    's.ipv6_modo',
                    'c.campos_personalizados',
                    trx.raw('host(a.ip) AS ip'),
                )
                .first()
            assert.equal(servicio.ip, '198.19.10.10')
            assert.equal(servicio.ipv6_modo, 'ninguno')
            assert.equal(descifrar(servicio.pass_ppp), 'clave-ana-1')
            assert.equal(servicio.campos_personalizados.mikrowisp_id, '101')

            const invalido = await trx
                .from('core.clientes')
                .whereRaw(`campos_personalizados->>'mikrowisp_id' = '104'`)
                .first()
            assert.isNull(invalido.nit_cui)
            assert.equal(invalido.campos_personalizados.mikrowisp_nit, '12345678-0')

            // Todo pasó por acciones: auditoría y eventos con el request_id de la corrida.
            const acciones = await trx
                .from('audit.acciones')
                .where('request_id', primera.request_id)
                .groupBy('accion')
                .select('accion', trx.raw('count(*)::int AS n'))
            assert.sameDeepMembers(acciones, [
                { accion: 'routers.crear', n: 2 },
                { accion: 'redes.crear', n: 2 },
                { accion: 'planes.crear', n: 2 },
                { accion: 'zonas.crear', n: 2 },
                { accion: 'clientes.crear', n: 5 },
                { accion: 'planes.editar', n: 3 },
                { accion: 'servicios.crear', n: 3 },
            ])
            const eventos = await trx
                .from('audit.outbox')
                .where('request_id', primera.request_id)
                .where('evento', 'servicio.creado')
                .count('* as n')
            assert.equal(Number(eventos[0]!.n), 3)

            const segunda = await importarMikrowisp(fuente, { dryRun: false, trx })
            for (const [entidad, c] of Object.entries(segunda.resumen)) {
                assert.equal(c.creados, 0, `${entidad} no debe crear nada la segunda vez`)
            }
            assert.deepInclude(segunda.resumen, {
                clientes: { origen: 5, creados: 0, existentes: 5, omitidos: 0 },
                servicios: { origen: 10, creados: 0, existentes: 3, omitidos: 7 },
            })
            assert.deepEqual(segunda.errores, [])
            const sinAuditoria = await trx
                .from('audit.acciones')
                .where('request_id', segunda.request_id)
                .first()
            assert.isNull(sinAuditoria)
        } finally {
            await trx.rollback()
        }
    })

    test('--solo-planes-existentes no crea planes y deja sus servicios sin equivalente', async ({
        assert,
    }) => {
        const fuente = await leerDirectorio(EJEMPLO)
        const r = await importarMikrowisp(fuente, { dryRun: true, soloPlanesExistentes: true })
        assert.equal(r.resumen.planes.creados, 0)
        assert.equal(r.resumen.servicios.creados, 0)
        assert.sameMembers(
            r.diferencias.planes_sin_equivalente.map((p) => p.plan_mw),
            ['1', '2', '3', '9'],
        )
    })
})

async function contar() {
    const resultado = (await db.rawQuery(`
        SELECT (SELECT count(*) FROM core.clientes)::int AS clientes,
               (SELECT count(*) FROM core.servicios)::int AS servicios,
               (SELECT count(*) FROM network.routers)::int AS routers,
               (SELECT count(*) FROM network.planes)::int AS planes,
               (SELECT count(*) FROM audit.outbox)::int AS outbox`)) as {
        rows: Array<Record<string, number>>
    }
    return resultado.rows[0]
}
