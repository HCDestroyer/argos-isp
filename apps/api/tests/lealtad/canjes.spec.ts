import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { generar } from '#tests/billing/ayudas_billing'
import { crearPlanFila } from '#tests/core/fabricas'
import {
    errorDe,
    facturasDelServicio,
    prepararEmpresas,
    saldoCuenta,
    servicioEn,
} from '#tests/contabilidad/ayudas_contabilidad'
import { hoyGuatemala } from '#ledger/fechas'
import { saldoPuntos } from '#lealtad/puntos'
import { sumarMeses } from '#lealtad/condiciones'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import EditarPrograma from '#lealtad/actions/editar_programa'
import CrearPremio, { type EntradaPremio } from '#lealtad/actions/crear_premio'
import Canjear from '#lealtad/actions/canjear'
import RevertirCanje from '#lealtad/actions/revertir_canje'
import AnularFactura from '#billing/actions/anular_factura'
import RegistrarPago from '#billing/actions/registrar_pago'
import { lineas as lineasAsiento } from '#tests/contabilidad/ayudas_contabilidad'
import {
    afirmarPasivoLealtad,
    asientoLealtad,
    movimientosDe,
    programaConReglas,
} from '#tests/lealtad/ayudas_lealtad'

/**
 * Lealtad fase 2 · canjes (contrato §5, §6 y §10): los puntos salen al canjear consumiendo los lotes
 * que vencen antes, con el asiento `2.1.10 / 4.1.06`; revertir los devuelve con su vencimiento
 * original; la mejora de plan usa el plan temporal de A1 y falla entera si no se puede.
 */

type Empresas = Awaited<ReturnType<typeof prepararEmpresas>>

async function conPuntos(
    e: Empresas,
    puntos: number,
    programa: Parameters<typeof programaConReglas>[2] = {},
) {
    const { programa: p } = await programaConReglas(e.B, e.ctx, { diferimiento: true, ...programa })
    const s = await servicioEn(e.B, { precio: '200.00', instalacion: '2026-10-01' })
    await new AjustarPuntos().execute(
        { empresa_id: e.B, cliente_id: s.clienteId, puntos, motivo: 'saldo inicial de la prueba' },
        e.ctx,
    )
    return { programa: p, ...s }
}

function premio(
    e: Empresas,
    programaId: number,
    datos: Partial<EntradaPremio> & Pick<EntradaPremio, 'tipo'>,
) {
    return new CrearPremio().execute(
        { programa_id: programaId, nombre: unico('Premio'), costo_puntos: 60, ...datos },
        e.ctx,
    )
}

/** Factura de noviembre pagada; canje de Q50 de descuento sobre ella; después se emite diciembre. */
async function canjeSobrePagada(e: Empresas) {
    const s = await conPuntos(e, 200)
    await generar(s.servicioId, '2026-11-01')
    const [octubre, noviembre] = await facturasDelServicio(s.servicioId)
    for (const f of [octubre!, noviembre!]) {
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: f.total, facturas: [f.id], empresa_id: e.B },
            e.ctx,
        )
    }
    const p = await premio(e, s.programa.id, {
        tipo: 'descuento_factura',
        descuento_tipo: 'monto',
        descuento_valor: '50.00',
        costo_puntos: 80,
    })
    const canje = await new Canjear().execute(
        { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: p.id, factura_id: noviembre!.id },
        e.ctx,
    )
    await generar(s.servicioId, '2026-12-01')
    const todas = await facturasDelServicio(s.servicioId)
    const diciembre = todas.at(-1)!
    return { s, canje, noviembre: noviembre!, diciembre }
}

test.group('Lealtad · canjes', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('mejora de plan: plan temporal de A1 con origen lealtad, puntos fuera con 2.1.10 / 4.1.06', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await conPuntos(e, 100)
        const mejor = await crearPlanFila({ precio: '300.00', bajada_kbps: 50000, subida_kbps: 10000 })
        const p = await premio(e, s.programa.id, { tipo: 'mejora_plan', plan_destino_id: mejor, dias: 30 })
        const canje = await new Canjear().execute(
            { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: p.id },
            e.ctx,
        )
        assert.equal(canje.estado, 'aplicado')
        assert.isNotNull(canje.plan_temporal_id)
        const temporal = await db
            .from('core.servicios_planes_temporales')
            .where('id', canje.plan_temporal_id!)
            .select('origen', 'origen_id', 'plan_id', 'estado')
            .firstOrFail()
        assert.deepInclude(temporal, { origen: 'lealtad', plan_id: mejor })
        assert.equal(Number(temporal.origen_id), canje.id)
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 40)
        assert.deepEqual(await asientoLealtad(canje.movimiento_id!), [
            ['2.1.10', '6.00', '0.00'],
            ['4.1.06', '0.00', '6.00'],
        ])
        assert.equal(await saldoCuenta(e.B, '2.1.10'), '-4.00')
        const aplicados = await db
            .from('audit.outbox')
            .where('evento', 'lealtad.canje_aplicado')
            .whereRaw(`(payload->>'canje_id')::bigint = ?`, [canje.id])
        assert.lengthOf(aplicados, 1)
        // aplicado: no se revierte
        const revertir = await errorDe(
            new RevertirCanje().execute({ id: canje.id, motivo: 'arrepentido' }, e.ctx),
        )
        assert.deepInclude(revertir, { status: 409, codigo: 'canje_no_revertible' })
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('mejora de plan incompatible: el canje falla entero (sin puntos fuera, sin canje, sin asiento)', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await conPuntos(e, 100)
        const incompatible = await crearPlanFila({ dual_stack: 'v6' })
        const p = await premio(e, s.programa.id, {
            tipo: 'mejora_plan',
            plan_destino_id: incompatible,
            dias: 30,
        })
        const error = await errorDe(
            new Canjear().execute(
                { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: p.id },
                e.ctx,
            ),
        )
        assert.equal(error.codigo, 'plan_temporal_incompatible')
        assert.lengthOf(await db.from('lealtad.canjes').where('premio_id', p.id), 0)
        assert.lengthOf(await movimientosDe(e.B, s.clienteId), 1)
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 100)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('descuento reservado: lote que vence antes primero; uno por servicio; revertir devuelve con su vencimiento', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await conPuntos(e, 40, { vencimiento_meses: 12 })
        const programa = await db
            .from('lealtad.programas')
            .where('id', s.programa.id)
            .select('version')
            .firstOrFail()
        await new EditarPrograma().execute(
            { id: s.programa.id, version: Number(programa.version), vencimiento_meses: 3 },
            e.ctx,
        )
        await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 30, motivo: 'lote corto' },
            e.ctx,
        )
        const p = await premio(e, s.programa.id, {
            tipo: 'descuento_factura',
            descuento_tipo: 'monto',
            descuento_valor: '50.00',
            costo_puntos: 50,
        })
        const canje = await new Canjear().execute(
            { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: p.id },
            e.ctx,
        )
        assert.equal(canje.estado, 'reservado')
        // 30 del lote de 3 meses y 20 del de 12
        const consumos = await db
            .from('lealtad.consumos as c')
            .join('lealtad.movimientos as l', 'l.id', 'c.lote_id')
            .where('c.movimiento_id', canje.movimiento_id!)
            .orderBy('c.id')
            .select('c.puntos', db.raw(`to_char(l.vence_en, 'YYYY-MM-DD') as vence_en`))
        const hoy = hoyGuatemala()
        assert.deepEqual(
            consumos.map((c) => [c.puntos, c.vence_en]),
            [
                [30, sumarMeses(hoy, 3)],
                [20, sumarMeses(hoy, 12)],
            ],
        )
        const otro = await errorDe(
            new Canjear().execute(
                { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: p.id },
                e.ctx,
            ),
        )
        assert.equal(otro.codigo, 'saldo_insuficiente')
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])

        const revertido = await new RevertirCanje().execute(
            { id: canje.id, motivo: 'el cliente lo pidió' },
            e.ctx,
        )
        assert.equal(revertido.estado, 'revertido')
        const movimientos = await movimientosDe(e.B, s.clienteId)
        const devueltos = movimientos.filter((m) => m.origen_tipo === 'canje' && m.puntos > 0)
        assert.deepEqual(
            devueltos.map((m) => [m.puntos, m.vence_en]),
            [
                [30, sumarMeses(hoy, 3)],
                [20, sumarMeses(hoy, 12)],
            ],
        )
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 70)
        const otraVez = await errorDe(
            new RevertirCanje().execute({ id: canje.id, motivo: 'otra vez' }, e.ctx),
        )
        assert.equal(otraVez.codigo, 'canje_no_revertible')
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('un descuento reservado por servicio (409 canje_pendiente); existencias; bien sin decisión del contador', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await conPuntos(e, 300)
        const descuento = await premio(e, s.programa.id, { tipo: 'mes_gratis', costo_puntos: 50 })
        await new Canjear().execute(
            { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: descuento.id },
            e.ctx,
        )
        const pendiente = await errorDe(
            new Canjear().execute(
                { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: descuento.id },
                e.ctx,
            ),
        )
        assert.deepInclude(pendiente, { status: 409, codigo: 'canje_pendiente' })

        const bien = await premio(e, s.programa.id, { tipo: 'bien', existencias: 1, costo_unitario: '80.00' })
        const sinDecision = await errorDe(
            new Canjear().execute(
                { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: bien.id },
                e.ctx,
            ),
        )
        assert.equal(sinDecision.codigo, 'parametro_sin_confirmar')

        const mejor = await crearPlanFila({ precio: '300.00' })
        const unico1 = await premio(e, s.programa.id, {
            tipo: 'mejora_plan',
            plan_destino_id: mejor,
            dias: 7,
            existencias: 0,
        })
        const agotado = await errorDe(
            new Canjear().execute(
                { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: unico1.id },
                e.ctx,
            ),
        )
        assert.deepInclude(agotado, { status: 409, codigo: 'sin_existencias' })
        // otra empresa: el servicio no es de la empresa del premio
        const ajeno = await servicioEn(e.C, { clienteId: s.clienteId })
        const otraEmpresa = await errorDe(
            new Canjear().execute(
                { cliente_id: s.clienteId, servicio_id: ajeno.servicioId, premio_id: descuento.id },
                e.ctx,
            ),
        )
        assert.equal(otraEmpresa.codigo, 'servicio_no_valido')
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('descuento sobre una factura emitida: nota de crédito por línea; fuera de los 2 meses, 422', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await conPuntos(e, 200)
        await generar(s.servicioId, '2026-11-01')
        const [octubre, noviembre] = await facturasDelServicio(s.servicioId)
        const p = await premio(e, s.programa.id, {
            tipo: 'descuento_factura',
            descuento_tipo: 'porcentaje',
            descuento_valor: '25',
            tope: '40.00',
            costo_puntos: 80,
        })
        const canje = await new Canjear().execute(
            {
                cliente_id: s.clienteId,
                servicio_id: s.servicioId,
                premio_id: p.id,
                factura_id: noviembre!.id,
            },
            e.ctx,
        )
        // 25 % de Q200 = Q50, con tope de Q40
        assert.include(canje, { estado: 'aplicado', descuento: '40.00', factura_id: noviembre!.id })
        const nota = await db.from('billing.notas_credito').where('id', canje.nota_credito_id!).firstOrFail()
        assert.equal(nota.monto, '40.00')
        const factura = await db
            .from('billing.facturas')
            .where('id', noviembre!.id)
            .select('pagado')
            .firstOrFail()
        assert.equal(factura.pagado, '40.00')

        await db
            .from('billing.facturas')
            .where('id', octubre!.id)
            .update({ emitida_en: new Date(Date.now() - 100 * 86_400_000) })
        const vieja = await errorDe(
            new Canjear().execute(
                {
                    cliente_id: s.clienteId,
                    servicio_id: s.servicioId,
                    premio_id: p.id,
                    factura_id: octubre!.id,
                },
                e.ctx,
            ),
        )
        assert.equal(vieja.codigo, 'nota_fuera_de_plazo')
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 120)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('descuento reservado: la próxima factura trae la línea con el IVA del neto y el canje queda aplicado', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await conPuntos(e, 100)
        const p = await premio(e, s.programa.id, {
            tipo: 'descuento_factura',
            descuento_tipo: 'monto',
            descuento_valor: '50.00',
            costo_puntos: 60,
        })
        const canje = await new Canjear().execute(
            { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: p.id },
            e.ctx,
        )
        assert.equal(canje.estado, 'reservado')
        await generar(s.servicioId, '2026-11-01')
        const [octubre, noviembre] = await facturasDelServicio(s.servicioId)
        assert.include(octubre!, { total: '150.00', iva: '16.07' })
        assert.include(noviembre!, { total: '200.00' })
        const lineasOct = await db
            .from('billing.facturas_lineas')
            .where('factura_id', octubre!.id)
            .orderBy('id')
            .select('tipo', 'total', 'iva')
        assert.deepEqual(
            lineasOct.map((l) => [l.tipo, l.total, l.iva]),
            [
                ['servicio', '200.00', '21.43'],
                ['descuento', '-50.00', '-5.36'],
            ],
        )
        assert.deepEqual(await lineasAsiento('factura', octubre!.id), [
            ['1.1.03', '150.00', '0.00'],
            ['5.1.01', '44.64', '0.00'],
            ['4.1.01', '0.00', '178.57'],
            ['2.1.02', '0.00', '16.07'],
        ])
        const aplicado = await db.from('lealtad.canjes').where('id', canje.id).firstOrFail()
        assert.include(aplicado, { estado: 'aplicado', descuento: '50.00' })
        assert.equal(Number(aplicado.factura_id), octubre!.id)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])

        // la factura se anula: el canje aplicado a ella se puede revertir y devuelve los puntos
        await new AnularFactura().execute({ factura_id: octubre!.id, motivo: 'error de plan' }, e.ctx)
        const revertido = await new RevertirCanje().execute(
            { id: canje.id, motivo: 'factura anulada' },
            e.ctx,
        )
        assert.equal(revertido.estado, 'revertido')
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 100)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('mejora de plan en la factura: cobra el plan superior con descuento hasta el precio del plan original', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await conPuntos(e, 100)
        const mejor = await crearPlanFila({ precio: '300.00', bajada_kbps: 50000, subida_kbps: 10000 })
        const p = await premio(e, s.programa.id, { tipo: 'mejora_plan', plan_destino_id: mejor, dias: 60 })
        const canje = await new Canjear().execute(
            { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: p.id },
            e.ctx,
        )
        await generar(s.servicioId, '2026-10-01')
        const [octubre] = await facturasDelServicio(s.servicioId)
        assert.include(octubre!, { total: '200.00' })
        const filas = await db
            .from('billing.facturas_lineas')
            .where('factura_id', octubre!.id)
            .orderBy('id')
            .select('tipo', 'total', 'concepto')
        assert.deepEqual(
            filas.map((l) => [l.tipo, l.total]),
            [
                ['servicio', '300.00'],
                ['descuento', '-100.00'],
            ],
        )
        assert.include(filas[1]!.concepto, `canje ${canje.id}`)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('descuento sobre una factura pagada: nota de crédito completa y el excedente a Anticipos para la próxima', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { s, canje, noviembre, diciembre } = await canjeSobrePagada(e)
        assert.include(canje, { estado: 'aplicado', descuento: '50.00' })
        const nota = await db.from('billing.notas_credito').where('id', canje.nota_credito_id!).firstOrFail()
        assert.include(nota, { monto: '50.00', a_favor: '50.00' })
        // la nota rebaja venta e IVA completos; el crédito queda en Anticipos y paga diciembre al emitirse
        assert.includeDeepMembers(
            await lineasAsiento('nota_credito', nota.id).then((lista) => lista.map((l) => [...l])),
            [
                ['4.1.01', '44.64', '0.00'],
                ['2.1.02', '5.36', '0.00'],
                ['2.1.01', '0.00', '50.00'],
            ],
        )
        const factura = await db.from('billing.facturas').where('id', noviembre.id).firstOrFail()
        assert.include(factura, { estado: 'pagada', pagado: '200.00' })
        const dic = await db.from('billing.facturas').where('id', diciembre.id).firstOrFail()
        assert.equal(dic.pagado, '50.00')
        const aplicaciones = await db
            .from('billing.notas_credito_aplicaciones')
            .where('nota_credito_id', nota.id)
        assert.lengthOf(aplicaciones, 1)
        assert.equal(await saldoCuenta(e.B, '2.1.01', s.clienteId), '0.00')
        await afirmarPasivoLealtad(assert, [e.B, e.C])
    })

    test('descuento sobre una factura pagada: el libro cuadra con el saldo a favor de la nota', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await canjeSobrePagada(e)
        await afirmarLibro(assert, [e.B, e.C])
    }).fails(
        'H-lealtad-nota-a-favor: los invariantes 3 y 5 del auditor aún no cuentan el saldo a favor de las notas de crédito (notas_credito.a_favor y notas_credito_aplicaciones)',
    )

    test('HTTP: canje con Idempotency-Key no se duplica; cajero canjea y no revierte', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await conPuntos(e, 100)
        const p = await premio(e, s.programa.id, { tipo: 'mes_gratis', costo_puntos: 30 })
        const cajero = await usuarioConRoles(['cajero'])
        const clave = unico('canje')
        const cuerpo = { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: p.id }
        const primero = await estado(
            client
                .post('/api/v1/lealtad/canjes')
                .bearerToken(cajero.token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', clave)
                .json(cuerpo),
            201,
        )
        const segundo = await estado(
            client
                .post('/api/v1/lealtad/canjes')
                .bearerToken(cajero.token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', clave)
                .json(cuerpo),
            201,
        )
        assert.equal(segundo.body().id, primero.body().id)
        assert.lengthOf(await db.from('lealtad.canjes').where('premio_id', p.id), 1)
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 70)
        await estado(
            client
                .post(`/api/v1/lealtad/canjes/${primero.body().id}/revertir`)
                .bearerToken(cajero.token)
                .header('X-Empresa-Id', String(e.B))
                .json({ motivo: 'no autorizado' }),
            403,
        )
        const lista = await estado(
            client
                .get('/api/v1/lealtad/canjes')
                .bearerToken(cajero.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.equal(lista.body().data[0].id, primero.body().id)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })
})
