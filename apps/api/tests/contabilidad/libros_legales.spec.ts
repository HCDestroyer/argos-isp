import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { errorDe } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import {
    LIBROS,
    asiento,
    empresasSinFel,
    habilitar,
    huellaEnDisco,
    mesConMovimiento,
    neto,
} from '#tests/contabilidad/ayudas_libros'
import { haceMeses } from '#tests/ledger/ayudas_compras'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { finDeMes, construirLibro, type LibroEmitible } from '#fiscal/libros_legales'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import ReabrirPeriodo from '#ledger/actions/reabrir_periodo'
import BloquearLibro from '#ledger/actions/bloquear_libro'
import EmitirLibro from '#fiscal/actions/emitir_libro'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import { cola, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { crearClienteFila } from '#tests/core/fabricas'
import { hoyGuatemala } from '#ledger/fechas'

/**
 * Auditor contable · libros legales con folio (fase 6 PR D; contrato de localización fiscal §7 y
 * §20, desvíos (r) a (x)).
 *
 *  - Libros = mayor: el Diario y el Mayor emitidos de un mes real (factura, compra y un asiento
 *    manual) cuadran con `ledger` (Debe = Haber; saldo inicial y final de cada cuenta = su saldo en
 *    el libro), el de Ventas con `2.1.02` y el de Compras con `1.1.04` del mes.
 *  - Folios: correlativos por (empresa, libro) aunque se emita en paralelo; la otra empresa no los
 *    comparte; SHA-256 guardado = archivo; la reemisión del mismo rango da el mismo contenido con
 *    folios nuevos; el periodo emitido no admite asientos.
 *  - Inv. 20 de `verificarLibro` con violaciones fabricadas en una transacción que se revierte.
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

test.group('Auditor contable · libros legales con folio', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('libros = mayor: Diario y Mayor cuadran con ledger, Ventas con 2.1.02 y Compras con 1.1.04; el periodo emitido queda congelado', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        const desde = haceMeses(1)
        const hasta = finDeMes(desde)
        await mesConMovimiento(e, e.B, desde)
        for (const libro of LIBROS) await habilitar(e, e.B, libro, 1, 100)

        const emisiones = new Map<LibroEmitible, Awaited<ReturnType<EmitirLibro['execute']>>>()
        for (const libro of LIBROS) {
            emisiones.set(
                libro,
                await new EmitirLibro().execute({ empresa_id: e.B, libro, desde, formato: 'pdf' }, e.ctx),
            )
        }
        const contenido = new Map<LibroEmitible, unknown>()
        for (const libro of LIBROS) {
            const l = await construirLibro(libro, e.B, { desde, hasta })
            contenido.set(libro, { filas: l.reporte.filas, totales: l.reporte.totales })
            const emision = emisiones.get(libro)!
            assert.deepEqual(emision.totales, l.reporte.totales, libro)
            assert.equal(emision.filas, l.reporte.filas.length, libro)
            const huella = await huellaEnDisco(emision.id)
            assert.equal(huella.calculado, huella.guardado, `SHA-256 del ${libro}`)
        }

        // Diario: cada partida y el libro cuadran, y el total es el de ledger del mes
        const diario = await construirLibro('diario', e.B, { desde, hasta })
        for (const fila of diario.reporte.filas.filter((f) => f.fila === 'total')) {
            assert.equal(fila.debe, fila.haber, `partida ${fila.partida}`)
            assert.isNotNull(fila.partida, 'mes cerrado: todas con partida')
        }
        const { rows: libroMes } = await db.rawQuery(
            `SELECT coalesce(sum(m.debe), 0)::text AS debe, coalesce(sum(m.haber), 0)::text AS haber
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
              WHERE a.empresa_id = ? AND a.fecha BETWEEN ? AND ?`,
            [e.B, desde, hasta],
        )
        assert.deepEqual(
            [diario.reporte.totales.debe, diario.reporte.totales.haber],
            [aTexto(dec(libroMes[0].debe)), aTexto(dec(libroMes[0].haber))],
        )
        assert.isTrue(dec(libroMes[0].debe).gt(0))

        // Mayor: saldo inicial y final de cada cuenta = su saldo en ledger, según su naturaleza
        const mayor = await construirLibro('mayor', e.B, { desde, hasta })
        const { rows: saldos } = await db.rawQuery(
            `SELECT c.codigo, c.naturaleza,
                    coalesce(sum(m.debe - m.haber) FILTER (WHERE a.fecha < ?), 0)::text AS inicial,
                    coalesce(sum(m.debe - m.haber) FILTER (WHERE a.fecha <= ?), 0)::text AS final,
                    coalesce(sum(m.debe) FILTER (WHERE a.fecha BETWEEN ? AND ?), 0)::text AS debe,
                    coalesce(sum(m.haber) FILTER (WHERE a.fecha BETWEEN ? AND ?), 0)::text AS haber
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.empresa_id = ? AND a.fecha <= ?
              GROUP BY c.codigo, c.naturaleza`,
            [desde, hasta, desde, hasta, desde, hasta, e.B, hasta],
        )
        const signo = (naturaleza: string | undefined) => (naturaleza === 'deudora' ? 1 : -1)
        const esperado = (saldos as Array<Record<string, string>>)
            .filter((s) => !dec(s.debe).isZero() || !dec(s.haber).isZero() || !dec(s.inicial).isZero())
            .map((s) => [
                s.codigo,
                aTexto(dec(s.inicial).times(signo(s.naturaleza))),
                aTexto(dec(s.final).times(signo(s.naturaleza))),
                aTexto(dec(s.debe)),
                aTexto(dec(s.haber)),
            ])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        const obtenido = mayor.reporte.filas
            .filter((f) => f.fila === 'saldo_final')
            .map((f) => {
                const inicial = mayor.reporte.filas.find(
                    (x) => x.fila === 'saldo_inicial' && x.cuenta === f.cuenta,
                )
                return [f.cuenta, inicial?.saldo, f.saldo, f.debe, f.haber]
            })
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        assert.deepEqual(obtenido, esperado)
        assert.deepEqual(
            [mayor.reporte.totales.debe, mayor.reporte.totales.haber],
            [diario.reporte.totales.debe, diario.reporte.totales.haber],
        )

        // Ventas = 2.1.02 del mes (haber); Compras = 1.1.04 del mes (debe)
        const ventas = await construirLibro('ventas', e.B, { desde, hasta })
        assert.isAbove(ventas.reporte.filas.length, 0)
        assert.equal(ventas.reporte.totales.iva, aTexto(CERO.minus(await neto(e.B, '2.1.02', desde, hasta))))
        const compras = await construirLibro('compras', e.B, { desde, hasta })
        assert.isAbove(compras.reporte.filas.length, 0)
        assert.equal(
            compras.reporte.totales.iva_credito,
            aTexto(await neto(e.B, CUENTAS_GT.IVA_CREDITO, desde, hasta)),
        )

        // el periodo emitido no admite asientos; la reemisión da el mismo contenido con folios nuevos
        const tarde = await errorDe(asiento(e.ctx, e.B, desde.slice(0, 8) + '20', '1.00'))
        assert.include([409, 422], tarde.status)
        for (const libro of LIBROS) {
            const anterior = emisiones.get(libro)!
            const otra = await new EmitirLibro().execute(
                { empresa_id: e.B, libro, desde, hasta, formato: 'xlsx' },
                e.ctx,
            )
            assert.include(otra, {
                reimpresion: true,
                reimpresion_de: anterior.id,
                folio_inicial: anterior.folio_final + 1,
            })
            assert.deepEqual(otra.totales, anterior.totales, libro)
            assert.equal(otra.filas, anterior.filas, libro)
            const l = await construirLibro(libro, e.B, { desde, hasta })
            assert.deepEqual(
                { filas: l.reporte.filas, totales: l.reporte.totales },
                contenido.get(libro),
                libro,
            )
            const huella = await huellaEnDisco(otra.id)
            assert.equal(huella.calculado, huella.guardado)
        }
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('folios: emisiones en paralelo sin repetir folio, la otra empresa con los suyos, sin bloqueo global o duro 422 y UPDATE/DELETE rechazados', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        for (const empresaId of [e.B, e.C]) {
            await asiento(e.ctx, empresaId, '2024-01-10', '100.00')
            await new CerrarPeriodo().execute({ empresa_id: empresaId, anio: 2024, mes: 1 }, e.ctx)
        }
        // un bloqueo de ventas no basta: global o duro
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'ventas', hasta: '2024-01-31', motivo: 'Ventas declaradas' },
            e.ctx,
        )
        await habilitar(e, e.B, 'diario', 1, 6)
        const sinGlobal = await errorDe(
            new EmitirLibro().execute({ empresa_id: e.B, libro: 'diario', desde: '2024-01-01' }, e.ctx),
        )
        assert.deepEqual(
            [sinGlobal.status, sinGlobal.codigo, sinGlobal.reglas],
            [422, 'periodo_sin_bloqueo', ['sin_bloqueo']],
        )
        for (const empresaId of [e.B, e.C]) {
            await new BloquearLibro().execute(
                { empresa_id: empresaId, tipo: 'global', hasta: '2024-01-31', motivo: 'Enero declarado' },
                e.ctx,
            )
        }
        await habilitar(e, e.C, 'diario', 900, 999)

        const emitir = (empresaId: number) =>
            new EmitirLibro().execute({ empresa_id: empresaId, libro: 'diario', desde: '2024-01-01' }, e.ctx)
        const resultados = await Promise.allSettled([
            emitir(e.B),
            emitir(e.B),
            emitir(e.B),
            emitir(e.C),
            emitir(e.B),
            emitir(e.C),
        ])
        const rechazos = resultados.filter((r) => r.status === 'rejected')
        assert.deepEqual(rechazos, [], 'ninguna emisión en paralelo falla')
        const filas = await db
            .from('fiscal.libros_emisiones')
            .whereIn('empresa_id', [e.B, e.C])
            .orderBy('id')
            .select('empresa_id', 'folio_inicial', 'folio_final', 'reimpresion_de', 'id')
        const folios = (empresaId: number) =>
            filas.filter((f) => Number(f.empresa_id) === empresaId).map((f) => Number(f.folio_inicial))
        assert.deepEqual(folios(e.B), [1, 2, 3, 4])
        assert.deepEqual(folios(e.C), [900, 901])
        // las dos primeras de cada empresa no reimprimen; cada una siguiente reimprime la anterior de su empresa
        const deB = filas.filter((f) => Number(f.empresa_id) === e.B)
        assert.deepEqual(
            deB.map((f) => f.reimpresion_de),
            [null, deB[0]!.id, deB[1]!.id, deB[2]!.id],
        )

        // quedan 2 folios en B: una más pasa, la siguiente se agota
        await emitir(e.B)
        await emitir(e.B)
        const agotados = await errorDe(emitir(e.B))
        assert.deepEqual([agotados.status, agotados.codigo], [422, 'folios_agotados'])

        // solo inserción, también para el dueño de la tabla
        const intentar = (sql: string) =>
            db.transaction(async (trx) => {
                await trx.rawQuery(sql)
                throw new Error('no lo rechazó')
            })
        for (const tabla of ['fiscal.libros_emisiones', 'fiscal.libros_habilitados']) {
            await assert.rejects(() => intentar(`UPDATE ${tabla} SET created_at = created_at`), /inmutable/)
            await assert.rejects(() => intentar(`DELETE FROM ${tabla}`), /inmutable/)
        }
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('emisión de dos meses: el último sello y hash son los del cierre del último mes, no los del primero', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        await asiento(e.ctx, e.B, '2024-01-10', '100.00')
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2024, mes: 1 }, e.ctx)
        await asiento(e.ctx, e.B, '2024-02-10', '40.00')
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2024, mes: 2 }, e.ctx)
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'global', hasta: '2024-02-29', motivo: 'Febrero declarado' },
            e.ctx,
        )
        await habilitar(e, e.B, 'mayor', 1, 10)
        const emision = await new EmitirLibro().execute(
            { empresa_id: e.B, libro: 'mayor', desde: '2024-01-01', hasta: '2024-02-29' },
            e.ctx,
        )
        const cierres = await db
            .from('ledger.cierres_mensuales')
            .where('empresa_id', e.B)
            .orderBy('periodo')
            .select('ultimo_sello', 'ultimo_hash')
        assert.notEqual(cierres[0].ultimo_hash, cierres[1].ultimo_hash, 'febrero selló asientos nuevos')
        assert.deepEqual(
            [emision.ultimo_sello, emision.ultimo_hash],
            [cierres[1].ultimo_sello, cierres[1].ultimo_hash],
        )
        assert.deepEqual([emision.totales.debe, emision.totales.haber], ['140.00', '140.00'])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('ventas con FEL: factura certificada y su NCRE salen una vez; con el DTE en otro mes (posterior o previo) la fila interna lleva el IVA y el DTE va informativo; Σ IVA = 2.1.02', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'emitir', '112.00', await crearClienteFila(datosNit()))
        await cola(e)
        const facturaId = s.facturas[0]!.id
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: facturaId, monto: '56.00', motivo: 'auditoría: media nota' },
            e.ctx,
        )
        await cola(e)
        // un aviso de cobro sin cubrir (IVA en 2.1.11): no es venta fiscal todavía
        const aviso = await servicioFel(e, 'pagar', '224.00')
        assert.isTrue(Boolean(aviso.facturas[0]))
        const [ncre] = await dtesDe('nota_credito', nota.id)
        assert.equal(ncre?.estado, 'certificado')
        const hoy = hoyGuatemala()
        const anio = { desde: `${hoy.slice(0, 4)}-01-01`, hasta: `${hoy.slice(0, 4)}-12-31` }
        const debito = async () => aTexto(CERO.minus(await neto(e.B, '2.1.02', anio.desde, anio.hasta)))
        const resumen = async () => {
            const l = await construirLibro('ventas', e.B, anio)
            return {
                filas: l.reporte.filas.map((f) => [f.origen, f.estado, f.iva]),
                iva: l.reporte.totales.iva,
            }
        }
        assert.deepEqual(await resumen(), {
            filas: [
                ['dte', 'vigente', '12.00'],
                ['dte', 'vigente', '-6.00'],
            ],
            iva: await debito(),
        })
        // el DTE de la factura en el mes siguiente (posterior) y el de la nota en el anterior (previo)
        const mover = (documentoTipo: string, documentoId: number, meses: number) =>
            db.rawQuery(
                `UPDATE fiscal.dte SET fecha_emision = fecha_emision + make_interval(months => ?)
                  WHERE documento_tipo = ? AND documento_id = ?`,
                [meses, documentoTipo, documentoId],
            )
        await mover('factura', facturaId, 1)
        await mover('nota_credito', nota.id, -1)
        const movido = await resumen()
        assert.sameDeepMembers(movido.filas, [
            ['interno', 'vigente', '12.00'],
            ['dte', 'certificado_posterior', '0.00'],
            ['interno', 'vigente', '-6.00'],
            ['dte', 'certificado_previo', '0.00'],
        ])
        assert.equal(movido.iva, await debito())
        await mover('factura', facturaId, -1)
        await mover('nota_credito', nota.id, 1)
        const devuelto = await resumen()
        assert.equal(devuelto.iva, await debito())
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('reabrir un mes emitido bajo el bloqueo global: el libro emitido ya no queda respaldado (decisión del contador)', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        await asiento(e.ctx, e.B, '2024-01-10', '100.00')
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2024, mes: 1 }, e.ctx)
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'global', hasta: '2024-01-31', motivo: 'Enero declarado' },
            e.ctx,
        )
        await habilitar(e, e.B, 'diario', 1, 10)
        await new EmitirLibro().execute({ empresa_id: e.B, libro: 'diario', desde: '2024-01-01' }, e.ctx)
        // el bloqueo global no impide reabrir (solo el duro, §9.2): la emisión queda sobre un mes abierto
        await new ReabrirPeriodo().execute(
            { empresa_id: e.B, anio: 2024, mes: 1, motivo: 'auditoría: reabrir lo emitido' },
            e.ctx,
        )
        // con el bloqueo global vigente nada entra al mes, y no se reemite hasta volver a cerrarlo
        const tarde = await errorDe(asiento(e.ctx, e.B, '2024-01-20', '1.00'))
        assert.include([409, 422], tarde.status)
        const abierto = await errorDe(
            new EmitirLibro().execute({ empresa_id: e.B, libro: 'diario', desde: '2024-01-01' }, e.ctx),
        )
        assert.deepEqual([abierto.codigo, abierto.reglas], ['periodo_sin_bloqueo', ['mes_abierto']])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('inv. 20: huecos y saltos de folio, emisión sin cierre ni bloqueo, hash ajeno, reimpresión mal enlazada y libro distinto del mayor', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        await asiento(e.ctx, e.B, '2024-01-10', '100.00')
        await asiento(e.ctx, e.B, '2024-02-10', '30.00')
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2024, mes: 1 }, e.ctx)
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'global', hasta: '2024-01-31', motivo: 'Enero declarado' },
            e.ctx,
        )
        await habilitar(e, e.B, 'diario', 1, 10)
        const real = await new EmitirLibro().execute(
            { empresa_id: e.B, libro: 'diario', desde: '2024-01-01' },
            e.ctx,
        )
        const empresas = [e.B, e.C]
        assert.deepEqual(await verificarLibro(empresas), [])

        const original = await db.from('fiscal.libros_emisiones').where('id', real.id).firstOrFail()
        const copia = (cambios: Record<string, unknown>) => {
            const resto: Record<string, unknown> = { ...original }
            for (const clave of ['id', 'created_at', 'generado_en']) delete resto[clave]
            return {
                ...resto,
                totales: JSON.stringify(original.totales),
                reimpresion_de: real.id,
                folio_inicial: 2,
                folio_final: 2,
                ...cambios,
            }
        }
        const insertar = async (trx: TransactionClientContract, fila: Record<string, unknown>) => {
            await trx.rawQuery('ALTER TABLE fiscal.libros_emisiones DISABLE TRIGGER USER')
            await trx.insertQuery().table('fiscal.libros_emisiones').insert(fila)
            await trx.rawQuery('ALTER TABLE fiscal.libros_emisiones ENABLE TRIGGER USER')
        }
        // una reimpresión correcta no viola nada
        assert.deepEqual(await fabricado(empresas, (trx) => insertar(trx, copia({}))), [])
        // hueco de folios (salta del 1 al 5) y una que pasa del último habilitado
        assert.include(
            await fabricado(empresas, (trx) => insertar(trx, copia({ folio_inicial: 5, folio_final: 5 }))),
            '20.folios_de_libro_no_correlativos',
        )
        assert.include(
            await fabricado(empresas, (trx) => insertar(trx, copia({ folio_final: 11, paginas: 10 }))),
            '20.folios_de_libro_no_correlativos',
        )
        // habilitación que no sigue a la anterior
        assert.include(
            await fabricado(empresas, async (trx) => {
                await trx.rawQuery('ALTER TABLE fiscal.libros_habilitados DISABLE TRIGGER USER')
                await trx.insertQuery().table('fiscal.libros_habilitados').insert({
                    empresa_id: e.B,
                    libro: 'diario',
                    autorizacion: 'SAT-7121 salto',
                    folio_desde: 50,
                    folio_hasta: 60,
                    fecha: '2024-01-02',
                })
                await trx.rawQuery('ALTER TABLE fiscal.libros_habilitados ENABLE TRIGGER USER')
            }),
            '20.folios_de_libro_no_correlativos',
        )
        // febrero (abierto y sin bloqueo), un rango que no es de meses completos, un hash ajeno y
        // una reimpresión sin enlazar
        for (const cambios of [
            { desde: '2024-02-01', hasta: '2024-02-29', reimpresion_de: null },
            { hasta: '2024-01-30' },
            { ultimo_hash: 'f'.repeat(64) },
            { reimpresion_de: null },
        ]) {
            assert.include(
                await fabricado(empresas, (trx) => insertar(trx, copia(cambios))),
                '20.libro_emitido_sin_cierre_o_bloqueo',
                JSON.stringify(cambios),
            )
        }
        // totales que no son los de ledger: distinto del mayor y distinto del libro rehecho
        const otrosTotales = await fabricado(empresas, (trx) =>
            insertar(trx, copia({ totales: JSON.stringify({ ...original.totales, debe: '1.00' }) })),
        )
        assert.includeMembers(otrosTotales, [
            '20.libro_emitido_distinto_del_mayor',
            '20.libro_emitido_cambio',
        ])
        // un libro de ventas con un IVA que no es el movimiento de 2.1.02 del rango
        assert.include(
            await fabricado(empresas, (trx) =>
                insertar(
                    trx,
                    copia({
                        libro: 'ventas',
                        reimpresion_de: null,
                        folio_inicial: 1,
                        folio_final: 1,
                        totales: JSON.stringify({ iva: '5.00' }),
                    }),
                ),
            ),
            '20.libro_ventas_distinto_del_iva_debito',
        )
        // un asiento que aparece en enero después de la emisión (el mes sigue cerrado)
        const tardio = await fabricado(empresas, async (trx) => {
            await trx.rawQuery('ALTER TABLE ledger.asientos DISABLE TRIGGER USER')
            await trx.rawQuery('ALTER TABLE ledger.movimientos DISABLE TRIGGER USER')
            const [a] = (await trx
                .insertQuery()
                .table('ledger.asientos')
                .insert({
                    empresa_id: e.B,
                    fecha: '2024-01-25',
                    descripcion: 'tardío',
                    origen_tipo: 'ajuste',
                })
                .returning('id')) as Array<{ id: number }>
            const cuentas = await trx
                .from('ledger.cuentas')
                .whereIn('codigo', ['1.1.02.01', '4.1.01'])
                .select('id', 'codigo')
            const id = (codigo: string) => cuentas.find((c) => c.codigo === codigo)!.id
            await trx
                .insertQuery()
                .table('ledger.movimientos')
                .multiInsert([
                    { asiento_id: a!.id, cuenta_id: id('1.1.02.01'), debe: '5.00', haber: '0.00' },
                    { asiento_id: a!.id, cuenta_id: id('4.1.01'), debe: '0.00', haber: '5.00' },
                ])
            await trx.rawQuery('ALTER TABLE ledger.movimientos ENABLE TRIGGER USER')
            await trx.rawQuery('ALTER TABLE ledger.asientos ENABLE TRIGGER USER')
        })
        assert.includeMembers(tardio, ['20.libro_emitido_distinto_del_mayor', '20.libro_emitido_cambio'])
        // enero reabierto después de emitir: ya no se exige el cuadre (la emisión era válida al emitirse)
        const reabierto = await fabricado(empresas, async (trx) => {
            const cierre = await trx
                .from('ledger.cierres_mensuales')
                .where({ empresa_id: e.B, periodo: '2024-01-01' })
                .firstOrFail()
            await trx
                .insertQuery()
                .table('ledger.reaperturas_mensuales')
                .insert({ cierre_id: cierre.id, motivo: 'auditoría' })
        })
        assert.notInclude(reabierto, '20.libro_emitido_sin_cierre_o_bloqueo')
        assert.notInclude(reabierto, '20.libro_emitido_cambio')
    })
})
