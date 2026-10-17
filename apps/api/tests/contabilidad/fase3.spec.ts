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
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import { CERO, dec } from '#ledger/dinero'
import { controlFelFalso } from '#fiscal/fel/falso'
import { lineas, sacarDeLaColaFel, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import {
    IVA_DEBITO,
    IVA_POR_CERTIFICAR,
    adelantarReintento,
    cola,
    datosNit,
    dtesDe,
    empresasFel,
    eventosDe,
    factura,
    saldo,
    servicioFel,
} from '#tests/fiscal/ayudas_fel'

/**
 * Auditor contable · invariantes de la localización fiscal, fase 3 (FEL), activados desde
 * `pendientes_fases.spec.ts`. Cada escenario se arma con las acciones (proveedor FEL falso) y se
 * comprueba en cada paso con `afirmarLibro`, que además revisa `12.iva_por_certificar_distinto`,
 * `12.por_certificar_con_asiento_o_evento` y `12.reclasificacion_sin_dte_certificado`.
 */

/** Σ IVA de los avisos sin DTE certificado − sus notas internas, calculado aparte del producto. */
async function ivaDeAvisosSinDte(empresaId: number): Promise<string> {
    const avisos = (await db
        .from('billing.facturas')
        .where('empresa_id', empresaId)
        .where('aviso_cobro', true)
        .whereNot('estado', 'anulada')
        .select('id', 'tipo', 'iva')) as Array<{ id: number; tipo: string; iva: string }>
    let total = CERO
    for (const a of avisos) {
        const dtes = await dtesDe(a.tipo === 'mora' ? 'nota_debito' : 'factura', a.id)
        if (dtes.some((d) => d.estado === 'certificado' || d.estado === 'anulacion_pendiente')) continue
        const notas = await db
            .from('billing.notas_credito')
            .where('factura_id', a.id)
            .sum('iva as iva')
            .first()
        total = total.plus(a.iva).minus(dec(notas?.iva ?? 0))
    }
    // 2.1.11 es pasivo: su saldo (debe − haber) es negativo
    return total.negated().toFixed(2)
}

test.group('Auditor contable · fase 3 (FEL)', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('2.1.11 IVA por certificar = IVA de los avisos de cobro sin DTE · localización fiscal, fase 3 (FEL)', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const paso = async (nombre: string) => {
            for (const empresa of [e.B, e.C]) {
                assert.equal(
                    await saldo(empresa, IVA_POR_CERTIFICAR),
                    await ivaDeAvisosSinDte(empresa),
                    nombre,
                )
            }
            await afirmarLibro(assert, [e.B, e.C])
        }
        const a = await servicioFel(e, 'pagar', '150.00')
        const b = await servicioFel(e, 'pagar', '224.00')
        const c = await servicioFel(e, 'pagar', '99.99', undefined, e.C)
        await paso('tres avisos emitidos')

        // pago parcial: el IVA sigue en 2.1.11
        await new RegistrarPago().execute(
            { cliente_id: a.clienteId, metodo: 'caja', monto: '75.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        await paso('pago parcial')

        // nota interna en un aviso sin DTE
        await new EmitirNotaCredito().execute(
            { factura_id: b.facturas[0]!.id, monto: '24.00', motivo: 'descuento' },
            e.ctx,
        )
        await paso('nota interna')

        // pago anulado antes de certificar
        const pagoC = await new RegistrarPago().execute(
            { cliente_id: c.clienteId, metodo: 'caja', monto: '99.99', empresa_id: e.C },
            e.ctx,
        )
        await new AnularPago().execute({ pago_id: pagoC.id, motivo: 'error' }, e.ctx)
        await cola(e)
        assert.lengthOf(await dtesDe('factura', c.facturas[0]!.id), 0)
        await paso('pago anulado antes de certificar')

        // cubiertos: se certifican y 2.1.11 baja; 2.1.02 sube lo mismo
        await new RegistrarPago().execute(
            { cliente_id: a.clienteId, metodo: 'caja', monto: '75.00', empresa_id: e.B },
            e.ctx,
        )
        const pagoB = await new RegistrarPago().execute(
            { cliente_id: b.clienteId, metodo: 'caja', monto: '200.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        await paso('dos avisos certificados')
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '0.00')
        assert.equal(await saldo(e.B, IVA_DEBITO), '-37.50')

        // pago anulado después de certificar: el DTE sigue certificado y 2.1.02 no cambia
        await new AnularPago().execute({ pago_id: pagoB.id, motivo: 'cheque rechazado' }, e.ctx)
        assert.equal(await dtesDe('factura', b.facturas[0]!.id).then((r) => r[0]!.estado), 'certificado')
        assert.equal(await saldo(e.B, IVA_DEBITO), '-37.50')
        await paso('pago anulado después de certificar')

        // mora con IVA (solo el contador lo activa): aviso que sale NDEB referida a su factura
        await new EditarParametro().execute(
            {
                clave: 'mora_con_iva',
                valor: true,
                vigente_desde: '2026-01-01',
                motivo: 'contador',
                empresa_id: e.C,
            },
            { ...e.ctx, empresaId: e.C },
        )
        const d = await servicioFacturado(e.C, '2026-10-01', {
            precio: '150.00',
            instalacion: '2026-10-01',
            plantilla: { certificar_al: 'pagar', mora_tipo: 'fija', mora_valor: '22.40', dias_gracia: 0 },
        })
        const vencida = await new VencerFactura().execute(
            { factura_id: d.facturas[0]!.id, hoy: '2026-10-17' },
            e.ctx,
        )
        const mora = await factura(vencida.moras[0]!)
        assert.containSubset(mora, { tipo: 'mora', aviso_cobro: true, iva: '2.40' })
        await paso('mora con IVA como aviso')
        await new RegistrarPago().execute(
            { cliente_id: d.clienteId, metodo: 'caja', monto: '172.40', empresa_id: e.C },
            e.ctx,
        )
        await cola(e)
        await cola(e)
        const [ndeb] = await dtesDe('nota_debito', mora.id)
        assert.containSubset(ndeb, { tipo_dte: 'NDEB', estado: 'certificado' })
        assert.equal(
            ndeb!.referencia.autorizacion,
            await dtesDe('factura', d.facturas[0]!.id).then((r) => r[0]!.autorizacion),
        )
        await paso('mora certificada como NDEB')
    })

    test('FEL obligatoria + emitir: la factura por_certificar no tiene asiento ni evento · localización fiscal, fase 3 (FEL)', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const cliente = await crearClienteFila(datosNit())
        controlFelFalso.siguiente.push('caida')
        const s = await servicioFel(e, 'emitir', '150.00', cliente)
        const f = s.facturas[0]!
        assert.equal(f.estado, 'por_certificar')
        await afirmarLibro(assert, e.B)
        assert.lengthOf(await lineas('factura', f.id), 0)

        // dos fallos (el primero ya había quedado certificado en el certificador)
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        await adelantarReintento(Number(dte!.id))
        await cola(e)
        assert.equal(await factura(f.id).then((r) => r.estado), 'emitida')
        assert.equal(controlFelFalso.llamadas.certificar, 1)
        assert.lengthOf(await dtesDe('factura', f.id), 1)
        // un solo asiento, con la fecha de certificación
        const asientos = await db.from('ledger.asientos').where({ origen_tipo: 'factura', origen_id: f.id })
        assert.lengthOf(asientos, 1)
        const certificado = await dtesDe('factura', f.id).then((r) => r[0]!)
        const fechaCert = await db.rawQuery(
            `SELECT to_char((certificado_en AT TIME ZONE 'America/Guatemala')::date, 'YYYY-MM-DD') AS f FROM fiscal.dte WHERE id = ?`,
            [certificado.id],
        )
        const fechaAsiento = await db.rawQuery(
            `SELECT to_char(fecha, 'YYYY-MM-DD') AS f FROM ledger.asientos WHERE id = ?`,
            [asientos[0].id],
        )
        assert.equal(fechaAsiento.rows[0].f, fechaCert.rows[0].f)
        assert.lengthOf(await eventosDe('factura.emitida', 'factura_id', f.id), 1)
        await cola(e)
        assert.lengthOf(
            await db.from('ledger.asientos').where({ origen_tipo: 'factura', origen_id: f.id }),
            1,
        )
        assert.deepEqual(await verificarLibro(e.B), [])
    })

    test('anulación de DTE y NCRE: reverso exacto del asiento de la factura · localización fiscal, fase 3 (FEL)', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        /** Lo que queda de cada cuenta del asiento original de la factura después de su corrección. */
        const residuos = async (facturaId: number) => {
            const filas = await db.rawQuery(
                `SELECT c.codigo, sum(m.debe - m.haber)::text AS saldo
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE (a.origen_tipo IN ('factura', 'mora') AND a.origen_id = ?)
                     OR (a.origen_tipo = 'nota_credito' AND a.origen_id IN (SELECT id FROM billing.notas_credito WHERE factura_id = ?))
                     OR (a.origen_tipo = 'reclasificacion' AND a.origen_id IN (SELECT id FROM fiscal.dte WHERE documento_tipo = 'factura' AND documento_id = ?))
                  GROUP BY c.codigo HAVING sum(m.debe - m.haber) <> 0`,
                [facturaId, facturaId, facturaId],
            )
            return filas.rows
        }

        // aviso certificado y anulado dentro del plazo: factura, IVA y reclasificación vuelven a cero
        const aviso = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const fa = aviso.facturas[0]!
        await new SolicitarCertificacion().execute({ factura_id: fa.id }, e.ctx)
        await cola(e)
        const [dteAviso] = await dtesDe('factura', fa.id)
        assert.lengthOf(await lineas('reclasificacion', Number(dteAviso!.id)), 2)
        await new AnularFactura().execute({ factura_id: fa.id, motivo: 'mal emitida' }, e.ctx)
        await cola(e)
        assert.equal(await factura(fa.id).then((r) => r.estado), 'anulada')
        assert.deepEqual(await residuos(fa.id), [])
        await afirmarLibro(assert, e.B)

        // factura certificada acreditada al 100 % con NCRE (en dos notas): cada cuenta en cero
        const emitida = await servicioFel(e, 'emitir', '224.00', await crearClienteFila(datosNit()))
        const fe = emitida.facturas[0]!
        await cola(e)
        await new EmitirNotaCredito().execute(
            { factura_id: fe.id, monto: '100.01', motivo: 'parcial' },
            e.ctx,
        )
        await new EmitirNotaCredito().execute({ factura_id: fe.id, monto: '123.99', motivo: 'resto' }, e.ctx)
        await cola(e)
        const notas = await db.from('billing.notas_credito').where('factura_id', fe.id).select('id')
        for (const n of notas) {
            assert.equal(await dtesDe('nota_credito', n.id).then((r) => r[0]!.estado), 'certificado')
        }
        assert.deepEqual(await residuos(fe.id), [])
        await afirmarLibro(assert, e.B)
    })

    test('ningún documento tiene dos DTE vigentes: pedir la certificación otra vez devuelve el mismo (auditor, fase 3)', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        const primera = await new SolicitarCertificacion().execute({ factura_id: f.id }, e.ctx)
        const segunda = await new SolicitarCertificacion().execute({ factura_id: f.id }, e.ctx)
        assert.equal(segunda.dte?.id, primera.dte?.id)
        assert.isFalse(segunda.creado)
        await cola(e)
        const tercera = await new SolicitarCertificacion().execute({ factura_id: f.id }, e.ctx)
        assert.equal(tercera.dte?.id, primera.dte?.id)
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        assert.lengthOf(await dtesDe('factura', f.id), 1)
        assert.equal(controlFelFalso.llamadas.certificar, 1)
        await afirmarLibro(assert, e.B)
    })
})
