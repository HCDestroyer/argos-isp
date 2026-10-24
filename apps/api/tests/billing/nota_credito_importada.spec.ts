import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { saldoCuenta } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import AnularFactura from '#billing/actions/anular_factura'
import CerrarApertura from '#ledger/actions/cerrar_apertura'
import { cuentaIngresoDeLinea } from '#billing/facturas'
import { errorDe } from '#tests/contabilidad/ayudas_contabilidad'
import { empresasSinFel } from '#tests/contabilidad/ayudas_libros'
import RegistrarSaldoInicial from '#billing/actions/registrar_saldo_inicial'
import AnularSaldoInicial from '#billing/actions/anular_saldo_inicial'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import { construirLibro, finDeMes, type LibroLegal } from '#fiscal/libros_legales'
import HabilitarLibro from '#fiscal/actions/habilitar_libro'
import { DateTime } from 'luxon'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import { verFactura } from '#billing/facturas'
import type { ContextoAccion } from '#shared/contexto'
import { CERO, aTexto, dec } from '#ledger/dinero'

const aTextoSuma = (montos: string[]) => aTexto(montos.reduce((s, m) => s.plus(dec(m)), CERO))

/**
 * H27 / H50 (decisiones del líder): una nota de crédito sobre una factura importada que desglosa IVA
 * es una rebaja de ventas del periodo: `2.1.02` al debe por el IVA proporcional y la base a la cuenta
 * de ingreso de la línea. 2.9.01 no se toca (conserva el saldo importado hasta su cierre). Con la
 * apertura cerrada, anular una importada responde 409 (se acredita con una nota).
 */

async function importada(ctx: ContextoAccion, empresaId: number, total = '43.98', fecha = '2026-09-05') {
    const clienteId = await crearClienteFila()
    const r = await new ImportarFacturaPendiente().execute(
        {
            origen: 'prueba_h27',
            id_externo: unico('f'),
            cliente_id: clienteId,
            empresa_id: empresaId,
            cargo_unico: true,
            emitida_en: fecha,
            total,
        },
        ctx,
    )
    const factura = (await db.from('billing.facturas').where('id', r.factura_id!).firstOrFail()) as {
        id: number
        iva: string
        total: string
    }
    return { ...factura, clienteId }
}

/**
 * Emisión del libro de ventas del mes como la deja `libros.emitir` (el mes en curso no se puede
 * cerrar en la prueba): habilitación y fila de `fiscal.libros_emisiones`. `notasImportadas` null es
 * una emisión anterior a H48 (sin las notas sobre importadas).
 */
async function emisionSimulada(
    ctx: ContextoAccion,
    empresaId: number,
    mes: { desde: string; hasta: string },
    libro: LibroLegal,
    notasImportadas: true | null,
) {
    await new HabilitarLibro().execute(
        {
            empresa_id: empresaId,
            libro: 'ventas',
            autorizacion: unico('SAT'),
            folio_desde: 1,
            folio_hasta: 10,
            fecha: mes.desde,
        },
        ctx,
    )
    await db.table('fiscal.libros_emisiones').insert({
        empresa_id: empresaId,
        libro: 'ventas',
        desde: mes.desde,
        hasta: mes.hasta,
        folio_inicial: 1,
        folio_final: 1,
        paginas: 1,
        formato: 'pdf',
        archivo: `libros/prueba/${unico('v')}.pdf`,
        tamano: 1,
        sha256: '0'.repeat(64),
        filas: libro.reporte.filas.length,
        totales: JSON.stringify(libro.reporte.totales),
        notas_importadas: notasImportadas,
    })
}

async function movimientosDeNota(notaId: number) {
    const filas = (await db
        .from('ledger.asientos as a')
        .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.origen_tipo', 'nota_credito')
        .where('a.origen_id', notaId)
        .orderBy('m.id')
        .select('c.codigo', 'm.debe', 'm.haber')) as Array<{ codigo: string; debe: string; haber: string }>
    return filas.map((f) => [f.codigo, f.debe, f.haber])
}

async function sinViolaciones(assert: { deepEqual: (a: unknown, b: unknown) => void }, empresas: number[]) {
    const violaciones = await verificarLibro(empresas, { incluirHallazgosAbiertos: true })
    assert.deepEqual(
        violaciones.map((v) => v.invariante.split(' ')[0]),
        [],
    )
}

test.group('Facturación · nota de crédito sobre una factura importada (H27, H50)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    async function cuentaDeIngreso(facturaId: number) {
        const detalle = await verFactura(facturaId)
        return cuentaIngresoDeLinea(detalle.lineas[0]!)
    }

    test('total: el IVA de la factura a 2.1.02 y la base a la cuenta de ingreso de la línea', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '112.00')
        assert.equal(f.iva, '12.00')
        const ingreso = await cuentaDeIngreso(f.id)
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: f.total, motivo: 'H27: acredita el total' },
            e.ctx,
        )
        assert.deepEqual([nota.subtotal, nota.iva], ['100.00', '12.00'])
        assert.sameDeepMembers(await movimientosDeNota(nota.id), [
            [ingreso, '100.00', '0.00'],
            ['2.1.02', '12.00', '0.00'],
            ['1.1.03', '0.00', '112.00'],
        ])
        // 2.9.01 conserva el saldo importado: lo cancela el cierre de apertura
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '-112.00')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('parcial: IVA proporcional; la segunda nota acredita el resto exacto', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '43.98')
        const notas = []
        for (const monto of ['10.01', '10.01', '10.01', '13.95']) {
            notas.push(
                await new EmitirNotaCredito().execute(
                    { factura_id: f.id, monto, motivo: 'H27: parcial' },
                    e.ctx,
                ),
            )
        }
        assert.equal(aTextoSuma(notas.map((n) => n.iva)), f.iva)
        assert.equal(await saldoCuenta(e.B, '2.1.02'), f.iva)
        assert.equal(await saldoCuenta(e.B, '1.1.03'), '0.00')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('por línea: la base de la línea va a su cuenta de ingreso', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '112.00')
        const detalle = await verFactura(f.id)
        const linea = detalle.lineas[0]!
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, lineas: [{ linea_id: linea.id, monto: '112.00' }], motivo: 'H27: por línea' },
            e.ctx,
        )
        assert.equal(nota.iva, '12.00')
        assert.sameDeepMembers(await movimientosDeNota(nota.id), [
            [cuentaIngresoDeLinea(linea), '100.00', '0.00'],
            ['2.1.02', '12.00', '0.00'],
            ['1.1.03', '0.00', '112.00'],
        ])
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('con la apertura cerrada: la nota no toca 2.9.01 ni patrimonio; anular la importada es 409', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '112.00')
        const otra = await importada(e.ctx, e.B, '224.00')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        assert.equal(await saldoCuenta(e.B, '3.3.01'), '-336.00')
        const ingreso = await cuentaDeIngreso(f.id)
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '112.00', motivo: 'H27: con la apertura cerrada' },
            e.ctx,
        )
        assert.sameDeepMembers(await movimientosDeNota(nota.id), [
            [ingreso, '100.00', '0.00'],
            ['2.1.02', '12.00', '0.00'],
            ['1.1.03', '0.00', '112.00'],
        ])
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')
        assert.equal(await saldoCuenta(e.B, '3.3.01'), '-336.00')

        const anular = await errorDe(
            new AnularFactura().execute(
                { factura_id: otra.id, motivo: 'H50: anular con la apertura cerrada' },
                e.ctx,
            ),
        )
        assert.deepInclude(anular, { status: 409, codigo: 'importada_con_apertura_cerrada' })
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')

        const hoy = new Date().toISOString().slice(0, 7)
        const verificacion = await new VerificarCierre().execute(
            { empresa_id: e.B, tipo: 'mensual', periodo: hoy },
            e.ctx,
        )
        assert.equal(verificacion.checks.find((c) => c.clave === 'apertura_cero')?.estado, 'revisado')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('con la apertura abierta: anular la importada la devuelve a 2.9.01 (corrige la importación)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '112.00')
        await new AnularFactura().execute({ factura_id: f.id, motivo: 'importada por error' }, e.ctx)
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')
        assert.equal(await saldoCuenta(e.B, '1.1.03'), '0.00')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H64: una importada posterior al cierre de apertura se anula normal contra 2.9.01', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await importada(e.ctx, e.B, '50.00', '2026-09-05')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        const tardia = await importada(e.ctx, e.B, '112.00', '2026-10-01')
        await new AnularFactura().execute({ factura_id: tardia.id, motivo: 'importación errónea' }, e.ctx)
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H63: un saldo inicial que ya entró en el cierre de apertura no se anula (409); uno posterior sí', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cliente = await crearClienteFila()
        const saldo = (fecha: string, monto: string) =>
            new RegistrarSaldoInicial().execute(
                {
                    origen: 'prueba_h63',
                    id_externo: unico('s'),
                    cliente_id: cliente,
                    empresa_id: e.B,
                    monto,
                    fecha,
                },
                e.ctx,
            )
        const antes = await saldo('2026-09-07', '80.00')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        const r = await errorDe(
            new AnularSaldoInicial().execute(
                { saldo_inicial_id: antes.saldo_inicial_id, motivo: 'tras el cierre' },
                e.ctx,
            ),
        )
        assert.deepInclude(r, { status: 409, codigo: 'saldo_con_apertura_cerrada' })
        const despues = await saldo('2026-10-02', '-15.00')
        await new AnularSaldoInicial().execute(
            { saldo_inicial_id: despues.saldo_inicial_id, motivo: 'error de carga' },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H66: una importada tardía con fecha anterior al cierre (registrada después, nunca trasladada) se anula contra 2.9.01', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const primera = await importada(e.ctx, e.B, '50.00', '2026-09-05')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: hoyGuatemala() }, e.ctx)
        const tardia = await importada(e.ctx, e.B, '112.00', '2026-09-20')
        await new AnularFactura().execute(
            { factura_id: tardia.id, motivo: 'importación tardía errónea' },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')
        // la que sí entró en el cierre sigue con 409
        const r = await errorDe(
            new AnularFactura().execute({ factura_id: primera.id, motivo: 'tras el cierre' }, e.ctx),
        )
        assert.deepInclude(r, { status: 409, codigo: 'importada_con_apertura_cerrada' })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H66: un saldo inicial tardío con fecha anterior al cierre se anula; uno que entró, 409', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        // un cliente por saldo: el saldo a favor se aplicaría a la factura de apertura del otro
        const saldo = async (fecha: string, monto: string) =>
            new RegistrarSaldoInicial().execute(
                {
                    origen: 'prueba_h66',
                    id_externo: unico('s'),
                    cliente_id: await crearClienteFila(),
                    empresa_id: e.B,
                    monto,
                    fecha,
                },
                e.ctx,
            )
        const entro = await saldo('2026-09-07', '-20.00')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: hoyGuatemala() }, e.ctx)
        const tardio = await saldo('2026-09-10', '75.00')
        await new AnularSaldoInicial().execute(
            { saldo_inicial_id: tardio.saldo_inicial_id, motivo: 'carga tardía errónea' },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')
        const r = await errorDe(
            new AnularSaldoInicial().execute(
                { saldo_inicial_id: entro.saldo_inicial_id, motivo: 'tras el cierre' },
                e.ctx,
            ),
        )
        assert.deepInclude(r, { status: 409, codigo: 'saldo_con_apertura_cerrada' })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('libro de ventas emitido sin las notas sobre importadas (antes de H48): no cambia y la nota va de ajuste al mes siguiente', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        const f = await importada(e.ctx, e.B, '112.00', '2026-08-10')
        const hoy = hoyGuatemala()
        const mes = { desde: inicioDeMes(hoy), hasta: finDeMes(hoy) }
        const siguiente = inicioDeMes(DateTime.fromISO(hoy).plus({ months: 1 }).toISODate()!)
        const otroMes = { desde: siguiente, hasta: finDeMes(siguiente) }

        // el libro del mes como se emitió con la regla anterior (sin la nota)
        const emitido = await construirLibro('ventas', e.B, mes)
        await emisionSimulada(e.ctx, e.B, mes, emitido, null)
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '56.00', motivo: 'rebaja tras la emisión' },
            e.ctx,
        )

        const otraVez = await construirLibro('ventas', e.B, mes)
        assert.deepEqual(otraVez.reporte.filas, emitido.reporte.filas)
        assert.deepEqual(otraVez.reporte.totales, emitido.reporte.totales)
        const ajuste = await construirLibro('ventas', e.B, otroMes)
        const fila = ajuste.reporte.filas.find((x) => x.numero === String(nota.id))
        assert.exists(fila)
        assert.include(fila!, { fecha: siguiente, total: '-56.00', iva: aTexto(dec(nota.iva).negated()) })
        assert.include(
            String(fila!.documento),
            `ajuste: nota del ${hoy} (libro de ${hoy.slice(0, 7)} ya emitido)`,
        )
    })

    test('libro de ventas emitido con la regla nueva: la nota sobre la importada queda en su mes y el libro no cambia al volver a generarlo', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        const f = await importada(e.ctx, e.B, '112.00', '2026-08-10')
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '56.00', motivo: 'rebaja' },
            e.ctx,
        )
        const hoy = hoyGuatemala()
        const mes = { desde: inicioDeMes(hoy), hasta: finDeMes(hoy) }
        const emitido = await construirLibro('ventas', e.B, mes)
        assert.exists(emitido.reporte.filas.find((x) => x.numero === String(nota.id)))
        await emisionSimulada(e.ctx, e.B, mes, emitido, true)
        const otraVez = await construirLibro('ventas', e.B, mes)
        assert.deepEqual(otraVez.reporte.filas, emitido.reporte.filas)
        const siguiente = inicioDeMes(DateTime.fromISO(hoy).plus({ months: 1 }).toISODate()!)
        const despues = await construirLibro('ventas', e.B, { desde: siguiente, hasta: finDeMes(siguiente) })
        assert.notExists(despues.reporte.filas.find((x) => x.numero === String(nota.id)))
    })

    test('H62: en pequeño contribuyente la importada no desglosa IVA y su nota sale en el libro de ventas', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        await new CambiarRegimen().execute(
            {
                empresa_id: e.B,
                regimen: 'pequeno_contribuyente',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción',
            },
            e.ctx,
        )
        const f = await importada(e.ctx, e.B, '200.00', '2026-08-10')
        assert.equal(f.iva, '0.00')
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '50.00', motivo: 'rebaja PC' },
            e.ctx,
        )
        assert.equal(nota.iva, '0.00')
        assert.isTrue(dec(await saldoCuenta(e.B, '2.1.02')).isZero())
        const hoy = hoyGuatemala()
        const ventas = await construirLibro('ventas', e.B, { desde: inicioDeMes(hoy), hasta: finDeMes(hoy) })
        assert.equal(ventas.reporte.totales.total, '-50.00')
    })
})
