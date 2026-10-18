import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { generar } from '#tests/billing/ayudas_billing'
import { facturasDelServicio, prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { contextoPrueba, soloEmpresaPrincipal } from '#tests/ayudas'
import { hoyGuatemala } from '#ledger/fechas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import { saldoPuntos } from '#lealtad/puntos'
import { sumarMeses } from '#lealtad/condiciones'
import OtorgarAntiguedad from '#lealtad/actions/otorgar_antiguedad'
import { codigoReferidoDe } from '#core/referidos'
import { crearClienteFila } from '#tests/core/fabricas'
import RechazarReferido from '#lealtad/actions/rechazar_referido'
import { ejecutarCron } from '#billing/jobs'
import {
    afirmarLibroLealtad,
    entregar,
    entregarEvento,
    movimientosDe,
    programaConReglas,
} from '#tests/lealtad/ayudas_lealtad'

/**
 * Lealtad · reglas para ganar (contrato §4): racha, topes, pago adelantado, antigüedad y referidos.
 * Cada una con sus reversos y terminando en los invariantes del libro.
 */

async function pagarFactura(
    e: Awaited<ReturnType<typeof prepararEmpresas>>,
    clienteId: number,
    factura: { id: number; total: string },
) {
    const pago = await new RegistrarPago().execute(
        {
            cliente_id: clienteId,
            metodo: 'caja',
            monto: factura.total,
            facturas: [factura.id],
            empresa_id: e.B,
        },
        e.ctx,
    )
    await entregarEvento('pago.registrado', 'pago_id', pago.id)
    return pago
}

test.group('Lealtad · reglas para ganar', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('racha: bono al completar N facturas seguidas a tiempo; tope por cliente y mes', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, { diferimiento: true }, [
            {
                tipo: 'pago_a_tiempo',
                puntos: 10,
                condiciones: { racha: { periodos: 2, puntos_extra: 50 } },
                tope_por_cliente: 2,
                periodo_tope: 'mes',
            },
        ])
        // facturas de noviembre a febrero: todas vencen después de hoy
        const s = await servicioEn(e.B, { precio: '100.00', instalacion: '2026-11-01' })
        await generar(s.servicioId, '2027-02-01')
        const facturas = await facturasDelServicio(s.servicioId)
        assert.isAtLeast(facturas.length, 3)
        for (const factura of facturas.slice(0, 3)) await pagarFactura(e, s.clienteId, factura)

        const movimientos = await movimientosDe(e.B, s.clienteId)
        // la 2.ª factura completa la racha (+50); la 3.ª choca con el tope de 2 otorgamientos al mes
        assert.deepEqual(
            movimientos.map((m) => [m.clave_unica, m.puntos]),
            [
                [`pago_a_tiempo:factura:${facturas[0]!.id}`, 10],
                [`pago_a_tiempo:factura:${facturas[1]!.id}`, 10],
            ],
        )
        await afirmarLibroLealtad(assert, [e.B, e.C])
    })

    test('racha sin tope: bono cada N; anular el pago revierte la factura y su bono', async ({ assert }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, { diferimiento: true }, [
            { tipo: 'pago_a_tiempo', puntos: 10, condiciones: { racha: { periodos: 2, puntos_extra: 50 } } },
        ])
        const s = await servicioEn(e.B, { precio: '100.00', instalacion: '2026-11-01' })
        await generar(s.servicioId, '2027-01-01')
        const [nov, dic] = await facturasDelServicio(s.servicioId)
        await pagarFactura(e, s.clienteId, nov!)
        const pagoDic = await pagarFactura(e, s.clienteId, dic!)
        assert.deepEqual(
            await movimientosDe(e.B, s.clienteId).then((lista) =>
                lista.map((m) => [m.clave_unica, m.puntos]),
            ),
            [
                [`pago_a_tiempo:factura:${nov!.id}`, 10],
                [`pago_a_tiempo:factura:${dic!.id}`, 10],
                [`pago_a_tiempo:racha:factura:${dic!.id}`, 50],
            ],
        )
        await new AnularPago().execute({ pago_id: pagoDic.id, motivo: 'cheque rechazado' }, e.ctx)
        await entregarEvento('pago.anulado', 'pago_id', pagoDic.id)
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 10)
        await afirmarLibroLealtad(assert, [e.B, e.C])

        // vuelve a pagar a tiempo: gana de nuevo con la clave siguiente (`#2`), sin duplicar
        await pagarFactura(e, s.clienteId, dic!)
        const claves = await movimientosDe(e.B, s.clienteId).then((lista) =>
            lista.filter((m) => m.puntos > 0).map((m) => m.clave_unica),
        )
        assert.includeMembers(claves, [
            `pago_a_tiempo:factura:${dic!.id}#2`,
            `pago_a_tiempo:racha:factura:${dic!.id}#2`,
        ])
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 70)
        await afirmarLibroLealtad(assert, [e.B, e.C])
    })

    test('pago adelantado: el excedente cubre N mensualidades; anular el pago lo revierte', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, { diferimiento: true, valor_punto: '0.05' }, [
            {
                tipo: 'pago_adelantado',
                puntos: 5,
                condiciones: { periodos_minimos: 3, puntos_por_periodo: 15 },
            },
        ])
        const s = await servicioEn(e.B, { precio: '150.00', instalacion: '2026-11-01' })
        // sin facturas pendientes: Q500 = 3 mensualidades de Q150 (y Q50 de resto) en Anticipos
        const pago = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '500.00', empresa_id: e.B },
            e.ctx,
        )
        await entregarEvento('pago.registrado', 'pago_id', pago.id, 2)
        const [movimiento] = await movimientosDe(e.B, s.clienteId)
        assert.equal(movimiento!.clave_unica, `adelantado:pago:${pago.id}`)
        assert.equal(movimiento!.puntos, 5 + 15 * 3)
        assert.equal(movimiento!.valor, '2.50')

        // con menos de 3 mensualidades no hay puntos
        const corto = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '400.00', empresa_id: e.B },
            e.ctx,
        )
        await entregarEvento('pago.registrado', 'pago_id', corto.id)
        assert.lengthOf(await movimientosDe(e.B, s.clienteId), 1)

        await new AnularPago().execute({ pago_id: pago.id, motivo: 'duplicado' }, e.ctx)
        await entregarEvento('pago.anulado', 'pago_id', pago.id)
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 0)
        await afirmarLibroLealtad(assert, [e.B, e.C])
    })

    test('antigüedad: cada 12 meses desde la instalación, sin retroactivo y sin duplicar', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const hoy = hoyGuatemala()
        // programa vigente desde hace 6 meses: el 1.er aniversario (hace 13 meses) no cuenta, el 2.º sí
        const desde = sumarMeses(hoy, -6)
        await programaConReglas(e.B, e.ctx, { diferimiento: true, vigente_desde: desde }, [
            { tipo: 'antiguedad', puntos: 100, condiciones: { cada_meses: 12 }, vigente_desde: desde },
        ])
        const s = await servicioEn(e.B, { instalacion: sumarMeses(hoy, -25) })
        const suspendido = await servicioEn(e.B, { instalacion: sumarMeses(hoy, -13) })
        await db.from('core.servicios').where('id', suspendido.servicioId).update({ estado: 'suspendido' })

        await ejecutarCron('lealtad:antiguedad')
        await new OtorgarAntiguedad().execute({ empresa_id: e.B, hoy }, contextoPrueba())
        assert.deepEqual(
            await movimientosDe(e.B, s.clienteId).then((lista) =>
                lista.map((m) => [m.clave_unica, m.puntos, m.valor]),
            ),
            [[`antiguedad:servicio:${s.servicioId}:2`, 100, '10.00']],
        )
        assert.lengthOf(await movimientosDe(e.B, suspendido.clienteId), 0)
        await afirmarLibroLealtad(assert, [e.B, e.C])
    })

    test('antigüedad: no otorga si el servicio pasó por suspendido en el ciclo', async ({ assert }) => {
        const e = await prepararEmpresas()
        const hoy = hoyGuatemala()
        const desde = sumarMeses(hoy, -6)
        await programaConReglas(e.B, e.ctx, { vigente_desde: desde }, [
            { tipo: 'antiguedad', puntos: 100, vigente_desde: desde },
        ])
        const s = await servicioEn(e.B, { instalacion: sumarMeses(hoy, -12) })
        await db.table('audit.outbox').insert({
            evento: 'servicio.estado_cambiado',
            payload: JSON.stringify({
                servicio_id: s.servicioId,
                empresa_id: e.B,
                de: 'activo',
                a: 'suspendido',
                motivo: 'corte',
            }),
            created_at: new Date(Date.now() - 60 * 86_400_000),
        })
        await new OtorgarAntiguedad().execute({ empresa_id: e.B, hoy }, contextoPrueba())
        assert.lengthOf(await movimientosDe(e.B, s.clienteId), 0)
        await afirmarLibroLealtad(assert, [e.B, e.C])
    })

    test('referido: califica con las facturas pagadas mínimas, bono al referido; rechazar revierte', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, { diferimiento: true }, [
            {
                tipo: 'referido',
                puntos: 150,
                condiciones: { facturas_pagadas_minimas: 2, puntos_referido: 50 },
            },
        ])
        const referidor = await servicioEn(e.B)
        const codigo = await codigoReferidoDe(referidor.clienteId, e.B)
        assert.match(String(codigo), /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/)
        // A1 resolvió el código en el alta: el cliente nuevo llegó referido a la empresa B
        const clienteNuevo = await crearClienteFila({
            referido_por_id: referidor.clienteId,
            referido_empresa_id: e.B,
        })
        const nuevo = await servicioEn(e.B, {
            precio: '100.00',
            instalacion: '2026-11-01',
            clienteId: clienteNuevo,
        })
        const enOtra = await servicioEn(e.C, { clienteId: clienteNuevo })
        const creado = (servicioId: number, empresaId: number) => ({
            id: `creado-${servicioId}`,
            evento: 'servicio.creado',
            payload: { servicio_id: servicioId, empresa_id: empresaId, cliente_id: clienteNuevo },
        })
        await entregar([creado(nuevo.servicioId, e.B), creado(enOtra.servicioId, e.C)], 2)
        const registrados = await db.from('lealtad.referidos').where('referido_id', clienteNuevo)
        assert.lengthOf(registrados, 1)
        assert.include(registrados[0], { estado: 'pendiente', codigo, referidor_id: referidor.clienteId })
        const referido = { id: Number(registrados[0]!.id) }

        await generar(nuevo.servicioId, '2026-12-01')
        const [nov, dic] = await facturasDelServicio(nuevo.servicioId)
        await pagarFactura(e, nuevo.clienteId, nov!)
        assert.lengthOf(await movimientosDe(e.B, referidor.clienteId), 0)
        await pagarFactura(e, nuevo.clienteId, dic!)
        assert.deepEqual(
            await movimientosDe(e.B, referidor.clienteId).then((lista) =>
                lista.map((m) => [m.clave_unica, m.puntos]),
            ),
            [[`referido:${referido.id}`, 150]],
        )
        assert.deepEqual(
            await movimientosDe(e.B, nuevo.clienteId).then((lista) =>
                lista.map((m) => [m.clave_unica, m.puntos]),
            ),
            [[`referido:bono:${referido.id}`, 50]],
        )
        const calificados = await db
            .from('audit.outbox')
            .where('evento', 'lealtad.referido_calificado')
            .whereRaw(`(payload->>'referido_id')::bigint = ?`, [referido.id])
        assert.lengthOf(calificados, 1)
        await afirmarLibroLealtad(assert, [e.B, e.C])

        const rechazado = await new RechazarReferido().execute(
            { id: referido.id, motivo: 'alta falsa' },
            e.ctx,
        )
        assert.equal(rechazado.estado, 'rechazado')
        assert.equal(await saldoPuntos(db.connection(), e.B, referidor.clienteId), 0)
        assert.equal(await saldoPuntos(db.connection(), e.B, nuevo.clienteId), 0)
        await afirmarLibroLealtad(assert, [e.B, e.C])
    })
})
