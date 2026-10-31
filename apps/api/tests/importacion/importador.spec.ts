import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { leerCsv, ErrorCsv } from '#importacion/csv'
import { leerDirectorio } from '#importacion/origenes/csv'
import { importar } from '#importacion/importador'
import { formatearReporte } from '#importacion/reporte'
import { lineasDiferencias } from '#importacion/reporte_salidas'
import type { EntidadExterna, IdsExternos } from '#importacion/ids_externos'
import { descifrar } from '#shared/cifrado'
import { crearPlantillaFila } from '#tests/billing/ayudas_billing'

/**
 * Pruebas con el ejemplo de `scripts/importacion/ejemplo/` (redes 198.19.0.0/16 y NAS en
 * 198.51.100.0/24, lejos de los datos de otras pruebas). La importación real corre dentro de una
 * transacción externa que se revierte al final, para no dejar datos en la BD de pruebas.
 */

const EJEMPLO = fileURLToPath(new URL('../../../../scripts/importacion/ejemplo/', import.meta.url))

/** ¿Ya está el modelo WISP de A1 (`core.servicios.tipo_conexion`)? Las pruebas se adaptan. */
async function hayTipoConexion(): Promise<boolean> {
    const r = (await db.rawQuery(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = 'core' AND table_name = 'servicios' AND column_name = 'tipo_conexion'`,
    )) as { rows: Array<{ n: number }> }
    return r.rows[0]!.n === 1
}

/** ¿Ya está `core.ids_externos` de A1? */
async function hayIdsExternos(): Promise<boolean> {
    const r = (await db.rawQuery(`SELECT to_regclass('core.ids_externos') IS NOT NULL AS hay`)) as {
        rows: Array<{ hay: boolean }>
    }
    return r.rows[0]!.hay
}

/** Ids externos en memoria (lo que hará `core.ids_externos` de A1). */
class IdsEnMemoria implements IdsExternos {
    readonly modo = 'tabla' as const
    readonly mapa = new Map<string, number>()
    async buscar(entidad: EntidadExterna, externoId: string) {
        return this.mapa.get(`${entidad}:${externoId}`) ?? null
    }
    externo() {
        return undefined // el doble guarda en memoria con registrar; las acciones no lo ven
    }
    async registrar(entidad: EntidadExterna, externoId: string, entidadId: number) {
        this.mapa.set(`${entidad}:${externoId}`, entidadId)
    }
}

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
        assert.lengthOf(fuente.servicios, 13)
        assert.lengthOf(fuente.facturas, 6)
        assert.lengthOf(fuente.saldos, 5)

        const s1001 = fuente.servicios.find((s) => s.id === '1001')!
        assert.equal(s1001.mac, 'AA:BB:CC:DD:EE:01')
        assert.equal(s1001.coordenadas, '14.6349,-90.5069')
        assert.equal(s1001.fecha_instalacion, '2024-03-15')
        assert.equal(s1001.tipo_conexion, 'pppoe')
        assert.equal(fuente.servicios.find((s) => s.id === '1002')!.fecha_instalacion, '2024-04-15')
        assert.equal(fuente.servicios.find((s) => s.id === '1002')!.tipo_conexion, 'pppoe')
        assert.equal(fuente.servicios.find((s) => s.id === '1008')!.estado, 'retirado')

        // WISP sin PPPoE: sin credenciales; dhcp_fija con MAC normalizada; amarre opcional
        assert.containSubset(
            fuente.servicios.find((s) => s.id === '1012'),
            {
                tipo_conexion: 'ip_estatica',
                user_ppp: null,
                pass_ppp: null,
                ip: '198.19.10.50',
                amarre_ip_mac: false,
            },
        )
        assert.containSubset(
            fuente.servicios.find((s) => s.id === '1013'),
            {
                tipo_conexion: 'dhcp_fija',
                mac: 'AA:BB:CC:00:10:13',
                amarre_ip_mac: true,
            },
        )
        assert.containSubset(
            fuente.servicios.find((s) => s.id === '1014'),
            {
                tipo_conexion: 'dhcp_fija',
                ip: null,
                mac: 'AA:BB:CC:00:10:14',
            },
        )

        // facturas: lo pendiente = total − pagado; periodo YYYY-MM o MM/YYYY → primer día
        const facturas = Object.fromEntries(fuente.facturas.map((f) => [f.id, f]))
        assert.containSubset(facturas['5002'], {
            servicio_id: null,
            periodo: '2026-10-01',
            pendiente: '100.00',
        })
        assert.containSubset(facturas['5003'], {
            periodo: '2026-10-01',
            pendiente: '1250.50',
            vence: '2026-10-15',
        })
        assert.equal(facturas['5005']!.pendiente, '0.00')
        assert.deepEqual(
            fuente.saldos.map((x) => [x.cliente_id, x.saldo]),
            [
                ['101', '300.00'],
                ['102', '1250.50'],
                ['103', '170.00'],
                ['105', '-20.00'],
                ['106', '75.00'],
            ],
        )

        const problemas = fuente.problemas.map((p) => `${p.archivo}:${p.id}:${p.aviso ? 'aviso' : 'omitida'}`)
        assert.sameMembers(problemas, [
            'clientes.csv:105:aviso', // email
            'clientes.csv:105:aviso', // coordenadas
            'clientes.csv:106:omitida', // sin nombre
            'servicios.csv:1005:aviso', // fecha 2024-13-40
            'servicios.csv:1011:omitida', // IP 300.1.1.1
            'servicios.csv:1015:omitida', // ip_estatica sin IP
            'servicios.csv:1016:omitida', // dhcp_fija sin MAC
            'facturas.csv:5007:omitida', // total "abc"
        ])
    })
})

test.group('importacion · Mikrowisp', () => {
    test('en seco: reporte de diferencias, suma de saldos contra el origen y la base queda igual', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const wisp = await hayTipoConexion()
        const antes = await contar()
        const fuente = await leerDirectorio(EJEMPLO)
        const r = await importar(fuente, { sistema: 'mikrowisp', dryRun: true, fuente: EJEMPLO, plantillaId })

        assert.equal(r.modo, 'en_seco')
        assert.deepEqual(r.errores, [])
        assert.deepInclude(r.resumen, {
            routers: { origen: 2, creados: 2, existentes: 0, omitidos: 0 },
            redes: { origen: 2, creados: 2, existentes: 0, omitidos: 0 },
            planes: { origen: 3, creados: 2, existentes: 0, omitidos: 1 },
            zonas: { origen: 2, creados: 2, existentes: 0, omitidos: 0 },
            clientes: { origen: 5, creados: 5, existentes: 0, omitidos: 0 },
            // con WISP, 1012 (plan 2 en el router 1) agrega una implementación
            implementaciones: wisp
                ? { origen: 4, creados: 4, existentes: 0, omitidos: 0 }
                : { origen: 3, creados: 3, existentes: 0, omitidos: 0 },
            servicios: wisp
                ? { origen: 13, creados: 6, existentes: 0, omitidos: 7 }
                : { origen: 13, creados: 3, existentes: 0, omitidos: 10 },
            // Modo B (todas por su total): 5001, 5002 (sin servicio_id: el único del cliente), 5003,
            // 5004 (su servicio no entró: cargo único del cliente) y 5005 (pagada: saldada en el
            // origen); 5006 es de un cliente que no existe
            facturas: { origen: 6, creados: 5, existentes: 0, omitidos: 1 },
            // la diferencia que las facturas no explican: 103: 170 − 150 = 20; 105: −20 (a favor).
            // 101 no lleva: sus facturas por su total ya suman los 300 del origen
            saldos: { origen: 2, creados: 2, existentes: 0, omitidos: 0 },
        })
        assert.equal(r.ids_externos, (await hayIdsExternos()) ? 'tabla' : 'ninguno')

        // Suma de saldos: lo que no cuadra son los clientes que no se pudieron importar
        assert.deepEqual(r.saldos, {
            clientes: 7, // los 5 del origen (todos en modo B), 106 (solo en saldos) y 999 (solo en facturas)
            suma_origen: '1874.50',
            suma_importada: '1700.50',
            diferencia: '-174.00',
            cuadra: false,
        })
        assert.sameDeepMembers(r.diferencias.saldos_distintos, [
            { cliente_origen: '106', nombre: null, origen: '75.00', importado: '0.00', diferencia: '-75.00' },
            { cliente_origen: '999', nombre: null, origen: '99.00', importado: '0.00', diferencia: '-99.00' },
        ])
        // su servicio no entró: cargo único del cliente (contrato «Importación completa»)
        assert.deepEqual(r.diferencias.facturas_a_saldo, [])
        assert.deepEqual(r.diferencias.facturas_cargo_unico, [
            {
                factura_origen: '5004',
                cliente_origen: '103',
                total: '150.00',
                nota: 'sin servicio en ArgosIsp (el servicio 1003 no se importó): entra como cargo único del cliente',
            },
        ])
        assert.deepEqual(
            r.diferencias.facturas_saldadas_en_origen.map((x) => x.factura_origen),
            ['5005'],
        )
        // Cuadre por tabla del directorio CSV: cada fila contada
        for (const t of r.tablas) {
            assert.equal(
                t.leidas,
                t.creadas + t.existentes + t.al_saldo + t.solo_archivo + t.omitidas,
                t.tabla,
            )
        }
        assert.deepInclude(r.diferencias.referencias_faltantes, {
            entidad: 'factura',
            id_origen: '5006',
            falta: 'cliente',
            id_falta_origen: '999',
        })
        assert.deepInclude(r.diferencias.referencias_faltantes, {
            entidad: 'saldo',
            id_origen: '106',
            falta: 'cliente',
            id_falta_origen: '106',
        })
        if (wisp) {
            assert.deepEqual(r.diferencias.tipos_conexion_pendientes, [])
        } else {
            assert.deepEqual(
                r.diferencias.tipos_conexion_pendientes.map((x) => [x.servicio_origen, x.tipo_conexion]),
                [
                    ['1012', 'ip_estatica'],
                    ['1013', 'dhcp_fija'],
                    ['1014', 'dhcp_fija'],
                ],
            )
        }

        const d = r.diferencias
        assert.deepEqual(d.ips_duplicadas, [
            { ip: '198.19.10.11', servicios_origen: ['1002', '1003'], importado_origen: '1002' },
        ])
        assert.deepEqual(d.ips_fuera_de_red, [
            { servicio_origen: '1004', ip: '198.19.99.5', router_origen: '2' },
        ])
        assert.include(
            d.ips_nuevas.map((x) => x.servicio_origen),
            '1005',
        )
        assert.match(d.ips_nuevas.find((x) => x.servicio_origen === '1005')!.ip!, /^198\.19\.20\.\d+$/)
        assert.sameDeepMembers(
            d.planes_sin_equivalente.map((p) => [p.plan_origen, p.servicios]),
            [
                ['3', 1],
                ['9', 1],
            ],
        )
        assert.deepEqual(
            d.clientes_sin_nit.map((c) => c.cliente_origen),
            ['103'],
        )
        assert.deepEqual(
            d.nit_invalidos.map((c) => [c.cliente_origen, c.nit]),
            [['104', '12345678-0']],
        )
        assert.deepEqual(
            d.user_ppp_duplicados.map((u) => u.servicios_origen),
            [['1001', '1009']],
        )
        assert.deepEqual(
            d.servicios_suspendidos_origen.map((s) => s.servicio_origen),
            ['1002'],
        )
        assert.deepEqual(
            d.servicios_retirados_origen.map((s) => s.servicio_origen),
            ['1008'],
        )
        assert.deepInclude(d.referencias_faltantes, {
            entidad: 'servicio',
            id_origen: '1010',
            falta: 'cliente',
            id_falta_origen: '999',
        })
        assert.isNotEmpty(r.pendiente)

        const texto = formatearReporte(r)
        assert.include(texto, 'EN SECO')
        assert.include(texto, '198.19.10.11: servicios 1002, 1003; se importa 1002')
        assert.include(
            texto,
            'Saldos (7 clientes): origen Q 1874.50 · ArgosIsp Q 1700.50 · DIFERENCIA Q -174.00',
        )
        assert.include(texto, 'cliente 999: origen Q 99.00 · ArgosIsp Q 0.00 · diferencia Q -99.00')

        assert.deepEqual(await contar(), antes)
    })

    test('en seco sin diferencias de saldo: cuadra', async ({ assert }) => {
        const plantillaId = await crearPlantillaFila()
        const fuente = await leerDirectorio(EJEMPLO)
        // sin el cliente que no existe (106) ni la factura del cliente fantasma (999)
        // sin archivo del origen: se quitaron filas a mano y el cuadre por tabla las echaría de menos
        const limpia = {
            ...fuente,
            archivo: undefined,
            saldos: fuente.saldos.filter((x) => x.cliente_id !== '106'),
            facturas: fuente.facturas.filter((f) => f.cliente_id !== '999'),
        }
        const r = await importar(limpia, { sistema: 'mikrowisp', dryRun: true, plantillaId })
        assert.deepEqual(r.saldos, {
            clientes: 5,
            suma_origen: '1700.50',
            suma_importada: '1700.50',
            diferencia: '0.00',
            cuadra: true,
        })
        assert.deepEqual(r.diferencias.saldos_distintos, [])
        assert.include(formatearReporte(r), '· CUADRA')
    })

    test('real: crea por las acciones (auditoría y outbox) y es idempotente', async ({ assert }) => {
        const plantillaId = await crearPlantillaFila()
        const wisp = await hayTipoConexion()
        const trx = await db.transaction()
        try {
            const fuente = await leerDirectorio(EJEMPLO)
            const primera = await importar(fuente, { sistema: 'mikrowisp', dryRun: false, trx, plantillaId })
            assert.equal(primera.modo, 'real')
            assert.deepEqual(primera.errores, [])
            assert.equal(primera.resumen.servicios.creados, wisp ? 6 : 3)

            const servicio = await trx
                .from('core.servicios as s')
                .join('core.clientes as c', 'c.id', 's.cliente_id')
                .join('network.ipv4_asignaciones as a', (q) =>
                    q.on('a.servicio_id', 's.id').andOnNull('a.fin'),
                )
                .where('s.user_ppp', 'mw.ana.lopez')
                .select(
                    's.id',
                    's.cliente_id',
                    's.pass_ppp',
                    's.ipv6_modo',
                    's.plantilla_facturacion_id',
                    'c.campos_personalizados',
                    trx.raw('host(a.ip) AS ip'),
                )
                .first()
            assert.equal(servicio.ip, '198.19.10.10')
            assert.equal(servicio.ipv6_modo, 'ninguno')
            assert.equal(servicio.plantilla_facturacion_id, plantillaId)
            assert.equal(descifrar(servicio.pass_ppp), 'clave-ana-1')
            assert.equal(servicio.campos_personalizados.mikrowisp_id, '101')

            const invalido = await trx
                .from('core.clientes')
                .whereRaw(`campos_personalizados->>'mikrowisp_id' = '104'`)
                .first()
            assert.isNull(invalido.nit_cui)
            assert.equal(invalido.campos_personalizados.mikrowisp_nit, '12345678-0')

            // Todo pasó por acciones: auditoría y eventos con el request_id de la corrida.
            const acciones = (await trx
                .from('audit.acciones')
                .where('request_id', primera.request_id)
                .groupBy('accion')
                .select('accion', trx.raw('count(*)::int AS n'))) as Array<{ accion: string; n: number }>
            const porAccion = Object.fromEntries(acciones.map((a) => [a.accion, a.n]))
            assert.containSubset(porAccion, {
                'routers.crear': 2,
                'redes.crear': 2,
                'planes.crear': 2,
                'zonas.crear': 2,
                'clientes.crear': 5,
                'planes.editar': wisp ? 4 : 3,
                'servicios.crear': wisp ? 6 : 3,
                'facturas.importar_pendiente': 5,
                'facturas.registrar_saldo_inicial': 2,
                'importacion.archivar': 7, // un lote por archivo CSV
            })
            const eventos = await trx
                .from('audit.outbox')
                .where('request_id', primera.request_id)
                .where('evento', 'servicio.creado')
                .count('* as n')
            assert.equal(Number(eventos[0]!.n), wisp ? 6 : 3)

            // Facturas y saldos por las acciones de A3, con su clave externa
            const factura = await trx
                .from('billing.facturas')
                .where('clave_externa', 'mikrowisp:factura:5002')
                .firstOrFail()
            assert.equal(factura.total, '150.00') // por su total (modo B)
            assert.equal(Number(factura.servicio_id), Number(servicio.id))
            const saldo103 = await trx
                .from('billing.saldos_iniciales')
                .where('clave_externa', 'mikrowisp:saldo:103')
                .firstOrFail()
            assert.equal(saldo103.monto, '20.00')
            assert.equal(primera.saldos.suma_importada, '1700.50')

            const segunda = await importar(fuente, { sistema: 'mikrowisp', dryRun: false, trx, plantillaId })
            for (const [entidad, c] of Object.entries(segunda.resumen)) {
                assert.equal(c.creados, 0, `${entidad} no debe crear nada la segunda vez`)
            }
            assert.deepInclude(segunda.resumen, {
                clientes: { origen: 5, creados: 0, existentes: 5, omitidos: 0 },
                servicios: wisp
                    ? { origen: 13, creados: 0, existentes: 6, omitidos: 7 }
                    : { origen: 13, creados: 0, existentes: 3, omitidos: 10 },
                facturas: { origen: 6, creados: 0, existentes: 5, omitidos: 1 },
                saldos: { origen: 2, creados: 0, existentes: 2, omitidos: 0 },
            })
            assert.deepEqual(segunda.errores, [])
            // la suma no cambia al repetir
            assert.deepEqual(segunda.saldos, primera.saldos)
            const sinAuditoria = await trx
                .from('audit.acciones')
                .where('request_id', segunda.request_id)
                .first()
            assert.isNull(sinAuditoria)
        } finally {
            await trx.rollback()
        }
    })

    test('teléfonos (A14 de Iris): los válidos quedan normalizados; los inválidos, tal cual y en el reporte', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const trx = await db.transaction()
        try {
            const fuente = await leerDirectorio(EJEMPLO)
            const cambiada = {
                ...fuente,
                // sin archivo del origen: las filas se cambiaron a mano
                archivo: undefined,
                clientes: fuente.clientes.map((c) =>
                    c.id === '101'
                        ? { ...c, telefono: '2222-3333', movil: ' 12-34 ' }
                        : c.id === '103'
                          ? { ...c, movil: '+502 5555 1111' }
                          : c,
                ),
            }
            const r = await importar(cambiada, { sistema: 'mikrowisp', dryRun: false, trx, plantillaId })
            assert.deepEqual(r.diferencias.telefonos_invalidos, [
                { cliente_origen: '101', nombre: 'Ana López', campo: 'movil', telefono: '12-34' },
            ])
            const linea = lineasDiferencias(r).find((l) => l.tipo === 'telefono_invalido')!
            assert.containsSubset(linea, { entidad: 'cliente', id_origen: '101', gravedad: 'aviso' })
            assert.include(formatearReporte(r), 'movil "12-34"')

            const telefonos = async (id: string) =>
                trx
                    .from('core.clientes')
                    .whereRaw(`campos_personalizados->>'mikrowisp_id' = ?`, [id])
                    .select('telefono', 'movil')
                    .first()
            assert.deepEqual(await telefonos('101'), { telefono: '+502 2222-3333', movil: '12-34' })
            assert.deepEqual(await telefonos('103'), { telefono: null, movil: '+502 5555-1111' })
        } finally {
            await trx.rollback()
        }
    })

    test('ids externos: reconoce lo ya importado aunque cambien nombre e IP del router en el origen', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const ids = new IdsEnMemoria()
        const trx = await db.transaction()
        try {
            const fuente = await leerDirectorio(EJEMPLO)
            const primera = await importar(fuente, {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
                idsExternos: ids,
            })
            assert.equal(primera.ids_externos, 'tabla')
            assert.isNumber(await ids.buscar('router', '1'))
            assert.isNumber(await ids.buscar('cliente', '101'))
            assert.isNumber(await ids.buscar('servicio', '1001'))

            // En Mikrowisp renombraron el router 1 y le cambiaron la IP: por claves naturales sería otro
            const cambiada = {
                ...fuente,
                routers: fuente.routers.map((x) =>
                    x.id === '1' ? { ...x, nombre: 'MW Centro (renombrado)', nas_ip: '198.51.100.99' } : x,
                ),
            }
            const segunda = await importar(cambiada, {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
                idsExternos: ids,
            })
            assert.deepEqual(segunda.resumen.routers, { origen: 2, creados: 0, existentes: 2, omitidos: 0 })
            assert.equal(segunda.resumen.servicios.creados, 0)
        } finally {
            await trx.rollback()
        }
    })

    test('core.ids_externos (A1): las altas guardan el id de Mikrowisp y una segunda corrida lo usa', async ({
        assert,
    }) => {
        if (!(await hayIdsExternos())) return // sin la tabla de A1, solo claves naturales (prueba anterior)
        const plantillaId = await crearPlantillaFila()
        const trx = await db.transaction()
        try {
            const fuente = await leerDirectorio(EJEMPLO)
            // Otras pruebas (p. ej. las de A1) también dejan vínculos `mikrowisp` en la base
            // compartida: se cuenta solo lo que agrega esta corrida.
            const contarVinculos = async () => {
                const filas = (await trx
                    .from('core.ids_externos')
                    .where('sistema', 'mikrowisp')
                    .groupBy('entidad_tipo')
                    .select('entidad_tipo', trx.raw('count(*)::int AS n'))) as Array<{
                    entidad_tipo: string
                    n: number
                }>
                return Object.fromEntries(filas.map((v) => [v.entidad_tipo, v.n])) as Record<string, number>
            }
            const antes = await contarVinculos()
            const primera = await importar(fuente, { sistema: 'mikrowisp', dryRun: false, trx, plantillaId })
            assert.equal(primera.ids_externos, 'tabla')
            assert.deepEqual(primera.errores, [])
            const despues = await contarVinculos()
            const porTipo = Object.fromEntries(
                Object.entries(despues).map(([tipo, n]) => [tipo, n - (antes[tipo] ?? 0)]),
            )
            assert.containSubset(porTipo, { router: 2, plan: 2, cliente: 5 })
            assert.equal(porTipo.servicio, primera.resumen.servicios.creados)

            const cambiada = {
                ...fuente,
                routers: fuente.routers.map((x) =>
                    x.id === '1' ? { ...x, nombre: 'MW Centro (renombrado)', nas_ip: '198.51.100.99' } : x,
                ),
            }
            const segunda = await importar(cambiada, {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
            })
            assert.deepEqual(segunda.resumen.routers, { origen: 2, creados: 0, existentes: 2, omitidos: 0 })
            assert.deepEqual(segunda.errores, [])
        } finally {
            await trx.rollback()
        }
    })

    test('servicios sin PPPoE: sin credenciales (o pendientes mientras falte el modelo de A1)', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const wisp = await hayTipoConexion()
        const trx = await db.transaction()
        try {
            const fuente = await leerDirectorio(EJEMPLO)
            const r = await importar(fuente, { sistema: 'mikrowisp', dryRun: false, trx, plantillaId })
            assert.deepEqual(r.errores, [])
            const porIp = async (valor: string) =>
                (await trx
                    .from('network.ipv4_asignaciones as a')
                    .join('core.servicios as s', 's.id', 'a.servicio_id')
                    .whereRaw('a.ip = ?::inet', [valor])
                    .whereNull('a.fin')
                    .select('s.*')
                    .first()) as Record<string, unknown> | null
            if (!wisp) {
                assert.lengthOf(r.diferencias.tipos_conexion_pendientes, 3)
                assert.isNull(await porIp('198.19.10.50'))
                assert.include(r.pendiente.join(' '), 'tipo_conexion')
                return
            }
            assert.containSubset(await porIp('198.19.10.50'), {
                tipo_conexion: 'ip_estatica',
                user_ppp: null,
            })
            assert.containSubset(await porIp('198.19.10.51'), {
                tipo_conexion: 'dhcp_fija',
                amarre_ip_mac: true,
                user_ppp: null,
            })
            const dhcp = (await trx
                .from('core.servicios')
                .whereRaw(`mac = 'AA:BB:CC:00:10:14'::macaddr`)
                .first()) as Record<string, unknown>
            assert.equal(dhcp.tipo_conexion, 'dhcp_fija')
            const otra = await importar(fuente, { sistema: 'mikrowisp', dryRun: false, trx, plantillaId })
            assert.equal(otra.resumen.servicios.creados, 0)
        } finally {
            await trx.rollback()
        }
    })

    test('--solo-planes-existentes no crea planes y deja sus servicios sin equivalente', async ({
        assert,
    }) => {
        const fuente = await leerDirectorio(EJEMPLO)
        const r = await importar(fuente, {
            sistema: 'mikrowisp',
            dryRun: true,
            soloPlanesExistentes: true,
            plantillaId: null,
        })
        assert.equal(r.resumen.planes.creados, 0)
        assert.equal(r.resumen.servicios.creados, 0)
        assert.sameMembers(
            r.diferencias.planes_sin_equivalente.map((p) => p.plan_origen),
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
               (SELECT count(*) FROM billing.facturas)::int AS facturas,
               (SELECT count(*) FROM billing.saldos_iniciales)::int AS saldos,
               (SELECT count(*) FROM ledger.asientos)::int AS asientos,
               (SELECT count(*) FROM audit.outbox)::int AS outbox`)) as {
        rows: Array<Record<string, number>>
    }
    return resultado.rows[0]
}
