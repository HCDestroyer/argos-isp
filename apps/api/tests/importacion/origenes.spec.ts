import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { COLUMNAS, ENTIDADES } from '#importacion/canonico'
import { leerCsv } from '#importacion/csv'
import { importar } from '#importacion/importador'
import type { ReporteImportacion } from '#importacion/reporte'
import { ARCHIVOS, generarPlantillas, leerDirectorio } from '#importacion/origenes/csv'
import { leerDumpMikrowisp } from '#importacion/origenes/mikrowisp'
import { fuenteDesdeDumpSmartisp } from '#importacion/origenes/smartisp'
import { EsquemaIncompleto } from '#importacion/origenes/esquema_sql'
import { leerOrigen } from '#importacion/origenes/index'
import { crearPlantillaFila } from '#tests/billing/ayudas_billing'

/**
 * Importador multi-origen: los adaptadores solo traducen al formato canónico, y el núcleo da el
 * mismo resultado para los mismos datos venga de donde venga.
 */

const SQL = fileURLToPath(new URL('../../../../scripts/importacion/mikrowisp-sintetico.sql', import.meta.url))
/** Los mismos datos del volcado sintético de Mikrowisp, como CSV canónicos. */
const CSV = fileURLToPath(new URL('../../../../scripts/importacion/sintetico-csv/', import.meta.url))

/**
 * Lo que debe coincidir entre orígenes: todo salvo request_id, horas, nombre del origen y de la
 * fuente, y el archivo y la línea de los problemas de formato (`tblservicios` fila 13 frente a
 * `servicios.csv` línea 14).
 */
function comparable(r: ReporteImportacion) {
    const copia: Partial<ReporteImportacion> = { ...r }
    for (const campo of ['request_id', 'inicio', 'fin', 'origen', 'fuente'] as const) delete copia[campo]
    copia.formato = r.formato.map(({ id, mensaje, aviso }) => ({ archivo: '', linea: 0, id, mensaje, aviso }))
    return copia
}

const SMARTISP_COMPLETO = `
CREATE TABLE routers (id int, name varchar(50), ip varchar(20), login varchar(20), password varchar(20), radius_secret varchar(20));
INSERT INTO routers VALUES (1,'Torre SI','198.18.70.1','argos','clave','secreto');
CREATE TABLE networks (router_id int, network varchar(20), gateway varchar(20));
INSERT INTO networks VALUES (1,'198.18.70.0/24','198.18.70.1');
CREATE TABLE plans (id int, name varchar(50), cost decimal(10,2), download varchar(10), upload varchar(10));
INSERT INTO plans VALUES (1,'SI 10M',150.00,'10M','5M');
CREATE TABLE clients (id int, name varchar(50), email varchar(50), phone varchar(20), dni varchar(20), address varchar(80), balance decimal(10,2));
INSERT INTO clients VALUES (1,'Cliente SmartISP','si@example.com','22223333','CF','Zona 1',20.00);
CREATE TABLE client_services (id int, client_id int, router_id int, plan_id int, user varchar(20), password varchar(20), ip varchar(20), mac varchar(20), status varchar(20));
INSERT INTO client_services VALUES (1,1,1,1,'si.cliente','clave','198.18.70.10',NULL,'active'),(2,1,1,1,'si.viejo','clave',NULL,NULL,'cancelled');
CREATE TABLE bills (id int, client_id int, period varchar(10), total decimal(10,2), paid decimal(10,2), status varchar(10));
INSERT INTO bills VALUES (1,1,'2026-09',150.00,50.00,'unpaid'),(2,1,'2026-08',150.00,0,'void');
CREATE TABLE payments (id int, client_id int, bill_id int, amount decimal(10,2), date date);
INSERT INTO payments VALUES (1,1,1,50.00,'2026-09-05');
`

test.group('importacion · orígenes', () => {
    test('CSV con los mismos datos que el volcado de Mikrowisp da el mismo reporte', async ({ assert }) => {
        const plantillaId = await crearPlantillaFila()
        const desdeSql = await importar(await leerOrigen('mikrowisp', SQL), {
            sistema: 'mikrowisp',
            dryRun: true,
            plantillaId,
        })
        const desdeCsv = await importar(await leerOrigen('csv', CSV), {
            sistema: 'csv',
            dryRun: true,
            plantillaId,
        })
        assert.deepEqual(comparable(desdeCsv), comparable(desdeSql))
        assert.equal(desdeCsv.origen, 'csv')
        assert.match(desdeCsv.request_id, /^importacion-csv-/)
        assert.isTrue(desdeCsv.saldos.cuadra)
        assert.equal(desdeCsv.saldos.suma_origen, '1830.00')
        assert.deepEqual(desdeCsv.errores, [])
    })

    test('idempotencia por origen + id: el CSV de un Mikrowisp ya importado (--sistema=mikrowisp) no crea nada', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const trx = await db.transaction()
        try {
            const real = await importar(await leerDumpMikrowisp(SQL), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
            })
            assert.isTrue(real.saldos.cuadra)
            const otra = await importar(await leerDirectorio(CSV), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
            })
            for (const [entidad, c] of Object.entries(otra.resumen)) {
                assert.equal(c.creados, 0, `${entidad} ya estaba importado`)
            }
            assert.deepEqual(otra.resumen.clientes, { origen: 10, creados: 0, existentes: 10, omitidos: 0 })
            assert.isTrue(otra.saldos.cuadra)
        } finally {
            await trx.rollback()
        }
    })

    test('el sistema de origen debe servir de clave', async ({ assert }) => {
        await assert.rejects(
            () =>
                importar(fuenteDesdeDumpSmartisp(SMARTISP_COMPLETO), { sistema: 'Smart ISP', dryRun: true }),
            /Sistema de origen "Smart ISP" inválido/,
        )
    })

    test('SmartISP: rechaza un esquema incompleto con todo lo que falta, antes de tocar la base', ({
        assert,
    }) => {
        const incompleto = `
            CREATE TABLE routers (id int, name varchar(50));
            INSERT INTO routers VALUES (1,'Torre');
            CREATE TABLE plans (id int, name varchar(50), cost decimal(10,2), download varchar(10), upload varchar(10));
        `
        try {
            fuenteDesdeDumpSmartisp(incompleto, 'smartisp.sql')
            assert.fail('debió rechazar el volcado')
        } catch (error) {
            assert.instanceOf(error, EsquemaIncompleto)
            const e = error as EsquemaIncompleto
            assert.equal(e.origen, 'smartisp')
            assert.deepEqual(e.faltantes, [
                'a la tabla routers le faltan las columnas ip',
                'falta la tabla clients',
                'falta la tabla client_services',
            ])
            assert.include(e.message, 'smartisp.sql: no tiene el esquema que espera el origen smartisp')
            assert.include(e.message, 'apps/api/app/importacion/origenes/smartisp.ts')
        }
        // Un volcado de Mikrowisp tampoco pasa por SmartISP (origen equivocado)
        assert.throws(() => fuenteDesdeDumpSmartisp('CREATE TABLE usuarios (id int);'), EsquemaIncompleto)
    })

    test('SmartISP: con el esquema supuesto traduce al formato canónico', ({ assert }) => {
        const fuente = fuenteDesdeDumpSmartisp(SMARTISP_COMPLETO)
        assert.deepEqual(fuente.problemas, [])
        assert.containSubset(fuente.routers, [{ id: '1', nas_ip: '198.18.70.1', api_usuario: 'argos' }])
        assert.containSubset(fuente.planes, [{ id: '1', bajada_kbps: 10_000, subida_kbps: 5000 }])
        assert.deepEqual(
            fuente.servicios.map((s) => [s.id, s.user_ppp, s.estado]),
            [
                ['1', 'si.cliente', 'activo'],
                ['2', 'si.viejo', 'retirado'],
            ],
        )
        // La anulada no viene; la otra con lo pendiente; saldo = pendiente − saldo a favor
        assert.deepEqual(
            fuente.facturas.map((f) => [f.id, f.periodo, f.pendiente]),
            [['1', '2026-09-01', '100.00']],
        )
        assert.deepEqual(fuente.saldos, [{ linea: 1, cliente_id: '1', saldo: '80.00' }])
        assert.equal(fuente.duenosFacturas?.get('2'), '1')
    })

    test('leerOrigen comprueba archivo o directorio según el origen', async ({ assert }) => {
        await assert.rejects(() => leerOrigen('mikrowisp', CSV), /--origen=csv --sistema=mikrowisp/)
        await assert.rejects(() => leerOrigen('csv', SQL), /lee un directorio/)
    })
})

test.group('importacion · plantillas CSV', (group) => {
    let dir: string
    group.each.setup(async () => {
        dir = await mkdtemp(join(tmpdir(), 'argos-plantillas-'))
        return () => rm(dir, { recursive: true, force: true })
    })

    test('genera una plantilla por entidad con encabezado y ejemplo válido, y el LEEME', async ({
        assert,
    }) => {
        const escritos = await generarPlantillas(dir)
        assert.lengthOf(escritos, ENTIDADES.length + 1)
        for (const entidad of ENTIDADES) {
            const filas = leerCsv(await readFile(join(dir, ARCHIVOS[entidad]), 'utf8'))
            assert.lengthOf(filas, 1, entidad)
            assert.deepEqual(
                Object.keys(filas[0]!.valores),
                COLUMNAS[entidad].map((c) => c.nombre),
            )
        }
        const leeme = await readFile(join(dir, 'LEEME.md'), 'utf8')
        assert.include(leeme, '## servicios.csv')
        assert.include(leeme, '| `user_ppp` | *condicional* |')
        assert.include(leeme, '--origen=csv')

        // La fila de ejemplo pasa la validación sin avisos
        const fuente = await leerDirectorio(dir)
        assert.deepEqual(fuente.problemas, [])
        assert.lengthOf(fuente.servicios, 1)
        assert.equal(fuente.facturas[0]!.pendiente, '100.00')

        // No pisa plantillas existentes salvo que se pida
        await assert.rejects(() => generarPlantillas(dir), /EEXIST/)
        assert.lengthOf(await generarPlantillas(dir, true), ENTIDADES.length + 1)
    })

    test('acepta punto y coma (Excel en español) y avisa de columnas desconocidas', async ({ assert }) => {
        await generarPlantillas(dir)
        await writeFile(
            join(dir, 'clientes.csv'),
            'id;nombre;usuario_ppp;email\r\nC1;"López; Ana";x;ana@example.com\r\n',
        )
        const fuente = await leerDirectorio(dir)
        assert.deepEqual(
            fuente.clientes.map((c) => [c.id, c.nombre, c.email]),
            [['C1', 'López; Ana', 'ana@example.com']],
        )
        assert.lengthOf(fuente.problemas, 1)
        assert.containSubset(fuente.problemas[0], { archivo: 'clientes.csv', linea: 1, aviso: true })
        assert.include(fuente.problemas[0]!.mensaje, 'columna "usuario_ppp" desconocida')
    })
})
