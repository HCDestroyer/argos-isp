import { test } from '@japa/runner'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, soloEmpresaPrincipal } from '#tests/ayudas'
import { errorDe, prepararEmpresas, saldoCuenta, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { hoyGuatemala } from '#ledger/fechas'
import { saldoPuntos } from '#lealtad/puntos'
import { sumarMeses } from '#lealtad/condiciones'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import EditarPrograma from '#lealtad/actions/editar_programa'
import VencerPuntos from '#lealtad/actions/vencer_puntos'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import { ejecutarCron } from '#billing/jobs'
import {
    afirmarPasivoLealtad,
    asientoLealtad,
    movimientosDe,
    programaConReglas,
} from '#tests/lealtad/ayudas_lealtad'

/**
 * Lealtad · lotes, vencimiento y ajustes (contrato §4, §6, §6.1 y §10): el lote que vence antes
 * sale primero, repetir el cron no duplica y `2.1.10` = valor de los lotes vivos en cada paso.
 */

test.group('Lealtad · vencimiento y ajustes', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('vencimiento: aviso una vez, lote vencido con 2.1.10 / 4.1.06; repetir el cron no duplica', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { programa } = await programaConReglas(e.B, e.ctx, {
            diferimiento: true,
            canje_esperado_pct: '80',
            vencimiento_meses: 12,
            aviso_vencimiento_dias: 30,
        })
        const s = await servicioEn(e.B)
        const ajuste = await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 100, motivo: 'bienvenida' },
            e.ctx,
        )
        const hoy = hoyGuatemala()
        const vence = sumarMeses(hoy, 12)
        assert.equal(ajuste.movimiento.vence_en, vence)
        assert.equal(ajuste.movimiento.valor, '8.00')
        assert.deepEqual(await asientoLealtad(ajuste.movimiento.id), [
            ['4.1.05', '8.00', '0.00'],
            ['2.1.10', '0.00', '8.00'],
        ])
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])

        // 20 días antes: aviso una sola vez aunque el cron corra dos veces
        const aviso = new Date(new Date(`${vence}T12:00:00Z`).getTime() - 20 * 86_400_000)
            .toISOString()
            .slice(0, 10)
        await new VencerPuntos().execute({ empresa_id: e.B, hoy: aviso }, contextoPrueba())
        await new VencerPuntos().execute({ empresa_id: e.B, hoy: aviso }, contextoPrueba())
        const avisos = await db
            .from('audit.outbox')
            .where('evento', 'lealtad.puntos_por_vencer')
            .whereRaw(`(payload->>'lote_id')::bigint = ?`, [ajuste.movimiento.id])
            .select('payload')
        assert.lengthOf(avisos, 1)
        assert.deepInclude(avisos[0]!.payload, { puntos: 100, vence_en: vence, cliente_id: s.clienteId })
        assert.lengthOf(await movimientosDe(e.B, s.clienteId), 1)

        // el día del vencimiento (y después: todo lo vencido hasta hoy) sale el lote, una sola vez
        await new VencerPuntos().execute({ empresa_id: e.B, hoy: vence }, contextoPrueba())
        await new VencerPuntos().execute({ empresa_id: e.B, hoy: sumarMeses(vence, 1) }, contextoPrueba())
        const movimientos = await movimientosDe(e.B, s.clienteId)
        assert.deepEqual(
            movimientos.map((m) => [m.tipo, m.puntos, m.valor, m.clave_unica]),
            [
                ['ajuste', 100, '8.00', movimientos[0]!.clave_unica],
                ['vencimiento', -100, '8.00', `vencimiento:lote:${ajuste.movimiento.id}`],
            ],
        )
        assert.deepEqual(await asientoLealtad(movimientos[1]!.id), [
            ['2.1.10', '8.00', '0.00'],
            ['4.1.06', '0.00', '8.00'],
        ])
        const vencidos = await db
            .from('audit.outbox')
            .where('evento', 'lealtad.puntos_vencidos')
            .whereRaw(`(payload->>'movimiento_id')::bigint = ?`, [movimientos[1]!.id])
        assert.lengthOf(vencidos, 1)
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 0)
        assert.equal(await saldoCuenta(e.B, '2.1.10'), '0.00')
        assert.equal(programa.vencimiento_meses, 12)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('el lote que vence antes sale primero; cambiar el vencimiento solo afecta a los lotes nuevos', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { programa } = await programaConReglas(e.B, e.ctx, {
            diferimiento: true,
            vencimiento_meses: 12,
        })
        const s = await servicioEn(e.B)
        const largo = await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 40, motivo: 'lote de 12 meses' },
            e.ctx,
        )
        await new EditarPrograma().execute(
            { id: programa.id, version: programa.version, vencimiento_meses: 3 },
            e.ctx,
        )
        const corto = await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 30, motivo: 'lote de 3 meses' },
            e.ctx,
        )
        const hoy = hoyGuatemala()
        assert.equal(largo.movimiento.vence_en, sumarMeses(hoy, 12))
        assert.equal(corto.movimiento.vence_en, sumarMeses(hoy, 3))
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])

        // el ajuste negativo consume primero el lote corto (vence antes) y revierte su diferimiento
        const descuento = await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: -20, motivo: 'corrección' },
            e.ctx,
        )
        const consumos = await db
            .from('lealtad.consumos')
            .where('movimiento_id', descuento.movimiento.id)
            .select('lote_id', 'puntos', 'valor')
        assert.deepEqual(
            consumos.map((c) => [Number(c.lote_id), c.puntos, c.valor]),
            [[corto.movimiento.id, 20, '2.00']],
        )
        assert.deepEqual(await asientoLealtad(descuento.movimiento.id), [
            ['2.1.10', '2.00', '0.00'],
            ['4.1.05', '0.00', '2.00'],
        ])
        assert.equal(descuento.saldo, 50)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])

        // a los 3 meses vencen los 10 que le quedan al lote corto; el largo sigue entero
        await ejecutarCron('lealtad:vencer', new Date(`${sumarMeses(hoy, 3)}T18:00:00Z`))
        const vencimientos = await movimientosDe(e.B, s.clienteId).then((lista) =>
            lista.filter((m) => m.tipo === 'vencimiento'),
        )
        assert.deepEqual(
            vencimientos.map((m) => [m.puntos, m.valor, m.origen_id === null ? null : Number(m.origen_id)]),
            [[-10, '1.00', corto.movimiento.id]],
        )
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 40)
        assert.equal(await saldoCuenta(e.B, '2.1.10'), '-4.00')
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('cron de vencimiento con un mes cerrado: esa empresa queda fallida en la corrida y las demás siguen', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, { diferimiento: true, vencimiento_meses: 1 })
        await programaConReglas(e.C, e.ctx, { diferimiento: true, vencimiento_meses: 1 })
        const enB = await servicioEn(e.B)
        const enC = await servicioEn(e.C)
        for (const [empresa, s] of [
            [e.B, enB],
            [e.C, enC],
        ] as const) {
            await new AjustarPuntos().execute(
                { empresa_id: empresa, cliente_id: s.clienteId, puntos: 10, motivo: 'bienvenida' },
                e.ctx,
            )
        }
        // la corrida cae dos meses después; ese mes ya está cerrado en B
        const corrida = sumarMeses(hoyGuatemala(), 2)
        const [anio, mes] = corrida.split('-').map(Number) as [number, number]
        await new CerrarPeriodo().execute(
            {
                empresa_id: e.B,
                anio,
                mes,
                ahora: new Date(`${sumarMeses(corrida, 1).slice(0, 8)}05T18:00:00Z`),
            },
            e.ctx,
        )
        const salida = await ejecutarCron('lealtad:vencer', new Date(`${corrida}T18:00:00Z`))
        assert.isFalse(salida.omitido)
        const resultado = salida.resultado as unknown as {
            empresas: Array<{ empresa_id: number; vencidos: number }>
            fallidas: Array<{ empresa_id: number; error: string }>
        }
        const fallida = resultado.fallidas.find((f) => f.empresa_id === e.B)
        assert.isDefined(fallida)
        assert.match(fallida!.error, /cerrado/)
        assert.deepInclude(resultado.empresas, { empresa_id: e.C, vencidos: 1, avisados: 0 })
        // B conserva su lote (se reintenta al reabrir o en el mes siguiente); C venció el suyo
        const movB = await movimientosDe(e.B, enB.clienteId)
        const movC = await movimientosDe(e.C, enC.clienteId)
        assert.deepEqual(
            movB.map((m) => m.tipo),
            ['ajuste'],
        )
        assert.deepEqual(
            movC.map((m) => m.tipo),
            ['ajuste', 'vencimiento'],
        )
        const corridas = await db
            .from('audit.acciones')
            .where('accion', 'lealtad.vencer')
            .whereNull('entidad_tipo')
            .whereRaw(`entrada->'resultado'->'fallidas' @> ?::jsonb`, [JSON.stringify([{ empresa_id: e.B }])])
        assert.isAtLeast(corridas.length, 1)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('ajuste: motivo obligatorio, nunca deja saldo negativo, programa activo y cliente de la empresa', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B)
        const sinPrograma = await errorDe(
            new AjustarPuntos().execute(
                { empresa_id: e.B, cliente_id: s.clienteId, puntos: 5, motivo: 'x' },
                e.ctx,
            ),
        )
        assert.equal(sinPrograma.status, 422)
        assert.equal(sinPrograma.codigo, 'programa_inactivo')

        await programaConReglas(e.B, e.ctx)
        await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 5, motivo: 'regalo' },
            e.ctx,
        )
        const insuficiente = await errorDe(
            new AjustarPuntos().execute(
                { empresa_id: e.B, cliente_id: s.clienteId, puntos: -6, motivo: 'corrección' },
                e.ctx,
            ),
        )
        assert.equal(insuficiente.status, 422)
        assert.equal(insuficiente.codigo, 'saldo_insuficiente')

        const otro = await servicioEn(e.C)
        const ajeno = await errorDe(
            new AjustarPuntos().execute(
                { empresa_id: e.B, cliente_id: otro.clienteId, puntos: 5, motivo: 'regalo' },
                e.ctx,
            ),
        )
        assert.equal(ajeno.codigo, 'servicio_no_valido')
        // sin diferimiento el ajuste no tiene valor contable
        const [movimiento] = await movimientosDe(e.B, s.clienteId)
        assert.equal(movimiento!.valor, '0.00')
        assert.isNull(movimiento!.asiento_id)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('lealtad.movimientos y lealtad.consumos son de solo inserción', async ({ assert }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx)
        const s = await servicioEn(e.B)
        const ajuste = await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 5, motivo: 'regalo' },
            e.ctx,
        )
        await assert.rejects(() =>
            db.from('lealtad.movimientos').where('id', ajuste.movimiento.id).update({ puntos: 500 }),
        )
        await assert.rejects(() => db.from('lealtad.movimientos').where('id', ajuste.movimiento.id).delete())
        // un lote no entrega más de lo que tiene (trigger)
        const salida = await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: -5, motivo: 'corrección' },
            e.ctx,
        )
        await assert.rejects(() =>
            db
                .table('lealtad.consumos')
                .insert({ movimiento_id: salida.movimiento.id, lote_id: ajuste.movimiento.id, puntos: 1 }),
        )
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })
})
