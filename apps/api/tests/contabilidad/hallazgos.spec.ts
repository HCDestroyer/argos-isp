import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import { libroDiario } from '#ledger/consultas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import { prepararEmpresas, saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · HALLAZGOS. Cada prueba es el escenario mínimo que rompe un invariante con el
 * código actual. Se dejan fallando a propósito (decisión del PM: la contabilidad al 100 %); el
 * mensaje dice qué cifra no cuadra y qué archivo de producto revisar. No se ajustan para que pasen:
 * se ponen en verde arreglando el producto.
 */

test.group('Auditor contable · hallazgos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('H1 · nota de crédito: acreditar una factura completa con notas deja IVA débito residual', async ({
        assert,
    }) => {
        // Producto: app/billing/notas_credito.ts (repartirProporcional) y app/billing/actions/emitir_nota_credito.ts.
        // Cada nota toma IVA = round(iva_factura × monto / total); con notas pequeñas el IVA se redondea a 0
        // y la última (el resto) no recoge lo que faltó. La factura queda en 0 pero 2.1.02 no.
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-09-01', { precio: '199.99', instalacion: '2026-09-01' })
        const factura = s.facturas[0]!
        assert.equal(factura.iva, '21.43')
        for (let i = 0; i < 10; i++) {
            await new EmitirNotaCredito().execute(
                { factura_id: factura.id, monto: '0.04', motivo: `ajuste de centavos ${i}` },
                e.ctx,
            )
        }
        await new EmitirNotaCredito().execute(
            { factura_id: factura.id, monto: '199.59', motivo: 'resto' },
            e.ctx,
        )
        const notas = await db
            .from('billing.notas_credito')
            .where('factura_id', factura.id)
            .select(db.raw('sum(monto)::text as monto'), db.raw('sum(iva)::text as iva'))
            .firstOrFail()
        assert.equal(notas.monto, '199.99')
        assert.equal(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId), '0.00')
        const ivaLibro = await saldoCuenta(e.B, CUENTAS.IVA_DEBITO)
        const ingresos = await saldoCuenta(e.B, CUENTAS.INGRESOS_INTERNET)
        assert.deepEqual(
            { iva_notas: notas.iva, iva_debito_en_libro: ivaLibro, ingresos_en_libro: ingresos },
            { iva_notas: '21.43', iva_debito_en_libro: '0.00', ingresos_en_libro: '0.00' },
            `Factura ${factura.id} (Q199.99, IVA 21.43) acreditada al 100 % con 10 notas de Q0.04 y una de Q199.59: ` +
                `Σ IVA de las notas = ${notas.iva}; quedan en el libro (debe − haber) IVA débito ${ivaLibro} (2.1.02) ` +
                `e ingresos ${ingresos} (4.1.01) sobre una venta anulada por completo. ` +
                'La nota que deja la factura en cero debería llevar el resto exacto de cada cuenta del asiento original.',
        )
    })

    test('H2 · pago de terceros anulado: el anticipo del dueño de la factura queda sin aplicar a su deuda', async ({
        assert,
    }) => {
        // Producto: app/billing/actions/anular_pago.ts (solo `aplicarAnticipos(t, pago.cliente_id, …)`, el pagador).
        // README de billing: "Anticipos previos primero: no puede quedar saldo a favor mientras haya deuda".
        const e = await prepararEmpresas()
        const dueno = await servicioFacturado(e.B, '2026-09-01', {
            precio: '150.00',
            instalacion: '2026-09-01',
        })
        const pagador = await servicioFacturado(e.B, '2026-09-01', {
            precio: '150.00',
            instalacion: '2026-09-01',
        })
        const factura = dueno.facturas[0]!
        // el pagador cubre la factura del dueño
        const tercero = await new RegistrarPago().execute(
            {
                cliente_id: pagador.clienteId,
                metodo: 'caja',
                monto: '150.00',
                facturas: [factura.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        // el dueño, sin deuda, deja Q50 a favor
        await new RegistrarPago().execute(
            { cliente_id: dueno.clienteId, metodo: 'caja', monto: '50.00', empresa_id: e.B },
            e.ctx,
        )
        await new AnularPago().execute({ pago_id: tercero.id, motivo: 'pago de terceros equivocado' }, e.ctx)
        const todas = await verificarLibro(e.B)
        const violaciones = todas.filter((v) => v.invariante.startsWith('3.anticipo_sin_aplicar'))
        assert.deepEqual(
            violaciones,
            [],
            `Cliente ${dueno.clienteId}: tras anular el pago ${tercero.id} del cliente ${pagador.clienteId}, ` +
                `la factura ${factura.id} vuelve a deber Q150.00 y el cliente conserva Q50.00 en 2.1.01 Anticipos sin aplicar. ` +
                `Anticipos del dueño = ${await saldoCuenta(e.B, CUENTAS.ANTICIPOS_CLIENTES, dueno.clienteId)} (saldo deudor), ` +
                `CxC del dueño = ${await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, dueno.clienteId)}.`,
        )
    })

    test('H3 · un turno de caja cerrado se puede modificar en la base (UPDATE de contado y diferencia)', async ({
        assert,
    }) => {
        // Producto: database/migrations (ledger.cajas_turnos sin trigger de inmutabilidad; argosisp_app con UPDATE/DELETE).
        const e = await prepararEmpresas()
        const turno = await new CerrarCaja().execute({ caja_id: e.cajas.get(e.B)!, contado: '100.00' }, e.ctx)
        const trx = await db.transaction()
        let error: string | null = null
        try {
            await trx.rawQuery(
                `UPDATE ledger.cajas_turnos SET contado = contado + 1, diferencia = diferencia + 1, motivo = 'alterado' WHERE id = ?`,
                [turno.id],
            )
        } catch (fallo) {
            error = (fallo as Error).message
        } finally {
            await trx.rollback()
        }
        const permisos = await db.rawQuery(
            `SELECT has_table_privilege('argosisp_app', 'ledger.cajas_turnos', 'UPDATE') AS u,
                    has_table_privilege('argosisp_app', 'ledger.cajas_turnos', 'DELETE') AS d
               FROM pg_roles WHERE rolname = 'argosisp_app'`,
        )
        assert.isNotNull(
            error,
            `La base aceptó cambiar contado (100.00 → 101.00) y diferencia (0.00 → 1.00) del turno ${turno.id} ya cerrado; ` +
                `argosisp_app tiene UPDATE=${permisos.rows[0]?.u} y DELETE=${permisos.rows[0]?.d} sobre ledger.cajas_turnos. ` +
                'Regla 4: lo que mueve dinero no se edita. Falta un trigger que rechace UPDATE/DELETE de un turno con cerrado_en ' +
                '(y que el cierre solo pueda hacerse una vez).',
        )
    })

    test('H4 · numeración del diario: un asiento con fecha anterior renumera las partidas existentes', async ({
        assert,
    }) => {
        // Producto: app/ledger/consultas.ts (libroDiario ordena por id, sin número propio) y el contrato de
        // localización fiscal §7 (el Libro Diario numera la partida por (fecha, id)). No hay un correlativo
        // almacenado en ledger.asientos: el número de partida sale del orden y cambia con un asiento anterior.
        const e = await prepararEmpresas()
        await servicioFacturado(e.B, '2026-10-01', { precio: '150.00', instalacion: '2026-10-01' })
        const columnas = await db.rawQuery(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'ledger' AND table_name = 'asientos'
                AND column_name IN ('numero', 'partida', 'correlativo', 'numero_partida')`,
        )
        const partidas = async () => {
            const resultado = await db.rawQuery(
                `SELECT id, row_number() OVER (ORDER BY fecha, id)::int AS partida
                   FROM ledger.asientos WHERE empresa_id = ? ORDER BY id`,
                [e.B],
            )
            return resultado.rows as Array<{ id: number; partida: number }>
        }
        const antes = await partidas()
        // asiento manual con fecha de septiembre (mes abierto) después de los de octubre
        await new RegistrarAsiento().execute(
            {
                empresa_id: e.B,
                fecha: '2026-09-15',
                descripcion: 'auditoría: gasto olvidado de septiembre',
                origen_tipo: 'ajuste',
                movimientos: [
                    { cuenta: CUENTAS.GASTO_OTROS, debe: '10.00' },
                    { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: '10.00' },
                ],
            },
            e.ctx,
        )
        const nuevas = await partidas()
        const despues = new Map(nuevas.map((p) => [Number(p.id), p.partida]))
        const renumeradas = antes.filter((p) => despues.get(Number(p.id)) !== p.partida)
        const diario = await libroDiario({ limit: 100 }, [e.B])
        assert.isTrue(diario.data.length > 0)
        assert.deepEqual(
            {
                columna_de_numero: columnas.rows.map((c: { column_name: string }) => c.column_name),
                renumeradas: renumeradas.length,
            },
            { columna_de_numero: ['numero'], renumeradas: 0 },
            `ledger.asientos no guarda número de partida; con el orden del Libro Diario (fecha, id) un asiento del ` +
                `2026-09-15 registrado el ${hoyGuatemala()} cambió el número de ${renumeradas.length} partidas existentes ` +
                `(${renumeradas.map((p) => `asiento ${p.id}: ${p.partida} → ${despues.get(Number(p.id))}`).join(', ')}). ` +
                'Hace falta un correlativo almacenado al insertar, único por (empresa, diario, año).',
        )
    })
})
