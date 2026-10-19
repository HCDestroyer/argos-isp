import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { generar } from '#tests/billing/ayudas_billing'
import {
    errorDe,
    lineas,
    prepararEmpresas,
    saldoCuenta,
    servicioEn,
} from '#tests/contabilidad/ayudas_contabilidad'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import CrearPremio from '#lealtad/actions/crear_premio'
import Canjear from '#lealtad/actions/canjear'
import RevertirCanje from '#lealtad/actions/revertir_canje'

/**
 * Decisión del PM (19 oct): **una factura de valor 0 nunca se genera**. Un mes gratis (canje de lealtad)
 * deja el periodo en cero: el cron registra una **bonificación** (`billing.bonificaciones`) con el
 * motivo «Canje de lealtad», su asiento interno `5.1.01 / 4.1.01` por la base (sin CxC ni IVA), el
 * periodo ocupado y el canje aplicado a ella.
 *
 * El inv. 9 del auditor conoce el origen `bonificacion` y `9.bonificacion_mal_contabilizada` revisa su
 * asiento (antes `.fails` «H-bonificacion»): no queda nada pendiente del auditor.
 */

const PENDIENTES_DEL_AUDITOR: string[] = []

async function otrasViolaciones(empresas: number[]) {
    const violaciones = await verificarLibro(empresas)
    return violaciones.filter((v) => !PENDIENTES_DEL_AUDITOR.some((p) => v.invariante.startsWith(p)))
}

test.group('Facturación · bonificaciones (nunca una factura de Q0)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('mes gratis por canje: el cron registra una bonificación, ocupa el periodo y no se duplica', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { programa } = await programaConReglas(e.B, e.ctx)
        const s = await servicioEn(e.B, { precio: '200.00', instalacion: '2026-10-01' })
        await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 100, motivo: 'saldo de la prueba' },
            e.ctx,
        )
        const premio = await new CrearPremio().execute(
            { programa_id: programa.id, nombre: unico('Mes gratis'), tipo: 'mes_gratis', costo_puntos: 50 },
            e.ctx,
        )
        const canje = await new Canjear().execute(
            { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: premio.id },
            e.ctx,
        )
        assert.equal(canje.estado, 'reservado')

        const primera = await generar(s.servicioId, '2026-11-01')
        assert.include(primera, { generadas: 1, bonificadas: 1 })
        const [b] = await db.from('billing.bonificaciones').where('servicio_id', s.servicioId)
        assert.include(b, {
            clave_unica: `${s.servicioId}-2026-10-01`,
            origen: 'mes_gratis',
            bruto: '200.00',
            base: '178.57',
            canje_id: canje.id,
        })
        assert.deepEqual(primera.bonificaciones, [Number(b.id)])
        const motivo = await db.from('billing.motivos_sin_costo').where('id', b.motivo_id).firstOrFail()
        assert.include(motivo, { nombre: 'Canje de lealtad', empresa_id: e.B })
        assert.deepEqual(await lineas('bonificacion', Number(b.id)), [
            ['5.1.01', '178.57', '0.00'],
            ['4.1.01', '0.00', '178.57'],
        ])
        // octubre no tiene factura (solo la bonificación); noviembre sí, completa
        const facturas = await db
            .from('billing.facturas')
            .where('servicio_id', s.servicioId)
            .orderBy('id')
            .select(db.raw(`to_char(periodo, 'YYYY-MM-DD') as periodo`), 'total')
        assert.deepEqual(
            facturas.map((f) => [f.periodo, f.total]),
            [['2026-11-01', '200.00']],
        )
        assert.equal(await saldoCuenta(e.B, '1.1.03', s.clienteId), '200.00')

        const aplicado = await db.from('lealtad.canjes').where('id', canje.id).firstOrFail()
        assert.include(aplicado, { estado: 'aplicado', descuento: '200.00', factura_id: null })
        assert.equal(Number(aplicado.bonificacion_id), Number(b.id))
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'lealtad.canje_aplicado')
            .whereRaw(`(payload->>'canje_id')::bigint = ?`, [canje.id])
            .firstOrFail()
        assert.include(evento.payload, { factura_id: null, bonificacion_id: Number(b.id) })
        const registrada = await db
            .from('audit.outbox')
            .where('evento', 'bonificacion.registrada')
            .whereRaw(`(payload->>'bonificacion_id')::bigint = ?`, [b.id])
            .firstOrFail()
        assert.include(registrada.payload, { origen: 'mes_gratis', bruto: '200.00', periodo: '2026-10-01' })

        // otra corrida: nada nuevo (el periodo bonificado está ocupado)
        const segunda = await generar(s.servicioId, '2026-11-01')
        assert.include(segunda, { generadas: 0, bonificadas: 0, omitidas: 2 })
        const cuantas = await db
            .from('billing.bonificaciones')
            .where('servicio_id', s.servicioId)
            .count('* as n')
        assert.equal(Number(cuantas[0]!.n), 1)
        // la base tampoco deja una factura en la clave bonificada, ni una factura nueva en cero
        await assert.rejects(() =>
            db.table('billing.facturas').insert({
                empresa_id: e.B,
                cliente_id: s.clienteId,
                servicio_id: s.servicioId,
                tipo: 'servicio',
                periodo: '2026-10-01',
                clave_unica: `${s.servicioId}-2026-10-01`,
                vence_en: '2026-10-06',
                estado: 'emitida',
                subtotal: '1.00',
                iva: '0.00',
                total: '1.00',
                reglas_snapshot: '{}',
            }),
        )
        await assert.rejects(() =>
            db.table('billing.facturas').insert({
                empresa_id: e.B,
                cliente_id: s.clienteId,
                servicio_id: s.servicioId,
                tipo: 'servicio',
                periodo: '2026-12-01',
                clave_unica: unico('cero'),
                vence_en: '2026-12-06',
                estado: 'pagada',
                subtotal: '0.00',
                iva: '0.00',
                total: '0.00',
                reglas_snapshot: '{}',
            }),
        )
        // la bonificación es de solo inserción y el canje aplicado a ella no se revierte
        await assert.rejects(() =>
            db.from('billing.bonificaciones').where('id', b.id).update({ concepto: 'x' }),
        )
        const revertir = await errorDe(new RevertirCanje().execute({ id: canje.id, motivo: 'no' }, e.ctx))
        assert.equal(revertir.codigo, 'canje_no_revertible')
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    test('H-bonificacion (mes gratis): el libro con una bonificación queda limpio para el auditor', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { programa } = await programaConReglas(e.B, e.ctx)
        const s = await servicioEn(e.B, { precio: '200.00', instalacion: '2026-10-01' })
        await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 100, motivo: 'saldo de la prueba' },
            e.ctx,
        )
        const premio = await new CrearPremio().execute(
            { programa_id: programa.id, nombre: unico('Mes gratis'), tipo: 'mes_gratis', costo_puntos: 50 },
            e.ctx,
        )
        await new Canjear().execute(
            { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: premio.id },
            e.ctx,
        )
        await generar(s.servicioId, '2026-10-01')
        await afirmarLibro(assert, [e.B, e.C])
    })
})
