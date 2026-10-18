import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { escribirCsv, leerCsv } from '#importacion/csv'
import { importar } from '#importacion/importador'
import { leerMonto, parsearFormatoDecimal, type SeparadorDecimal } from '#importacion/montos'
import { generarPlantillas, leerDirectorio } from '#importacion/origenes/csv'
import { leerOrigen } from '#importacion/origenes/index'
import { fuenteDesdeDump } from '#importacion/origenes/mikrowisp'
import { fuenteDesdeDumpSmartisp } from '#importacion/origenes/smartisp'
import { D } from '#ledger/dinero'
import { crearPlantillaFila } from '#tests/billing/ayudas_billing'
import { volcadoSintetico } from '#tests/importacion/ayudas_importacion'

/**
 * Montos del origen: lo ilegible o ambiguo nunca entra como 0 ni se adivina; la fila se omite
 * con su motivo y cuenta en el cuadre. Separadores sin ambigüedad, con coma decimal solo si el
 * origen la declara.
 */

function valor(crudo: string | null, decimal: SeparadorDecimal = 'punto'): string {
    const l = leerMonto(crudo, decimal)
    return l.ok ? l.valor.toFixed() : `✗ ${l.motivo}`
}

test.group('importacion · montos del origen', () => {
    test('punto decimal: miles con coma solo sin ambigüedad', ({ assert }) => {
        const bien: Array<[string, string]> = [
            ['150', '150'],
            ['150.00', '150'],
            ['1250.5', '1250.5'],
            ['0.01', '0.01'],
            ['1,234.50', '1234.5'],
            ['Q 1,250.50', '1250.5'],
            ['q1,250.50', '1250.5'],
            ['1,234,567', '1234567'],
            ['1,234,567.89', '1234567.89'],
            ['  -20.00 ', '-20'],
            ['- Q 20', '-20'],
            ['+5', '5'],
            ['-0', '0'],
            ['007.50', '7.5'],
            ['1.250', '1.25'],
        ]
        for (const [crudo, esperado] of bien) assert.equal(valor(crudo), esperado, crudo)
    })

    test('punto decimal: lo ambiguo o ilegible vuelve con su motivo, nunca 0', ({ assert }) => {
        for (const crudo of ['1,50', '1,250', '12,5', '0,01']) {
            assert.match(valor(crudo), /^✗ es ambiguo/, crudo)
        }
        for (const crudo of [
            '',
            '   ',
            'abc',
            'Q',
            '-',
            '1e3',
            '0x10',
            'Infinity',
            'NaN',
            '1.2.3',
            '1.250,50',
            '12,34.50',
            '1,2345.00',
            '1,5,0',
            '.50',
            '150.',
            '1 250.00',
            '$150',
            '--5',
        ]) {
            const l = leerMonto(crudo)
            assert.isFalse(l.ok, crudo)
        }
        assert.match(valor(''), /vacío/)
        assert.match(valor(null), /vacío/)
        assert.match(valor('abc'), /no es un monto/)
    })

    test('coma decimal declarada: punto de miles solo sin ambigüedad', ({ assert }) => {
        const bien: Array<[string, string]> = [
            ['1,50', '1.5'],
            ['150', '150'],
            ['1250,50', '1250.5'],
            ['1.250,50', '1250.5'],
            ['Q 1.234.567,89', '1234567.89'],
            ['1.234.567', '1234567'],
            ['-20,00', '-20'],
            ['1,250', '1.25'],
        ]
        for (const [crudo, esperado] of bien) assert.equal(valor(crudo, 'coma'), esperado, crudo)
        for (const crudo of ['1.250', '150.00', '1.5']) {
            assert.match(valor(crudo, 'coma'), /^✗ es ambiguo/, crudo)
        }
        for (const crudo of ['1,234.50', '1.2,3', '1,2,3', 'abc', '']) {
            assert.isFalse(leerMonto(crudo, 'coma').ok, crudo)
        }
    })

    test('precisión de #ledger/dinero (40 dígitos), sin pérdida en montos grandes', ({ assert }) => {
        const l = leerMonto('123,456,789,012,345,678,901.25')
        assert.isTrue(l.ok)
        if (l.ok) {
            assert.instanceOf(l.valor, D)
            assert.equal(l.valor.toFixed(2), '123456789012345678901.25')
            assert.equal(l.valor.plus('0.01').toFixed(2), '123456789012345678901.26')
        }
    })

    test('--decimal: general, por archivo y errores', ({ assert }) => {
        assert.deepEqual(parsearFormatoDecimal(undefined), { general: 'punto', archivos: {} })
        assert.deepEqual(parsearFormatoDecimal('coma'), { general: 'coma', archivos: {} })
        assert.deepEqual(parsearFormatoDecimal('facturas.csv:coma, pagos.csv:coma'), {
            general: 'punto',
            archivos: { 'facturas.csv': 'coma', 'pagos.csv': 'coma' },
        })
        assert.deepEqual(parsearFormatoDecimal('coma,planes.csv:punto'), {
            general: 'coma',
            archivos: { 'planes.csv': 'punto' },
        })
        assert.throws(() => parsearFormatoDecimal('decimal'), /no se entiende/)
        assert.throws(() => parsearFormatoDecimal('coma,punto'), /una sola vez/)
        assert.throws(() => parsearFormatoDecimal(':coma'), /no dice el archivo/)
    })
})

test.group('importacion · montos en los adaptadores', (group) => {
    let dir: string
    group.each.setup(async () => {
        dir = await mkdtemp(join(tmpdir(), 'argos-montos-'))
        return () => rm(dir, { recursive: true, force: true })
    })

    /** facturas.csv con la fila de ejemplo de la plantilla repetida con cada total. */
    async function facturasCon(totales: string[]) {
        await generarPlantillas(dir)
        const [ejemplo] = leerCsv(await readFile(join(dir, 'facturas.csv'), 'utf8'))
        const columnas = Object.keys(ejemplo!.valores)
        const filas = totales.map((total, i) => ({ ...ejemplo!.valores, id: `F${i + 1}`, total, pagado: '' }))
        await writeFile(join(dir, 'facturas.csv'), escribirCsv(columnas, filas))
    }

    test('CSV: un monto ambiguo o ilegible omite la fila con su motivo; nunca entra como 0', async ({
        assert,
    }) => {
        await facturasCon(['150.00', '1,50', 'Q 1,250.50', 'abc', '1,250', '1.250,50', '0.00'])
        const fuente = await leerDirectorio(dir)
        assert.deepEqual(
            fuente.facturas.map((f) => [f.id, f.total]),
            [
                ['F1', '150.00'],
                ['F3', '1250.50'],
                ['F7', '0.00'],
            ],
        )
        const omitidas = fuente.problemas.filter((p) => p.archivo === 'facturas.csv' && !p.aviso)
        assert.deepEqual(
            omitidas.map((p) => [p.id, p.linea]),
            [
                ['F2', 3],
                ['F4', 5],
                ['F5', 6],
                ['F6', 7],
            ],
        )
        assert.match(omitidas[0]!.mensaje, /^total "1,50" es ambiguo/)
        assert.match(omitidas[1]!.mensaje, /^total "abc" no es un monto/)
        assert.match(omitidas[2]!.mensaje, /^total "1,250" es ambiguo/)
        assert.match(omitidas[3]!.mensaje, /^total "1\.250,50" no es un monto/)
    })

    test('CSV con coma decimal declarada, para todo el origen o por archivo', async ({ assert }) => {
        await facturasCon(['1,50', '1.250,50', '150.00'])
        for (const decimal of [parsearFormatoDecimal('coma'), parsearFormatoDecimal('facturas.csv:coma')]) {
            const fuente = await leerDirectorio(dir, { decimal })
            assert.deepEqual(
                fuente.facturas.map((f) => [f.id, f.total]),
                [
                    ['F1', '1.50'],
                    ['F2', '1250.50'],
                ],
            )
            const omitida = fuente.problemas.find((p) => p.archivo === 'facturas.csv' && !p.aviso)
            assert.containSubset(omitida, { id: 'F3', linea: 4 })
            assert.match(omitida!.mensaje, /^total "150.00" es ambiguo/)
        }
        // la coma de un archivo no cambia los demás: los planes siguen con punto
        const fuente = await leerDirectorio(dir, { decimal: parsearFormatoDecimal('facturas.csv:coma') })
        assert.isTrue(fuente.planes.every((p) => /^\d+\.\d{2}$/.test(p.precio)))

        await assert.rejects(
            () => leerDirectorio(dir, { decimal: parsearFormatoDecimal('factura.csv:coma') }),
            /factura\.csv no es un archivo del formato/,
        )
        await assert.rejects(
            () =>
                leerOrigen('mikrowisp', join(dir, 'facturas.csv'), {
                    decimal: parsearFormatoDecimal('coma'),
                }),
            /punto decimal: --decimal no aplica/,
        )
    })

    test('Mikrowisp: total, cobrado o monto ilegible omiten la fila; el cuadre los cuenta', async ({
        assert,
    }) => {
        const extra = `
INSERT INTO \`facturas\` (\`id\`, \`legal\`, \`idcliente\`, \`emitido\`, \`vencimiento\`, \`pago\`, \`total\`, \`estado\`, \`tipo\`, \`cobrado\`, \`iva_igv\`, \`sub_total\`, \`saldo\`, \`moneda\`) VALUES
(5101,0,2,'2026-10-01','2026-10-10','0000-00-00','1,50','No pagado',2,0.00,0.00,0.00,0.00,1),
(5102,0,2,'2026-10-01','2026-10-10','0000-00-00',150.00,'No pagado',1,'',0.00,0.00,0.00,1),
(5103,0,2,'2026-11-01','2026-11-10','2026-11-02','abc','pagado',2,0.00,0.00,0.00,0.00,1);
INSERT INTO \`operaciones\` (\`id\`, \`nfactura\`, \`idcliente\`, \`fecha_pago\`, \`operador\`, \`transaccion\`, \`forma_pago\`, \`descripcion\`, \`cobrado\`, \`comision\`, \`saldo\`, \`idmoneda\`) VALUES
(9101,5003,2,'2026-09-20 10:00:00',1,NULL,'Efectivo','','1,000',0.00,0.00,1);
INSERT INTO \`saldos\` (\`id\`, \`iduser\`, \`idorigen\`, \`iddestino\`, \`estado\`, \`monto\`, \`fecha\`, \`moneda\`) VALUES
(9,2,0,0,'no cobrado',NULL,'2026-09-01',1);
`
        const base = fuenteDesdeDump(await volcadoSintetico('mikrowisp'), 'mw.sql', { hoy: '2026-09-15' })
        const fuente = fuenteDesdeDump((await volcadoSintetico('mikrowisp')) + extra, 'mw.sql', {
            hoy: '2026-09-15',
        })
        const omitidos = fuente.problemas.filter(
            (p) => !p.aviso && !base.problemas.some((b) => b.mensaje === p.mensaje),
        )
        assert.deepEqual(
            omitidos.map((p) => [p.archivo, p.id, p.mensaje]),
            [
                [
                    'mw.sql:operaciones',
                    '9101',
                    'cobrado "1,000" es ambiguo: "," puede ser separador de miles o decimal; escríbelo como 1.50 o 150 (o 1,250.00) o declara el separador decimal del origen (--decimal=coma)',
                ],
                [
                    'mw.sql:facturas',
                    '5101',
                    'total "1,50" es ambiguo: "," puede ser separador de miles o decimal; escríbelo como 1.50 o 150 (o 1,250.00) o declara el separador decimal del origen (--decimal=coma)',
                ],
                ['mw.sql:facturas', '5102', 'cobrado "" está vacío'],
                [
                    'mw.sql:facturas',
                    '5103',
                    'total "abc" no es un monto (se espera 1250.50 o 1,250.50, separador decimal: punto)',
                ],
                ['mw.sql:saldos', '2', 'saldo a favor: monto NULL está vacío'],
            ],
        )
        // Ninguna entra: ni como factura ni como pago, ni suma 0 en el saldo del cliente
        assert.deepEqual(
            fuente.facturas.map((f) => f.id),
            base.facturas.map((f) => f.id),
        )
        assert.deepEqual(
            fuente.pagos.map((p) => p.id),
            base.pagos.map((p) => p.id),
        )
        assert.deepEqual(fuente.saldos, base.saldos)

        // El cuadre por tabla cuenta las filas omitidas (en seco: no guarda nada)
        const plantillaId = await crearPlantillaFila()
        const r = await importar(fuente, {
            sistema: 'mikrowisp',
            dryRun: true,
            plantillaId,
            fuente: 'mw.sql',
        })
        const tabla = (t: string) => r.tablas.find((x) => x.tabla === t)!
        const rBase = await importar(base, {
            sistema: 'mikrowisp',
            dryRun: true,
            plantillaId,
            fuente: 'mw.sql',
        })
        const tablaBase = (t: string) => rBase.tablas.find((x) => x.tabla === t)!
        assert.equal(tabla('facturas').omitidas, tablaBase('facturas').omitidas + 3)
        assert.equal(tabla('operaciones').omitidas, tablaBase('operaciones').omitidas + 1)
        assert.equal(tabla('saldos').omitidas, tablaBase('saldos').omitidas + 1)
        for (const t of r.tablas) assert.equal(t.sin_contar, 0, t.tabla)
        assert.deepEqual(r.saldos, rBase.saldos)
    })

    test('SmartISP: total o pago ilegible omite la fila; saldo a favor ilegible no se inventa', async ({
        assert,
    }) => {
        const extra = `
INSERT INTO \`bill_customers\` (\`id\`, \`num_bill\`, \`period\`, \`release_date\`, \`expiration_date\`, \`iva\`, \`cost\`, \`total_pay\`, \`actual_total_pay\`, \`status\`, \`client_id\`, \`service_id\`, \`open\`, \`paid_on\`, \`start_date\`, \`recurring_invoice\`) VALUES
(201, 'F-201', 'Octubre 2026', '2026-10-01', '2026-10-10', '0.00', '150.00', '1,50', NULL, 3, 7, NULL, 0, NULL, '2026-10-01', 'yes'),
(202, 'F-202', 'Octubre 2026', '2026-10-01', '2026-10-10', 'x', '150.00', NULL, NULL, 3, 7, NULL, 0, NULL, '2026-10-01', 'yes');
INSERT INTO \`payment_news\` (\`id\`, \`client_id\`, \`way_to_pay\`, \`date\`, \`amount\`, \`commentary\`, \`note\`, \`memo\`, \`created_at\`, \`updated_at\`, \`deleted_at\`, \`num_bill\`, \`received_by\`, \`id_pago\`) VALUES
(601, 1, 'Efectivo', '2026-09-20', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'F-101', 1, NULL),
(602, 1, 'Efectivo', '2026-09-21', '2,5', NULL, NULL, NULL, NULL, NULL, NULL, 'F-101', 1, NULL);
`
        const sql = await volcadoSintetico('smartisp')
        const base = fuenteDesdeDumpSmartisp(sql, 'si.sql')
        // saldo a favor ilegible en el cliente 6 (tenía 10.00)
        const conWallet = sql.replace("'portal-6', '150.00', 1, 10.00,", "'portal-6', '150.00', 1, '10,00',")
        assert.notEqual(conWallet, sql)
        const fuente = fuenteDesdeDumpSmartisp(conWallet + extra, 'si.sql')
        const nuevos = fuente.problemas.filter((p) => !base.problemas.some((b) => b.mensaje === p.mensaje))
        assert.deepEqual(
            nuevos.filter((p) => !p.aviso).map((p) => [p.archivo, p.id, p.mensaje.split(':')[0]]),
            [
                ['si.sql:payment_news', '601', 'amount NULL está vacío'],
                ['si.sql:payment_news', '602', 'amount "2,5" es ambiguo'],
                ['si.sql:bill_customers', '201', 'total_pay "1,50" es ambiguo'],
                [
                    'si.sql:bill_customers',
                    '202',
                    'iva "x" no es un monto (se espera 1250.50 o 1,250.50, separador decimal',
                ],
                ['si.sql:clients.wallet_balance', '6', 'saldo a favor'],
            ],
        )
        assert.deepEqual(
            fuente.facturas.map((f) => f.id),
            base.facturas.map((f) => f.id),
        )
        assert.deepEqual(
            fuente.pagos.map((p) => p.id),
            base.pagos.map((p) => p.id),
        )
        // el cliente 6 queda sin la fila de saldo (no se inventa un saldo a favor de 0 ni de 1000)
        assert.isUndefined(fuente.saldos.find((s) => s.cliente_id === '6'))
        assert.isDefined(base.saldos.find((s) => s.cliente_id === '6'))
    })
})
