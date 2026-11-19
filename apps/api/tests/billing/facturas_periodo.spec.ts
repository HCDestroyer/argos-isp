import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import {
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

async function errorDe(promesa: Promise<unknown>) {
    try {
        await promesa
    } catch (error) {
        const e = error as { status?: number; code?: string; errores?: Array<{ rule: string }> }
        return { status: e.status, rule: e.errores?.[0]?.rule ?? null }
    }
    throw new Error('Se esperaba un error')
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
        const e = await servicioDesdeSeptiembre({ fecha_instalacion: '2026-09-16' })
        await generar(e.servicioId, '2026-10-01')
        const antes = await conteos(e.servicioId)

        const v = await vista(e.servicioId)
        assert.isTrue(v.emitible)
        assert.equal(v.maximo_futuros, 12)
        assert.equal(v.saldo_a_favor, '0.00')
        assert.deepEqual(
            v.periodos.slice(0, 4).map((p) => [p.periodo, p.estado, p.monto, p.vence_en, p.prorrateado]),
            [
                // septiembre prorrateado: 15 de 30 días
                ['2026-09-16', 'emitida', '75.00', '2026-09-21', true],
                ['2026-10-01', 'emitida', '150.00', '2026-10-06', false],
                ['2026-11-01', 'pendiente', '150.00', '2026-11-06', false],
                ['2026-12-01', 'futuro', '150.00', '2026-12-06', false],
            ],
        )
        assert.isNotNull(v.periodos[0]!.factura_id)
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
            v.periodos.map((p) => [p.periodo, p.estado, p.monto, p.pagado]),
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

test.group('Facturas de periodo · emitir', () => {
    test('cliente paga 3 meses adelantados: el anticipo queda aplicado y el cron no duplica', async ({
        assert,
    }) => {
        const e = await servicioDesdeSeptiembre({ fecha_instalacion: '2026-11-01' })
        await generar(e.servicioId, '2026-11-01')
        // paga noviembre y tres meses más: lo que sobra queda como saldo a favor
        await new RegistrarPago().execute(
            { cliente_id: e.clienteId, metodo: 'caja', monto: '600.00' },
            contextoPrueba(),
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
        await afirmarLibro(assert, 1)

        // misma clave que el cron, mismo evento y snapshot con la emisión manual
        const dic = await db.from('billing.facturas').where('id', r.creadas[0]!.factura_id).firstOrFail()
        assert.equal(dic.clave_unica, `${e.servicioId}-2026-12-01`)
        assert.deepEqual(dic.reglas_snapshot.emision_manual, {
            motivo: 'Pagó tres meses por adelantado',
            antes_de_facturar_desde: false,
            facturar_desde: null,
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
        assert.deepEqual(
            r.creadas.map((c) => [c.periodo, c.estado, c.total]),
            [
                ['2026-09-01', 'emitida', '150.00'],
                ['2026-10-01', 'emitida', '150.00'],
                ['2026-11-01', 'emitida', '150.00'],
            ],
        )
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
        assert.deepEqual(await errorDe(emitir(e.servicioId, { periodos: ['2026-08-01'] })), {
            status: 422,
            rule: 'periodo_invalido',
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
            v.periodos.map((p) => [p.periodo, p.estado]),
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
            facturar_desde: '2026-11-01',
        })
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
})
