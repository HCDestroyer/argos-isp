import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { prepararEmpresas, sacarDeLaColaFel, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { cola, empresasFel } from '#tests/fiscal/ayudas_fel'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import CrearConceptoCargo from '#billing/actions/crear_concepto_cargo'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · cargo único (`a3/cargo-unico`): cada línea acredita la cuenta de su concepto
 * (`facturas_lineas.cuenta_codigo`), las notas y los descuentos rebajan esa cuenta, y un Q0 sin costo
 * nace pagado, sin CxC ni DTE. Solo `verificarLibro` (el auditor), sin aserciones de A3.
 */

async function conceptoId(empresaId: number, nombre: string) {
    const fila = await db
        .from('billing.conceptos_cargo')
        .where({ empresa_id: empresaId, nombre })
        .firstOrFail()
    return Number(fila.id)
}

test.group('Auditor contable · cargo único', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('líneas con cuentas propias, descuento y notas por línea y por monto: el libro por cuenta cuadra', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B, { precio: '150.00', instalacion: '2026-09-01' })
        const propio = await new CrearConceptoCargo().execute(
            { empresa_id: e.B, nombre: 'Traslado', cuenta_codigo: '4.1.04' },
            e.ctx,
        )
        const f = await new EmitirCargoUnico().execute(
            {
                servicio_id: s.servicioId,
                lineas: [
                    { concepto_id: await conceptoId(e.B, 'Instalación'), precio_unitario: '300.00' },
                    {
                        concepto_id: propio.id,
                        precio_unitario: '224.00',
                        descuentos: [{ concepto: 'Promoción', monto: '33.33' }],
                    },
                ],
            },
            e.ctx,
        )
        assert.deepEqual(await verificarLibro([e.B, e.C]), [])
        const traslado = await db
            .from('billing.facturas_lineas')
            .where({ factura_id: f.id, cuenta_codigo: '4.1.04' })
            .whereNot('tipo', 'descuento')
            .firstOrFail()
        await new EmitirNotaCredito().execute(
            {
                factura_id: f.id,
                lineas: [{ linea_id: Number(traslado.id), monto: '100.00' }],
                motivo: 'parcial',
            },
            e.ctx,
        )
        assert.deepEqual(await verificarLibro([e.B, e.C]), [])
        // el resto entero por monto: cada cuenta queda acreditada por su neto (sin el descuento)
        const factura = await db.from('billing.facturas').where('id', f.id).firstOrFail()
        const resto = (Number(factura.total) - 100).toFixed(2)
        await new EmitirNotaCredito().execute({ factura_id: f.id, monto: resto, motivo: 'por monto' }, e.ctx)
        assert.deepEqual(await verificarLibro([e.B, e.C]), [])
    })

    test('Q0 sin costo con FEL obligatoria: pagado, sin CxC ni DTE después de la cola', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioEn(e.B, {
            precio: '150.00',
            instalacion: '2026-09-01',
            plantilla: { certificar_al: 'emitir' },
        })
        const motivo = await db
            .from('billing.motivos_sin_costo')
            .where({ empresa_id: e.B, nombre: 'Garantía' })
            .firstOrFail()
        await new EmitirCargoUnico().execute(
            {
                servicio_id: s.servicioId,
                lineas: [
                    {
                        concepto_id: await conceptoId(e.B, 'Equipo'),
                        precio_unitario: '450.00',
                        descuentos: [{ concepto: 'Cambio por garantía', monto: '450.00' }],
                    },
                ],
                motivo_sin_costo_id: Number(motivo.id),
                motivo_sin_costo_texto: 'router dañado de fábrica',
            },
            e.ctx,
        )
        await cola(e)
        assert.deepEqual(await verificarLibro([e.B, e.C]), [])
    })
})
