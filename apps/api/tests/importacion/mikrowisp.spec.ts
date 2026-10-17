import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { leerDumpMysql, ErrorDumpSql } from '#importacion/mysql_dump'
import { leerDumpMikrowisp } from '#importacion/origenes/mikrowisp'
import { normalizarMac } from '#importacion/canonico'
import { importar, metodoPago } from '#importacion/importador'
import type { ReporteImportacion } from '#importacion/reporte'
import { lineasDiferencias, reporteCsv, reporteMarkdown } from '#importacion/reporte_salidas'
import type { CargaFinanciera } from '#importacion/carga_financiera'
import { cargaFinancieraA3 } from '#importacion/carga_financiera'
import { crearPlantillaFila } from '#tests/billing/ayudas_billing'
import { archivoSintetico } from '#tests/importacion/ayudas_importacion'
import { descifrar } from '#shared/cifrado'

/**
 * Volcado sintético sobre el esquema real de Mikrowisp 6 (`scripts/importacion/esquemas/mikrowisp6.sql`
 * + los datos de `scripts/importacion/mikrowisp-sintetico.sql`, redes 198.18.0.0/16): los casos
 * difíciles del dump real. Las corridas reales van en una transacción externa que se revierte al
 * final.
 */

let FIXTURE: string

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

test.group('importacion · volcado MySQL', (group) => {
    group.setup(async () => {
        FIXTURE = await archivoSintetico('mikrowisp')
    })

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

    test('ignora los triggers con DELIMITER aunque traigan INSERT dentro (Mikrowisp 6)', ({ assert }) => {
        const tablas = leerDumpMysql(`
            CREATE TABLE \`logsistema\` (\`log\` text, \`idcliente\` int, \`tipolog\` int);
            CREATE TABLE \`tblservicios\` (\`id\` int, \`ip\` varchar(700));
            DELIMITER ;;
            CREATE TRIGGER \`LogStatusUser\` AFTER UPDATE ON \`tblservicios\` FOR EACH ROW
            IF OLD.ip <> NEW.ip THEN
            INSERT INTO logsistema(log,idcliente,tipolog) VALUES (CONCAT('IP ',NEW.ip), NEW.id,'1');
            END IF;;
            DELIMITER ;
            /*!50003 CREATE*/ /*!50017 DEFINER=\`x\`@\`localhost\`*/ /*!50003 TRIGGER t2 BEFORE INSERT ON tblservicios FOR EACH ROW SET NEW.ip = '' */;
            INSERT INTO \`tblservicios\` (\`id\`, \`ip\`) VALUES ('000101','198.18.10.10; otra');
        `)
        assert.deepEqual(tablas.get('logsistema')!.filas, [])
        assert.deepEqual(tablas.get('tblservicios')!.filas, [{ id: '000101', ip: '198.18.10.10; otra' }])
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
        assert.lengthOf(fuente.clientes, 11)
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

        // Propio del esquema real de Mikrowisp 6
        assert.isNull(s('105')!.ip) // tipoipv4 = 1: IP de la última sesión, no fija
        assert.equal(s('106')!.pass_ppp, 'clave106') // ppppass vacía: Cleartext-Password de radcheck
        assert.equal(s('102')!.ip, '198.18.10.20') // dos IPs: la primera
        assert.containSubset(s('111'), { cliente_id: '10' }) // zerofill '000010'
        assert.equal(fuente.clientes.find((c) => c.id === '10')!.zona, 'MW Centro')
        assert.isUndefined(s('114')) // tiposervicio tv
        assert.equal(s('104')!.estado, 'suspendido') // estado del cliente
        assert.equal(s('112')!.estado, 'retirado')
        assert.isUndefined(fuente.facturas.find((f) => ['5009', '5011', '5012'].includes(f.id)))
        assert.equal(fuente.duenosFacturas?.get('5009'), '10')
        assert.notInclude(
            fuente.pagos.map((p) => p.id),
            '9004',
        )
        const propios = fuente.problemas
            .filter((p) => !p.archivo.endsWith(':usuarios') || p.id !== '7')
            .map((p) => [p.archivo.split(':')[1], p.id, p.aviso, p.mensaje])
        assert.deepInclude(propios, [
            'facturas',
            '5011',
            false,
            'moneda USD: solo se importan facturas en quetzales (GTQ)',
        ])
        assert.deepInclude(propios, [
            'facturas',
            '5012',
            false,
            'estado "Vencida" desconocido (se esperaba No pagado, Pagado o Anulado)',
        ])
        assert.deepInclude(propios, [
            'operaciones',
            '9004',
            false,
            'moneda USD: solo se importan pagos en quetzales (GTQ)',
        ])
        assert.deepInclude(propios, [
            'tblservicios',
            '114',
            false,
            'tiposervicio "tv": solo se importan servicios de internet',
        ])
        assert.sameMembers(
            fuente.problemas.filter((p) => p.aviso && p.archivo.endsWith(':tblservicios')).map((p) => p.id),
            ['101', '102', '110'], // precio distinto, dos IPs, IPv6
        )
        assert.deepInclude(
            fuente.problemas.map((p) => [p.id, p.aviso]),
            ['5007', true],
        )

        // Facturas: la anulada no viene; la pagada con pendiente 0; las abonadas, lo que falta
        const pendiente = Object.fromEntries(fuente.facturas.map((f) => [f.id, f.pendiente]))
        assert.deepEqual(pendiente, {
            '5001': '150.00',
            '5002': '0.00',
            '5003': '350.00',
            '5004': '200.00',
            '5005': '150.00',
            '5006': '600.00',
            '5007': '100.00', // cobrado 50 sin operaciones: se toma lo cobrado (con aviso)
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

test.group('importacion · Mikrowisp desde volcado SQL', (group) => {
    group.setup(async () => {
        FIXTURE = await archivoSintetico('mikrowisp')
    })

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
            suma_origen: '1780.00',
            suma_importada: '1780.00',
            diferencia: '0.00',
            cuadra: true,
        })
        assert.deepInclude(r1.resumen, {
            routers: { origen: 2, creados: 2, existentes: 0, omitidos: 0 },
            clientes: { origen: 11, creados: 11, existentes: 0, omitidos: 0 },
            // 12 filas válidas: 107 sin plan, 111 IP repetida y 112 retirado no entran
            servicios: { origen: 12, creados: 9, existentes: 0, omitidos: 3 },
            // Modo B (clientes 1, 2, 5 y 6 tienen pagos): 5002 pagada entra por su total porque la
            // cubre el pago 9001; 5005 (servicio sin plan) y 5007 (cliente con dos servicios) al saldo
            facturas: { origen: 9, creados: 7, existentes: 0, omitidos: 2 },
            // 4: −50; 5: 130 − 150 = −20 (su pago fue a la factura del 6); 7: 150; 9: 150
            saldos: { origen: 4, creados: 4, existentes: 0, omitidos: 0 },
            pagos: { origen: 3, creados: 3, existentes: 0, omitidos: 0 },
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
            ['103', '105', '109'], // 105: su IP era dinámica (tipoipv4 = 1)
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
        assert.isFalse(r1.pendiente.some((p) => p.startsWith('Pagos históricos')))
        assert.deepEqual(d.pagos_sin_factura, [])
        assert.deepEqual(d.pagos_no_importados, [])

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
        // Lo que el adaptador no traduce sale en el reporte, con su entidad
        const propias = lineasDiferencias(r1).map((x) => [x.entidad, x.id_origen, x.tipo])
        for (const esperada of [
            ['factura', '5011', 'formato_fila'], // dólares
            ['factura', '5012', 'formato_fila'], // estado desconocido
            ['pago', '9004', 'formato_fila'], // dólares
            ['servicio', '114', 'formato_fila'], // tv
            ['servicio', '101', 'formato_campo'], // precio distinto al del plan
            ['factura', '5007', 'formato_campo'], // cobrado sin operaciones
        ]) {
            assert.deepInclude(propias, esperada)
        }
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

            // La clave PPPoE del origen entra cifrada (como la guarda ArgosIsp) y no sale en el reporte
            const ppp = (await trx
                .from('core.servicios as s')
                .join('core.ids_externos as e', (q) =>
                    q
                        .on('e.entidad_id', 's.id')
                        .andOnVal('e.entidad_tipo', 'servicio')
                        .andOnVal('e.sistema', 'mikrowisp'),
                )
                .where('e.externo_id', '101')
                .select('s.pass_ppp')
                .first()) as { pass_ppp: string }
            assert.notEqual(ppp.pass_ppp, 'clave101')
            assert.equal(descifrar(ppp.pass_ppp), 'clave101')
            const salidas = [JSON.stringify(primera), reporteMarkdown(primera), reporteCsv(primera)].join(
                '\n',
            )
            for (const secreto of ['clave1', 'clave-lab-norte', 'secreto-lab-norte']) {
                assert.notInclude(salidas, secreto)
            }

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
                clientes: { origen: 11, creados: 0, existentes: 11, omitidos: 0 },
                servicios: { origen: 12, creados: 0, existentes: 9, omitidos: 3 },
                facturas: { origen: 9, creados: 0, existentes: 7, omitidos: 2 },
                saldos: { origen: 4, creados: 0, existentes: 4, omitidos: 0 },
                pagos: { origen: 3, creados: 0, existentes: 3, omitidos: 0 },
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

    test('pagos históricos (modo B): facturas por su total, pago con facturas: [id], saldos cuadran', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const trx = await db.transaction()
        try {
            const r = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
            })
            assert.deepEqual(r.errores, [])
            assert.isTrue(r.saldos.cuadra)
            assert.equal(r.saldos.suma_importada, '1780.00')

            const factura = async (id: string) =>
                (await trx
                    .from('billing.facturas')
                    .where('clave_externa', `mikrowisp:factura:${id}`)
                    .select('id', 'cliente_id', 'total', 'estado')
                    .first()) as { id: number; cliente_id: number; total: string; estado: string }
            // 5002 estaba pagada: entra por su total y el pago 9001 la salda
            const f5002 = await factura('5002')
            assert.deepInclude(f5002, { total: '150.00', estado: 'pagada' })
            // 5003 (600, abono 250, venció el 2026-09-10): entra por 600 y sigue vencida por 350
            const f5003 = await factura('5003')
            assert.deepInclude(f5003, { total: '600.00', estado: 'vencida' })

            const pagos = (await trx
                .from('billing.pagos as p')
                .where('p.clave_externa', 'like', 'mikrowisp:pago:%')
                .select(
                    'p.id',
                    'p.clave_externa',
                    'p.cliente_id',
                    'p.monto',
                    'p.metodo',
                    'p.historico',
                    'p.origen',
                    db.raw(`to_char(p.created_at AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD') AS fecha`),
                )
                .orderBy('p.clave_externa')) as Array<Record<string, unknown>>
            assert.deepEqual(
                pagos.map((p) => [p.clave_externa, p.monto, p.metodo, p.historico, p.fecha]),
                [
                    ['mikrowisp:pago:9001', '150.00', 'caja', true, '2026-08-05'],
                    ['mikrowisp:pago:9002', '250.00', 'transferencia', true, '2026-09-08'],
                    ['mikrowisp:pago:9003', '100.00', 'caja', true, '2026-09-09'],
                ],
            )
            // El pago cruzado (cliente 5 → factura 5004 del cliente 6) se aplica a esa factura
            const f5004 = await factura('5004')
            const aplicaciones = (await trx
                .from('billing.pagos_aplicaciones')
                .where('pago_id', pagos[2]!.id as number)
                .select('factura_id', 'monto')) as Array<{ factura_id: number; monto: string }>
            assert.deepEqual(
                aplicaciones.map((a) => [a.factura_id, a.monto]),
                [[f5004.id, '100.00']],
            )
            assert.notEqual(pagos[2]!.cliente_id, f5004.cliente_id)
            // Origen neutral de A3: el sistema de la corrida, con el mismo formato de id de siempre
            assert.deepEqual([...new Set(pagos.map((p) => p.origen))], ['mikrowisp'])

            // Segunda corrida: nada nuevo, sigue cuadrando
            const r2 = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
            })
            assert.deepEqual(r2.resumen.pagos, { origen: 3, creados: 0, existentes: 3, omitidos: 0 })
            assert.isTrue(r2.saldos.cuadra)
        } finally {
            await trx.rollback()
        }
    })

    test('sin acción de pago histórico: modo A (facturas por lo pendiente) y también cuadra', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const carga: CargaFinanciera = { ...cargaFinancieraA3, registrarPagoHistorico: null }
        const r = await importar(await leerDumpMikrowisp(FIXTURE), {
            sistema: 'mikrowisp',
            dryRun: true,
            plantillaId,
            carga,
        })
        assert.deepInclude(r.resumen, {
            facturas: { origen: 9, creados: 6, existentes: 0, omitidos: 3 },
            pagos: { origen: 3, creados: 0, existentes: 0, omitidos: 3 },
        })
        assert.isTrue(r.saldos.cuadra)
        assert.isTrue(r.pendiente.some((p) => p.startsWith('Pagos históricos: 3 pagos')))
    })

    test('pagos que no cuadran con sus facturas: el saldo inicial compensa y lo reporta', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const fuente = await leerDumpMikrowisp(FIXTURE)
        // 9001 sin fecha (no se importa) y 9002 a una factura que no entra (5005 no tiene servicio)
        fuente.pagos.find((p) => p.id === '9001')!.fecha = null
        fuente.pagos.find((p) => p.id === '9002')!.factura_id = '5005'
        const r = await importar(fuente, { sistema: 'mikrowisp', dryRun: true, plantillaId })
        assert.deepEqual(r.errores, [])
        assert.deepEqual(
            r.diferencias.pagos_no_importados.map((x) => x.pago_origen),
            ['9001'],
        )
        assert.deepEqual(
            r.diferencias.pagos_sin_factura.map((x) => [x.pago_origen, x.factura_origen]),
            [['9002', '5005']],
        )
        assert.isTrue(r.saldos.cuadra)
        assert.deepInclude(
            lineasDiferencias(r).map((x) => [x.entidad, x.id_origen, x.tipo]),
            ['pago', '9002', 'pago_sin_factura'],
        )
    })

    test('forma de pago del origen a los métodos de ArgosIsp', ({ assert }) => {
        assert.equal(metodoPago('Efectivo'), 'caja')
        assert.equal(metodoPago('Depósito BI'), 'deposito')
        assert.equal(metodoPago('Transferencia'), 'transferencia')
        assert.equal(metodoPago('Tarjeta de crédito'), 'debito')
        assert.equal(metodoPago('PayPal'), 'pasarela')
        assert.equal(metodoPago(null), 'caja')
    })
})
