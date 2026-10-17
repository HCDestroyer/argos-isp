import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import RegistrarAsiento, { type EntradaAsiento } from '#ledger/actions/registrar_asiento'
import { verAsiento } from '#ledger/consultas'
import { balanceSaldos } from '#ledger/estados_financieros'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { contextoPrueba, soloEmpresaPrincipal } from '#tests/ayudas'

/**
 * Libro: etiqueta de impuesto en las partidas,
 * cuentas de patrimonio y contracuentas en el balance.
 */

const asiento = (empresaId: number, datos: Partial<EntradaAsiento> & Pick<EntradaAsiento, 'movimientos'>) =>
    new RegistrarAsiento().execute(
        {
            empresa_id: empresaId,
            descripcion: 'Prueba de cuadrículas y patrimonio',
            origen_tipo: 'ajuste',
            ...datos,
        },
        contextoPrueba(),
    )

const capital = (monto: string) => [
    { cuenta: CUENTAS.BANCO_PRINCIPAL, debe: monto },
    { cuenta: CUENTAS_GT.CAPITAL_SOCIAL, haber: monto },
]

test.group('Libro · cuadrículas de impuesto y patrimonio', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('cuadrícula de impuesto en el movimiento: debe ir con su impuesto y ser suya', async ({
        assert,
    }) => {
        const empresaId = await crearEmpresaFila()
        const registrado = await asiento(empresaId, {
            movimientos: [
                { cuenta: CUENTAS.BANCO_PRINCIPAL, debe: '112.00' },
                {
                    cuenta: CUENTAS.OTROS_INGRESOS,
                    haber: '100.00',
                    impuesto_codigo: 'IVA12',
                    cuadricula: 'iva_debito_base',
                },
                {
                    cuenta: CUENTAS.IVA_DEBITO,
                    haber: '12.00',
                    impuesto_codigo: 'IVA12',
                    cuadricula: 'iva_debito',
                },
            ],
        })
        const vista = await verAsiento(registrado.id)
        const movimientos = vista.movimientos as Array<Record<string, unknown>>
        assert.deepEqual(
            movimientos.map((m) => m.cuadricula),
            [null, 'iva_debito_base', 'iva_debito'],
        )
        const sinImpuesto = await asiento(empresaId, {
            movimientos: [
                { cuenta: CUENTAS.BANCO_PRINCIPAL, debe: '1.00', cuadricula: 'iva_debito' },
                { cuenta: CUENTAS.OTROS_INGRESOS, haber: '1.00' },
            ],
        }).catch((e) => e)
        assert.equal(sinImpuesto.errores[0].field, 'movimientos.0.impuesto_codigo')
        const ajena = await asiento(empresaId, {
            movimientos: [
                {
                    cuenta: CUENTAS.BANCO_PRINCIPAL,
                    debe: '1.00',
                    impuesto_codigo: 'IVA12',
                    cuadricula: 'iso',
                },
                { cuenta: CUENTAS.OTROS_INGRESOS, haber: '1.00' },
            ],
        }).catch((e) => e)
        assert.equal(ajena.errores[0].field, 'movimientos.0.cuadricula')
        // la base también lo exige
        await assert.rejects(() =>
            db.transaction(async (trx) => {
                const fila = await trx.from('ledger.movimientos').where('asiento_id', registrado.id).first()
                await trx.insertQuery().table('ledger.movimientos').insert({
                    asiento_id: registrado.id,
                    cuenta_id: fila.cuenta_id,
                    debe: '1.00',
                    haber: 0,
                    impuesto_codigo: 'IVA12',
                })
            }),
        )
    })

    test('balance con patrimonio y contracuentas: activo neto = pasivo + patrimonio + resultado', async ({
        assert,
    }) => {
        const empresaId = await crearEmpresaFila()
        await asiento(empresaId, { fecha: '2026-10-01', movimientos: capital('1000.00') })
        await asiento(empresaId, {
            fecha: '2026-10-02',
            movimientos: [
                { cuenta: `${CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO}.01`, debe: '600.00' },
                { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: '600.00' },
            ],
        })
        await asiento(empresaId, {
            fecha: '2026-10-03',
            movimientos: [
                { cuenta: CUENTAS_GT.DEPRECIACIONES, debe: '5.00' },
                { cuenta: `${CUENTAS_GT.DEPRECIACION_ACUMULADA}.01`, haber: '5.00' },
            ],
        })
        const balance = await balanceSaldos({ hasta: '2026-10-31' }, [empresaId])
        const totales = balance.empresas[0]!.totales
        assert.include(totales, {
            activo: '995.00',
            pasivo: '0.00',
            patrimonio: '1000.00',
            gastos: '5.00',
            resultado: '-5.00',
            cuadra: true,
        })
        const depreciacion = balance.empresas[0]!.cuentas.find(
            (c) => c.codigo === `${CUENTAS_GT.DEPRECIACION_ACUMULADA}.01`,
        )!
        assert.include(depreciacion, { naturaleza: 'acreedora', saldo: '5.00' })
    })
})
