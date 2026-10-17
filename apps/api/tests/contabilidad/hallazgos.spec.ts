import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import ReabrirPeriodo from '#ledger/actions/reabrir_periodo'
import { libroDiario } from '#ledger/consultas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import {
    errorDe,
    prepararEmpresas,
    saldoCuenta,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
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

    test('H4 · numeración del diario: un asiento con fecha anterior no cambia el número guardado de los existentes', async ({
        assert,
    }) => {
        // Contrato de localización fiscal §10.7: el número de diario se asigna al INSERTAR y se guarda en
        // ledger.asientos_numeros (asiento_id PK, diario_id, anio, numero; único diario_id, anio, numero),
        // solo inserción. Se mide lo guardado antes y después de registrar un asiento con fecha anterior
        // en un mes abierto: ningún asiento existente cambia de número.
        // Producto: migración y acción de numeración de A3 (app/ledger/actions/registrar_asiento.ts).
        assert.isTrue(
            await existeTabla('ledger.asientos_numeros'),
            'Falta ledger.asientos_numeros (contrato §10.7): los asientos no tienen número de diario guardado; ' +
                'hoy la partida del Libro Diario sale del orden (fecha, id) y un asiento con fecha anterior renumera.',
        )
        const e = await prepararEmpresas()
        await servicioFacturado(e.B, '2026-10-01', { precio: '150.00', instalacion: '2026-09-01' })
        const antes = await numerosDeDiario(e.B)
        assert.isAbove(antes.size, 0)
        const diarioAntes = await numerosDelLibroDiario(e.B)

        const tardio = await new RegistrarAsiento().execute(
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
        const despues = await numerosDeDiario(e.B)
        const cambiados = [...antes].filter(([id, numero]) => despues.get(id) !== numero)
        assert.deepEqual(
            cambiados.map(([id, numero]) => `asiento ${id}: ${numero} → ${despues.get(id) ?? 'sin número'}`),
            [],
            `Un asiento del 2026-09-15 registrado el ${hoyGuatemala()} cambió el número guardado de asientos existentes.`,
        )
        assert.isTrue(
            despues.has(Number(tardio.id)),
            `el asiento ${tardio.id} no recibió número al insertarse`,
        )
        const repetidos = await db.rawQuery(
            `SELECT diario_id, anio, numero, count(*)::int AS n FROM ledger.asientos_numeros
              GROUP BY 1, 2, 3 HAVING count(*) > 1`,
        )
        assert.deepEqual(repetidos.rows, [], 'números de diario repetidos')
        // si el Libro Diario expone un número, tampoco cambia
        const diarioDespues = await numerosDelLibroDiario(e.B)
        for (const [id, numero] of diarioAntes) {
            assert.equal(
                diarioDespues.get(id),
                numero,
                `GET /libro/diario cambió el número del asiento ${id}`,
            )
        }
    })

    test('H4 · partida legal: al cerrar el mes es correlativa en orden cronológico y reabrir y volver a cerrar no la cambia', async ({
        assert,
    }) => {
        // Contrato §10.7: el correlativo de partida por empresa y año se guarda en ledger.asientos_partidas
        // al CERRAR el mes, en orden (fecha, numero); el mes cerrado no admite asientos, así que nunca se
        // renumera. El contrato no dice qué pasa con un asiento nuevo tras reabrir (queda para el contador);
        // aquí se exige lo que sí dice: reabrir y volver a cerrar sin cambios deja las mismas partidas.
        assert.isTrue(
            await existeTabla('ledger.asientos_partidas'),
            'Falta ledger.asientos_partidas (contrato §10.7): el Libro Diario no tiene partida legal guardada al cerrar el mes.',
        )
        const columna = await columnaPartida()
        assert.isNotNull(columna, 'ledger.asientos_partidas sin columna de correlativo (partida o numero)')
        const e = await prepararEmpresas()
        // septiembre con asientos registrados fuera de orden de fecha
        for (const [fecha, monto] of [
            ['2026-09-20', '20.00'],
            ['2026-09-05', '5.00'],
            ['2026-09-12', '12.00'],
            ['2026-09-05', '5.50'],
        ] as const) {
            await new RegistrarAsiento().execute(
                {
                    empresa_id: e.B,
                    fecha,
                    descripcion: `auditoría: gasto del ${fecha}`,
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: CUENTAS.GASTO_OTROS, debe: monto },
                        { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: monto },
                    ],
                },
                e.ctx,
            )
        }
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9 }, e.ctx)
        const primera = await partidasDe(e.B, columna!)
        assert.lengthOf(primera, 4, 'cada asiento del mes cerrado tiene exactamente una partida')
        assert.deepEqual(
            primera.map((p) => p.partida),
            [1, 2, 3, 4],
            'partidas correlativas desde 1 en una empresa nueva',
        )
        const fechas = primera.map((p) => p.fecha)
        assert.deepEqual(fechas, [...fechas].sort(), 'la partida sigue el orden cronológico')

        await new ReabrirPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9, motivo: 'revisión' }, e.ctx)
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9 }, e.ctx)
        assert.deepEqual(
            await partidasDe(e.B, columna!),
            primera,
            'reabrir y volver a cerrar cambió las partidas',
        )
    })
    test('H4 · reabrir septiembre con octubre ya cerrado (con partidas) responde 409 reapertura_fuera_de_orden', async ({
        assert,
    }) => {
        // Decisión del líder: solo se reabre un mes si ningún mes posterior del mismo año tiene partidas.
        assert.isTrue(
            await existeTabla('ledger.asientos_partidas'),
            'Falta ledger.asientos_partidas (contrato §10.7).',
        )
        const e = await prepararEmpresas()
        await gastoDel(e, '2026-09-10', '10.00')
        await gastoDel(e, '2026-10-02', '20.00')
        const enNoviembre = new Date('2026-11-05T12:00:00-06:00')
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9, ahora: enNoviembre }, e.ctx)
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 10, ahora: enNoviembre }, e.ctx)
        const columna = await columnaPartida()
        const antes = await partidasDe(e.B, columna!)
        const error = await errorDe(
            new ReabrirPeriodo().execute(
                { empresa_id: e.B, anio: 2026, mes: 9, motivo: 'fuera de orden' },
                e.ctx,
            ),
        )
        assert.equal(error.status, 409, error.detalle)
        assert.equal(error.codigo, 'reapertura_fuera_de_orden', error.detalle)
        assert.deepEqual(await partidasDe(e.B, columna!), antes)
    })

    test('H4 · septiembre reabierto: el asiento nuevo recibe la partida siguiente al final del mes y las anteriores no cambian', async ({
        assert,
    }) => {
        // Decisión del líder: las partidas asignadas no cambian; los asientos nuevos del mes reciben, al
        // volver a cerrar, las partidas siguientes al final de la secuencia de ese mes (aunque su fecha sea anterior).
        assert.isTrue(
            await existeTabla('ledger.asientos_partidas'),
            'Falta ledger.asientos_partidas (contrato §10.7).',
        )
        const e = await prepararEmpresas()
        await gastoDel(e, '2026-09-10', '10.00')
        await gastoDel(e, '2026-09-20', '20.00')
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9 }, e.ctx)
        const columna = await columnaPartida()
        const antes = await partidasDe(e.B, columna!)
        assert.deepEqual(
            antes.map((p) => p.partida),
            [1, 2],
        )
        // octubre sigue abierto: reabrir septiembre se puede
        await new ReabrirPeriodo().execute(
            { empresa_id: e.B, anio: 2026, mes: 9, motivo: 'faltó un gasto' },
            e.ctx,
        )
        const nuevo = await gastoDel(e, '2026-09-03', '3.00')
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9 }, e.ctx)
        const despues = await partidasDe(e.B, columna!)
        assert.deepEqual(
            despues.filter((p) => Number(p.asiento_id) !== Number(nuevo.id)),
            antes,
            'las partidas ya asignadas cambiaron',
        )
        const delNuevo = despues.find((p) => Number(p.asiento_id) === Number(nuevo.id))
        assert.equal(
            delNuevo?.partida,
            3,
            `el asiento ${nuevo.id} debe quedar con la partida 3 (al final del mes)`,
        )
        assert.lengthOf(despues, 3)
    })
})

async function existeTabla(tabla: string): Promise<boolean> {
    const fila = await db.rawQuery(`SELECT to_regclass(?) IS NOT NULL AS existe`, [tabla])
    return Boolean(fila.rows[0]?.existe)
}

/** asiento_id → "diario/año/número" guardado en ledger.asientos_numeros. */
async function numerosDeDiario(empresaId: number): Promise<Map<number, string>> {
    const resultado = await db.rawQuery(
        `SELECT n.asiento_id, n.diario_id, n.anio, n.numero
           FROM ledger.asientos_numeros n JOIN ledger.asientos a ON a.id = n.asiento_id
          WHERE a.empresa_id = ?`,
        [empresaId],
    )
    const filas = resultado.rows as Array<{
        asiento_id: number
        diario_id: number
        anio: number
        numero: number
    }>
    return new Map(filas.map((f) => [Number(f.asiento_id), `${f.diario_id}/${f.anio}/${f.numero}`]))
}

/** Número que expone el Libro Diario por asiento (`numero` o `partida`), si lo expone. */
async function numerosDelLibroDiario(empresaId: number): Promise<Map<number, unknown>> {
    const diario = await libroDiario({ limit: 100 }, [empresaId])
    const mapa = new Map<number, unknown>()
    for (const asiento of diario.data as Array<Record<string, unknown>>) {
        const numero = asiento.numero ?? asiento.partida
        if (numero !== undefined && numero !== null) mapa.set(Number(asiento.id), numero)
    }
    return mapa
}

async function columnaPartida(): Promise<string | null> {
    const resultado = await db.rawQuery(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'ledger' AND table_name = 'asientos_partidas'
            AND column_name IN ('partida', 'numero', 'correlativo') ORDER BY column_name DESC LIMIT 1`,
    )
    return resultado.rows[0]?.column_name ?? null
}

async function partidasDe(empresaId: number, columna: string) {
    const resultado = await db.rawQuery(
        `SELECT p.asiento_id, p.${columna}::int AS partida, to_char(a.fecha, 'YYYY-MM-DD') AS fecha
           FROM ledger.asientos_partidas p JOIN ledger.asientos a ON a.id = p.asiento_id
          WHERE a.empresa_id = ? ORDER BY p.${columna}`,
        [empresaId],
    )
    return resultado.rows as Array<{ asiento_id: number; partida: number; fecha: string }>
}

/** Gasto manual con fecha dada en la empresa B (Gasto / Banco principal). */
function gastoDel(e: Awaited<ReturnType<typeof prepararEmpresas>>, fecha: string, monto: string) {
    return new RegistrarAsiento().execute(
        {
            empresa_id: e.B,
            fecha,
            descripcion: `auditoría: gasto del ${fecha}`,
            origen_tipo: 'ajuste',
            movimientos: [
                { cuenta: CUENTAS.GASTO_OTROS, debe: monto },
                { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: monto },
            ],
        },
        e.ctx,
    )
}
