import { test } from '@japa/runner'
import { unicoBdMayusculas } from '#tests/billing/ayudas_billing'
import db from '@adonisjs/lucid/services/db'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { lineas, prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { periodosHasta } from '#billing/periodos'
import EmitirFactura from '#billing/actions/emitir_factura'
import CrearAdicional from '#core/actions/crear_adicional'
import AgregarAdicionalServicio from '#core/actions/agregar_adicional_servicio'
import QuitarAdicionalServicio from '#core/actions/quitar_adicional_servicio'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'

/**
 * Línea mensual de los adicionales `cobrado` (contrato `adicionales.md`): una línea por asignación
 * vigente en el periodo, a su precio con IVA incluido; `incluido` y `cortesia` no generan línea; la
 * factura es única por periodo y cada asignación tiene a lo sumo una línea por periodo en ella.
 * Decisiones del PM (19 oct): un periodo que empieza con el servicio suspendido (asignación bloqueada)
 * no cobra los adicionales; el primer periodo se cobra según `primer_periodo` (`prorrateado`: los días
 * desde `cobrado_desde` en la siguiente factura; `sin_costo`: nada).
 */

const PERIODOS = periodosHasta({ ciclo: 'dia_fijo', dia: 1, prorrateo: true }, '2026-10-01', '2026-12-01')
const OCTUBRE = PERIODOS[0]!
const NOVIEMBRE = PERIODOS[1]!
const DICIEMBRE = PERIODOS[2]!

/** `cobrado_desde` fijo (medianoche de Guatemala del día dado) para no depender de la fecha de hoy. */
async function cobradoDesde(asignaciones: number[], dia: string) {
    await db.rawQuery(
        `UPDATE core.servicios_adicionales
            SET cobrado_desde = (?::date)::timestamp AT TIME ZONE 'America/Guatemala'
          WHERE id = ANY(?::bigint[])`,
        [dia, asignaciones],
    )
}

/**
 * `baja_en` o `bloqueado_en` fijo (mediodía de Guatemala del día dado): `QuitarAdicionalServicio` y el
 * bloqueo por suspensión los fechan con el reloj real, y desde el 1 de noviembre (o en enero) «hoy» ya
 * cae dentro del periodo que la prueba factura.
 */
async function fijarFecha(columna: 'baja_en' | 'bloqueado_en', asignaciones: number[], dia: string) {
    await db.rawQuery(
        `UPDATE core.servicios_adicionales
            SET ${columna} = (?::date + time '12:00') AT TIME ZONE 'America/Guatemala'
          WHERE id = ANY(?::bigint[])`,
        [dia, asignaciones],
    )
}

async function lineasAdicionales(facturaId: number) {
    const filas = await db
        .from('billing.facturas_lineas')
        .where('factura_id', facturaId)
        .whereNotNull('servicio_adicional_id')
        .orderBy('id')
        .select(
            'total',
            'servicio_adicional_id',
            db.raw(`to_char(adicional_periodo, 'YYYY-MM-DD') as periodo`),
        )
    return filas.map((l) => [l.total, Number(l.servicio_adicional_id), l.periodo])
}

async function conIptv(empresas: Awaited<ReturnType<typeof prepararEmpresas>>) {
    const s = await servicioEn(empresas.B, { precio: '150.00', instalacion: '2026-10-01' })
    const iptv = await new CrearAdicional().execute(
        { empresa_id: empresas.B, codigo: await unicoBdMayusculas('IPTV'), nombre: 'Usuario de IPTV' },
        empresas.ctx,
    )
    const agregar = (datos: Record<string, unknown>) =>
        new AgregarAdicionalServicio().execute(
            { servicio_id: s.servicioId, adicional_id: iptv.id, ...datos } as never,
            empresas.ctx,
        )
    return { ...s, agregar }
}

test.group('Facturas · adicionales cobrados', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('una línea por cada cobrado vigente; incluido, cortesía y los dados de baja no; sin duplicar', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B, { precio: '150.00', instalacion: '2026-10-01' })
        const iptv = await new CrearAdicional().execute(
            { empresa_id: e.B, codigo: await unicoBdMayusculas('IPTV'), nombre: 'Usuario de IPTV' },
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
        // se cobran desde el primer día de octubre (octubre aún sin facturar: noviembre va completo)
        await cobradoDesde([primero.id, segundo.id, retirado.id], OCTUBRE.periodo)
        await new QuitarAdicionalServicio().execute(
            { servicio_id: s.servicioId, id: retirado.id, version: retirado.version, motivo: 'ya no lo usa' },
            e.ctx,
        )
        await fijarFecha('baja_en', [retirado.id], '2026-10-20')

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
                adicional_periodo: NOVIEMBRE.periodo,
            }),
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('primer periodo prorrateado: los días desde cobrado_desde van en la siguiente factura, una sola vez', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await conIptv(e)
        const octubre = await new EmitirFactura().execute(
            { servicio_id: s.servicioId, periodo: OCTUBRE },
            e.ctx,
        )
        assert.deepEqual(await lineasAdicionales(octubre.factura_id!), [])
        // se agrega el 20 de octubre, con octubre ya facturado
        const tv = await s.agregar({ modalidad: 'cobrado', precio: '35.00', identificador: 'tv-1' })
        assert.equal(tv.primer_periodo, 'prorrateado')
        await cobradoDesde([tv.id], '2026-10-20')

        const noviembre = await new EmitirFactura().execute(
            { servicio_id: s.servicioId, periodo: NOVIEMBRE },
            e.ctx,
        )
        // 35 × 12/31 (del 20 al 31 de octubre) = 13.55, y noviembre completo
        assert.deepEqual(await lineasAdicionales(noviembre.factura_id!), [
            ['13.55', tv.id, OCTUBRE.periodo],
            ['35.00', tv.id, NOVIEMBRE.periodo],
        ])
        const conceptos = await db
            .from('billing.facturas_lineas')
            .where('factura_id', noviembre.factura_id!)
            .where('servicio_adicional_id', tv.id)
            .orderBy('id')
            .select('concepto')
        assert.match(conceptos[0]!.concepto, /primer periodo, 12\/31 días desde el 2026-10-20/)
        // diciembre: solo su periodo; el prorrateo ya se cobró
        const diciembre = await new EmitirFactura().execute(
            { servicio_id: s.servicioId, periodo: DICIEMBRE },
            e.ctx,
        )
        assert.deepEqual(await lineasAdicionales(diciembre.factura_id!), [
            ['35.00', tv.id, DICIEMBRE.periodo],
        ])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('primer periodo sin costo: el periodo de cobrado_desde no se cobra; si aún no se facturaba, va prorrateado en él', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await conIptv(e)
        const gratis = await s.agregar({
            modalidad: 'cobrado',
            precio: '35.00',
            identificador: 'tv-1',
            primer_periodo: 'sin_costo',
        })
        const prorrateado = await s.agregar({ modalidad: 'cobrado', precio: '31.00', identificador: 'tv-2' })
        await cobradoDesde([gratis.id, prorrateado.id], '2026-10-20')
        // octubre se factura después del alta: el prorrateado va en su propia factura, el sin costo no
        const octubre = await new EmitirFactura().execute(
            { servicio_id: s.servicioId, periodo: OCTUBRE },
            e.ctx,
        )
        assert.deepEqual(await lineasAdicionales(octubre.factura_id!), [
            ['12.00', prorrateado.id, OCTUBRE.periodo],
        ])
        const noviembre = await new EmitirFactura().execute(
            { servicio_id: s.servicioId, periodo: NOVIEMBRE },
            e.ctx,
        )
        assert.deepEqual(await lineasAdicionales(noviembre.factura_id!), [
            ['35.00', gratis.id, NOVIEMBRE.periodo],
            ['31.00', prorrateado.id, NOVIEMBRE.periodo],
        ])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('servicio suspendido: el periodo que empieza con la asignación bloqueada no cobra el adicional; el plan sí', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await conIptv(e)
        const tv = await s.agregar({ modalidad: 'cobrado', precio: '35.00', identificador: 'tv-1' })
        await cobradoDesde([tv.id], OCTUBRE.periodo)
        await new CambiarEstadoServicio().execute(
            { servicioId: s.servicioId, nuevo: 'suspendido', motivo: 'mora' },
            e.ctx,
        )
        const bloqueada = await db.from('core.servicios_adicionales').where('id', tv.id).firstOrFail()
        assert.equal(bloqueada.bloqueo, 'bloqueado')
        // bloqueado en octubre: diciembre empieza con el servicio suspendido
        await fijarFecha('bloqueado_en', [tv.id], '2026-10-20')
        const suspendido = await new EmitirFactura().execute(
            { servicio_id: s.servicioId, periodo: DICIEMBRE },
            e.ctx,
        )
        assert.deepEqual(await lineasAdicionales(suspendido.factura_id!), [])
        const plan = await db.from('billing.facturas').where('id', suspendido.factura_id!).firstOrFail()
        assert.equal(plan.total, '150.00')

        // reactivado antes de que empiece el periodo: vuelve a cobrarse
        const otro = await conIptv(e)
        const tv2 = await otro.agregar({ modalidad: 'cobrado', precio: '35.00', identificador: 'tv-9' })
        await cobradoDesde([tv2.id], OCTUBRE.periodo)
        await new CambiarEstadoServicio().execute(
            { servicioId: otro.servicioId, nuevo: 'suspendido', motivo: 'mora' },
            e.ctx,
        )
        await new CambiarEstadoServicio().execute(
            { servicioId: otro.servicioId, nuevo: 'activo', motivo: 'pagó' },
            e.ctx,
        )
        const activo = await new EmitirFactura().execute(
            { servicio_id: otro.servicioId, periodo: DICIEMBRE },
            e.ctx,
        )
        assert.deepEqual(await lineasAdicionales(activo.factura_id!), [['35.00', tv2.id, DICIEMBRE.periodo]])
        await afirmarLibro(assert, [e.B, e.C])
    })
})
