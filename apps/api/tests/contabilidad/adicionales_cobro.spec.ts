import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { periodosHasta } from '#billing/periodos'
import EmitirFactura from '#billing/actions/emitir_factura'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import SustituirFactura from '#billing/actions/sustituir_factura'
import AnularFactura from '#billing/actions/anular_factura'
import CrearAdicional from '#core/actions/crear_adicional'
import AgregarAdicionalServicio from '#core/actions/agregar_adicional_servicio'

/**
 * Auditor contable · adicionales cobrados en la factura del periodo (`a3/adicionales-cobro`): la
 * vigencia en hora de Guatemala en los bordes del periodo, el prorrateo del plan, y la nota, la
 * sustitución y la anulación de una factura con esas líneas, con el libro verificado en cada paso.
 */

const [OCTUBRE, NOVIEMBRE] = periodosHasta(
    { ciclo: 'dia_fijo', dia: 1, prorrateo: true },
    '2026-10-01',
    '2026-11-01',
)

async function lineasAdicionales(facturaId: number) {
    return (await db
        .from('billing.facturas_lineas')
        .where('factura_id', facturaId)
        .whereNotNull('servicio_adicional_id')
        .orderBy('id')
        .select('id', 'total', 'iva', 'servicio_adicional_id')) as Array<{
        id: number
        total: string
        iva: string
        servicio_adicional_id: number
    }>
}

test.group('Auditor contable · adicionales cobrados', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('vigencia en hora de Guatemala: alta y baja en los bordes del periodo (UTC de otro día)', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B, { precio: '150.00', instalacion: '2026-10-01' })
        const tv = await new CrearAdicional().execute(
            { empresa_id: e.B, codigo: unico('TV').toUpperCase(), nombre: 'Usuario de IPTV' },
            e.ctx,
        )
        const asignar = async (identificador: string, alta: string, baja: string | null) => {
            const a = await new AgregarAdicionalServicio().execute(
                {
                    servicio_id: s.servicioId,
                    adicional_id: tv.id,
                    modalidad: 'cobrado',
                    precio: '35.00',
                    identificador,
                } as never,
                e.ctx,
            )
            // fixture: fechas de alta y baja en los bordes (UTC), como si el alta o la baja hubieran sido ese día
            await db
                .from('core.servicios_adicionales')
                .where('id', a.id)
                .update({
                    alta_en: alta,
                    baja_en: baja,
                    ...(baja ? { estado: 'baja' } : {}),
                })
            return Number(a.id)
        }
        // 30-nov 21:00 en Guatemala (1-dic 03:00 UTC): alta dentro de noviembre → se cobra
        const altaUltimoDia = await asignar('a', '2026-12-01T03:00:00Z', null)
        // 1-dic 00:30 en Guatemala (1-dic 06:30 UTC): alta del periodo siguiente → no
        const altaSiguiente = await asignar('b', '2026-12-01T06:30:00Z', null)
        // baja el 31-oct 22:00 en Guatemala (1-nov 04:00 UTC): antes del periodo → no
        const bajaAntes = await asignar('c', '2026-09-01T12:00:00Z', '2026-11-01T04:00:00Z')
        // baja el 1-nov 08:00 en Guatemala (1-nov 14:00 UTC): el primer día ya no → no (baja después del primer día)
        const bajaPrimerDia = await asignar('d', '2026-09-01T12:00:00Z', '2026-11-01T14:00:00Z')
        // baja el 2-nov en Guatemala: se cobra noviembre
        const bajaDespues = await asignar('e', '2026-09-01T12:00:00Z', '2026-11-02T15:00:00Z')
        const r = await new EmitirFactura().execute({ servicio_id: s.servicioId, periodo: NOVIEMBRE! }, e.ctx)
        const filas = await lineasAdicionales(r.factura_id!)
        const cobradas = filas.map((l) => Number(l.servicio_adicional_id))
        assert.sameMembers(cobradas, [altaUltimoDia, bajaDespues])
        assert.notInclude(cobradas, altaSiguiente)
        assert.notInclude(cobradas, bajaAntes)
        assert.notInclude(cobradas, bajaPrimerDia)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('prorrateo del plan, nota por línea del adicional, sustitución y anulación: el libro cuadra en cada paso', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        // instalación a mitad de octubre: el periodo de octubre va prorrateado, el adicional también
        const s = await servicioEn(e.B, { precio: '150.00', instalacion: '2026-10-16' })
        const tv = await new CrearAdicional().execute(
            { empresa_id: e.B, codigo: unico('TV').toUpperCase(), nombre: 'IPTV' },
            e.ctx,
        )
        const a = await new AgregarAdicionalServicio().execute(
            {
                servicio_id: s.servicioId,
                adicional_id: tv.id,
                modalidad: 'cobrado',
                precio: '35.00',
                identificador: 'x',
            } as never,
            e.ctx,
        )
        await db
            .from('core.servicios_adicionales')
            .where('id', a.id)
            .update({ alta_en: '2026-10-16T15:00:00Z' })
        const periodoOct = periodosHasta(
            { ciclo: 'dia_fijo', dia: 1, prorrateo: true },
            '2026-10-16',
            '2026-10-16',
        )[0]!
        const r = await new EmitirFactura().execute({ servicio_id: s.servicioId, periodo: periodoOct }, e.ctx)
        const [linea] = await lineasAdicionales(r.factura_id!)
        const plan = await db
            .from('billing.facturas_lineas')
            .where({ factura_id: r.factura_id!, tipo: 'servicio' })
            .firstOrFail()
        // mismo factor que el plan: 35/150 del total del plan
        assert.equal(
            ((Number(plan.total) * 35) / 150).toFixed(2),
            linea!.total,
            `plan ${plan.total}, adicional ${linea!.total}`,
        )
        await afirmarLibro(assert, [e.B, e.C])
        await new EmitirNotaCredito().execute(
            {
                factura_id: r.factura_id!,
                lineas: [{ linea_id: Number(linea!.id), monto: '5.00' }],
                motivo: 'caída de IPTV',
            },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
        // noviembre entero: se sustituye y la nueva conserva la línea del adicional; luego se anula
        const nov = await new EmitirFactura().execute(
            { servicio_id: s.servicioId, periodo: NOVIEMBRE! },
            e.ctx,
        )
        const sust = await new SustituirFactura().execute(
            { factura_id: nov.factura_id!, motivo: 'datos del cliente' },
            e.ctx,
        )
        const nuevas = await lineasAdicionales(sust.nueva.id)
        assert.deepEqual(
            nuevas.map((l) => [l.total, Number(l.servicio_adicional_id)]),
            [['35.00', Number(a.id)]],
        )
        await afirmarLibro(assert, [e.B, e.C])
        await new AnularFactura().execute({ factura_id: sust.nueva.id, motivo: 'error' }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
        void OCTUBRE
    })
})
