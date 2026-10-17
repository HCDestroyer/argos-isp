import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularFactura from '#billing/actions/anular_factura'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import AnularNotaCredito from '#billing/actions/anular_nota_credito'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import ReintentarDte from '#fiscal/actions/reintentar_dte'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import { controlFelFalso } from '#fiscal/fel/falso'
import { dteParaEnviar, verDte } from '#fiscal/fel/dte'
import { xmlDte } from '#fiscal/fel/xml_gt'
import { errorDe, lineas, sacarDeLaColaFel } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
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
 * Decisiones del líder sobre los hallazgos del auditor de la fase 3 (H5–H9 y desvíos): el
 * comportamiento del producto. Los escenarios del auditor están en
 * `tests/contabilidad/hallazgos_fase3.spec.ts`.
 */
test.group('FEL · decisiones sobre los hallazgos del auditor', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('H5: el aviso con notas internas se certifica por el neto, con el descuento en cada ítem; la reclasificación lleva el IVA del DTE', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '224.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '24.00', motivo: 'descuento' },
            e.ctx,
        )
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '200.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.containSubset(dte, { estado: 'certificado', total: '200.00', iva: '21.43' })
        const envio = await dteParaEnviar(db.connection(), await verDte(Number(dte!.id)))
        assert.containSubset(envio.lineas[0], {
            precio: '224.00',
            descuento: '24.00',
            total: '200.00',
            iva: '21.43',
        })
        assert.include(xmlDte(envio), '<dte:Descuento>24.00</dte:Descuento>')
        assert.deepEqual(await lineas('reclasificacion', Number(dte!.id)), [
            [IVA_POR_CERTIFICAR, '21.43', '0.00'],
            [IVA_DEBITO, '0.00', '21.43'],
        ])
        assert.equal(await saldo(e.B, IVA_DEBITO), '-21.43')
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '0.00')
    })

    test('H11: con FEL opcional, una factura que no es aviso y tiene nota interna se certifica a mano por el neto', async ({
        assert,
    }) => {
        const e = await empresasFel('opcional')
        const s = await servicioFel(e, 'nunca', '224.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        assert.isFalse(await factura(f.id).then((r) => Boolean(r.aviso_cobro)))
        await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '24.00', motivo: 'descuento' },
            e.ctx,
        )
        // la nota interna ya bajó 2.1.02: 24.00 − 2.57 = 21.43
        assert.equal(await saldo(e.B, IVA_DEBITO), '-21.43')
        await new SolicitarCertificacion().execute({ factura_id: f.id }, e.ctx)
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.containSubset(dte, { estado: 'certificado', total: '200.00', iva: '21.43' })
        const envio = await dteParaEnviar(db.connection(), await verDte(Number(dte!.id)))
        assert.containSubset(envio.lineas[0], { precio: '224.00', descuento: '24.00', total: '200.00' })
        assert.equal(await saldo(e.B, IVA_DEBITO), '-21.43')
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '0.00')
    })

    test('nota interna después del DTE:con el DTE en cola 409 con su estado; certificado y FEL desactivada 409 nota_requiere_ncre', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        // la factura aún por certificar no admite notas (no está emitida)
        const enCola = await errorDe(
            new EmitirNotaCredito().execute(
                { factura_id: s.facturas[0]!.id, monto: '1.00', motivo: 'prueba' },
                e.ctx,
            ),
        )
        assert.equal(enCola.status, 409)
        const aviso = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        await new SolicitarCertificacion().execute({ factura_id: aviso.facturas[0]!.id }, e.ctx)
        const pendiente = await errorDe(
            new EmitirNotaCredito().execute(
                { factura_id: aviso.facturas[0]!.id, monto: '1.00', motivo: 'prueba' },
                e.ctx,
            ),
        )
        assert.equal(pendiente.codigo, 'dte_en_proceso')
        assert.include(pendiente.detalle, 'pendiente de certificar')
        await cola(e)
        assert.equal(await dtesDe('factura', aviso.facturas[0]!.id).then((r) => r[0]!.estado), 'certificado')
        // certificado (sin avisos pendientes): la FEL se puede desactivar, pero la nota ya no puede ser interna
        await configurarModo(e, e.B, 'desactivada')
        const sinNcre = await errorDe(
            new EmitirNotaCredito().execute(
                { factura_id: aviso.facturas[0]!.id, monto: '1.00', motivo: 'prueba' },
                e.ctx,
            ),
        )
        assert.equal(sinNcre.codigo, 'nota_requiere_ncre')
    })

    test('H6: con la anulación pendiente no se registran pagos ni notas; si el certificador ya anuló, el reintento lo consulta y completa la anulación local', async ({
        assert,
    }) => {
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
        )
        assert.equal(pago.codigo, 'anulacion_en_proceso')
        const nota = await errorDe(
            new EmitirNotaCredito().execute({ factura_id: f.id, monto: '10.00', motivo: 'prueba' }, e.ctx),
        )
        assert.equal(nota.codigo, 'dte_en_proceso')
        assert.include(nota.detalle, 'anulación pendiente')
        // un pago sin facturas pedidas no se aplica a la factura en anulación: queda como anticipo
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        assert.equal(await factura(f.id).then((r) => r.pagado), '0.00')

        // el certificador ya anuló (la transacción local falló después): el reintento consulta primero
        controlFelFalso.registros.get(String(dte!.identificador))!.anulado = true
        await db.table('fiscal.dte_intentos').insert({
            dte_id: dte!.id,
            operacion: 'anular',
            resultado: 'enviando',
            respuesta: '{}',
        })
        await cola(e)
        assert.equal(controlFelFalso.llamadas.anular, 0)
        assert.equal(await dtesDe('factura', f.id).then((r) => r[0]!.estado), 'anulado')
        assert.equal(await factura(f.id).then((r) => r.estado), 'anulada')
    })

    test('H6: el anticipo que quedó mientras la anulación estaba pendiente se aplica si la anulación se rechaza', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await cola(e)
        await new AnularFactura().execute({ factura_id: f.id, motivo: 'error de plan' }, e.ctx)
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        assert.equal(await factura(f.id).then((r) => r.pagado), '0.00')
        controlFelFalso.siguiente.push('rechazado')
        await cola(e)
        assert.equal(await dtesDe('factura', f.id).then((r) => r[0]!.estado), 'certificado')
        assert.containSubset(await factura(f.id), { estado: 'pagada', pagado: '150.00' })
        assert.equal(await saldo(e.B, '2.1.01'), '0.00')
        await afirmarLibro(assert, e.B)
    })

    test('H6: un rechazo de la anulación que en realidad ya estaba anulada se confirma con el certificador y nunca vuelve a certificado', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        await new AnularFactura().execute({ factura_id: f.id, motivo: 'error' }, e.ctx)
        controlFelFalso.registros.get(String(dte!.identificador))!.anulado = true
        controlFelFalso.siguiente.push('rechazado')
        await cola(e)
        assert.equal(await dtesDe('factura', f.id).then((r) => r[0]!.estado), 'anulado')
        assert.equal(await factura(f.id).then((r) => r.estado), 'anulada')
    })

    test('H8: desactivar la FEL con avisos por certificar responde 422 avisos_por_certificar con la cuenta', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        await servicioFel(e, 'pagar', '99.00', await crearClienteFila(datosNit()))
        const error = await errorDe(configurarModo(e, e.B, 'desactivada'))
        assert.equal(error.codigo, 'avisos_por_certificar')
        assert.include(error.detalle, '2 avisos')
        // con opcional los avisos siguen certificándose: se admite
        await configurarModo(e, e.B, 'opcional')
    })

    test('ReintentarDte sobre una factura anulada responde 409', async ({ assert }) => {
        const e = await empresasFel('obligatoria')
        controlFelFalso.siguiente.push('rechazado')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        await cola(e)
        const [rechazado] = await dtesDe('factura', s.facturas[0]!.id)
        assert.equal(rechazado!.estado, 'rechazado')
        await new AnularFactura().execute({ factura_id: s.facturas[0]!.id, motivo: 'baja' }, e.ctx)
        const error = await errorDe(new ReintentarDte().execute({ dte_id: Number(rechazado!.id) }, e.ctx))
        assert.equal(error.codigo, 'factura_anulada')
        assert.lengthOf(await dtesDe('factura', s.facturas[0]!.id), 1)
    })

    test('NCRE rechazada en definitivo: el cierre del mes responde 409 hasta anularla; la anulación revierte su asiento y devuelve el saldo', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await cola(e)
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '50.00', motivo: 'descuento' },
            e.ctx,
        )
        assert.equal(await factura(f.id).then((r) => r.pagado), '50.00')
        // una NCRE en cola no se anula
        const enCola = await errorDe(
            new AnularNotaCredito().execute({ nota_id: nota.id, motivo: 'x x x' }, e.ctx),
        )
        assert.equal(enCola.codigo, 'dte_en_proceso')
        controlFelFalso.siguiente.push('rechazado')
        await cola(e)
        const [ncre] = await dtesDe('nota_credito', nota.id)
        assert.containSubset(ncre, { estado: 'rechazado', definitivo: true })

        // el cierre de un mes con la NCRE sin certificar responde 409 (la nota se fecha en septiembre,
        // como dueño, dentro de una transacción que se deshace)
        const trx = await db.transaction()
        try {
            await trx.rawQuery(`ALTER TABLE billing.notas_credito DISABLE TRIGGER notas_credito_inmutable`)
            await trx.rawQuery(`UPDATE billing.notas_credito SET fecha = '2026-09-20' WHERE id = ?`, [
                nota.id,
            ])
            const cierre = await errorDe(
                new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9 }, e.ctx, { trx }),
            )
            assert.equal(cierre.codigo, 'ncre_sin_certificar')
            assert.include(cierre.detalle, `nota ${nota.id}: rechazado`)
        } finally {
            await trx.rollback()
        }

        const anulada = await new AnularNotaCredito().execute(
            { nota_id: nota.id, motivo: 'SAT la rechazó' },
            e.ctx,
        )
        assert.isNotNull(anulada.anulada_en)
        assert.equal(await factura(f.id).then((r) => r.pagado), '0.00')
        assert.equal(await factura(f.id).then((r) => r.estado), 'emitida')
        const asientos = await db
            .from('ledger.asientos')
            .where({ origen_tipo: 'nota_credito', origen_id: nota.id })
            .orderBy('id')
        assert.lengthOf(asientos, 2)
        assert.equal(asientos[1].reversa_de, asientos[0].id)
        assert.equal(await saldo(e.B, IVA_DEBITO), '-16.07')
        await afirmarLibro(assert, e.B)
        const otra = await errorDe(
            new AnularNotaCredito().execute({ nota_id: nota.id, motivo: 'otra vez' }, e.ctx),
        )
        assert.equal(otra.codigo, 'nota_anulada')

        // una NCRE certificada no se anula con esta acción
        const certificada = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '10.00', motivo: 'descuento' },
            e.ctx,
        )
        await cola(e)
        const noSe = await errorDe(
            new AnularNotaCredito().execute({ nota_id: certificada.id, motivo: 'no corresponde' }, e.ctx),
        )
        assert.equal(noSe.codigo, 'ncre_certificada')
        // una nota interna (sin NCRE) tampoco
        const interna = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const ni = await new EmitirNotaCredito().execute(
            { factura_id: interna.facturas[0]!.id, monto: '5.00', motivo: 'interna' },
            e.ctx,
        )
        const sinNcre = await errorDe(
            new AnularNotaCredito().execute({ nota_id: ni.id, motivo: 'prueba' }, e.ctx),
        )
        assert.equal(sinNcre.codigo, 'nota_sin_ncre_rechazada')
        await afirmarLibro(assert, e.B)
    })
})
