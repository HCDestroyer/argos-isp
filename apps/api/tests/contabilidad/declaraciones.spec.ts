import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { errorDe, saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import { relojFiscal } from '#fiscal/comun'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import EditarParametro from '#fiscal/actions/editar_parametro'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import RegistrarPagoDeclaracion from '#fiscal/actions/registrar_pago_declaracion'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import CrearExcepcionBloqueo from '#ledger/actions/crear_excepcion_bloqueo'
import AnularFactura from '#billing/actions/anular_factura'

/**
 * Auditor contable · declaraciones de IVA y de pequeño contribuyente (fase 7 PR B; contrato de
 * localización fiscal §9.3, §10.2, §10.4–§10.6 y §21, desvíos (a)–(e)). Inv. 22 con violaciones
 * fabricadas sobre un escenario real (B en régimen general, C pequeño contribuyente, los dos
 * liquidados y pagados en el mismo mes), y los invariantes 4, 9, 15 y 20 que ahora conocen la
 * liquidación (`liquidacion_impuesto`) y su pago (`pago_impuesto`).
 */

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const ANTERIOR = DateTime.fromISO(
    `${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' }).slice(0, 7)}-01`,
)
    .minus({ months: 1 })
    .toFormat('yyyy-MM')
const SIGUIENTE = DateTime.fromISO(`${MES}-01`).plus({ months: 1 }).toFormat('yyyy-MM')
const DESPUES = DateTime.fromISO(`${MES}-01`).plus({ months: 2 }).toFormat('yyyy-MM')

async function compra(e: EmpresasGt, empresaId: number, total: string) {
    const proveedor = await proveedorEn(empresaId, e.ctx)
    return new RegistrarCompra().execute(
        {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: unico('D'),
            fecha_documento: HOY,
            periodo_iva: `${MES}-01`,
            condicion: 'credito',
            lineas: [{ descripcion: 'Enlace de tránsito', total }],
        },
        e.ctx,
    )
}

const venta = (empresaId: number, precio: string) =>
    servicioFacturado(empresaId, `${MES}-01`, { precio, instalacion: `${MES}-01` })

function declarar(
    e: EmpresasGt,
    empresaId: number,
    impuesto: 'iva_mensual' | 'pc_mensual',
    periodo = MES,
    extra = {},
) {
    return new CalcularDeclaracion().execute({ empresa_id: empresaId, impuesto, periodo, ...extra }, e.ctx)
}

async function fabricado(empresas: number[], paso: (trx: TransactionClientContract) => Promise<void>) {
    const trx = await db.transaction()
    try {
        await paso(trx)
        const violaciones = await verificarLibro(empresas, { cliente: trx, incluirHallazgosAbiertos: true })
        return violaciones.map((v) => v.invariante.split(' ')[0]!)
    } finally {
        await trx.rollback()
    }
}

async function sinTriggers(
    trx: TransactionClientContract,
    tabla: string,
    sql: string,
    bindings: unknown[] = [],
) {
    await trx.rawQuery(`ALTER TABLE ${tabla} DISABLE TRIGGER USER`)
    await trx.rawQuery(sql, bindings as never)
    await trx.rawQuery(`ALTER TABLE ${tabla} ENABLE TRIGGER USER`)
}

test.group('Auditor contable · declaraciones de IVA y PC', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('inv. 22 y la liquidación en los inv. 4, 9, 15 y 20: IVA de B y PC de C revisados y pagados; violaciones fabricadas', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await new CambiarRegimen().execute(
            {
                empresa_id: e.C,
                regimen: 'pequeno_contribuyente',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción',
            },
            e.ctx,
        )
        const vB = await venta(e.B, '224.00') // IVA 24
        await compra(e, e.B, '112.00') // crédito 12
        const vC = await venta(e.C, '336.00') // PC: sin IVA
        assert.equal(vC.facturas[0]!.iva, '0.00')
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)

        const iva = await declarar(e, e.B, 'iva_mensual')
        const pc = await declarar(e, e.C, 'pc_mensual')
        await new RevisarDeclaracion().execute({ declaracion_id: iva.id }, e.ctx)
        await new RevisarDeclaracion().execute({ declaracion_id: pc.id }, e.ctx)
        for (const [d, empresa] of [
            [iva, e.B],
            [pc, e.C],
        ] as const) {
            await new RegistrarPagoDeclaracion().execute(
                {
                    declaracion_id: d.id,
                    metodo: 'cuenta_bancaria',
                    cuenta_bancaria_id: e.cuentas.get(empresa)!,
                    fecha: HOY,
                },
                e.ctx,
            )
        }
        // la liquidación de una empresa no toca la otra
        assert.deepEqual(
            [
                await saldoCuenta(e.B, '2.1.02'),
                await saldoCuenta(e.B, '2.1.06'),
                await saldoCuenta(e.C, '2.1.09'),
            ],
            ['0.00', '0.00', '0.00'],
        )
        const empresas = [e.B, e.C]
        await afirmarLibro(assert, empresas)

        const facturaB = vB.facturas[0]!.id
        const movimientoIva = (await db
            .from('ledger.movimientos as m')
            .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where({ 'a.origen_tipo': 'factura', 'a.origen_id': facturaB, 'c.codigo': '2.1.02' })
            .select('m.id')
            .firstOrFail()) as { id: number }
        const pagoB = (await db
            .from('fiscal.declaraciones_pagos')
            .where('declaracion_id', iva.id)
            .firstOrFail()) as {
            id: number
            asiento_id: number
        }

        const casos: Array<[string, (trx: TransactionClientContract) => Promise<void>]> = [
            [
                '22.declaracion_mal_calculada',
                (trx) =>
                    sinTriggers(
                        trx,
                        'fiscal.declaraciones',
                        `UPDATE fiscal.declaraciones SET totales = totales || '{"a_pagar": "11.00"}' WHERE id = ?`,
                        [iva.id],
                    ),
            ],
            [
                '22.liquidacion_distinta_de_la_declaracion',
                async (trx) => {
                    const [a] = (await trx
                        .insertQuery()
                        .table('ledger.asientos')
                        .insert({
                            empresa_id: e.B,
                            fecha: `${MES}-15`,
                            descripcion: 'liquidación de más',
                            origen_tipo: 'liquidacion_impuesto',
                            origen_id: iva.id,
                        })
                        .returning('id')) as Array<{ id: number }>
                    const cuentas = await trx
                        .from('ledger.cuentas')
                        .whereIn('codigo', ['2.1.02', '2.1.06'])
                        .select('id', 'codigo')
                    const id = (c: string) => cuentas.find((x) => x.codigo === c)!.id
                    await trx
                        .insertQuery()
                        .table('ledger.movimientos')
                        .multiInsert([
                            { asiento_id: a!.id, cuenta_id: id('2.1.02'), debe: '5.00', haber: '0.00' },
                            { asiento_id: a!.id, cuenta_id: id('2.1.06'), debe: '0.00', haber: '5.00' },
                        ])
                },
            ],
            [
                '22.iva_del_mes_sin_liquidar',
                (trx) =>
                    sinTriggers(
                        trx,
                        'ledger.movimientos',
                        `UPDATE ledger.movimientos SET haber = haber + 1 WHERE id = ?`,
                        [movimientoIva.id],
                    ),
            ],
            [
                '22.etiqueta_de_venta_mal_puesta',
                (trx) =>
                    sinTriggers(
                        trx,
                        'ledger.movimientos',
                        `UPDATE ledger.movimientos SET cuadricula = '-V_IVA' WHERE id = ?`,
                        [movimientoIva.id],
                    ),
            ],
            [
                '22.cuadriculas_distintas_de_la_declaracion',
                (trx) =>
                    sinTriggers(
                        trx,
                        'ledger.movimientos',
                        `UPDATE ledger.movimientos SET cuadricula = '+C_IVA' WHERE id = ?`,
                        [movimientoIva.id],
                    ),
            ],
            [
                '22.pago_de_declaracion_mal_contabilizado',
                (trx) =>
                    sinTriggers(
                        trx,
                        'fiscal.declaraciones_pagos',
                        `UPDATE fiscal.declaraciones_pagos SET mora = 1.00, total = total + 1 WHERE id = ?`,
                        [pagoB.id],
                    ),
            ],
            [
                '22.revisada_sin_bloqueo_de_impuestos',
                (trx) =>
                    sinTriggers(
                        trx,
                        'ledger.bloqueos',
                        `INSERT INTO ledger.bloqueos (empresa_id, tipo, hasta, motivo) VALUES (?, 'impuestos', NULL, 'auditor')`,
                        [e.B],
                    ),
            ],
            [
                '22.pequeno_contribuyente_con_iva',
                (trx) =>
                    sinTriggers(
                        trx,
                        'billing.facturas',
                        `UPDATE billing.facturas SET iva = 36.00 WHERE id = ?`,
                        [vC.facturas[0]!.id],
                    ),
            ],
        ]
        for (const [invariante, paso] of casos) {
            assert.include(await fabricado(empresas, paso), invariante, invariante)
        }
        // un asiento pago_impuesto sin su pago registrado
        assert.include(
            await fabricado(empresas, async (trx) => {
                await sinTriggers(
                    trx,
                    'fiscal.declaraciones_pagos',
                    `DELETE FROM fiscal.declaraciones_pagos WHERE id = ?`,
                    [pagoB.id],
                )
            }),
            '22.pago_de_declaracion_mal_contabilizado',
        )
        await afirmarLibro(assert, empresas)
    })

    test('anular en el mes ya liquidado una factura de ese mes: el bloqueo de impuestos rechaza su reverso etiquetado', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const v = await venta(e.B, '224.00')
        await compra(e, e.B, '112.00')
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const d = await declarar(e, e.B, 'iva_mensual')
        await new RevisarDeclaracion().execute({ declaracion_id: d.id }, e.ctx)
        const rechazo = await errorDe(
            new AnularFactura().execute(
                { factura_id: v.facturas[0]!.id, motivo: 'auditoría: anular en el mes liquidado' },
                e.ctx,
            ),
        )
        assert.deepEqual([rechazo.codigo, rechazo.reglas], ['periodo_bloqueado', ['impuestos']])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('remanente: el crédito no usado de un mes paga el débito del siguiente; 1.1.04 queda con lo que sobra', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await new EditarParametro().execute(
            {
                empresa_id: e.B,
                clave: 'inicio_libros',
                valor: '2026-01-01',
                vigente_desde: '2014-01-01',
                motivo: 'Libros en ArgosIsp (auditor)',
            },
            e.ctx,
        )
        // mes anterior: solo una compra (crédito 36)
        const proveedor = await proveedorEn(e.B, e.ctx)
        await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('D'),
                fecha_documento: `${ANTERIOR}-10`,
                periodo_iva: `${ANTERIOR}-01`,
                condicion: 'credito',
                lineas: [{ descripcion: 'Enlace de tránsito', total: '336.00' }],
            },
            e.ctx,
        )
        const primero = await declarar(e, e.B, 'iva_mensual', ANTERIOR)
        assert.include(primero.totales, { credito: '36.00', remanente_credito: '36.00', a_pagar: '0.00' })
        await new RevisarDeclaracion().execute({ declaracion_id: primero.id }, e.ctx)
        // este mes: una venta (débito 24) que el remanente paga
        await venta(e.B, '224.00')
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const segundo = await declarar(e, e.B, 'iva_mensual')
        assert.include(segundo.totales, {
            debito: '24.00',
            remanente_credito_anterior: '36.00',
            credito_usado: '24.00',
            a_pagar: '0.00',
            remanente_credito: '12.00',
        })
        await new RevisarDeclaracion().execute({ declaracion_id: segundo.id }, e.ctx)
        assert.deepEqual(
            [await saldoCuenta(e.B, '1.1.04'), await saldoCuenta(e.B, '2.1.02')],
            ['12.00', '0.00'],
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H34: una sustitutiva de un mes cuyo siguiente ya está liquidado cambia el remanente que ese siguiente arrastró', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await venta(e.B, '112.00') // IVA 12
        await compra(e, e.B, '336.00') // crédito 36 → remanente 24
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const v1 = await declarar(e, e.B, 'iva_mensual')
        await new RevisarDeclaracion().execute({ declaracion_id: v1.id }, e.ctx)
        // el mes siguiente se liquida arrastrando 24
        relojFiscal.ahora = () => new Date(`${DESPUES}-05T18:00:00Z`)
        const siguiente = await declarar(e, e.B, 'iva_mensual', SIGUIENTE)
        assert.include(siguiente.totales, { remanente_credito_anterior: '24.00', remanente_credito: '24.00' })
        await new RevisarDeclaracion().execute({ declaracion_id: siguiente.id }, e.ctx)

        // una compra tardía del primer mes (con excepción del bloqueo) y su sustitutiva: remanente 30
        await new CrearExcepcionBloqueo().execute(
            {
                empresa_id: e.B,
                tipo: 'impuestos',
                motivo: 'Factura del mes recibida tarde',
                hasta_en: new Date(Date.now() + 3_600_000).toISOString(),
            },
            e.ctx,
        )
        await compra(e, e.B, '56.00') // crédito 6
        const v2 = await declarar(e, e.B, 'iva_mensual', MES, { sustitutiva: true })
        await new RevisarDeclaracion().execute({ declaracion_id: v2.id }, e.ctx)
        // el siguiente quedó revisado con el remanente viejo: el crédito de 6 no lo arrastra nadie
        const violaciones = await verificarLibro([e.B, e.C])
        assert.deepEqual(
            violaciones.map((x) => x.invariante.split(' ')[0]),
            [],
        )
    }).fails(
        'H34: revisar la sustitutiva de un mes no exige recalcular el siguiente ya liquidado (remanente desfasado)',
    )
})
