import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import * as XLSX from 'xlsx'
import { createHash } from 'node:crypto'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { cuentaBancariaPrueba } from '#tests/billing/ayudas_billing'
import { leerHoja } from '#importacion/extractos/hoja'
import { detectarFormato, leerFecha } from '#importacion/extractos/formatos'
import { interpretarFilas } from '#importacion/extractos/interpretar'

/**
 * Estados de cuenta tal como los descarga el banco (A6): adaptadores por banco en la API, vista
 * previa con sugerencia de mapeo, mapeo guardado por cuenta bancaria y el archivo con su sha256.
 */

type Fila = Array<string | number | Date | null>

/** Libro de Excel con una hoja; `formato` .xlsx o .xls (BIFF8). Las fechas como serie con formato. */
function libro(filas: Fila[], formato: 'xlsx' | 'biff8' = 'xlsx'): Buffer {
    const hoja = XLSX.utils.aoa_to_sheet(filas, { cellDates: true, dateNF: 'dd/mm/yyyy' })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, hoja, 'Movimientos')
    return XLSX.write(wb, { type: 'buffer', bookType: formato }) as Buffer
}

function fecha(iso: string): Date {
    return new Date(`${iso}T12:00:00Z`)
}

async function preparar(banco: string) {
    const { token } = await usuarioConRoles(['contabilidad'])
    const cuenta = await cuentaBancariaPrueba(banco, 1)
    return { token, cuentaId: cuenta.id as number }
}

function enviar(
    client: any,
    ruta: 'vista-previa' | 'archivo',
    token: string,
    cuentaId: number,
    contenido: Buffer,
    nombre: string,
    campos: Record<string, string> = {},
) {
    let peticion = client
        .post(`/api/v1/bancos/extractos/${ruta}`)
        .bearerToken(token)
        .header('X-Empresa-Id', '1')
        .field('cuenta_bancaria_id', String(cuentaId))
        .file('archivo', contenido, { filename: nombre })
    if (ruta === 'archivo') peticion = peticion.header('Idempotency-Key', unico('ext'))
    for (const [k, v] of Object.entries(campos)) peticion = peticion.field(k, v)
    return peticion
}

const BANRURAL: Fila[] = [
    ['BANRURAL'],
    ['Estado de cuenta monetaria'],
    ['Cuenta No.', '3-033-12345-6'],
    ['Saldo anterior:', 'Q 1,000.00'],
    [],
    ['Fecha', 'Agencia', 'No. Documento', 'Descripción', 'Débito', 'Crédito', 'Saldo'],
    [fecha('2026-10-01'), 'Central', '1001', 'DEPOSITO EFECTIVO', null, 250.5, 1250.5],
    [fecha('2026-10-02'), 'Central', '1002', 'PAGO PROVEEDOR', 100, null, 1150.5],
    [fecha('2026-10-03'), 'Mixco', '1003', 'TRANSFERENCIA ACH', null, 49.5, 1200],
    [null, null, null, 'Totales', 100, 300, null],
]

test.group('Estados de cuenta del banco · adaptadores', () => {
    test('lee fechas con formato de Excel y números sin ruido; .xls BIFF8 también', ({ assert }) => {
        for (const formato of ['xlsx', 'biff8'] as const) {
            const leida = leerHoja(
                libro(BANRURAL, formato),
                `banrural.${formato === 'xlsx' ? 'xlsx' : 'xls'}`,
            )
            assert.equal(leida.tipo, formato === 'xlsx' ? 'xlsx' : 'xls')
            const det = detectarFormato(leida.filas, 'estado.xlsx', leida.hoja, null)
            assert.isTrue(det.reconocido)
            assert.equal(det.perfil?.codigo, 'banrural')
            assert.equal(det.mapeo.fila_encabezado, 6)
            const r = interpretarFilas(leida.filas, det.mapeo)
            assert.deepEqual(
                r.lineas.map((l) => [l.fecha, l.monto, l.referencia]),
                [
                    ['2026-10-01', '250.50', '1001'],
                    ['2026-10-02', '-100.00', '1002'],
                    ['2026-10-03', '49.50', '1003'],
                ],
            )
            assert.equal(r.saldo_inicial, '1000.00')
            assert.equal(r.saldo_final, '1200.00')
            assert.deepEqual(r.saldos_que_no_encadenan, [])
        }
    })

    test('fechas de texto: dd/mm/aaaa, con hora y con mes abreviado', ({ assert }) => {
        assert.equal(leerFecha('05/11/2026', 'dmy'), '2026-11-05')
        assert.equal(leerFecha('05-11-26 10:22:01', 'dmy'), '2026-11-05')
        assert.equal(leerFecha('05-nov-2026', 'dmy'), '2026-11-05')
        assert.equal(leerFecha('31/02/2026', 'dmy'), null)
        assert.equal(leerFecha('Totales', 'dmy'), null)
    })

    test('G&T en CSV con punto y coma, BAC del más reciente al más antiguo y Promerica con monto en paréntesis', ({
        assert,
    }) => {
        const gyt = leerHoja(
            Buffer.from(
                'Banco G&T Continental;;;;;\r\nFecha;Descripción;No. Documento;Cargos;Abonos;Saldo\r\n' +
                    '01/10/2026;"DEPOSITO; AGENCIA";55;;"1,500.00";"2,500.00"\r\n' +
                    '02/10/2026;CHEQUE;56;200.00;;"2,300.00"\r\n',
                'utf8',
            ),
            'movimientos.csv',
        )
        const dg = detectarFormato(gyt.filas, 'movimientos.csv', null, null)
        assert.equal(dg.perfil?.codigo, 'gyt')
        const rg = interpretarFilas(gyt.filas, dg.mapeo)
        assert.deepEqual(
            rg.lineas.map((l) => [l.descripcion, l.monto]),
            [
                ['DEPOSITO; AGENCIA', '1500.00'],
                ['CHEQUE', '-200.00'],
            ],
        )
        assert.equal(rg.saldo_inicial, '1000.00')

        const bac = leerHoja(
            libro([
                ['BAC Credomatic - Movimientos'],
                ['Fecha', 'Referencia', 'Descripción', 'Débitos', 'Créditos', 'Balance'],
                ['03/10/2026', 'R3', 'PAGO TARJETA', '50.00', '', '950.00'],
                ['01/10/2026', 'R1', 'DEPOSITO', '', '1,000.00', '1,000.00'],
            ]),
            'bac.xlsx',
        )
        const rb = interpretarFilas(bac.filas, detectarFormato(bac.filas, 'bac.xlsx', bac.hoja, null).mapeo)
        assert.isTrue(rb.invertido)
        assert.deepEqual(
            rb.lineas.map((l) => l.monto),
            ['1000.00', '-50.00'],
        )
        assert.equal(rb.saldo_inicial, '0.00')
        assert.equal(rb.saldo_final, '950.00')

        const pro = leerHoja(
            libro([
                ['Banco Promerica de Guatemala'],
                ['Fecha', 'Concepto', 'Documento', 'Monto', 'Saldo'],
                ['01/10/2026', 'COMISION', 'C1', '(15.25)', '84.75'],
            ]),
            'promerica.xlsx',
        )
        const dp = detectarFormato(pro.filas, 'promerica.xlsx', pro.hoja, null)
        assert.equal(dp.perfil?.codigo, 'promerica')
        assert.deepEqual(
            interpretarFilas(pro.filas, dp.mapeo).lineas.map((l) => l.monto),
            ['-15.25'],
        )
    })

    test('Industrial: el banco sale de la cuenta bancaria cuando el archivo no trae su marca', ({
        assert,
    }) => {
        const bi = leerHoja(
            libro([
                ['Fecha', 'TT', 'Descripción', 'No. Doc', 'Débito', 'Crédito', 'Saldo Contable'],
                [fecha('2026-10-05'), 'DP', 'DEPOSITO', 'D9', null, 10, 110],
            ]),
            'export.xlsx',
        )
        const sinBanco = detectarFormato(bi.filas, 'export.xlsx', bi.hoja, null)
        assert.isFalse(sinBanco.reconocido)
        const industrial = detectarFormato(bi.filas, 'export.xlsx', bi.hoja, {
            codigo: 'industrial',
            nombre: 'Banco Industrial',
            catalogo: /x/,
            marcas: /x/,
            formato_fecha: 'dmy',
            decimal: 'punto',
        })
        assert.isTrue(industrial.reconocido)
        assert.deepEqual(
            interpretarFilas(bi.filas, industrial.mapeo).lineas.map((l) => l.monto),
            ['10.00'],
        )
    })
})

test.group('Estados de cuenta del banco · rutas', () => {
    test('vista previa de Banrural: periodo, saldos, entradas, salidas y revisiones; importar guarda el archivo y el mapeo', async ({
        client,
        assert,
    }) => {
        const { token, cuentaId } = await preparar('Banrural')
        const contenido = libro(BANRURAL)
        const vista = await estado(
            enviar(client, 'vista-previa', token, cuentaId, contenido, 'octubre.xlsx'),
            200,
        )
        const v = vista.body()
        assert.deepInclude(v.formato, { codigo: 'banrural', reconocido: true, origen: 'banco' })
        assert.isFalse(v.requiere_confirmacion)
        assert.deepEqual(v.periodo, { desde: '2026-10-01', hasta: '2026-10-03' })
        assert.equal(v.saldo_inicial, '1000.00')
        assert.equal(v.saldo_final, '1200.00')
        assert.equal(v.entradas, '300.00')
        assert.equal(v.salidas, '100.00')
        assert.equal(v.lineas, 3)
        assert.isTrue(v.revisiones.cuadra.ok)
        assert.isNull(v.revisiones.encadena.ok)
        assert.equal(v.revisiones.repetidos.cantidad, 0)
        assert.lengthOf(v.columnas, 7)
        assert.deepEqual(v.columnas[3], {
            indice: 3,
            letra: 'D',
            encabezado: 'Descripción',
            muestra: ['DEPOSITO EFECTIVO', 'PAGO PROVEEDOR', 'TRANSFERENCIA ACH'],
            papel: 'descripcion',
        })
        // La vista previa no escribe nada
        assert.isNull(await db.from('ledger.extractos').where('cuenta_bancaria_id', cuentaId).first())

        const importado = await estado(
            enviar(client, 'archivo', token, cuentaId, contenido, 'octubre.xlsx'),
            201,
        )
        const r = importado.body()
        const sha = createHash('sha256').update(contenido).digest('hex')
        assert.equal(r.sha256, sha)
        assert.equal(r.extracto.sha256, sha)
        assert.equal(r.extracto.lineas, 3)
        assert.equal(r.extracto.archivo, 'octubre.xlsx')
        assert.isTrue(r.mapeo_guardado)
        const archivo = await db.from('importacion.extractos_archivos').where('id', r.archivo_id).first()
        assert.equal(archivo.sha256, sha)
        assert.equal(archivo.tipo, 'xlsx')
        assert.isTrue(Buffer.from(archivo.contenido).equals(contenido))
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'banco.extracto_importado')
            .whereRaw(`(payload->>'extracto_id')::bigint = ?`, [r.extracto.id])
            .first()
        assert.exists(evento)
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'bancos.importar_extracto_archivo')
            .where('entidad_id', r.extracto.id)
            .first()
        assert.exists(auditoria)
        assert.notInclude(JSON.stringify(auditoria.entrada), 'PAGO PROVEEDOR')

        // Otra vez el mismo archivo: la vista previa marca los repetidos y la importación da 409
        const otra = await estado(
            enviar(client, 'vista-previa', token, cuentaId, contenido, 'octubre.xlsx'),
            200,
        )
        assert.equal(otra.body().formato.origen, 'mapeo_guardado')
        assert.equal(otra.body().revisiones.repetidos.cantidad, 3)
        assert.isTrue(otra.body().revisiones.encadena.ok === false)
        await estado(enviar(client, 'archivo', token, cuentaId, contenido, 'octubre.xlsx'), 409)
    })

    test('formato desconocido: sugerencia con muestra; sin mapeo 422; con el mapeo confirmado importa y la próxima vez lo reconoce', async ({
        client,
        assert,
    }) => {
        const { token, cuentaId } = await preparar('BAM')
        const filas: Fila[] = [
            ['Movimientos del mes'],
            ['F. Mov', 'Glosa', 'Ref', 'Valor'],
            ['01/11/2026', 'ABONO CLIENTE', 'A1', '75.00'],
            ['02/11/2026', 'CARGO SERVICIO', 'A2', '-25.00'],
            ['03/11/2026', 'ABONO CLIENTE', 'A3', '10.00'],
        ]
        const contenido = libro(filas)
        const vista = await estado(
            enviar(client, 'vista-previa', token, cuentaId, contenido, 'mov.xlsx'),
            200,
        )
        const v = vista.body()
        assert.isTrue(v.requiere_confirmacion)
        assert.equal(v.formato.origen, 'sugerencia')
        assert.equal(v.mapeo.fila_datos, 3)
        assert.equal(v.mapeo.columnas.fecha, 0)
        assert.equal(v.mapeo.columnas.monto, 3)
        assert.deepEqual(v.columnas[1].muestra, ['ABONO CLIENTE', 'CARGO SERVICIO', 'ABONO CLIENTE'])

        const sinMapeo = await estado(
            enviar(client, 'archivo', token, cuentaId, contenido, 'mov.xlsx', { saldo_inicial: '0.00' }),
            422,
        )
        assert.equal(sinMapeo.body().type, 'urn:argosisp:problema:formato_no_reconocido')

        const mapeo = { ...v.mapeo, columnas: { ...v.mapeo.columnas, descripcion: 1, referencia: 2 } }
        const confirmada = await estado(
            enviar(client, 'vista-previa', token, cuentaId, contenido, 'mov.xlsx', {
                mapeo: JSON.stringify(mapeo),
                saldo_inicial: '0.00',
            }),
            200,
        )
        assert.equal(confirmada.body().formato.origen, 'manual')
        assert.equal(confirmada.body().saldo_final, '60.00')
        assert.isTrue(confirmada.body().revisiones.cuadra.ok)

        const importado = await estado(
            enviar(client, 'archivo', token, cuentaId, contenido, 'mov.xlsx', {
                mapeo: JSON.stringify(mapeo),
                saldo_inicial: '0.00',
            }),
            201,
        )
        assert.isTrue(importado.body().mapeo_guardado)
        const guardado = await estado(
            client
                .get(`/api/v1/bancos/cuentas-bancarias/${cuentaId}/mapeo-extracto`)
                .bearerToken(token)
                .header('X-Empresa-Id', '1'),
            200,
        )
        assert.equal(guardado.body().formato, 'personalizado')
        assert.equal(guardado.body().mapeo.columnas.referencia, 2)

        // El mes siguiente, con una fila más de encabezado: lo reconoce por la firma de títulos y
        // el saldo inicial encadena con el extracto anterior
        const siguiente = libro([
            ['Movimientos del mes'],
            ['Cuenta 99'],
            ['F. Mov', 'Glosa', 'Ref', 'Valor'],
            ['01/12/2026', 'ABONO CLIENTE', 'B1', '40.00'],
        ])
        const v2 = await estado(enviar(client, 'vista-previa', token, cuentaId, siguiente, 'dic.xlsx'), 200)
        assert.equal(v2.body().formato.origen, 'mapeo_guardado')
        assert.isFalse(v2.body().requiere_confirmacion)
        assert.equal(v2.body().mapeo.fila_datos, 4)
        assert.equal(v2.body().saldo_inicial, '60.00')
        assert.equal(v2.body().origen_saldos, 'extracto_anterior')
        assert.isTrue(v2.body().revisiones.encadena.ok)
        await estado(enviar(client, 'archivo', token, cuentaId, siguiente, 'dic.xlsx'), 201)
    })

    test('filas ilegibles: 422 con la fila; mapeo guardado con versión (409) y permisos exactos', async ({
        client,
        assert,
    }) => {
        const { token, cuentaId } = await preparar('Banrural')
        const malo = libro([
            ['BANRURAL'],
            ['Fecha', 'Descripción', 'Débito', 'Crédito', 'Saldo'],
            ['01/10/2026', 'DEPOSITO', '', 'abc', '10.00'],
        ])
        const r = await estado(
            enviar(client, 'archivo', token, cuentaId, malo, 'malo.xlsx', { saldo_inicial: '0.00' }),
            422,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:extracto_con_errores')
        assert.equal(r.body().errors[0].field, 'filas.3.credito')

        const mapeo = {
            hoja: null,
            fila_encabezado: 2,
            fila_datos: 3,
            columnas: { fecha: 0, descripcion: 1, debito: 2, credito: 3, saldo: 4 },
            formato_fecha: 'dmy',
            decimal: 'punto',
            encabezados: ['fecha', 'descripcion', 'debito', 'credito', 'saldo'],
        }
        const ruta = `/api/v1/bancos/cuentas-bancarias/${cuentaId}/mapeo-extracto`
        const g1 = await estado(
            client
                .put(ruta)
                .bearerToken(token)
                .header('X-Empresa-Id', '1')
                .json({ mapeo, formato: 'banrural' }),
            200,
        )
        assert.equal(g1.body().version, 1)
        await estado(
            client.put(ruta).bearerToken(token).header('X-Empresa-Id', '1').json({ mapeo, version: 7 }),
            409,
        )
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cuenta_bancaria', entidad_id: cuentaId, campo: 'mapeo_extracto' })
        assert.lengthOf(cambios, 1)

        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post('/api/v1/bancos/extractos/vista-previa')
                .bearerToken(cajero)
                .field('cuenta_bancaria_id', String(cuentaId))
                .file('archivo', malo, { filename: 'x.xlsx' }),
            403,
        )
    })
})
