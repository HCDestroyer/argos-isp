import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import AnularFactura from '#billing/actions/anular_factura'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import VencerFactura from '#billing/actions/vencer_factura'
import EditarParametro from '#fiscal/actions/editar_parametro'
import { controlFelFalso } from '#fiscal/fel/falso'
import { dec } from '#ledger/dinero'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import { dteParaEnviar, verDte } from '#fiscal/fel/dte'
import { errorDe, lineas, sacarDeLaColaFel, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import {
    IVA_DEBITO,
    IVA_POR_CERTIFICAR,
    cola,
    configurarModo,
    datosNit,
    dtesDe,
    empresasFel,
    factura,
    saldo,
    servicioFel,
} from '#tests/fiscal/ayudas_fel'

/**
 * Auditor contable · HALLAZGOS de la fase 3 (FEL). Igual que `hallazgos.spec.ts`: cada prueba es
 * el escenario mínimo que rompe un invariante con el código de `a3/fase3-fel`. Están marcadas con
 * `.fails(motivo)`: pasan mientras el hallazgo exista y se ponen en rojo cuando A3 lo arregle (ese
 * día se quita el `.fails`). No se ajustan para que pasen.
 */

/** Σ IVA de los DTE certificados de la empresa (FACT/FPEQ/NDEB suman, NCRE resta): el libro de ventas. */
async function ivaDeDteCertificados(empresaId: number): Promise<string> {
    const { rows } = (await db.rawQuery(
        `SELECT coalesce(sum(CASE WHEN tipo_dte = 'NCRE' THEN -iva ELSE iva END), 0)::text AS iva
           FROM fiscal.dte WHERE empresa_id = ? AND estado IN ('certificado', 'anulacion_pendiente')`,
        [empresaId],
    )) as { rows: Array<{ iva: string }> }
    return dec(rows[0]!.iva).negated().toFixed(2)
}

/** Mora con IVA de la empresa (solo el contador la activa). */
async function moraConIva(e: Awaited<ReturnType<typeof empresasFel>>, empresaId: number) {
    await new EditarParametro().execute(
        {
            clave: 'mora_con_iva',
            valor: true,
            vigente_desde: '2026-01-01',
            motivo: 'contador',
            empresa_id: empresaId,
        },
        { ...e.ctx, empresaId },
    )
}

test.group('Auditor contable · hallazgos de la fase 3 (FEL)', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('H5 · el DTE de un aviso con notas internas se certifica por el neto y la reclasificación lleva su IVA exacto', async ({
        assert,
    }) => {
        // Decisión del líder: el DTE de un aviso se certifica por bruto − notas internas vivas al certificar, y la
        // reclasificación 2.1.11 / 2.1.02 lleva exactamente el IVA del DTE. Producto hoy: el DTE va por el bruto
        // (app/fiscal/actions/solicitar_certificacion.ts: total/iva de la factura; app/fiscal/fel/dte.ts:
        // dteParaEnviar con todas las líneas) mientras reclasificarIva (app/billing/fel_facturas.ts) lleva lo que
        // queda en 2.1.11: el DTE declara IVA 24.00 y 2.1.02 reconoce 21.43.
        const e = await empresasFel('obligatoria')

        // cobrado: aviso 224.00 con nota interna de 24.00 (IVA 2.57) y pago de 200.00
        const s = await servicioFel(e, 'pagar', '224.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        const interna = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '24.00', motivo: 'descuento' },
            e.ctx,
        )
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '200.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.equal(dte!.estado, 'certificado')
        const ivaNeto = dec(f.iva).minus(interna.iva).toFixed(2)
        assert.equal(dte!.total, '200.00')
        assert.equal(dte!.iva, ivaNeto)
        // lo que se envía al certificador también es el neto
        const envio = await dteParaEnviar(db.connection(), await verDte(Number(dte!.id)))
        const sumaLineas = envio.lineas.reduce((t, l) => t.plus(l.total), dec('0')).toFixed(2)
        assert.equal(sumaLineas, '200.00')
        assert.equal(envio.total, '200.00')
        assert.equal(envio.iva, ivaNeto)
        assert.deepEqual(await lineas('reclasificacion', Number(dte!.id)), [
            [IVA_POR_CERTIFICAR, ivaNeto, '0.00'],
            [IVA_DEBITO, '0.00', ivaNeto],
        ])
        assert.equal(await saldo(e.B, IVA_DEBITO), await ivaDeDteCertificados(e.B), 'IVA de los DTE ≠ 2.1.02')

        // a mano antes de cobrar y acreditado el resto con NCRE: libro de ventas y 2.1.02 en cero
        const t = await servicioFel(e, 'pagar', '224.00', await crearClienteFila(datosNit()), e.C)
        const g = t.facturas[0]!
        await new EmitirNotaCredito().execute(
            { factura_id: g.id, monto: '22.40', motivo: 'descuento' },
            e.ctx,
        )
        await new SolicitarCertificacion().execute({ factura_id: g.id }, e.ctx)
        await cola(e)
        await new EmitirNotaCredito().execute({ factura_id: g.id, monto: '201.60', motivo: 'baja' }, e.ctx)
        await cola(e)
        assert.equal(await saldo(e.C, IVA_DEBITO), '0.00')
        assert.equal(
            await ivaDeDteCertificados(e.C),
            '0.00',
            'el libro de ventas deja IVA de una factura acreditada al 100 %',
        )

        assert.deepEqual(await verificarLibro([e.B, e.C], { incluirHallazgosAbiertos: true }), [])
    })

    test('H6 · un pago registrado mientras la anulación del DTE está pendiente deja el DTE anulado en la SAT y vivo en el libro', async ({
        assert,
    }) => {
        // Producto: app/billing/actions/registrar_pago.ts no rechaza una factura cuyo DTE está
        // `anulacion_pendiente`, y app/fiscal/actions/anular_dte.ts confirma la anulación con el certificador
        // ANTES de completar `facturas.anular` (que ahora responde 409 factura_con_pagos): la transacción se
        // revierte, el certificador ya anuló el documento y el DTE local sigue `anulacion_pendiente` (con
        // INFILE, el reintento recibiría "ya anulado" → rechazado → el DTE vuelve a `certificado`).
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        await new AnularFactura().execute({ factura_id: f.id, motivo: 'error de plan' }, e.ctx)
        const pago = await errorDe(
            new RegistrarPago().execute(
                {
                    cliente_id: s.clienteId,
                    metodo: 'caja',
                    monto: '150.00',
                    facturas: [f.id],
                    empresa_id: e.B,
                },
                e.ctx,
            ),
        ).catch(() => null)
        await cola(e)
        const enSat = controlFelFalso.registros.get(String(dte!.identificador))
        const local = await dtesDe('factura', f.id).then((r) => r[0]!)
        // o el pago se rechaza mientras la anulación está pendiente, o el libro sigue a la SAT
        const doc = await factura(f.id)
        assert.isTrue(
            pago !== null || (enSat?.anulado === true) === (local.estado === 'anulado'),
            `SAT anulado=${enSat?.anulado}, DTE local ${local.estado}, factura ${doc.estado}`,
        )
        assert.equal(local.estado === 'anulado', doc.estado === 'anulada')
    })

    test('H7 · anular una mora certificada como NDEB anula el DTE pero deja la mora viva y su IVA en 2.1.02', async ({
        assert,
    }) => {
        // Producto: app/fiscal/actions/anular_dte.ts solo completa `facturas.anular` cuando
        // documento_tipo = 'factura'; con 'nota_debito' el DTE queda `anulado` y la mora sigue vigente, con su
        // asiento y su reclasificación vivos (§17 dice "se anula primero la mora").
        const e = await empresasFel('obligatoria')
        await moraConIva(e, e.C)
        const s = await servicioFacturado(e.C, '2026-10-01', {
            precio: '150.00',
            instalacion: '2026-10-01',
            clienteId: await crearClienteFila(datosNit()),
            plantilla: { certificar_al: 'pagar', mora_tipo: 'fija', mora_valor: '22.40', dias_gracia: 0 },
        })
        const vencida = await new VencerFactura().execute(
            { factura_id: s.facturas[0]!.id, hoy: '2026-10-17' },
            e.ctx,
        )
        const moraId = vencida.moras[0]!
        const pago = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '172.40', empresa_id: e.C },
            e.ctx,
        )
        await cola(e)
        await cola(e)
        assert.equal(await dtesDe('nota_debito', moraId).then((r) => r[0]?.estado), 'certificado')
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'cheque rechazado' }, e.ctx)
        await new AnularFactura().execute({ factura_id: moraId, motivo: 'recargo indebido' }, e.ctx)
        await cola(e)
        const [ndeb] = await dtesDe('nota_debito', moraId)
        assert.equal(ndeb!.estado, 'anulado')
        const mora = await factura(moraId)
        assert.equal(mora.estado, 'anulada', 'la NDEB se anuló pero la mora sigue viva')
        assert.deepEqual(await verificarLibro(e.C), [])
    })

    test('H8 · pasar la FEL a desactivada con avisos pendientes deja su IVA en 2.1.11 para siempre', async ({
        assert,
    }) => {
        // Producto: app/fiscal/actions/configurar_fel.ts acepta `desactivada` con avisos de cobro sin DTE;
        // después app/fiscal/fel/cola.ts (avisosPorCertificar) y solicitar_certificacion.ts los omiten
        // (`fel_desactivada`). El aviso se cobra y su IVA nunca llega a 2.1.02: es IVA cobrado que no se
        // declara. §17 restringe `pagar` a FEL activa justo para que esto no pase, pero solo al emitir.
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const desactivar = await errorDe(configurarModo(e, e.B, 'desactivada')).catch(() => null)
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        // o no se permite desactivar con avisos pendientes, o el aviso cobrado sale de 2.1.11
        assert.isTrue(
            desactivar !== null || (await saldo(e.B, IVA_POR_CERTIFICAR)) === '0.00',
            `2.1.11 = ${await saldo(e.B, IVA_POR_CERTIFICAR)} con el aviso ${s.facturas[0]!.id} ya cobrado`,
        )
    })

    test('H9 · con FEL opcional, la mora con IVA de una factura sin FEL nace aviso y su IVA nunca sale de 2.1.11', async ({
        assert,
    }) => {
        // Producto: app/billing/mora.ts marca `aviso_cobro` en toda mora con IVA si la FEL no está
        // desactivada, aunque su factura no sea aviso ni vaya a tener DTE (opcional + certificar_al emitir).
        // La NDEB exige la factura de origen certificada (cola.ts, solicitar_certificacion.ts): la mora se
        // cobra y su IVA queda en 2.1.11 mientras el de su factura está en 2.1.02.
        const e = await empresasFel('opcional')
        await moraConIva(e, e.B)
        const s = await servicioFacturado(e.B, '2026-10-01', {
            precio: '150.00',
            instalacion: '2026-10-01',
            clienteId: await crearClienteFila(datosNit()),
            plantilla: { certificar_al: 'emitir', mora_tipo: 'fija', mora_valor: '22.40', dias_gracia: 0 },
        })
        const origen = await factura(s.facturas[0]!.id)
        assert.isFalse(origen.aviso_cobro)
        await new VencerFactura().execute({ factura_id: s.facturas[0]!.id, hoy: '2026-10-17' }, e.ctx)
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '172.40', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        await cola(e)
        assert.equal(
            await saldo(e.B, IVA_POR_CERTIFICAR),
            '0.00',
            'IVA de la mora cobrada atrapado en 2.1.11',
        )
        assert.equal(await saldo(e.B, IVA_DEBITO), '-18.47')
    })
})
