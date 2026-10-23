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
import MarcarDeclaracionPresentada from '#fiscal/actions/marcar_declaracion_presentada'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import CrearExcepcionBloqueo from '#ledger/actions/crear_excepcion_bloqueo'
import AnularFactura from '#billing/actions/anular_factura'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import { cola, datosNit, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { crearClienteFila } from '#tests/core/fabricas'

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

    test('H34 (arreglado en 655001f): la sustitutiva de un mes rehace en cascada el siguiente ya liquidado con el remanente nuevo', async ({
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
        // la cascada rehízo el siguiente con el remanente 30
        const siguienteAhora = (await db
            .from('fiscal.declaraciones')
            .where({ empresa_id: e.B, impuesto: 'iva_mensual', periodo_desde: `${SIGUIENTE}-01` })
            .orderBy('version', 'desc')
            .firstOrFail()) as { version: number; estado: string; totales: Record<string, string> }
        assert.deepEqual(
            [
                siguienteAhora.version,
                siguienteAhora.estado,
                siguienteAhora.totales.remanente_credito_anterior,
            ],
            [2, 'revisada', '30.00'],
        )
        const violaciones = await verificarLibro([e.B, e.C])
        assert.deepEqual(
            violaciones.map((x) => x.invariante.split(' ')[0]),
            [],
        )
    })

    test('cascada con el mes siguiente ya presentado y pagado: saldo a favor en 2.1.06, obligación por rectificar; una NCRE sin certificar la bloquea sin guardar nada; un ajuste sin etiqueta a una cuenta de impuesto ya no entra', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
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
        const compraEn = async (fecha: string, total: string) => {
            const proveedor = await proveedorEn(e.B, e.ctx)
            return new RegistrarCompra().execute(
                {
                    proveedor_id: proveedor.id,
                    tipo_documento: 'FACT',
                    numero: unico('D'),
                    fecha_documento: fecha,
                    periodo_iva: `${fecha.slice(0, 7)}-01`,
                    condicion: 'credito',
                    lineas: [{ descripcion: 'Enlace de tránsito', total }],
                },
                e.ctx,
            )
        }
        // mes anterior: crédito 36; este mes: factura FEL con débito 48 → usa 36, paga 12
        await compraEn(`${ANTERIOR}-10`, '336.00')
        const anterior = await declarar(e as EmpresasGt, e.B, 'iva_mensual', ANTERIOR)
        await new RevisarDeclaracion().execute({ declaracion_id: anterior.id }, e.ctx)
        const s = await servicioFel(e, 'emitir', '448.00', await crearClienteFila(datosNit()))
        await cola(e)
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const mes = await declarar(e as EmpresasGt, e.B, 'iva_mensual')
        assert.include(mes.totales, { debito: '48.00', credito_usado: '36.00', a_pagar: '12.00' })
        await new RevisarDeclaracion().execute({ declaracion_id: mes.id }, e.ctx)
        await new MarcarDeclaracionPresentada().execute(
            { declaracion_id: mes.id, numero_formulario: '2237-1', fecha_presentacion: `${SIGUIENTE}-05` },
            e.ctx,
        )
        await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: mes.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: HOY,
            },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, '2.1.06'), '0.00')

        // e3bfefd: un ajuste manual sin etiqueta a una cuenta de impuesto ya no entra en el mes liquidado
        for (const cuenta of ['2.1.02', '1.1.04', '2.1.11']) {
            const ajuste = await errorDe(
                new RegistrarAsiento().execute(
                    {
                        empresa_id: e.B,
                        fecha: HOY,
                        descripcion: 'Ajuste manual al IVA (auditor)',
                        origen_tipo: 'ajuste',
                        movimientos: [
                            { cuenta: '1.1.02.01', debe: '5.00' },
                            { cuenta, haber: '5.00' },
                        ],
                    },
                    e.ctx,
                ),
            )
            assert.deepEqual([ajuste.codigo, ajuste.reglas], ['periodo_bloqueado', ['impuestos']], cuenta)
        }

        // con una excepción autorizada: una nota de crédito del mes (su NCRE queda en cola) y una compra
        // tardía del mes anterior, cuya sustitutiva cambia el remanente de 36 a 42
        await new CrearExcepcionBloqueo().execute(
            {
                empresa_id: e.B,
                tipo: 'impuestos',
                motivo: 'Documentos recibidos tarde',
                hasta_en: new Date(Date.now() + 3_600_000).toISOString(),
            },
            e.ctx,
        )
        await new EmitirNotaCredito().execute(
            { factura_id: s.facturas[0]!.id, monto: '56.00', motivo: 'auditoría: descuento' },
            e.ctx,
        )
        await compraEn(`${ANTERIOR}-20`, '56.00')
        const sustitutiva = await declarar(e as EmpresasGt, e.B, 'iva_mensual', ANTERIOR, {
            sustitutiva: true,
        })
        const foto = async () => {
            const { rows } = await db.rawQuery(
                `SELECT (SELECT count(*) FROM fiscal.declaraciones WHERE empresa_id = ?)::int AS declaraciones,
                        (SELECT string_agg(id || ':' || estado, ',' ORDER BY id) FROM fiscal.declaraciones WHERE empresa_id = ?) AS estados,
                        (SELECT count(*) FROM ledger.asientos WHERE empresa_id = ?)::int AS asientos,
                        (SELECT count(*) FROM ledger.bloqueos WHERE empresa_id = ?)::int AS bloqueos,
                        (SELECT coalesce(sum(version), 0) FROM fiscal.obligaciones WHERE empresa_id = ?)::int AS obligaciones,
                        (SELECT count(*) FROM audit.outbox WHERE (payload ->> 'empresa_id')::bigint = ?)::int AS eventos`,
                [e.B, e.B, e.B, e.B, e.B, e.B],
            )
            return rows[0]
        }
        const antes = await foto()
        const bloqueada = await errorDe(
            new RevisarDeclaracion().execute({ declaracion_id: sustitutiva.id }, e.ctx),
        )
        assert.deepEqual([bloqueada.status, bloqueada.codigo], [409, 'cascada_bloqueada'])
        assert.include(bloqueada.reglas, 'ncre_sin_certificar')
        assert.deepEqual(
            await foto(),
            antes,
            'nada se guardó: ni versiones, ni asientos, ni bloqueos, ni eventos',
        )

        // la NCRE se certifica y la cascada pasa: el mes ya pagado queda con 12 a favor en 2.1.06
        await cola(e)
        const revisada = await new RevisarDeclaracion().execute({ declaracion_id: sustitutiva.id }, e.ctx)
        assert.lengthOf(revisada.cascada, 1)
        assert.include(revisada.cascada[0]!, {
            estaba_presentada: true,
            remanente_credito_anterior: '42.00',
            a_pagar: '0.00',
        })
        assert.equal(await saldoCuenta(e.B, '2.1.06'), '12.00')
        const obligacion = await db
            .from('fiscal.obligaciones')
            .where({ empresa_id: e.B, impuesto: 'iva_mensual', periodo_desde: `${MES}-01` })
            .firstOrFail()
        assert.deepEqual([obligacion.estado, obligacion.motivo_estado], ['borrador', 'rectificativa'])
        const sustituidaMes = await db.from('fiscal.declaraciones').where('id', mes.id).firstOrFail()
        assert.deepEqual([sustituidaMes.estado, sustituidaMes.numero_formulario], ['sustituida', '2237-1'])
        assert.lengthOf(await db.from('fiscal.declaraciones_pagos').where('empresa_id', e.B), 1)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H35: la liquidación y el pago de una declaración se revierten directo (POST /libro/asientos/:id/revertir) y deshacen lo declarado', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await venta(e.B, '224.00')
        await compra(e, e.B, '112.00')
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const d = await declarar(e, e.B, 'iva_mensual')
        const revisada = await new RevisarDeclaracion().execute({ declaracion_id: d.id }, e.ctx)
        const pagada = await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: d.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: HOY,
            },
            e.ctx,
        )
        const intentos = []
        for (const asientoId of [revisada.asiento_id!, pagada.pago!.asiento_id]) {
            intentos.push(
                await new RevertirAsiento()
                    .execute({ asiento_id: asientoId, motivo: 'auditoría: revertir directo' }, e.ctx)
                    .then(
                        () => 'revertido',
                        (error: { tipo?: string }) => error.tipo?.split(':').pop() ?? 'error',
                    ),
            )
        }
        assert.deepEqual(intentos, ['reverso_por_documento', 'reverso_por_documento'])
    }).fails('H35: liquidacion_impuesto y pago_impuesto no están en POR_DOCUMENTO de #ledger/reversos')
})
