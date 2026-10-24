import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { relojFiscal } from '#fiscal/comun'
import { compararRegimenes } from '#fiscal/comparador'
import type { ContextoAccion } from '#shared/contexto'
import EditarParametro from '#fiscal/actions/editar_parametro'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import CerrarEjercicio from '#ledger/actions/cerrar_ejercicio'

/**
 * Inventario interno, fase C (§15 #79): el costo de ventas (`5.6.01`; las mermas 5.6.02 son gasto) entra al margen bruto del ISO
 * trimestral y del ISO como piso del comparador; sin pasar de `iso_umbral_margen` (4 %) no hay ISO.
 */

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const SIGUIENTE = DateTime.fromISO(`${MES}-01`).plus({ months: 1 }).toFormat('yyyy-MM')
const BANCO = '1.1.02.01'

async function parametro(ctx: ContextoAccion, empresaId: number, clave: string, valor: unknown) {
    await new EditarParametro().execute(
        { empresa_id: empresaId, clave, valor, vigente_desde: '2014-01-01', motivo: `Prueba (${clave})` },
        ctx,
    )
}

function asiento(
    ctx: ContextoAccion,
    empresaId: number,
    fecha: string,
    debe: string,
    haber: string,
    monto: string,
) {
    return new RegistrarAsiento().execute(
        {
            empresa_id: empresaId,
            fecha,
            descripcion: 'Movimiento de prueba (costo de ventas)',
            origen_tipo: 'ajuste',
            movimientos: [
                { cuenta: debe, debe: monto },
                { cuenta: haber, haber: monto },
            ],
        },
        ctx,
    )
}

test.group('Inventario · fase C · costo de ventas en el ISO y el comparador', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })
    group.each.timeout(240_000)

    test('ISO trimestral: margen bruto con el costo de ventas 5.6 del año anterior; sin pasar del 4 % no hay ISO', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        for (const id of [e.B, e.C]) {
            await parametro(e.ctx, id, 'inicio_libros', '2021-01-01')
            await parametro(e.ctx, id, 'iso_base_periodo', 'anio_anterior')
            await asiento(e.ctx, id, '2021-01-04', BANCO, '3.1.01', '120000.00')
            await asiento(e.ctx, id, '2021-03-10', BANCO, '4.1.01', '8000.00')
        }
        // B: costo de ventas 7,800 (margen 2.5 %); C: 1,000 de costo y 7,000 de mermas, que son gasto
        // y no costo de ventas (margen 87.5 %)
        await asiento(e.ctx, e.B, '2021-05-20', CUENTAS_GT.COSTO_EQUIPO_VENDIDO, BANCO, '7800.00')
        await asiento(e.ctx, e.C, '2021-05-20', CUENTAS_GT.COSTO_EQUIPO_VENDIDO, BANCO, '1000.00')
        await asiento(e.ctx, e.C, '2021-06-20', CUENTAS_GT.MERMAS_INVENTARIO, BANCO, '7000.00')
        for (const id of [e.B, e.C]) {
            for (let mes = 1; mes <= 11; mes++) {
                await new CerrarPeriodo().execute({ empresa_id: id, anio: 2021, mes }, e.ctx)
            }
            await new CerrarEjercicio().execute({ empresa_id: id, anio: 2021, isr: { monto: '0.00' } }, e.ctx)
        }
        const calcular = (empresaId: number) =>
            new CalcularDeclaracion().execute(
                { empresa_id: empresaId, impuesto: 'iso_trimestral' as any, periodo: '2022-T1' },
                e.ctx,
            )
        const sinIso = await calcular(e.B)
        assert.include(sinIso.totales, {
            ingresos_brutos: '8000.00',
            costo_ventas: '7800.00',
            margen_bruto: '2.50',
            impuesto: '0.00',
            a_pagar: '0.00',
        })
        assert.isTrue((sinIso.detalle.notas ?? []).some((n) => n.startsWith('Costo de ventas 7800.00')))
        const conIso = await calcular(e.C)
        // activo neto 120,000 (120,000 + 8,000 − 1,000 − 7,000): ¼ al 1 %
        assert.include(conIso.totales, {
            costo_ventas: '1000.00',
            margen_bruto: '87.50',
            base: '30000.00',
            impuesto: '300.00',
        })
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('comparador: el ISO como piso solo con margen bruto (ingresos − 5.6) mayor que el umbral', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        for (const id of [e.B, e.C]) {
            await parametro(e.ctx, id, 'inicio_libros', `${MES.slice(0, 4)}-01-01`)
            // ventas sin IVA 50,000 en el mes
            await servicioFacturado(id, `${MES}-01`, { precio: '56000.00', instalacion: `${MES}-01` })
        }
        await asiento(e.ctx, e.B, `${MES}-02`, CUENTAS_GT.COSTO_EQUIPO_VENDIDO, BANCO, '48500.00')
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const r = await compararRegimenes([e.B, e.C], null)
        const iso = (id: number) =>
            r.empresas.find((x) => x.empresa_id === id)!.bloques.iso_piso.datos as Record<string, any>
        assert.include(iso(e.B), {
            costo_ventas: '48500.00',
            margen_bruto: '3.00',
            umbral_margen: '4.00',
            aplica: false,
            iso_anual: '0.00',
        })
        assert.include(iso(e.C), { costo_ventas: '0.00', margen_bruto: '100.00', aplica: true })
        assert.notEqual(iso(e.C).iso_anual, '0.00')
    })
})
