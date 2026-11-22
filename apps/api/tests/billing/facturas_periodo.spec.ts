import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import {
    asientoDe,
    escenario,
    estadoServicio,
    eventosDe,
    facturasDe,
    generar,
    type Escenario,
} from '#tests/billing/ayudas_billing'
import { vistaPreviaPeriodos, type VistaPreviaPeriodos } from '#billing/periodos_facturables'
import EmitirFacturasPeriodo, {
    type EntradaEmitirFacturasPeriodo,
} from '#billing/actions/emitir_facturas_periodo'
import RegistrarPago from '#billing/actions/registrar_pago'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import { hoyGuatemala } from '#ledger/fechas'

/**
 * Emisión manual de facturas de periodo (pedido del PM, 19 nov): «No puedo agregar facturas
 * siguientes (pago por adelantado) ni agregar facturas a un servicio (por si falló el sistema o si
 * bien lo quiero dejar pagado desde ya)». Las pruebas de acción fijan `hoy` (2026-11-19); las de
 * HTTP usan el día real y eligen los periodos de la vista previa.
 */

const HOY = '2026-11-19'

function emitir(servicioId: number, datos: Omit<EntradaEmitirFacturasPeriodo, 'servicio_id'>) {
    return new EmitirFacturasPeriodo().execute(
        { servicio_id: servicioId, hoy: HOY, ...datos },
        contextoPrueba(),
    )
}

function vista(servicioId: number, hasta?: string): Promise<VistaPreviaPeriodos> {
    return vistaPreviaPeriodos(db.connection(), servicioId, contextoPrueba(), { hoy: HOY, hasta })
}

/** Los periodos del servicio (sin los anteriores a su inicio). */
function delServicio(v: VistaPreviaPeriodos) {
    return v.periodos.filter((p) => p.estado !== 'antes_del_inicio')
}

async function errorDe(promesa: Promise<unknown>) {
    try {
        await promesa
    } catch (error) {
        const e = error as { status?: number; code?: string; errores?: Array<{ rule: string }> }
        return { status: e.status, rule: e.errores?.[0]?.rule ?? null }
    }
    throw new Error('Se esperaba un error')
}

async function facturasEmitidas(servicioId: number): Promise<number> {
    const { facturas } = await conteos(servicioId)
    return facturas
}

async function conteos(servicioId: number) {
    const [f] = await db.from('billing.facturas').where('servicio_id', servicioId).count('* as n')
    const [o] = await db
        .from('audit.outbox')
        .where('evento', 'factura.emitida')
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .count('* as n')
    const [a] = await db
        .from('ledger.asientos')
        .whereIn('origen_id', db.from('billing.facturas').where('servicio_id', servicioId).select('id'))
        .where('origen_tipo', 'factura')
        .count('* as n')
    return { facturas: Number(f!.n), eventos: Number(o!.n), asientos: Number(a!.n) }
}

/** Servicio de Q150 instalado el 1 de septiembre (día 1, gracia 5), sin nada emitido. */
function servicioDesdeSeptiembre(opciones: Parameters<typeof escenario>[0] = {}): Promise<Escenario> {
    return escenario({ fecha_instalacion: '2026-09-01', plantilla: { hora_corte: '00:00' }, ...opciones })
}

async function fijarFacturarDesde(e: Escenario, desde: string) {
    await db.table('billing.servicios_facturar_desde').insert({
        servicio_id: e.servicioId,
        facturar_desde: desde,
        plantilla_id: e.plantillaId,
        origen: 'asignacion_sin_plantilla',
    })
}

test.group('Facturas de periodo · vista previa', () => {
    test('lista emitidas, pendientes y 12 futuros con monto y vencimiento, sin escribir nada', async ({
        assert,
    }) => {
        // plantilla con prorrateo encendido a propósito: el cron prorratea septiembre
        const e = await servicioDesdeSeptiembre({
            fecha_instalacion: '2026-09-16',
            plantilla: { hora_corte: '00:00', prorrateo: true },
        })
        await generar(e.servicioId, '2026-10-01')
        const antes = await conteos(e.servicioId)

        const v = await vista(e.servicioId)
        assert.isTrue(v.emitible)
        assert.equal(v.maximo_futuros, 12)
        assert.equal(v.saldo_a_favor, '0.00')
        assert.deepEqual(
            delServicio(v)
                .slice(0, 4)
                .map((p) => [p.periodo, p.estado, p.monto, p.vence_en, p.prorrateado]),
            [
                // septiembre prorrateado por el cron: 15 de 30 días (lo emitido queda como se emitió)
                ['2026-09-16', 'emitida', '75.00', '2026-09-21', true],
                ['2026-10-01', 'emitida', '150.00', '2026-10-06', false],
                // pendiente emitido a mano: su vencimiento normal (6 nov) ya pasó, vence desde hoy
                ['2026-11-01', 'pendiente', '150.00', '2026-11-24', false],
                ['2026-12-01', 'futuro', '150.00', '2026-12-06', false],
            ],
        )
        assert.isNotNull(delServicio(v)[0]!.factura_id)
        const futuros = v.periodos.filter((p) => p.estado === 'futuro')
        assert.lengthOf(futuros, 12)
        assert.equal(futuros.at(-1)!.periodo, '2027-11-01')
        assert.isTrue(v.periodos.every((p) => p.error === null))

        // la vista previa emite en una transacción que se revierte: nada queda
        assert.deepEqual(await conteos(e.servicioId), antes)

        // hasta: corta la lista; más allá del 12.º futuro, 422
        const corta = await vista(e.servicioId, '2027-01-15')
        assert.equal(corta.periodos.at(-1)!.periodo, '2027-01-01')
        assert.deepEqual(await errorDe(vista(e.servicioId, '2027-12-01')), {
            status: 422,
            rule: 'maximo_periodos_futuros',
        })
    })

    test('muestra cuánto cubre el saldo a favor, de la más antigua a la más nueva', async ({ assert }) => {
        const e = await servicioDesdeSeptiembre({ fecha_instalacion: '2026-11-01' })
        await generar(e.servicioId, '2026-11-01')
        await new RegistrarPago().execute(
            { cliente_id: e.clienteId, metodo: 'caja', monto: '400.00' },
            contextoPrueba(),
        )
        const v = await vista(e.servicioId, '2027-02-01')
        assert.equal(v.saldo_a_favor, '250.00')
        assert.deepEqual(
            delServicio(v).map((p) => [p.periodo, p.estado, p.monto, p.pagado]),
            [
                ['2026-11-01', 'emitida', '150.00', '150.00'],
                ['2026-12-01', 'futuro', '150.00', '150.00'],
                ['2027-01-01', 'futuro', '150.00', '100.00'],
                ['2027-02-01', 'futuro', '150.00', '0.00'],
            ],
        )
    })

    test('retirado, pendiente de instalación o sin plantilla: no emitible y sin periodos', async ({
        assert,
    }) => {
        const retirado = await servicioDesdeSeptiembre({ servicio: { estado: 'retirado' } })
        const pendiente = await servicioDesdeSeptiembre({
            servicio: { estado: 'pendiente_instalacion', instalado_en: null, fecha_instalacion: null },
        })
        const sinPlantilla = await servicioDesdeSeptiembre({ servicio: { plantilla_facturacion_id: null } })
        for (const [e, motivo] of [
            [retirado, 'servicio_retirado'],
            [pendiente, 'servicio_pendiente_instalacion'],
            [sinPlantilla, 'sin_plantilla'],
        ] as const) {
            const v = await vista(e.servicioId)
            assert.deepEqual([v.emitible, v.motivo, v.periodos.length], [false, motivo, 0])
            assert.deepEqual(await errorDe(emitir(e.servicioId, { hasta: '2026-12-01' })), {
                status: 422,
                rule: motivo,
            })
        }
        assert.lengthOf(await facturasDe(retirado.servicioId), 0)
    })
})

test.group('Facturas de periodo · emitir', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('cliente paga 3 meses adelantados: el anticipo queda aplicado y el cron no duplica', async ({
        assert,
    }) => {
        // empresa propia: `afirmarLibro` compara el libro con los documentos de toda la empresa, y en
        // la principal otras suites dejan fixtures sin asiento (el orden de los archivos varía)
        const empresas = await prepararEmpresas()
        const e = await servicioDesdeSeptiembre({
            fecha_instalacion: '2026-11-01',
            servicio: { empresa_id: empresas.B },
        })
        await generar(e.servicioId, '2026-11-01')
        // paga noviembre y tres meses más: lo que sobra queda como saldo a favor
        await new RegistrarPago().execute(
            { cliente_id: e.clienteId, metodo: 'caja', monto: '600.00' },
            empresas.ctx,
        )
        const conSaldo = await vista(e.servicioId, '2026-11-01')
        assert.equal(conSaldo.saldo_a_favor, '450.00')

        const r = await emitir(e.servicioId, {
            periodos: ['2027-01-01', '2026-12-01', '2027-02-01', '2026-12-01'],
            motivo: 'Pagó tres meses por adelantado',
        })
        assert.deepEqual(
            r.creadas.map((c) => [c.periodo, c.estado, c.total, c.pagado, c.vence_en]),
            [
                ['2026-12-01', 'pagada', '150.00', '150.00', '2026-12-06'],
                ['2027-01-01', 'pagada', '150.00', '150.00', '2027-01-06'],
                ['2027-02-01', 'pagada', '150.00', '150.00', '2027-02-06'],
            ],
        )
        assert.deepEqual([r.omitidas, r.bonificadas, r.saldo_a_favor], [[], [], '0.00'])
        assert.equal(await saldoTexto(e.clienteId), '0.00')
        await afirmarLibroCuadrado(assert)
        await afirmarLibro(assert, [empresas.B, empresas.C])

        // misma clave que el cron, mismo evento y snapshot con la emisión manual
        const dic = await db.from('billing.facturas').where('id', r.creadas[0]!.factura_id).firstOrFail()
        assert.equal(dic.clave_unica, `${e.servicioId}-2026-12-01`)
        assert.deepEqual(dic.reglas_snapshot.emision_manual, {
            motivo: 'Pagó tres meses por adelantado',
            antes_de_facturar_desde: false,
            antes_del_inicio: false,
            facturar_desde: null,
            monto_calculado: '150.00',
            monto_cobrado: null,
        })
        const eventos = await eventosDe('factura.emitida', 'servicio_id', e.servicioId)
        assert.lengthOf(eventos, 4)
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'facturas.emitir_periodos')
            .where('entidad_id', e.servicioId)
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')

        // repetir: nada nuevo, todo informado
        const antes = await conteos(e.servicioId)
        const otra = await emitir(e.servicioId, { hasta: '2027-02-01' })
        assert.deepEqual(otra.creadas, [])
        assert.deepEqual(
            otra.omitidas.map((o) => [o.periodo, o.motivo]),
            [
                ['2026-11-01', 'ya_emitida'],
                ['2026-12-01', 'ya_emitida'],
                ['2027-01-01', 'ya_emitida'],
                ['2027-02-01', 'ya_emitida'],
            ],
        )
        // el cron llega a esos meses y no los vuelve a emitir
        const cron = await generar(e.servicioId, '2027-02-01')
        assert.deepEqual([cron.generadas, cron.omitidas], [0, 4])
        assert.deepEqual(await conteos(e.servicioId), antes)
        await afirmarLibroCuadrado(assert)
    })

    test('una factura futura no vence ni cuenta para el corte antes de su vencimiento', async ({
        assert,
    }) => {
        const e = await servicioDesdeSeptiembre({ fecha_instalacion: '2026-11-01' })
        await generar(e.servicioId, '2026-11-01')
        await emitir(e.servicioId, { hasta: '2027-01-01' })
        await new VencerFacturas().execute({ servicio_id: e.servicioId, hasta: HOY }, contextoPrueba())
        const evaluado = await new EvaluarEstadoServicio().execute(
            { servicio_id: e.servicioId, ignorarHoraCorte: true },
            contextoPrueba(),
        )
        // solo noviembre (vence el 6) está vencida: limita, no corta
        assert.equal(evaluado.vencidas, 1)
        assert.equal(await estadoServicio(e.servicioId), 'limitado')
        const facturas = await facturasDe(e.servicioId)
        assert.deepEqual(
            facturas.filter((f) => f.tipo === 'servicio').map((f) => [f.periodo, f.estado]),
            [
                ['2026-11-01', 'vencida'],
                ['2026-12-01', 'emitida'],
                ['2027-01-01', 'emitida'],
            ],
        )
    })

    test('periodos pasados que el cron no emitió, con hasta', async ({ assert }) => {
        const e = await servicioDesdeSeptiembre()
        const r = await emitir(e.servicioId, { hasta: '2026-11-01' })
        // a mano, lo atrasado vence desde hoy (19 nov + 5 de gracia): emitirlo no corta al cliente
        assert.deepEqual(
            r.creadas.map((c) => [c.periodo, c.estado, c.total, c.vence_en]),
            [
                ['2026-09-01', 'emitida', '150.00', '2026-11-24'],
                ['2026-10-01', 'emitida', '150.00', '2026-11-24'],
                ['2026-11-01', 'emitida', '150.00', '2026-11-24'],
            ],
        )
        await new VencerFacturas().execute({ servicio_id: e.servicioId, hasta: HOY }, contextoPrueba())
        const evaluado = await new EvaluarEstadoServicio().execute(
            { servicio_id: e.servicioId, ignorarHoraCorte: true },
            contextoPrueba(),
        )
        assert.equal(evaluado.vencidas, 0)
        assert.equal(await estadoServicio(e.servicioId), 'activo')
        assert.equal(await saldoTexto(e.clienteId), '450.00')
        await afirmarLibroCuadrado(assert)
    })

    test('límites: 12 futuros, inicio de periodo exacto, periodos o hasta', async ({ assert }) => {
        const e = await servicioDesdeSeptiembre()
        assert.deepEqual(await errorDe(emitir(e.servicioId, { periodos: ['2027-12-01'] })), {
            status: 422,
            rule: 'maximo_periodos_futuros',
        })
        assert.deepEqual(await errorDe(emitir(e.servicioId, { hasta: '2027-12-01' })), {
            status: 422,
            rule: 'maximo_periodos_futuros',
        })
        assert.deepEqual(await errorDe(emitir(e.servicioId, { periodos: ['2026-12-15'] })), {
            status: 422,
            rule: 'periodo_invalido',
        })
        assert.deepEqual(await errorDe(emitir(e.servicioId, { periodos: ['2026-08-15'] })), {
            status: 422,
            rule: 'periodo_invalido',
        })
        // 24 periodos antes del inicio (septiembre de 2024); más atrás, 422
        assert.deepEqual(await errorDe(emitir(e.servicioId, { periodos: ['2024-08-01'] })), {
            status: 422,
            rule: 'maximo_periodos_anteriores',
        })
        assert.deepEqual(
            await errorDe(emitir(e.servicioId, { periodos: ['2026-12-01'], hasta: '2026-12-01' })),
            { status: 422, rule: 'periodos_o_hasta' },
        )
        assert.deepEqual(await errorDe(emitir(e.servicioId, {})), { status: 422, rule: 'periodos_o_hasta' })
        // el 12.º futuro sí
        const r = await emitir(e.servicioId, { periodos: ['2027-11-01'] })
        assert.deepEqual(
            r.creadas.map((c) => [c.periodo, c.vence_en]),
            [['2027-11-01', '2027-11-06']],
        )
        assert.lengthOf(await facturasDe(e.servicioId), 1)
    })

    test('antes de facturar_desde: permiso aparte y motivo; hasta nunca los incluye', async ({ assert }) => {
        const e = await servicioDesdeSeptiembre()
        await fijarFacturarDesde(e, '2026-11-01')
        const v = await vista(e.servicioId, '2026-11-01')
        assert.deepEqual(
            delServicio(v).map((p) => [p.periodo, p.estado]),
            [
                ['2026-09-01', 'antes_de_facturar_desde'],
                ['2026-10-01', 'antes_de_facturar_desde'],
                ['2026-11-01', 'pendiente'],
            ],
        )

        assert.deepEqual(await errorDe(emitir(e.servicioId, { periodos: ['2026-10-01'] })), {
            status: 422,
            rule: 'antes_de_facturar_desde',
        })
        assert.deepEqual(
            await errorDe(emitir(e.servicioId, { periodos: ['2026-10-01'], puede_emitir_anterior: true })),
            { status: 422, rule: 'motivo_requerido' },
        )
        const conHasta = await emitir(e.servicioId, { hasta: '2026-11-01' })
        assert.deepEqual(
            conHasta.creadas.map((c) => c.periodo),
            ['2026-11-01'],
        )

        const r = await emitir(e.servicioId, {
            periodos: ['2026-10-01'],
            puede_emitir_anterior: true,
            motivo: 'El cliente usó el servicio en octubre',
        })
        assert.deepEqual(
            r.creadas.map((c) => c.periodo),
            ['2026-10-01'],
        )
        const octubre = await db.from('billing.facturas').where('id', r.creadas[0]!.factura_id).firstOrFail()
        assert.deepEqual(octubre.reglas_snapshot.emision_manual, {
            motivo: 'El cliente usó el servicio en octubre',
            antes_de_facturar_desde: true,
            antes_del_inicio: false,
            facturar_desde: '2026-11-01',
            monto_calculado: '150.00',
            monto_cobrado: null,
        })
        // su vencimiento normal (6 de octubre) ya pasó: vence desde hoy (19 nov + 5 de gracia)
        assert.equal(r.creadas[0]!.vence_en, '2026-11-24')
        // el cron sigue sin facturar hacia atrás
        const cron = await generar(e.servicioId, '2026-11-01')
        assert.equal(cron.generadas, 0)
        const facturas = await facturasDe(e.servicioId)
        assert.deepEqual(
            facturas.map((f) => f.periodo),
            ['2026-11-01', '2026-10-01'],
        )
        await afirmarLibroCuadrado(assert)
    })
})

/** Debe y haber por cuenta del asiento de una factura (suma de sus movimientos). */
async function cuentasDe(facturaId: number) {
    const porCuenta = new Map<string, [number, number]>()
    for (const m of await asientoDe('factura', facturaId)) {
        const [debe, haber] = porCuenta.get(m.codigo) ?? [0, 0]
        // centavos enteros: sumar montos de 2 decimales sin flotantes
        porCuenta.set(m.codigo, [
            debe + Math.round(Number(m.debe) * 100),
            haber + Math.round(Number(m.haber) * 100),
        ])
    }
    return Object.fromEntries(
        [...porCuenta].map(([c, [d, h]]) => [c, [(d / 100).toFixed(2), (h / 100).toFixed(2)]]),
    )
}

test.group('Facturas de periodo · antes del inicio del servicio', () => {
    test('servicio recién creado: 24 periodos completos antes del inicio, que vencen desde hoy', async ({
        assert,
    }) => {
        const e = await servicioDesdeSeptiembre({ fecha_instalacion: '2026-11-01' })
        const v = await vista(e.servicioId)
        assert.equal(v.maximo_anteriores, 24)
        const anteriores = v.periodos.filter((p) => p.estado === 'antes_del_inicio')
        assert.lengthOf(anteriores, 24)
        // ascendentes, de noviembre de 2024 a octubre de 2026, y después los del servicio
        assert.equal(anteriores[0]!.periodo, '2024-11-01')
        assert.equal(anteriores.at(-1)!.periodo, '2026-10-01')
        assert.deepEqual(
            v.periodos.slice(0, 25).map((p) => p.periodo),
            [...anteriores.map((p) => p.periodo), '2026-11-01'],
        )
        assert.equal(v.periodos[24]!.estado, 'pendiente')
        // periodo completo al precio actual; vence hoy (19 nov) + 5 días de gracia, no en 2024
        assert.isTrue(
            anteriores.every(
                (p) =>
                    p.monto === '150.00' &&
                    p.vence_en === '2026-11-24' &&
                    !p.prorrateado &&
                    p.factor === '1' &&
                    p.error === null,
            ),
        )
        assert.deepEqual(
            anteriores.slice(-2).map((p) => [p.periodo, p.hasta, p.dias]),
            [
                ['2026-09-01', '2026-09-30', 30],
                ['2026-10-01', '2026-10-31', 31],
            ],
        )
        // el saldo a favor se muestra primero sobre los periodos del servicio
        await new RegistrarPago().execute(
            { cliente_id: e.clienteId, metodo: 'caja', monto: '200.00' },
            contextoPrueba(),
        )
        const conSaldo = await vista(e.servicioId, '2026-12-01')
        assert.deepEqual(
            delServicio(conSaldo).map((p) => [p.periodo, p.pagado]),
            [
                ['2026-11-01', '150.00'],
                ['2026-12-01', '50.00'],
            ],
        )
        assert.equal(conSaldo.periodos.find((p) => p.periodo === '2026-10-01')!.pagado, '0.00')
        assert.equal(await facturasEmitidas(e.servicioId), 0)
    })

    test('emitir: permiso y motivo, vence desde hoy, asiento de hoy, sin duplicados y sin corte', async ({
        assert,
    }) => {
        const e = await servicioDesdeSeptiembre({ fecha_instalacion: '2026-11-01' })
        const pedidos = ['2026-09-01', '2026-10-01']
        assert.deepEqual(
            await errorDe(emitir(e.servicioId, { periodos: pedidos, motivo: 'Usó el servicio' })),
            {
                status: 422,
                rule: 'antes_del_inicio',
            },
        )
        assert.deepEqual(
            await errorDe(emitir(e.servicioId, { periodos: pedidos, puede_emitir_anterior: true })),
            { status: 422, rule: 'motivo_requerido' },
        )
        // hasta nunca los incluye
        const conHasta = await emitir(e.servicioId, { hasta: '2026-10-01' })
        assert.deepEqual(conHasta.creadas, [])
        assert.equal(await facturasEmitidas(e.servicioId), 0)

        const r = await emitir(e.servicioId, {
            periodos: pedidos,
            puede_emitir_anterior: true,
            motivo: 'Usó el servicio desde septiembre antes del alta',
        })
        assert.deepEqual(
            r.creadas.map((c) => [
                c.periodo,
                c.estado,
                c.total,
                c.monto_calculado,
                c.monto_editado,
                c.vence_en,
            ]),
            [
                ['2026-09-01', 'emitida', '150.00', '150.00', false, '2026-11-24'],
                ['2026-10-01', 'emitida', '150.00', '150.00', false, '2026-11-24'],
            ],
        )
        const septiembre = await db
            .from('billing.facturas')
            .where('id', r.creadas[0]!.factura_id)
            .firstOrFail()
        assert.equal(septiembre.clave_unica, `${e.servicioId}-2026-09-01`)
        assert.include(septiembre.reglas_snapshot.emision_manual, {
            antes_del_inicio: true,
            antes_de_facturar_desde: false,
            motivo: 'Usó el servicio desde septiembre antes del alta',
        })
        // asiento CxC / ingresos + IVA, con fecha de hoy (nunca retroactivo)
        assert.deepEqual(await cuentasDe(septiembre.id), {
            '1.1.03': ['150.00', '0.00'],
            '4.1.01': ['0.00', '133.93'],
            '2.1.02': ['0.00', '16.07'],
        })
        const asiento = await db
            .from('ledger.asientos')
            .where('origen_tipo', 'factura')
            .where('origen_id', septiembre.id)
            .select(db.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
            .firstOrFail()
        assert.equal(asiento.fecha, hoyGuatemala())
        assert.lengthOf(await eventosDe('factura.emitida', 'servicio_id', e.servicioId), 2)
        await afirmarLibroCuadrado(assert)

        // emitirlas no corta: vencen el 24 y hoy es 19
        await new VencerFacturas().execute({ servicio_id: e.servicioId, hasta: HOY }, contextoPrueba())
        const evaluado = await new EvaluarEstadoServicio().execute(
            { servicio_id: e.servicioId, ignorarHoraCorte: true },
            contextoPrueba(),
        )
        assert.equal(evaluado.vencidas, 0)
        assert.equal(await estadoServicio(e.servicioId), 'activo')
        // si no paga en su plazo, vencen como cualquier otra
        await new VencerFacturas().execute(
            { servicio_id: e.servicioId, hasta: '2026-11-25' },
            contextoPrueba(),
        )
        const despues = await new EvaluarEstadoServicio().execute(
            { servicio_id: e.servicioId, ignorarHoraCorte: true },
            contextoPrueba(),
        )
        assert.equal(despues.vencidas, 2)
        assert.notEqual(await estadoServicio(e.servicioId), 'activo')

        // repetir: nada nuevo; el cron no factura hacia atrás
        const otra = await emitir(e.servicioId, {
            periodos: pedidos,
            puede_emitir_anterior: true,
            motivo: 'Otra vez',
        })
        assert.deepEqual(
            otra.omitidas.map((o) => [o.periodo, o.motivo]),
            [
                ['2026-09-01', 'ya_emitida'],
                ['2026-10-01', 'ya_emitida'],
            ],
        )
        const cron = await generar(e.servicioId, '2026-11-01')
        assert.equal(cron.generadas, 1)
        const servicioFinal = await facturasDe(e.servicioId)
        assert.deepEqual(
            servicioFinal
                .filter((f) => f.tipo === 'servicio')
                .map((f) => f.periodo)
                .sort(),
            ['2026-09-01', '2026-10-01', '2026-11-01'],
        )
    })
})

test.group('Facturas de periodo · sin prorrateo y monto editado', () => {
    test('plantilla con prorrateo: a mano el primer periodo cobra el mes completo; el cron prorratea', async ({
        assert,
    }) => {
        const conProrrateo = { hora_corte: '00:00', prorrateo: true }
        const aMano = await servicioDesdeSeptiembre({
            fecha_instalacion: '2026-09-16',
            plantilla: conProrrateo,
        })
        const v = await vista(aMano.servicioId, '2026-09-16')
        assert.deepEqual(
            delServicio(v).map((p) => [p.periodo, p.monto, p.prorrateado, p.dias, p.dias_ciclo]),
            [['2026-09-16', '150.00', false, 15, 30]],
        )
        const r = await emitir(aMano.servicioId, { periodos: ['2026-09-16'] })
        assert.deepEqual(
            r.creadas.map((c) => [c.periodo, c.total, c.monto_calculado]),
            [['2026-09-16', '150.00', '150.00']],
        )
        const [linea] = await db
            .from('billing.facturas_lineas')
            .where('factura_id', r.creadas[0]!.factura_id)
            .where('tipo', 'servicio')
            .select('concepto')
        assert.notInclude(linea!.concepto, 'prorrateo')

        const conCron = await servicioDesdeSeptiembre({
            fecha_instalacion: '2026-09-16',
            plantilla: conProrrateo,
        })
        await generar(conCron.servicioId, '2026-09-16')
        const [delCron] = await facturasDe(conCron.servicioId)
        assert.equal(delCron!.total, '75.00')
        await afirmarLibroCuadrado(assert)
    })

    test('monto editado: permiso y motivo; menor como descuento, mayor como ajuste; queda auditado', async ({
        assert,
    }) => {
        const e = await servicioDesdeSeptiembre({ fecha_instalacion: '2026-11-01' })
        const rebaja = { periodos: ['2026-12-01'], montos: [{ periodo: '2026-12-01', monto: '120.00' }] }
        assert.deepEqual(await errorDe(emitir(e.servicioId, { ...rebaja, motivo: 'Acuerdo' })), {
            status: 422,
            rule: 'editar_monto_sin_permiso',
        })
        assert.deepEqual(await errorDe(emitir(e.servicioId, { ...rebaja, puede_editar_monto: true })), {
            status: 422,
            rule: 'motivo_requerido',
        })
        assert.deepEqual(
            await errorDe(
                emitir(e.servicioId, {
                    periodos: ['2026-12-01'],
                    montos: [{ periodo: '2026-12-01', monto: '0.00' }],
                    puede_editar_monto: true,
                    motivo: 'Acuerdo',
                }),
            ),
            { status: 422, rule: 'monto_positivo' },
        )
        assert.deepEqual(
            await errorDe(
                emitir(e.servicioId, {
                    periodos: ['2026-12-01'],
                    montos: [{ periodo: '2027-01-01', monto: '100.00' }],
                    puede_editar_monto: true,
                    motivo: 'Acuerdo',
                }),
            ),
            { status: 422, rule: 'periodo_invalido' },
        )
        assert.equal(await facturasEmitidas(e.servicioId), 0)
        // igual al calculado: no es edición, no pide permiso ni motivo
        const igual = await emitir(e.servicioId, {
            periodos: ['2027-02-01'],
            montos: [{ periodo: '2027-02-01', monto: '150' }],
        })
        assert.deepEqual(
            igual.creadas.map((c) => [c.total, c.monto_editado]),
            [['150.00', false]],
        )

        const r = await emitir(e.servicioId, {
            periodos: ['2026-12-01', '2027-01-01'],
            montos: [
                { periodo: '2026-12-01', monto: '120.00' },
                { periodo: '2027-01-01', monto: '200.00' },
            ],
            puede_editar_monto: true,
            motivo: 'Acuerdo con el cliente',
        })
        assert.deepEqual(
            r.creadas.map((c) => [c.periodo, c.total, c.monto_calculado, c.monto_editado]),
            [
                ['2026-12-01', '120.00', '150.00', true],
                ['2027-01-01', '200.00', '150.00', true],
            ],
        )
        const [dic, ene] = [r.creadas[0]!.factura_id, r.creadas[1]!.factura_id]
        const lineas = async (id: number) => {
            const filas = await db
                .from('billing.facturas_lineas')
                .where('factura_id', id)
                .orderBy('id', 'asc')
                .select('tipo', 'concepto', 'total', 'iva')
            return filas.map((l) => [
                l.tipo,
                l.concepto.startsWith('Ajuste') ? 'ajuste' : 'plan',
                l.total,
                l.iva,
            ])
        }
        // rebaja: descuento sobre la línea del plan con el IVA del neto (120 / 1.12)
        assert.deepEqual(await lineas(dic), [
            ['servicio', 'plan', '150.00', '16.07'],
            ['descuento', 'ajuste', '-30.00', '-3.21'],
        ])
        assert.deepEqual(await cuentasDe(dic), {
            '1.1.03': ['120.00', '0.00'],
            '5.1.01': ['26.79', '0.00'],
            '4.1.01': ['0.00', '133.93'],
            '2.1.02': ['0.00', '12.86'],
        })
        // aumento: línea de servicio por la diferencia, a ingresos por internet
        assert.deepEqual(await lineas(ene), [
            ['servicio', 'plan', '150.00', '16.07'],
            ['servicio', 'ajuste', '50.00', '5.36'],
        ])
        assert.deepEqual(await cuentasDe(ene), {
            '1.1.03': ['200.00', '0.00'],
            '4.1.01': ['0.00', '178.57'],
            '2.1.02': ['0.00', '21.43'],
        })
        const factura = await db.from('billing.facturas').where('id', dic).firstOrFail()
        assert.include(factura.reglas_snapshot.emision_manual, {
            monto_calculado: '150.00',
            monto_cobrado: '120.00',
            motivo: 'Acuerdo con el cliente',
        })
        // la bitácora guarda calculado y cobrado
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'facturas.emitir_periodos')
            .where('entidad_id', e.servicioId)
            .where('resultado', 'ok')
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.deepEqual(accion.entrada.auditoria.montos_editados, [
            { periodo: '2026-12-01', factura_id: dic, calculado: '150.00', cobrado: '120.00' },
            { periodo: '2027-01-01', factura_id: ene, calculado: '150.00', cobrado: '200.00' },
        ])
        assert.deepEqual(accion.entrada.montos, [
            { periodo: '2026-12-01', monto: '120.00' },
            { periodo: '2027-01-01', monto: '200.00' },
        ])
        await afirmarLibroCuadrado(assert)
    })

    test('una rebaja mayor que la línea del servicio: 422 y nada emitido', async ({ assert }) => {
        const e = await servicioDesdeSeptiembre({ fecha_instalacion: '2026-11-01' })
        await db.table('billing.conceptos_recurrentes').insert({
            servicio_id: e.servicioId,
            nombre: 'Renta de router',
            monto: '50.00',
            activo: true,
        })
        // calculado 200 (150 + 50): rebajar a 10 pide 190 de descuento sobre una línea de 150
        assert.deepEqual(
            await errorDe(
                emitir(e.servicioId, {
                    periodos: ['2026-12-01'],
                    montos: [{ periodo: '2026-12-01', monto: '10.00' }],
                    puede_editar_monto: true,
                    motivo: 'Prueba',
                }),
            ),
            { status: 422, rule: 'monto_editado_invalido' },
        )
        assert.equal(await facturasEmitidas(e.servicioId), 0)
    })
})

test.group('Facturas de periodo · días antes del primer periodo (tramo inicial)', () => {
    /** Instalado el 16 de septiembre con ciclo del día 1: del 1 al 15 no es de ningún periodo. */
    function aMitadDeCiclo() {
        return servicioDesdeSeptiembre({ fecha_instalacion: '2026-09-16' })
    }

    test('vista previa: el tramo con su sugerencia proporcional; incluirlo en la primera factura', async ({
        assert,
    }) => {
        const e = await aMitadDeCiclo()
        const v = await vista(e.servicioId)
        assert.deepEqual(v.tramo_inicial, {
            desde: '2026-09-01',
            hasta: '2026-09-15',
            dias: 15,
            dias_ciclo: 30,
            primer_periodo: '2026-09-16',
            primer_periodo_libre: true,
            monto_proporcional: '75.00',
            vence_cargo: '2026-11-24',
            cobrado_como: null,
            factura_id: null,
        })
        const pedido = { modo: 'primera_factura' as const }
        assert.deepEqual(
            await errorDe(
                emitir(e.servicioId, {
                    periodos: ['2026-09-16'],
                    tramo_inicial: pedido,
                    motivo: 'Usó desde el 1',
                }),
            ),
            { status: 422, rule: 'tramo_inicial_sin_permiso' },
        )
        assert.deepEqual(
            await errorDe(
                emitir(e.servicioId, {
                    periodos: ['2026-09-16'],
                    tramo_inicial: pedido,
                    puede_emitir_anterior: true,
                }),
            ),
            { status: 422, rule: 'motivo_requerido' },
        )
        assert.deepEqual(
            await errorDe(
                emitir(e.servicioId, {
                    periodos: ['2026-10-01'],
                    tramo_inicial: pedido,
                    puede_emitir_anterior: true,
                    motivo: 'Usó desde el 1',
                }),
            ),
            { status: 422, rule: 'tramo_sin_primer_periodo' },
        )
        assert.equal(await facturasEmitidas(e.servicioId), 0)

        const r = await emitir(e.servicioId, {
            periodos: ['2026-09-16'],
            tramo_inicial: pedido,
            puede_emitir_anterior: true,
            motivo: 'Usó el servicio desde el 1 de septiembre',
        })
        assert.deepEqual(
            r.creadas.map((c) => [c.periodo, c.total, c.vence_en]),
            [['2026-09-16', '150.00', '2026-11-24']],
        )
        const facturaId = r.creadas[0]!.factura_id
        assert.deepEqual(r.tramo_inicial, {
            modo: 'primera_factura',
            desde: '2026-09-01',
            hasta: '2026-09-15',
            factura_id: facturaId,
            total: '150.00',
            monto_calculado: '150.00',
            monto_editado: false,
            vence_en: '2026-11-24',
        })
        // misma clave que usaría el cron para el primer periodo; la línea cubre desde el inicio del ciclo
        const factura = await db.from('billing.facturas').where('id', facturaId).firstOrFail()
        assert.equal(factura.clave_unica, `${e.servicioId}-2026-09-16`)
        assert.deepEqual(factura.reglas_snapshot.emision_manual.tramo_inicial, {
            modo: 'primera_factura',
            desde: '2026-09-01',
            dias: 15,
        })
        const [linea] = await db
            .from('billing.facturas_lineas')
            .where('factura_id', facturaId)
            .where('tipo', 'servicio')
            .select('concepto')
        assert.include(linea!.concepto, 'del 2026-09-01 al 2026-09-30')

        // ya cobrado: ni otra vez ni como cargo único; el cron no duplica el primer periodo
        const despues = await vista(e.servicioId)
        assert.include(despues.tramo_inicial!, { cobrado_como: 'primera_factura', factura_id: facturaId })
        assert.deepEqual(
            await errorDe(
                emitir(e.servicioId, {
                    tramo_inicial: { modo: 'cargo_unico' },
                    puede_emitir_anterior: true,
                    motivo: 'Otra vez',
                }),
            ),
            { status: 422, rule: 'tramo_ya_cobrado' },
        )
        const cron = await generar(e.servicioId, '2026-10-01')
        assert.deepEqual([cron.generadas, cron.omitidas], [1, 1])
        await afirmarLibroCuadrado(assert)
    })

    test('como cargo único: proporcional sugerido, asiento, sin duplicados con el cron; monto editado', async ({
        assert,
    }) => {
        const e = await aMitadDeCiclo()
        const pedido = { tramo_inicial: { modo: 'cargo_unico' as const }, puede_emitir_anterior: true }
        assert.deepEqual(
            await errorDe(
                emitir(e.servicioId, {
                    ...pedido,
                    tramo_inicial: { modo: 'cargo_unico', monto: '100.00' },
                    motivo: 'Acuerdo',
                }),
            ),
            { status: 422, rule: 'editar_monto_sin_permiso' },
        )
        assert.equal(await facturasEmitidas(e.servicioId), 0)

        // solo el tramo, sin periodos
        const r = await emitir(e.servicioId, { ...pedido, motivo: 'Usó del 1 al 15 de septiembre' })
        assert.deepEqual(r.creadas, [])
        const cargo = r.tramo_inicial!
        assert.deepInclude(cargo, {
            modo: 'cargo_unico',
            desde: '2026-09-01',
            hasta: '2026-09-15',
            total: '75.00',
            monto_calculado: '75.00',
            monto_editado: false,
            vence_en: '2026-11-24',
        })
        const factura = await db.from('billing.facturas').where('id', cargo.factura_id).firstOrFail()
        assert.equal(factura.clave_unica, `cargo-tramo-${e.servicioId}-2026-09-01`)
        assert.include(factura.reglas_snapshot, { cargo_unico: true, mora_tipo: 'ninguna' })
        assert.deepInclude(factura.reglas_snapshot.emision_manual, {
            motivo: 'Usó del 1 al 15 de septiembre',
            monto_calculado: '75.00',
            monto_cobrado: null,
        })
        // asiento de servicio de internet (4.1.01) con IVA, de hoy
        assert.deepEqual(await cuentasDe(cargo.factura_id), {
            '1.1.03': ['75.00', '0.00'],
            '4.1.01': ['0.00', '66.96'],
            '2.1.02': ['0.00', '8.04'],
        })
        assert.lengthOf(await eventosDe('factura.emitida', 'servicio_id', e.servicioId), 1)
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'facturas.emitir_periodos')
            .where('resultado', 'ok')
            .where('entidad_tipo', 'servicio')
            .where('entidad_id', e.servicioId)
            .first()
        assert.exists(accion)

        // no se cobra dos veces, ni en la primera factura; el cron emite sus periodos completos aparte
        for (const modo of ['cargo_unico', 'primera_factura'] as const) {
            assert.deepEqual(
                await errorDe(
                    emitir(e.servicioId, {
                        periodos: modo === 'primera_factura' ? ['2026-09-16'] : undefined,
                        tramo_inicial: { modo },
                        puede_emitir_anterior: true,
                        motivo: 'Otra vez',
                    }),
                ),
                { status: 422, rule: 'tramo_ya_cobrado' },
            )
        }
        const cron = await generar(e.servicioId, '2026-10-01')
        assert.equal(cron.generadas, 2)
        const todas = await facturasDe(e.servicioId)
        assert.deepEqual(
            todas.map((f) => [f.periodo, f.total]),
            [
                ['2026-09-01', '75.00'],
                ['2026-09-16', '150.00'],
                ['2026-10-01', '150.00'],
            ],
        )

        // otro servicio: el cargo con el monto editado, con permiso y motivo
        const otro = await aMitadDeCiclo()
        const editado = await emitir(otro.servicioId, {
            tramo_inicial: { modo: 'cargo_unico', monto: '90.00' },
            puede_emitir_anterior: true,
            puede_editar_monto: true,
            motivo: 'Acuerdo con el cliente',
        })
        assert.deepInclude(editado.tramo_inicial!, {
            total: '90.00',
            monto_calculado: '75.00',
            monto_editado: true,
        })
        const auditada = await db
            .from('audit.acciones')
            .where('accion', 'facturas.emitir_periodos')
            .where('resultado', 'ok')
            .where('entidad_id', otro.servicioId)
            .firstOrFail()
        assert.deepEqual(auditada.entrada.auditoria.montos_editados, [
            {
                periodo: '2026-09-01',
                factura_id: editado.tramo_inicial!.factura_id,
                calculado: '75.00',
                cobrado: '90.00',
            },
        ])
        await afirmarLibroCuadrado(assert)
    })

    test('sin tramo: un servicio que empieza en inicio de ciclo responde 422 sin_tramo_inicial', async ({
        assert,
    }) => {
        const e = await servicioDesdeSeptiembre()
        const v = await vista(e.servicioId)
        assert.isNull(v.tramo_inicial)
        assert.deepEqual(
            await errorDe(
                emitir(e.servicioId, {
                    tramo_inicial: { modo: 'cargo_unico' },
                    puede_emitir_anterior: true,
                    motivo: 'x x x',
                }),
            ),
            { status: 422, rule: 'sin_tramo_inicial' },
        )
    })
})

test.group('Facturas de periodo · HTTP', () => {
    test('cajero: vista previa y emisión con Idempotency-Key; lectura no puede emitir', async ({
        client,
        assert,
    }) => {
        const e = await servicioDesdeSeptiembre({ fecha_instalacion: '2026-11-01' })
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: lectura } = await usuarioConRoles(['lectura'])

        const vistaHttp = await estado(
            client.get(`/api/v1/servicios/${e.servicioId}/periodos-facturables`).bearerToken(cajero),
            200,
        )
        const futuros = (vistaHttp.body().periodos as Array<{ periodo: string; estado: string }>)
            .filter((p) => p.estado === 'futuro')
            .slice(0, 2)
            .map((p) => p.periodo)
        assert.lengthOf(futuros, 2)

        await estado(
            client
                .post(`/api/v1/servicios/${e.servicioId}/facturas-periodo`)
                .bearerToken(lectura)
                .json({ periodos: futuros }),
            403,
        )
        const clave = unico('periodos')
        const cuerpo = { periodos: futuros, motivo: 'Pago adelantado' }
        const primera = await estado(
            client
                .post(`/api/v1/servicios/${e.servicioId}/facturas-periodo`)
                .bearerToken(cajero)
                .header('Idempotency-Key', clave)
                .json(cuerpo),
            200,
        )
        const repetida = await estado(
            client
                .post(`/api/v1/servicios/${e.servicioId}/facturas-periodo`)
                .bearerToken(cajero)
                .header('Idempotency-Key', clave)
                .json(cuerpo),
            200,
        )
        assert.deepEqual(repetida.body(), primera.body())
        assert.deepEqual(
            (primera.body().creadas as Array<{ periodo: string }>).map((c) => c.periodo),
            futuros,
        )
        const facturas = await facturasDe(e.servicioId)
        assert.lengthOf(
            facturas.filter((f) => futuros.includes(f.periodo)),
            2,
        )
    })

    test('periodo anterior: cajero 422 antes_de_facturar_desde; contabilidad con motivo sí', async ({
        client,
        assert,
    }) => {
        const e = await servicioDesdeSeptiembre()
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: contabilidad } = await usuarioConRoles(['contabilidad'])
        const previa = await estado(
            client.get(`/api/v1/servicios/${e.servicioId}/periodos-facturables`).bearerToken(cajero),
            200,
        )
        const pasados = (previa.body().periodos as Array<{ periodo: string; estado: string }>).filter(
            (p) => p.estado === 'pendiente',
        )
        // facturar desde el último pasado: el primero queda antes
        await fijarFacturarDesde(e, pasados.at(-1)!.periodo)
        const anterior = pasados[0]!.periodo

        const rechazo = await estado(
            client
                .post(`/api/v1/servicios/${e.servicioId}/facturas-periodo`)
                .bearerToken(cajero)
                .header('Idempotency-Key', unico('ant'))
                .json({ periodos: [anterior], motivo: 'Se olvidó facturar' }),
            422,
        )
        assert.equal(rechazo.body().errors[0].rule, 'antes_de_facturar_desde')

        const ok = await estado(
            client
                .post(`/api/v1/servicios/${e.servicioId}/facturas-periodo`)
                .bearerToken(contabilidad)
                .header('Idempotency-Key', unico('ant'))
                .json({ periodos: [anterior], motivo: 'Se olvidó facturar' }),
            200,
        )
        assert.equal(ok.body().creadas[0].periodo, anterior)
        await afirmarLibroCuadrado(assert)
    })

    test('antes del inicio y monto editado: cajero 422; contabilidad con motivo sí', async ({
        client,
        assert,
    }) => {
        const e = await servicioDesdeSeptiembre()
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: contabilidad } = await usuarioConRoles(['contabilidad'])
        const previa = await estado(
            client.get(`/api/v1/servicios/${e.servicioId}/periodos-facturables`).bearerToken(cajero),
            200,
        )
        assert.equal(previa.body().maximo_anteriores, 24)
        const periodos = previa.body().periodos as Array<{ periodo: string; estado: string; monto: string }>
        const anterior = periodos.filter((p) => p.estado === 'antes_del_inicio').at(-1)!.periodo
        const futuro = periodos.find((p) => p.estado === 'futuro')!.periodo
        const post = (token: string, cuerpo: Record<string, unknown>) =>
            client
                .post(`/api/v1/servicios/${e.servicioId}/facturas-periodo`)
                .bearerToken(token)
                .header('Idempotency-Key', unico('ini'))
                .json(cuerpo)

        const sinAnterior = await estado(
            post(cajero, { periodos: [anterior], motivo: 'Usó el servicio' }),
            422,
        )
        assert.equal(sinAnterior.body().errors[0].rule, 'antes_del_inicio')
        const sinEditar = await estado(
            post(cajero, {
                periodos: [futuro],
                montos: [{ periodo: futuro, monto: '99.00' }],
                motivo: 'Acuerdo',
            }),
            422,
        )
        assert.equal(sinEditar.body().errors[0].rule, 'editar_monto_sin_permiso')

        const ok = await estado(
            post(contabilidad, {
                periodos: [anterior, futuro],
                montos: [{ periodo: futuro, monto: '99.00' }],
                motivo: 'Usó el servicio antes del alta; acuerdo de precio',
            }),
            200,
        )
        assert.deepEqual(
            (ok.body().creadas as Array<{ periodo: string; total: string; monto_editado: boolean }>).map(
                (c) => [c.periodo, c.total, c.monto_editado],
            ),
            [
                [anterior, '150.00', false],
                [futuro, '99.00', true],
            ],
        )
        await afirmarLibroCuadrado(assert)
    })
})
