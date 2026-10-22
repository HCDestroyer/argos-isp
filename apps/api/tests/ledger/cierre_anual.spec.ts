import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { errorDe } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import ReabrirPeriodo from '#ledger/actions/reabrir_periodo'
import CerrarEjercicio from '#ledger/actions/cerrar_ejercicio'
import ReabrirEjercicio from '#ledger/actions/reabrir_ejercicio'
import BloquearDuro from '#ledger/actions/bloquear_duro'
import EditarParametro from '#fiscal/actions/editar_parametro'
import { balanceSaldos, estadoResultados } from '#ledger/estados_financieros'
import { balanceComprobacion } from '#ledger/comprobacion'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 6 · PR C (contrato de localización fiscal §9.1 y §10.8): cierre anual con la partida clásica
 * (ISR escrito por el usuario, cancelación contra 3.3.03, traslado a 3.3.01 y reserva legal),
 * reapertura del ejercicio y balance de comprobación antes y después del cierre. Cada prueba usa
 * empresas nuevas con la localización GT y termina en `afirmarLibro`.
 */

const ANIO = 2024

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
            descripcion: 'Movimiento de prueba (cierre anual)',
            origen_tipo: 'ajuste',
            movimientos: [
                { cuenta: debe, debe: monto },
                { cuenta: haber, haber: monto },
            ],
        },
        ctx,
    )
}

/** Ingresos 1000, gastos 300 y 50 de pagos trimestrales de ISR en el año. */
async function anioConMovimiento(ctx: ContextoAccion, empresaId: number, anio = ANIO) {
    await asiento(ctx, empresaId, `${anio}-03-10`, '1.1.02.01', '4.1.01', '1000.00')
    await asiento(ctx, empresaId, `${anio}-05-20`, '5.2.99', '1.1.02.01', '300.00')
    await asiento(ctx, empresaId, `${anio}-07-15`, '1.1.07', '1.1.02.01', '50.00')
}

async function cerrarMeses(ctx: ContextoAccion, empresaId: number, anio = ANIO, hasta = 11) {
    for (let mes = 1; mes <= hasta; mes++) {
        await new CerrarPeriodo().execute({ empresa_id: empresaId, anio, mes }, ctx)
    }
}

/** Saldo (debe − haber) de una cuenta al día, en el libro de la empresa. */
async function saldo(empresaId: number, codigo: string, hasta: string): Promise<string> {
    const fila = (await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.empresa_id', empresaId)
        .where('c.codigo', codigo)
        .where('a.fecha', '<=', hasta)
        .select(db.raw('coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text as s'))
        .firstOrFail()) as { s: string }
    return fila.s
}

/** Σ debe − haber de las cuentas que se reinician (ingresos y gastos) en el año. */
async function resultadosDelAnio(empresaId: number, anio = ANIO): Promise<string> {
    const fila = (await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.empresa_id', empresaId)
        .where('c.reinicia_anual', true)
        .whereBetween('a.fecha', [`${anio}-01-01`, `${anio}-12-31`])
        .select(db.raw('coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text as s'))
        .firstOrFail()) as { s: string }
    return fila.s
}

test.group('Fase 6 · cierre anual', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('cerrar el ejercicio: ISR, resultados en cero, traslado a 3.3.01, reserva legal y diciembre cerrado', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await anioConMovimiento(e.ctx, e.B)
        await cerrarMeses(e.ctx, e.B)

        const cierre = await new CerrarEjercicio().execute(
            {
                empresa_id: e.B,
                anio: ANIO,
                isr: { monto: '120.00', acreditado_trimestral: '50.00', nota: 'Cálculo del contador' },
            },
            e.ctx,
        )
        assert.equal(cierre.estado, 'cerrado')
        assert.deepEqual(
            [cierre.resultado_antes_isr, cierre.isr, cierre.resultado, cierre.reserva_legal],
            ['700.00', '120.00', '580.00', '29.00'],
        )
        assert.lengthOf(cierre.asientos, 5)

        const fin = `${ANIO}-12-31`
        assert.equal(await resultadosDelAnio(e.B), '0.00')
        for (const codigo of ['3.3.03', '3.3.02', '1.1.07']) {
            assert.equal(await saldo(e.B, codigo, fin), '0.00', codigo)
        }
        assert.equal(await saldo(e.B, '2.1.07', fin), '-70.00')
        assert.equal(await saldo(e.B, '3.3.01', fin), '-551.00')
        assert.equal(await saldo(e.B, '3.2.01', fin), '-29.00')

        // asientos en el diario de cierre, con fecha 31-dic, y diciembre cerrado
        const diarios = (await db
            .from('ledger.asientos as a')
            .join('ledger.asientos_numeros as n', 'n.asiento_id', 'a.id')
            .join('ledger.diarios as d', 'd.id', 'n.diario_id')
            .whereIn('a.id', cierre.asientos)
            .select('d.codigo', db.raw(`to_char(a.fecha, 'YYYY-MM-DD') as fecha`))) as Array<{
            codigo: string
            fecha: string
        }>
        assert.isTrue(diarios.every((d) => d.codigo === 'CIE' && d.fecha === fin))
        await assert.rejects(
            () => asiento(e.ctx, e.B, '2024-12-15', '5.2.99', '1.1.02.01', '1.00'),
            /cerrado/,
        )

        // el estado de resultados del año no muestra el asiento de cierre
        const er = await estadoResultados({ desde: `${ANIO}-01-01`, hasta: fin }, [e.B])
        assert.deepEqual(
            [er.total.totales.ingresos, er.total.totales.gastos, er.total.totales.resultado],
            ['1000.00', '420.00', '580.00'],
        )
        // balance del año siguiente sin resultado de ejercicios sin cerrar
        const balance = await balanceSaldos({ hasta: `${ANIO + 1}-06-30` }, [e.B])
        assert.equal(balance.empresas[0]!.totales.resultado_ejercicios_sin_cerrar, '0.00')
        assert.isTrue(balance.empresas[0]!.totales.cuadra)

        // evento y auditoría con el ISR escrito por el usuario
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'libro.ejercicio_cerrado')
            .whereRaw(`(payload->>'empresa_id')::bigint = ?`, [e.B])
            .firstOrFail()
        assert.deepInclude(evento.payload, {
            anio: ANIO,
            resultado: '580.00',
            isr: '120.00',
            reserva_legal: '29.00',
        })
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'libro.cerrar_ejercicio')
            .where('entidad_id', cierre.id)
            .firstOrFail()
        assert.equal(auditoria.entrada.isr.monto, '120.00')

        // repetir, reabrir un mes del año o revertir un asiento del cierre a mano: no
        const otra = await errorDe(
            new CerrarEjercicio().execute({ empresa_id: e.B, anio: ANIO, isr: { monto: '0.00' } }, e.ctx),
        )
        assert.deepEqual([otra.status, otra.codigo], [409, 'ejercicio_cerrado'])
        const mes = await errorDe(
            new ReabrirPeriodo().execute({ empresa_id: e.B, anio: ANIO, mes: 11, motivo: 'corregir' }, e.ctx),
        )
        assert.deepEqual([mes.status, mes.codigo], [409, 'ejercicio_cerrado'])
        const reverso = await errorDe(
            new RevertirAsiento().execute({ asiento_id: cierre.asientos[0]!, motivo: 'a mano' }, e.ctx),
        )
        assert.equal(reverso.codigo, 'reverso_por_documento')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('pérdida: sin reserva legal y la pérdida a utilidades acumuladas; reserva antes del ISR según el parámetro', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await asiento(e.ctx, e.B, `${ANIO}-02-01`, '1.1.02.01', '4.1.01', '200.00')
        await asiento(e.ctx, e.B, `${ANIO}-02-02`, '5.2.01', '1.1.02.01', '500.00')
        await cerrarMeses(e.ctx, e.B)
        const perdida = await new CerrarEjercicio().execute(
            { empresa_id: e.B, anio: ANIO, isr: { monto: '0.00' } },
            e.ctx,
        )
        assert.deepEqual([perdida.resultado, perdida.reserva_legal], ['-300.00', '0.00'])
        assert.lengthOf(perdida.asientos, 3)
        assert.equal(await saldo(e.B, '3.3.01', `${ANIO}-12-31`), '300.00')
        assert.equal(await saldo(e.B, '3.2.01', `${ANIO}-12-31`), '0.00')

        // C: la reserva sobre el resultado antes del ISR
        await new EditarParametro().execute(
            {
                clave: 'reserva_legal_base',
                valor: 'antes_isr',
                vigente_desde: `${ANIO}-01-01`,
                motivo: 'prueba del cierre anual',
                ambito: 'empresa',
                empresa_id: e.C,
            },
            e.ctx,
        )
        await anioConMovimiento(e.ctx, e.C)
        await cerrarMeses(e.ctx, e.C)
        const antes = await new CerrarEjercicio().execute(
            { empresa_id: e.C, anio: ANIO, isr: { monto: '120.00' } },
            e.ctx,
        )
        // 5 % de 700.00 (antes del ISR); sin acreditar, todo el ISR queda por pagar
        assert.deepEqual([antes.resultado, antes.reserva_legal], ['580.00', '35.00'])
        assert.equal(await saldo(e.C, '2.1.07', `${ANIO}-12-31`), '-120.00')
        assert.equal(await saldo(e.C, '1.1.07', `${ANIO}-12-31`), '50.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('requisitos: meses abiertos, diciembre cerrado, ejercicio anterior abierto e ISR obligatorio y acreditable', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await anioConMovimiento(e.ctx, e.B)
        const meses = await errorDe(
            new CerrarEjercicio().execute({ empresa_id: e.B, anio: ANIO, isr: { monto: '0.00' } }, e.ctx),
        )
        assert.deepEqual([meses.status, meses.codigo], [422, 'ejercicio_requisitos'])
        assert.include(meses.reglas, 'meses_abiertos')

        await cerrarMeses(e.ctx, e.B)
        const sinIsr = await errorDe(
            new CerrarEjercicio().execute({ empresa_id: e.B, anio: ANIO, isr: { monto: '' } }, e.ctx),
        )
        assert.deepEqual([sinIsr.status, sinIsr.reglas], [422, ['isr_obligatorio']])
        const demas = await errorDe(
            new CerrarEjercicio().execute(
                { empresa_id: e.B, anio: ANIO, isr: { monto: '40.00', acreditado_trimestral: '60.00' } },
                e.ctx,
            ),
        )
        // 60 > 50 de saldo en 1.1.07 y 60 > 40 de ISR
        assert.deepEqual(demas.reglas, ['isr_acreditable', 'isr_acreditable'])

        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: ANIO, mes: 12 }, e.ctx)
        const diciembre = await errorDe(
            new CerrarEjercicio().execute({ empresa_id: e.B, anio: ANIO, isr: { monto: '0.00' } }, e.ctx),
        )
        assert.deepEqual(diciembre.reglas, ['diciembre_cerrado'])

        // C: con 2023 sin cerrar no se cierra 2024
        await asiento(e.ctx, e.C, '2023-06-01', '1.1.02.01', '4.1.03', '10.00')
        await cerrarMeses(e.ctx, e.C)
        const anterior = await errorDe(
            new CerrarEjercicio().execute({ empresa_id: e.C, anio: ANIO, isr: { monto: '0.00' } }, e.ctx),
        )
        assert.deepEqual(anterior.reglas, ['ejercicio_anterior_abierto'])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('reabrir: solo admin, reabre diciembre, revierte el cierre al 31-dic y se vuelve a cerrar; bajo el duro no', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await anioConMovimiento(e.ctx, e.B)
        await cerrarMeses(e.ctx, e.B)
        const primero = await new CerrarEjercicio().execute(
            { empresa_id: e.B, anio: ANIO, isr: { monto: '120.00', acreditado_trimestral: '50.00' } },
            e.ctx,
        )
        const cuerpo = { empresa_id: e.B, anio: ANIO, motivo: 'Gasto de diciembre omitido' }
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        await estado(
            client
                .post('/api/v1/libro/ejercicios/reabrir')
                .bearerToken(contador)
                .header('X-Empresa-Id', String(e.B))
                .json(cuerpo),
            403,
        )
        const reabierto = await estado(
            client
                .post('/api/v1/libro/ejercicios/reabrir')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .json(cuerpo),
            200,
        )
        assert.equal(reabierto.body().estado, 'reabierto')
        assert.equal(reabierto.body().motivo_reapertura, 'Gasto de diciembre omitido')
        assert.lengthOf(reabierto.body().asientos, 10)

        // el libro del 31-dic vuelve a como estaba antes del cierre
        const fin = `${ANIO}-12-31`
        assert.equal(await resultadosDelAnio(e.B), '-700.00')
        for (const codigo of ['3.3.01', '3.2.01', '2.1.07']) {
            assert.equal(await saldo(e.B, codigo, fin), '0.00', codigo)
        }
        assert.equal(await saldo(e.B, '1.1.07', fin), '50.00')
        const otraVez = await errorDe(
            new ReabrirEjercicio().execute({ ...cuerpo, motivo: 'otra vez' }, e.ctx),
        )
        assert.equal(otraVez.codigo, 'ejercicio_abierto')

        // diciembre abierto: el gasto omitido y el cierre nuevo
        await asiento(e.ctx, e.B, '2024-12-20', '5.2.99', '1.1.02.01', '100.00')
        const segundo = await new CerrarEjercicio().execute(
            { empresa_id: e.B, anio: ANIO, isr: { monto: '90.00', acreditado_trimestral: '50.00' } },
            e.ctx,
        )
        assert.notEqual(segundo.id, primero.id)
        assert.deepEqual([segundo.resultado_antes_isr, segundo.resultado], ['600.00', '510.00'])
        assert.equal(await resultadosDelAnio(e.B), '0.00')
        assert.equal(await saldo(e.B, '3.3.01', fin), '-484.50')
        const er = await estadoResultados({ desde: `${ANIO}-01-01`, hasta: fin }, [e.B])
        assert.equal(er.total.totales.resultado, '510.00')

        // con el bloqueo duro sobre el 31-dic no se reabre
        await new BloquearDuro().execute(
            {
                empresa_id: e.B,
                hasta: fin,
                motivo: 'Libros entregados',
                confirmacion: `BLOQUEO DURO hasta ${fin}`,
            },
            e.ctx,
        )
        const duro = await errorDe(new ReabrirEjercicio().execute({ ...cuerpo, motivo: 'tarde' }, e.ctx))
        assert.deepEqual([duro.status, duro.codigo], [409, 'bloqueo_duro'])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('balance de comprobación por cuenta y grupo, antes y después del cierre; rutas de lectura', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await anioConMovimiento(e.ctx, e.B)
        await cerrarMeses(e.ctx, e.B)
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        const cerrado = await estado(
            client
                .post('/api/v1/libro/ejercicios/cerrar')
                .bearerToken(contador)
                .header('X-Empresa-Id', String(e.B))
                .json({ anio: ANIO, isr: { monto: '0.00' } }),
            201,
        )
        assert.equal(cerrado.body().resultado, '700.00')

        const fin = `${ANIO}-12-31`
        const antes = await balanceComprobacion(
            { desde: `${ANIO}-01-01`, hasta: fin, sin_cierre_anual: true },
            [e.B],
        )
        const despues = await balanceComprobacion({ desde: `${ANIO}-01-01`, hasta: fin }, [e.B])
        const cuenta = (r: typeof antes, codigo: string) =>
            r.empresas[0]!.cuentas.find((c) => c.codigo === codigo)
        assert.equal(cuenta(antes, '4.1.01')?.saldo_final_acreedor, '1000.00')
        assert.equal(cuenta(despues, '4.1.01')?.saldo_final_acreedor, '0.00')
        assert.equal(cuenta(despues, '3.3.01')?.saldo_final_acreedor, '665.00')
        assert.isUndefined(cuenta(antes, '3.3.01'))
        assert.isTrue(antes.empresas[0]!.totales.cuadra)
        assert.isTrue(despues.empresas[0]!.totales.cuadra)
        const grupo = despues.empresas[0]!.grupos.find((g) => g.codigo === '4')
        assert.deepEqual([grupo?.nivel, grupo?.debe, grupo?.haber], [1, '1000.00', '1000.00'])

        // saldo inicial del año siguiente: solo cuentas de balance
        const siguiente = await balanceComprobacion(
            { desde: `${ANIO + 1}-01-01`, hasta: `${ANIO + 1}-01-31` },
            [e.B],
        )
        assert.isUndefined(siguiente.empresas[0]!.cuentas.find((c) => c.codigo.startsWith('4')))
        assert.isTrue(siguiente.empresas[0]!.totales.cuadra)

        const http = await estado(
            client
                .get('/api/v1/libro/comprobacion')
                .bearerToken(contador)
                .header('X-Empresa-Id', String(e.B))
                .qs({ desde: `${ANIO}-01-01`, hasta: fin, sin_cierre_anual: true }),
            200,
        )
        assert.isTrue(http.body().sin_cierre_anual)
        const lista = await estado(
            client.get('/api/v1/libro/ejercicios').bearerToken(contador).header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.deepEqual(
            lista.body().data.map((c: { anio: number; estado: string }) => [c.anio, c.estado]),
            [[ANIO, 'cerrado']],
        )
        const uno = await estado(
            client
                .get(`/api/v1/libro/ejercicios/${cerrado.body().id}`)
                .bearerToken(contador)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.lengthOf(uno.body().asientos, 4)
        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post('/api/v1/libro/ejercicios/cerrar')
                .bearerToken(cajero)
                .header('X-Empresa-Id', String(e.B))
                .json({ anio: ANIO + 1, isr: { monto: '0.00' } }),
            403,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})
