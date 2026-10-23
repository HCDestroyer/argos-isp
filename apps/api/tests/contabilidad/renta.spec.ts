import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { saldoCuenta } from '#tests/contabilidad/ayudas_contabilidad'
import EditarParametro from '#fiscal/actions/editar_parametro'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import RegistrarPagoDeclaracion from '#fiscal/actions/registrar_pago_declaracion'
import AnularPagoDeclaracion from '#fiscal/actions/anular_pago_declaracion'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import CerrarEjercicio from '#ledger/actions/cerrar_ejercicio'

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'

/**
 * Auditor contable · ISR, ISO, retenciones y anulación del pago de declaraciones (fase 7 PR C;
 * contrato de localización fiscal §9.1, §9.3, §10.6 y §21, desvíos (a)–(c), §15 #75–#83). Los
 * escenarios reales (ISR opcional con pago anulado, retenciones desde las compras, ISO 2022 que acredita
 * al ISR 2023 y vence en 2025 con sus cierres) los recorre `tests/fiscal/declaraciones_renta.spec.ts`
 * con `afirmarLibro`; aquí el inv. 23 y lo nuevo del 22 con violaciones fabricadas en una transacción
 * que se revierte.
 */

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

/** Una declaración «revisada» fabricada (con su obligación) de la empresa. */
async function declaracion(
    trx: TransactionClientContract,
    empresaId: number,
    impuesto: string,
    desde: string,
    hasta: string,
    totales: Record<string, string>,
) {
    const [o] = (await trx
        .insertQuery()
        .table('fiscal.obligaciones')
        .insert({
            empresa_id: empresaId,
            impuesto,
            periodo_desde: desde,
            periodo_hasta: hasta,
            vence_en: `${Number(hasta.slice(0, 4)) + 1}-03-31`,
            estado: 'pendiente',
        })
        .returning('id')) as Array<{ id: number }>
    const [d] = (await trx
        .insertQuery()
        .table('fiscal.declaraciones')
        .insert({
            empresa_id: empresaId,
            impuesto,
            periodo_desde: desde,
            periodo_hasta: hasta,
            version: 1,
            obligacion_id: o!.id,
            vence_en: `${Number(hasta.slice(0, 4)) + 1}-03-31`,
            totales: JSON.stringify(totales),
            datos_hash: 'a'.repeat(64),
            estado: 'revisada',
            revisada_en: new Date(),
        })
        .returning('id')) as Array<{ id: number }>
    return Number(d!.id)
}

async function iso(
    trx: TransactionClientContract,
    fila: {
        empresa_id: number
        tipo: string
        iso_periodo: string
        monto: string
        declaracion_id?: number
        cierre_id?: number
    },
    ventana = { acreditable_desde: '2023-01-01', vence_en: '2025-12-31' },
) {
    await trx
        .insertQuery()
        .table('fiscal.iso_acreditamientos')
        .insert({ ...ventana, declaracion_id: null, cierre_id: null, ...fila })
}

test.group('Auditor contable · ISR, ISO y pagos de declaraciones', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('inv. 23: ISO sin origen, acreditado de más o fuera de su ventana, 1.1.08 sin respaldo y cierre anual distinto de la declaración; inv. 22 del ISR', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const empresas = [e.B, e.C]
        assert.deepEqual(await verificarLibro(empresas), [])

        // un ISO del T1-2022 revisado sin su fila origen (y 1.1.08 en cero: la liquidación tampoco está)
        const sinOrigen = await fabricado(empresas, async (trx) => {
            await declaracion(trx, e.B, 'iso_trimestral', '2022-01-01', '2022-03-31', {
                impuesto: '100.00',
                a_pagar: '100.00',
            })
        })
        assert.includeMembers(sinOrigen, [
            '23.iso_por_acreditar_mal_llevado',
            '22.liquidacion_distinta_de_la_declaracion',
        ])

        // con su origen de 100, un ISR trimestral que acredita 150 (de más) y otro de 2027 (fuera de la ventana)
        const deMas = await fabricado(empresas, async (trx) => {
            const isoId = await declaracion(trx, e.B, 'iso_trimestral', '2022-01-01', '2022-03-31', {
                impuesto: '100.00',
                a_pagar: '100.00',
            })
            await iso(trx, {
                empresa_id: e.B,
                tipo: 'origen',
                iso_periodo: '2022-01-01',
                monto: '100.00',
                declaracion_id: isoId,
            })
            const isr = await declaracion(trx, e.B, 'isr_trimestral', '2023-01-01', '2023-03-31', {
                isr: '150.00',
                iso_acreditado: '150.00',
                a_pagar: '0.00',
            })
            await iso(trx, {
                empresa_id: e.B,
                tipo: 'acreditado',
                iso_periodo: '2022-01-01',
                monto: '150.00',
                declaracion_id: isr,
            })
            const tarde = await declaracion(trx, e.B, 'isr_trimestral', '2027-01-01', '2027-03-31', {
                isr: '1.00',
                iso_acreditado: '1.00',
                a_pagar: '0.00',
            })
            await iso(trx, {
                empresa_id: e.B,
                tipo: 'acreditado',
                iso_periodo: '2022-01-01',
                monto: '1.00',
                declaracion_id: tarde,
            })
        })
        assert.includeMembers(deMas, [
            '23.iso_por_acreditar_mal_llevado',
            '23.iso_por_acreditar_distinto_de_1.1.08',
        ])

        // un cierre anual de 2023 con ISR 0 cuando la declaración ISR anual revisada dice 40
        const cierre = await fabricado(empresas, async (trx) => {
            await declaracion(trx, e.B, 'isr_anual', '2023-01-01', '2023-12-31', {
                isr: '40.00',
                trimestral_acreditado: '0.00',
                iso_acreditado: '0.00',
                a_pagar: '40.00',
            })
            await trx
                .insertQuery()
                .table('ledger.cierres_anuales')
                .insert({
                    empresa_id: e.B,
                    anio: 2023,
                    isr: '0.00',
                    resultado_antes_isr: '0.00',
                    resultado: '0.00',
                    resumen: JSON.stringify({}),
                })
        })
        assert.include(cierre, '23.cierre_anual_distinto_de_la_declaracion')

        // ISR opcional liquidado contra la cuenta del IVA en lugar de 5.5.01 / 2.1.07
        const opcional = await fabricado(empresas, async (trx) => {
            const d = await declaracion(trx, e.B, 'isr_opcional_mensual', '2026-09-01', '2026-09-30', {
                isr: '30.00',
                retenciones_usadas: '0.00',
                a_pagar: '30.00',
            })
            await trx.rawQuery('ALTER TABLE ledger.asientos DISABLE TRIGGER USER')
            await trx.rawQuery('ALTER TABLE ledger.movimientos DISABLE TRIGGER USER')
            const [a] = (await trx
                .insertQuery()
                .table('ledger.asientos')
                .insert({
                    empresa_id: e.B,
                    fecha: '2026-10-01',
                    descripcion: 'liquidación ISR (auditor)',
                    origen_tipo: 'liquidacion_impuesto',
                    origen_id: d,
                })
                .returning('id')) as Array<{ id: number }>
            const cuentas = await trx
                .from('ledger.cuentas')
                .whereIn('codigo', ['5.5.01', '2.1.06'])
                .select('id', 'codigo')
            const id = (c: string) => cuentas.find((x) => x.codigo === c)!.id
            await trx
                .insertQuery()
                .table('ledger.movimientos')
                .multiInsert([
                    { asiento_id: a!.id, cuenta_id: id('5.5.01'), debe: '30.00', haber: '0.00' },
                    { asiento_id: a!.id, cuenta_id: id('2.1.06'), debe: '0.00', haber: '30.00' },
                ])
            await trx.rawQuery('ALTER TABLE ledger.movimientos ENABLE TRIGGER USER')
            await trx.rawQuery('ALTER TABLE ledger.asientos ENABLE TRIGGER USER')
        })
        assert.include(opcional, '22.liquidacion_distinta_de_la_declaracion')
    })

    test('ISO 2022-T1 revisado, pagado desde 2.1.08, el pago anulado y pagado otra vez: un pago vigente, 2.1.08 en cero y el inv. 23 en orden', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const parametro = (clave: string, valor: unknown) =>
            new EditarParametro().execute(
                { empresa_id: e.B, clave, valor, vigente_desde: '2014-01-01', motivo: `Auditor (${clave})` },
                e.ctx,
            )
        await parametro('inicio_libros', '2021-01-01')
        await parametro('iso_base_periodo', 'anio_anterior')
        const asiento = (fecha: string, debe: string, haber: string, monto: string) =>
            new RegistrarAsiento().execute(
                {
                    empresa_id: e.B,
                    fecha,
                    descripcion: 'Movimiento del auditor (ISO)',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: debe, debe: monto },
                        { cuenta: haber, haber: monto },
                    ],
                },
                e.ctx,
            )
        await asiento('2021-01-04', '1.1.02.01', '3.1.01', '120000.00')
        await asiento('2021-03-10', '1.1.02.01', '4.1.01', '8000.00')
        await asiento('2021-05-20', '5.2.99', '1.1.02.01', '2000.00')
        for (let mes = 1; mes <= 11; mes++) {
            await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2021, mes }, e.ctx)
        }
        await new CerrarEjercicio().execute({ empresa_id: e.B, anio: 2021, isr: { monto: '0.00' } }, e.ctx)
        const d = await new CalcularDeclaracion().execute(
            { empresa_id: e.B, impuesto: 'iso_trimestral', periodo: '2022-T1' },
            e.ctx,
        )
        await new RevisarDeclaracion().execute({ declaracion_id: d.id }, e.ctx)
        const pagar = () =>
            new RegistrarPagoDeclaracion().execute(
                {
                    declaracion_id: d.id,
                    metodo: 'cuenta_bancaria',
                    cuenta_bancaria_id: e.cuentas.get(e.B)!,
                    fecha: HOY,
                },
                e.ctx,
            )
        const primero = await pagar()
        assert.equal(primero.pago!.impuesto, '315.00')
        assert.equal(await saldoCuenta(e.B, '2.1.08'), '0.00')
        await new AnularPagoDeclaracion().execute(
            { declaracion_id: d.id, motivo: 'Boleta rechazada por el banco' },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, '2.1.08'), '-315.00')
        await pagar()
        assert.equal(await saldoCuenta(e.B, '2.1.08'), '0.00')
        const vigentes = await db
            .from('fiscal.declaraciones_pagos as p')
            .where('p.declaracion_id', d.id)
            .whereNotExists((q) =>
                q.from('fiscal.declaraciones_pagos_anulaciones as x').whereRaw('x.pago_id = p.id'),
            )
        assert.lengthOf(vigentes, 1)
        await afirmarLibro(assert, [e.B, e.C])
    })
})
