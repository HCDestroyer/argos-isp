import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { lineas, prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { periodosHasta } from '#billing/periodos'
import EmitirFactura from '#billing/actions/emitir_factura'
import CrearAdicional from '#core/actions/crear_adicional'
import AgregarAdicionalServicio from '#core/actions/agregar_adicional_servicio'
import QuitarAdicionalServicio from '#core/actions/quitar_adicional_servicio'

/**
 * Línea mensual de los adicionales `cobrado` (contrato `adicionales.md`): una línea por asignación
 * vigente en el periodo, a su precio con IVA incluido; `incluido` y `cortesia` no generan línea; la
 * factura es única por periodo y cada asignación tiene a lo sumo una línea en ella.
 */

const NOVIEMBRE = periodosHasta(
    { ciclo: 'dia_fijo', dia: 1, prorrateo: true },
    '2026-10-01',
    '2026-11-01',
)[1]!

test.group('Facturas · adicionales cobrados', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('una línea por cada cobrado vigente; incluido, cortesía y los dados de baja no; sin duplicar', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B, { precio: '150.00', instalacion: '2026-10-01' })
        const iptv = await new CrearAdicional().execute(
            { empresa_id: e.B, codigo: unico('IPTV').toUpperCase(), nombre: 'Usuario de IPTV' },
            e.ctx,
        )
        const agregar = (datos: Record<string, unknown>) =>
            new AgregarAdicionalServicio().execute(
                { servicio_id: s.servicioId, adicional_id: iptv.id, ...datos } as never,
                e.ctx,
            )
        const primero = await agregar({ modalidad: 'cobrado', precio: '35.00', identificador: 'tv-1' })
        const segundo = await agregar({ modalidad: 'cobrado', precio: '35.00', identificador: 'tv-2' })
        const motivo = (await db
            .from('core.motivos_cortesia')
            .whereNull('empresa_id')
            .where('codigo', 'PROMOCION')
            .select('id')
            .firstOrFail()) as { id: number }
        await agregar({ modalidad: 'cortesia', motivo_id: Number(motivo.id) })
        await agregar({ modalidad: 'incluido' })
        // dado de baja antes de que empiece el periodo: no se cobra
        const retirado = await agregar({ modalidad: 'cobrado', precio: '20.00', identificador: 'tv-3' })
        await new QuitarAdicionalServicio().execute(
            { servicio_id: s.servicioId, id: retirado.id, version: retirado.version, motivo: 'ya no lo usa' },
            e.ctx,
        )

        const r = await new EmitirFactura().execute({ servicio_id: s.servicioId, periodo: NOVIEMBRE }, e.ctx)
        assert.isTrue(r.creada)
        const filas = await db
            .from('billing.facturas_lineas')
            .where('factura_id', r.factura_id!)
            .orderBy('id')
            .select('tipo', 'concepto', 'total', 'iva', 'servicio_adicional_id')
        assert.deepEqual(
            filas.map((l) => [
                l.tipo,
                l.total,
                l.iva,
                l.servicio_adicional_id === null ? null : Number(l.servicio_adicional_id),
            ]),
            [
                ['servicio', '150.00', '16.07', null],
                ['otro', '35.00', '3.75', primero.id],
                ['otro', '35.00', '3.75', segundo.id],
            ],
        )
        assert.equal(filas[1]!.concepto, 'Usuario de IPTV (tv-1)')
        const factura = await db.from('billing.facturas').where('id', r.factura_id!).firstOrFail()
        assert.include(factura, { total: '220.00', iva: '23.57', subtotal: '196.43' })
        assert.deepEqual(await lineas('factura', r.factura_id!), [
            ['1.1.03', '220.00', '0.00'],
            ['4.1.01', '0.00', '133.93'],
            ['4.1.03', '0.00', '62.50'],
            ['2.1.02', '0.00', '23.57'],
        ])

        // el mismo periodo otra vez: ni factura ni líneas nuevas
        const otra = await new EmitirFactura().execute(
            { servicio_id: s.servicioId, periodo: NOVIEMBRE },
            e.ctx,
        )
        assert.include(otra, { creada: false, factura_id: r.factura_id })
        const total = await db
            .from('billing.facturas_lineas as l')
            .join('billing.facturas as f', 'f.id', 'l.factura_id')
            .where('f.servicio_id', s.servicioId)
            .where('l.servicio_adicional_id', primero.id)
            .count('* as n')
            .firstOrFail()
        assert.equal(Number(total.n), 1)
        // la base rechaza una segunda línea de la misma asignación en la factura
        await assert.rejects(() =>
            db.table('billing.facturas_lineas').insert({
                factura_id: r.factura_id!,
                concepto: 'duplicada',
                tipo: 'otro',
                cantidad: 1,
                precio_unitario: '35.00',
                gravable: true,
                iva: '3.75',
                total: '35.00',
                servicio_adicional_id: primero.id,
            }),
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})
