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
import { fuenteDesdeDump, leerDumpMikrowisp } from '#importacion/origenes/mikrowisp'
import { fuenteDesdeDumpSmartisp } from '#importacion/origenes/smartisp'
import { EsquemaIncompleto } from '#importacion/origenes/esquema_sql'
import { leerOrigen } from '#importacion/origenes/index'
import { crearPlantillaFila } from '#tests/billing/ayudas_billing'
import { archivoSintetico, rutaEsquema } from '#tests/importacion/ayudas_importacion'

/**
 * Importador multi-origen: los adaptadores solo traducen al formato canónico, y el núcleo da el
 * mismo resultado para los mismos datos venga de donde venga.
 */

/** Volcado sintético de Mikrowisp sobre su esquema real (estructura + datos, archivo temporal). */
let SQL: string
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

/** Unos pocos datos sobre la estructura real de SmartISP (`scripts/importacion/esquemas/smartisp.sql`). */
const DATOS_SMARTISP = `
INSERT INTO routers (id,name,model,ip,location,coordinates,clients,status,connection,login,password,port,lan) VALUES (1,'Torre SI','RB4011','198.18.70.1','','',0,'on',1,'argos','clave',8728,'');
INSERT INTO radius (id,secret,router_id) VALUES (1,'secreto',1);
INSERT INTO control_routers (id,router_id,type_control,dhcp,arpmac,adv,address_list) VALUES (1,1,'pp',0,0,0,0);
INSERT INTO address_routers (id,name,router_id,gateway,type,mask,network,hosts,used) VALUES (1,'Red SI',1,'198.18.70.1','static','24','198.18.70.0',254,0.00);
INSERT INTO plans (id,name,download,upload,num_clients,cost,iva) VALUES (1,'SI 10M',10000,5000,1,150.00,0.00);
INSERT INTO clients (id,name,email,phone,address,coordinates,photo,dni,password,balance,zona_id,wallet_balance) VALUES (1,'Cliente SmartISP','si@example.com','22223333','Zona 1',NULL,'','CF','portal',100.00,NULL,20.00);
INSERT INTO client_services (id,client_id,ip,mac,date_in,plan_id,router_id,status,user_hot,pass_hot) VALUES (1,1,'198.18.70.10','00:00:00:00:00:00','2024-01-10',1,1,'ac','si.cliente','clave'),(2,1,'198.18.70.11',NULL,'2024-01-10',1,1,'baja','si.viejo','clave');
INSERT INTO bill_customers (id,num_bill,period,release_date,expiration_date,iva,cost,total_pay,status,client_id,service_id,open,paid_on,start_date) VALUES (1,'B-1','Septiembre 2026','2026-09-01','2026-09-10',0.00,150.00,150.00,2,1,1,0,NULL,'2026-09-01'),(2,'B-2','Agosto 2026','2026-08-01','2026-08-10',0.00,150.00,150.00,4,1,NULL,0,NULL,NULL);
INSERT INTO payment_news (id,client_id,way_to_pay,date,amount,num_bill,deleted_at) VALUES (1,1,'Efectivo','2026-09-05','50.00','B-1',NULL),(2,1,'Efectivo','2026-09-06','30.00','B-1','2026-09-07 08:00:00');
`

let SMARTISP_REAL: string

test.group('importacion · orígenes', (group) => {
    group.setup(async () => {
        SQL = await archivoSintetico('mikrowisp')
        SMARTISP_REAL = `${await readFile(rutaEsquema('smartisp'), 'utf8')}\n${DATOS_SMARTISP}`
    })

    test('los esquemas reales pasan la validación de su adaptador y no la del otro', async ({ assert }) => {
        const mikrowisp = await readFile(rutaEsquema('mikrowisp'), 'utf8')
        const smartisp = await readFile(rutaEsquema('smartisp'), 'utf8')
        // Solo estructura: todo vacío, sin errores de esquema (los triggers con DELIMITER se ignoran)
        const fm = fuenteDesdeDump(mikrowisp, 'mikrowisp6.sql')
        assert.deepEqual([fm.routers, fm.clientes, fm.servicios, fm.problemas], [[], [], [], []])
        const fs = fuenteDesdeDumpSmartisp(smartisp, 'smartisp.sql')
        assert.deepEqual([fs.routers, fs.clientes, fs.servicios, fs.problemas], [[], [], [], []])
        // Origen equivocado: se detiene con la lista de lo que falta
        assert.throws(() => fuenteDesdeDump(smartisp, 'smartisp.sql'), /falta la tabla server/)
        assert.throws(() => fuenteDesdeDumpSmartisp(mikrowisp, 'mikrowisp6.sql'), /falta la tabla clients/)
    })

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
            assert.deepEqual(otra.resumen.clientes, { origen: 11, creados: 0, existentes: 11, omitidos: 0 })
            assert.isTrue(otra.saldos.cuadra)
        } finally {
            await trx.rollback()
        }
    })

    test('el sistema de origen debe servir de clave', async ({ assert }) => {
        await assert.rejects(
            () => importar(fuenteDesdeDumpSmartisp(SMARTISP_REAL), { sistema: 'Smart ISP', dryRun: true }),
            /Sistema de origen "Smart ISP" inválido/,
        )
    })

    test('SmartISP: rechaza un esquema incompleto con todo lo que falta, antes de tocar la base', ({
        assert,
    }) => {
        const incompleto = `
            CREATE TABLE routers (id int, name varchar(50));
            INSERT INTO routers VALUES (1,'Torre');
            CREATE TABLE plans (id int, name varchar(50), cost decimal(10,2), download int, upload int);
        `
        try {
            fuenteDesdeDumpSmartisp(incompleto, 'smartisp.sql')
            assert.fail('debió rechazar el volcado')
        } catch (error) {
            assert.instanceOf(error, EsquemaIncompleto)
            const e = error as EsquemaIncompleto
            assert.equal(e.origen, 'smartisp')
            assert.deepEqual(e.faltantes, [
                'a la tabla routers le faltan las columnas ip, login, password',
                'a la tabla plans le faltan las columnas iva',
                'falta la tabla clients',
                'falta la tabla client_services',
            ])
            assert.include(e.message, 'smartisp.sql: no tiene el esquema que espera el origen smartisp:\n')
            assert.include(e.message, '  - falta la tabla clients\n')
            assert.include(e.message, 'apps/api/app/importacion/origenes/smartisp.ts')
            assert.include(e.message, 'No se tocó la base')
        }
        // Un volcado de Mikrowisp tampoco pasa por SmartISP (origen equivocado)
        assert.throws(() => fuenteDesdeDumpSmartisp('CREATE TABLE usuarios (id int);'), EsquemaIncompleto)
    })

    test('SmartISP: con el esquema real traduce al formato canónico', ({ assert }) => {
        const fuente = fuenteDesdeDumpSmartisp(SMARTISP_REAL)
        assert.deepEqual(fuente.problemas, [])
        assert.containSubset(fuente.routers, [
            { id: '1', nas_ip: '198.18.70.1', api_usuario: 'argos', radius_secret: 'secreto' },
        ])
        assert.containSubset(fuente.redes, [{ router_id: '1', cidr: '198.18.70.0/24', tipo: 'estatico' }])
        assert.containSubset(fuente.planes, [{ id: '1', bajada_kbps: 10_000, subida_kbps: 5000 }])
        // ac = activo; 'baja' (texto libre) = retirado; MAC 00:00:... = sin MAC
        assert.deepEqual(
            fuente.servicios.map((s) => [s.id, s.tipo_conexion, s.user_ppp, s.mac, s.estado]),
            [
                ['1', 'pppoe', 'si.cliente', null, 'activo'],
                ['2', 'pppoe', 'si.viejo', null, 'retirado'],
            ],
        )
        // La anulada (status 4) no viene; la pendiente descuenta su pago vigente (el borrado no)
        assert.deepEqual(
            fuente.facturas.map((f) => [f.id, f.servicio_id, f.periodo, f.pendiente]),
            [['1', '1', '2026-09-01', '100.00']],
        )
        assert.deepEqual(
            fuente.pagos.map((p) => [p.id, p.factura_id, p.monto]),
            [['1', '1', '50.00']],
        )
        // Saldo = pendiente − wallet_balance; balance (100) cuadra con lo pendiente: sin aviso
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
