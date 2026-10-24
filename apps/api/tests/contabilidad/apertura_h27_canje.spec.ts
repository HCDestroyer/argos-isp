import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import { contextoPrueba, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import {
    errorDe,
    lineas,
    saldoCuenta,
    servicioEn,
    type Empresas,
} from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { empresasSinFel, neto } from '#tests/contabilidad/ayudas_libros'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import { servicioCortado } from '#tests/billing/ayudas_billing'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import RegistrarSaldoInicial from '#billing/actions/registrar_saldo_inicial'
import RegistrarPagoHistorico from '#billing/actions/registrar_pago_historico'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import CrearCobroPasarela from '#billing/actions/crear_cobro_pasarela'
import ProcesarWebhookPasarela from '#billing/actions/procesar_webhook_pasarela'
import { CABECERAS_SVIX, firmarSvix } from '#billing/pasarelas/recurrente'
import CerrarApertura from '#ledger/actions/cerrar_apertura'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import CrearCaja from '#ledger/actions/crear_caja'
import AbrirCaja from '#ledger/actions/abrir_caja'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import CrearPremio from '#lealtad/actions/crear_premio'
import Canjear from '#lealtad/actions/canjear'
import RevertirCanje from '#lealtad/actions/revertir_canje'
import VencerPuntos from '#lealtad/actions/vencer_puntos'
import { saldoPuntos } from '#lealtad/puntos'
import { construirLibro, finDeMes } from '#fiscal/libros_legales'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Auditor contable · rama `a3/h27-canje-recurrente` (sale de `a3/apertura-y-api`):
 *
 * - Cierre de los saldos de apertura (`libro.cerrar_apertura`, localización §23): activa el pendiente
 *   «2.9.01 queda en 0 después de la importación y el cierre» y lo ataca (concurrencia, NCRE e
 *   importaciones después del cierre).
 * - H27 arreglado: la NCRE sobre una importada con IVA rebaja el débito del mes en que se emite; varias
 *   notas parciales acreditan el IVA exacto.
 * - Canje revertido como reverso espejo (`4.1.06 / 2.1.10`, inv. 14.canje_revertido_mal): doble reverso
 *   concurrente, lote ya vencido, 2.1.10 = lotes vivos.
 * - Pasarela Recurrente: dos eventos de pago del mismo checkout, IVA retenido por la emisora.
 * - Egresos del cajero.
 *
 * Hallazgos de esta revisión: H43 a H47 (`.fails`, fila en `a3.md`).
 */

async function importar(
    ctx: ContextoAccion,
    empresaId: number,
    total: string,
    fecha: string,
    clienteId?: number,
) {
    const cliente = clienteId ?? (await crearClienteFila())
    const r = await new ImportarFacturaPendiente().execute(
        {
            origen: 'auditoria',
            id_externo: unico('f'),
            cliente_id: cliente,
            empresa_id: empresaId,
            cargo_unico: true,
            emitida_en: fecha,
            total,
        },
        ctx,
    )
    const f = (await db.from('billing.facturas').where('id', r.factura_id!).firstOrFail()) as {
        id: number
        total: string
        iva: string
    }
    return { ...f, clienteId: cliente }
}

async function apertura(empresaId: number, hasta = '2999-12-31') {
    const { rows } = await db.rawQuery(
        `SELECT coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text AS s
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE a.empresa_id = ? AND c.codigo = '2.9.01' AND a.fecha <= ?`,
        [empresaId, hasta],
    )
    return rows[0].s as string
}

async function movimientosDeNota(notaId: number) {
    return (
        (await db
            .from('ledger.asientos as a')
            .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('a.origen_tipo', 'nota_credito')
            .where('a.origen_id', notaId)
            .orderBy('c.codigo')
            .select('c.codigo', 'c.tipo', 'm.debe', 'm.haber')) as Array<{
            codigo: string
            tipo: string
            debe: string
            haber: string
        }>
    ).map((m) => [m.codigo, m.tipo, m.debe, m.haber])
}

async function sinViolaciones(
    assert: { deepEqual: (a: unknown, b: unknown, m?: string) => void },
    empresas: number[],
) {
    const violaciones = await verificarLibro(empresas, { incluirHallazgosAbiertos: true })
    assert.deepEqual(
        violaciones.map((v) => v.invariante.split(' ')[0]),
        [],
        JSON.stringify(violaciones.map((v) => v.detalle)).slice(0, 1500),
    )
}

test.group('Auditor contable · cierre de los saldos de apertura (§23)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('2.9.01 Saldos de apertura queda en 0 después de la importación y el cierre (activado de pendientes_fases)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cliente = await crearClienteFila()
        const f1 = await importar(e.ctx, e.B, '300.00', '2026-09-05', cliente)
        const f2 = await importar(e.ctx, e.B, '120.50', '2026-09-06', cliente)
        await new RegistrarSaldoInicial().execute(
            {
                origen: 'auditoria',
                id_externo: unico('s'),
                cliente_id: await crearClienteFila(),
                empresa_id: e.B,
                monto: '-35.50',
                fecha: '2026-09-07',
            },
            e.ctx,
        )
        // un pago histórico de la importada (2.9.01 / CxC): CxC inicial = lo que queda abierto
        await new RegistrarPagoHistorico().execute(
            {
                historico: true,
                origen: 'auditoria',
                id_externo: unico('p'),
                cliente_id: cliente,
                metodo: 'deposito',
                monto: '100.00',
                fecha: '2026-09-08',
                facturas: [f1.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        await importar(e.ctx, e.C, '77.00', '2026-09-05')
        assert.equal(await apertura(e.B), '-285.00')

        const cierre = await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        assert.equal(cierre.trasladado, '-285.00')
        assert.equal(await apertura(e.B), '0.00')
        assert.equal(await saldoCuenta(e.B, '3.3.01'), '-285.00')
        // la otra empresa intacta
        assert.equal(await apertura(e.C), '-77.00')
        // total de facturas abiertas importadas = CxC inicial
        const abiertas = dec(f1.total).minus('100.00').plus(f2.total)
        assert.equal(await saldoCuenta(e.B, '1.1.03'), aTexto(abiertas))
        const verificacion = await new VerificarCierre().execute(
            { empresa_id: e.B, tipo: 'mensual', periodo: '2026-09' },
            e.ctx,
        )
        assert.notEqual(verificacion.checks.find((c) => c.clave === 'apertura_cero')?.estado, 'anomalia')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('dos cierres de apertura simultáneos trasladan el saldo una sola vez', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        await importar(e.ctx, e.B, '250.00', '2026-09-05')
        const resultados = await Promise.allSettled([
            new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx),
            new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx),
        ])
        const hechos = resultados.filter((r) => r.status === 'fulfilled').map((r) => r.value)
        assert.lengthOf(hechos, 2)
        assert.lengthOf(
            hechos.filter((h) => h.asiento !== null),
            1,
        )
        assert.equal(await apertura(e.B), '0.00')
        assert.equal(await saldoCuenta(e.B, '3.3.01'), '-250.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('NCRE sobre una importada después del cierre: 2.9.01 sigue en 0, el IVA rebaja 2.1.02 y apertura_cero pasa', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const f = await importar(e.ctx, e.B, '112.00', '2026-09-05')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '56.00', motivo: 'auditoría: la mitad después del cierre' },
            e.ctx,
        )
        assert.equal(nota.iva, '6.00')
        assert.equal(await apertura(e.B), '0.00')
        const v = await new VerificarCierre().execute(
            { empresa_id: e.B, tipo: 'mensual', periodo: hoyGuatemala().slice(0, 7) },
            e.ctx,
        )
        assert.notEqual(v.checks.find((c) => c.clave === 'apertura_cero')?.estado, 'anomalia')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H43: una importada que entra después del cierre de apertura (y antes de su fecha) manda la base de su NCRE a patrimonio aunque su saldo nunca se cerró', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await importar(e.ctx, e.B, '50.00', '2026-09-05')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: hoyGuatemala() }, e.ctx)
        // importación tardía con fecha anterior al cierre: su 2.9.01 no está en el cierre
        const tardia = await importar(e.ctx, e.B, '112.00', '2026-09-20')
        assert.equal(await apertura(e.B), '-112.00')
        await new EmitirNotaCredito().execute(
            { factura_id: tardia.id, monto: '112.00', motivo: 'auditoría: acredita la tardía' },
            e.ctx,
        )
        // lo correcto: la base vuelve contra 2.9.01 (que conserva solo el IVA, como cualquier importada
        // aún sin cerrar); hoy va a 3.3.01 y 2.9.01 queda con los 112.00 completos
        assert.equal(await apertura(e.B), '-12.00')
    }).fails(
        'H43: cuentaBaseApertura decide por la fecha del asiento importado, no por si entró en el cierre',
    )
})

test.group('Auditor contable · H27 en el libro de ventas y la declaración', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('H42: la nota de crédito sin FEL sobre una importada rebaja 2.1.02 del mes pero no sale en el libro de ventas (la declaración de IVA no la ve)', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        const f = await importar(e.ctx, e.B, '224.00', '2026-08-10')
        assert.equal(f.iva, '24.00')
        await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '112.00', motivo: 'auditoría: rebaja de la importada' },
            e.ctx,
        )
        const hoy = hoyGuatemala()
        const mes = { desde: inicioDeMes(hoy), hasta: finDeMes(hoy) }
        const ventas = await construirLibro('ventas', e.B, mes)
        const debito = await neto(e.B, '2.1.02', mes.desde, mes.hasta)
        assert.equal(debito.toFixed(2), '12.00')
        assert.equal(ventas.reporte.totales.iva, aTexto(CERO.minus(debito)))
        // agosto (la importada) no aparece en el libro: la declaró el sistema de origen
        const agosto = await construirLibro('ventas', e.B, { desde: '2026-08-01', hasta: '2026-08-31' })
        assert.equal(agosto.reporte.totales.iva, '0.00')
        const v = await new VerificarCierre().execute(
            { empresa_id: e.B, tipo: 'mensual', periodo: hoy.slice(0, 7) },
            e.ctx,
        )
        assert.notEqual(v.checks.find((c) => c.clave === 'iva_cuadrado')?.estado, 'anomalia')
        await sinViolaciones(assert, [e.B, e.C])
    }).fails('H42: libroVentasLegal excluye las notas de facturas con clave_externa (importadas)')

    test('cuatro NCRE parciales con redondeo sobre una importada: Σ IVA = IVA de la factura y Σ base = su base', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const f = await importar(e.ctx, e.B, '43.98', '2026-09-05')
        const notas = []
        for (const monto of ['10.01', '10.01', '10.01', '13.95']) {
            notas.push(
                await new EmitirNotaCredito().execute(
                    { factura_id: f.id, monto, motivo: 'auditoría: parcial' },
                    e.ctx,
                ),
            )
        }
        const iva = notas.reduce((s, n) => s.plus(n.iva), CERO)
        assert.equal(aTexto(iva), f.iva)
        assert.equal(await saldoCuenta(e.B, '1.1.03'), '0.00')
        // 2.9.01 conserva exactamente el IVA de la importada
        assert.equal(await apertura(e.B), aTexto(CERO.minus(f.iva)))
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H44: la base de la NCRE sobre una importada no rebaja los ingresos del periodo (va a 2.9.01 o a patrimonio) aunque su IVA sí rebaja el débito del mes', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const f = await importar(e.ctx, e.B, '112.00', '2026-09-05')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '112.00', motivo: 'auditoría: rebaja del periodo' },
            e.ctx,
        )
        // la NCRE es un documento del mes en que se emite (libro de ventas, débito del mes): su base
        // es una rebaja de ventas del periodo, como la de cualquier factura de un año ya cerrado
        const movimientos = await movimientosDeNota(nota.id)
        const aIngreso = movimientos.filter((m) => m[1] === 'ingreso' && m[2] === '100.00')
        assert.lengthOf(aIngreso, 1, JSON.stringify(movimientos))
    }).fails(
        'H44: la base de la NCRE de una importada va contra 2.9.01/3.3.01, no contra ingresos del periodo',
    )
})

test.group('Auditor contable · canje revertido como reverso espejo', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    async function conCanje(e: Empresas, puntos = 100, costo = 60) {
        const { programa } = await programaConReglas(e.B, e.ctx, { diferimiento: true, vencimiento_meses: 3 })
        const s = await servicioEn(e.B, { precio: '200.00', instalacion: '2026-10-01' })
        await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos, motivo: 'saldo inicial' },
            e.ctx,
        )
        const premio = await new CrearPremio().execute(
            {
                programa_id: programa.id,
                nombre: unico('Premio'),
                tipo: 'descuento_factura',
                descuento_tipo: 'monto',
                descuento_valor: '5.00',
                costo_puntos: costo,
            },
            e.ctx,
        )
        const canje = await new Canjear().execute(
            { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: premio.id },
            e.ctx,
        )
        return { s, canje, programa }
    }

    test('dos reversos simultáneos del mismo canje devuelven los puntos una sola vez', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const { s, canje } = await conCanje(e)
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 40)
        const r = await Promise.allSettled([
            new RevertirCanje().execute({ id: canje.id, motivo: 'uno' }, e.ctx),
            new RevertirCanje().execute({ id: canje.id, motivo: 'dos' }, e.ctx),
        ])
        assert.isAtLeast(r.filter((x) => x.status === 'fulfilled').length, 1)
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 100)
        const reversos = await db
            .from('lealtad.movimientos')
            .where('tipo', 'reverso')
            .where('origen_tipo', 'canje')
            .where('origen_id', canje.id)
            .count('* as n')
            .firstOrFail()
        assert.equal(Number(reversos.n), 1)
        // 2.1.10 = valor de los lotes vivos (inv. 14) y el reverso es espejo de la salida
        const salida = await lineas('lealtad', canje.movimiento_id!)
        assert.isAbove(salida.length, 0)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('reverso de un canje cuyo lote ya venció: el lote devuelto vence en el siguiente cron y 2.1.10 queda en los lotes vivos', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { s, canje } = await conCanje(e)
        const lote = (await db
            .from('lealtad.consumos as c')
            .join('lealtad.movimientos as l', 'l.id', 'c.lote_id')
            .where('c.movimiento_id', canje.movimiento_id!)
            .select(db.raw(`to_char(l.vence_en, 'YYYY-MM-DD') as vence_en`))
            .firstOrFail()) as { vence_en: string | null }
        assert.isNotNull(lote.vence_en, 'el lote del ajuste vence con el programa')
        // vence el resto del lote (40) en su fecha
        await new VencerPuntos().execute({ empresa_id: e.B, hoy: lote.vence_en! }, contextoSistema('cron'))
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 0)
        await afirmarLibro(assert, [e.B, e.C])
        // se revierte el canje: vuelve un lote con el vencimiento original (ya pasado para el cron)
        await new RevertirCanje().execute({ id: canje.id, motivo: 'auditoría: lote vencido' }, e.ctx)
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 60)
        await afirmarLibro(assert, [e.B, e.C])
        await new VencerPuntos().execute({ empresa_id: e.B, hoy: lote.vence_en! }, contextoSistema('cron'))
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 0)
        assert.equal(await saldoCuenta(e.B, '2.1.10'), '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })
})

const SECRETO = `whsec_${Buffer.from('secreto-del-auditor-recurrente-32').toString('base64')}`

function webhook(cuerpo: Record<string, unknown>, id: string) {
    const texto = JSON.stringify(cuerpo)
    const marca = Math.floor(Date.now() / 1000)
    return {
        cuerpo: texto,
        cabeceras: {
            [CABECERAS_SVIX.id]: id,
            [CABECERAS_SVIX.marca]: String(marca),
            [CABECERAS_SVIX.firma]: firmarSvix(SECRETO, id, marca, texto),
        },
    }
}

async function conRecurrente<T>(checkout: string, total: number, fn: () => Promise<T>): Promise<T> {
    const anterior = {
        proveedor: env.get('PASARELA_PROVEEDOR'),
        llave: env.get('RECURRENTE_SECRET_KEY'),
        secreto: env.get('RECURRENTE_WEBHOOK_SECRETO'),
        url: env.get('RECURRENTE_API_URL'),
    }
    const fetchOriginal = globalThis.fetch
    try {
        env.set('PASARELA_PROVEEDOR', 'recurrente')
        env.set('RECURRENTE_SECRET_KEY', 'sk_test_auditor')
        env.set('RECURRENTE_WEBHOOK_SECRETO', SECRETO)
        env.set('RECURRENTE_API_URL', 'https://recurrente.simulado/api')
        globalThis.fetch = (async (url: string) => {
            const cuerpo = String(url).endsWith('/checkouts')
                ? { id: checkout, checkout_url: `https://app.recurrente.com/c/${checkout}` }
                : { id: checkout, status: 'paid', total_in_cents: total }
            return new Response(JSON.stringify(cuerpo), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }) as unknown as typeof fetch
        return await fn()
    } finally {
        globalThis.fetch = fetchOriginal
        env.set('PASARELA_PROVEEDOR', anterior.proveedor ?? '')
        env.set('RECURRENTE_SECRET_KEY', anterior.llave ?? '')
        env.set('RECURRENTE_WEBHOOK_SECRETO', anterior.secreto ?? '')
        env.set('RECURRENTE_API_URL', anterior.url ?? '')
    }
}

test.group('Auditor contable · pasarela Recurrente', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('el evento unificado y el legacy del mismo pago (svix-id distintos) registran un solo pago por el bruto', async ({
        assert,
    }) => {
        const datos = await servicioCortado()
        const checkout = `ch_${unico('a')}`
        await conRecurrente(checkout, 30000, async () => {
            const cobro = await new CrearCobroPasarela().execute(
                { cliente_id: datos.clienteId },
                contextoSistema('portal'),
            )
            const centavos = Number(aTexto(dec(cobro.monto).times(100)).split('.')[0])
            const unificado = webhook(
                {
                    event_type: 'intent.succeeded',
                    checkout: { id: checkout },
                    amount_in_cents: centavos,
                    details: { fee: 1050 },
                },
                `msg_${unico('u')}`,
            )
            const legacy = webhook(
                {
                    event_type: 'payment_intent.succeeded',
                    checkout: { id: checkout },
                    amount_in_cents: centavos,
                    fee: 1050,
                },
                `msg_${unico('l')}`,
            )
            const uno = await new ProcesarWebhookPasarela().execute(
                { proveedor: 'recurrente', ...unificado },
                contextoSistema('webhook'),
            )
            const dos = await new ProcesarWebhookPasarela().execute(
                { proveedor: 'recurrente', ...legacy },
                contextoSistema('webhook'),
            )
            assert.isNotNull(uno.pago_id)
            assert.equal(dos.ignorado, 'cobro_ya_pagado')
            const pagos = await db
                .from('billing.pagos')
                .where('referencia', checkout)
                .select('monto', 'comision')
            assert.deepEqual(pagos, [{ monto: cobro.monto, comision: '10.50' }])
            // el libro de la empresa del cobro (las demás empresas de la base son de otras pruebas)
            await afirmarLibro(assert, [Number(cobro.empresa_id)])
        })
    })

    test('H45: el IVA que retiene la emisora de la tarjeta (`vat_withheld` del webhook) no se registra: el banco recibe de más y falta la retención en 1.1.05', async ({
        assert,
    }) => {
        const datos = await servicioCortado()
        const checkout = `ch_${unico('v')}`
        await conRecurrente(checkout, 30000, async () => {
            const cobro = await new CrearCobroPasarela().execute(
                { cliente_id: datos.clienteId },
                contextoSistema('portal'),
            )
            const centavos = Number(aTexto(dec(cobro.monto).times(100)).split('.')[0])
            // retención de IVA de la operadora de tarjetas (15 % del IVA de la venta)
            const ivaVenta = dec(cobro.monto).minus(dec(cobro.monto).div('1.12')).toDecimalPlaces(2)
            const retenido = ivaVenta.times('0.15').toDecimalPlaces(2)
            const w = webhook(
                {
                    event_type: 'payment_intent.succeeded',
                    checkout: { id: checkout },
                    amount_in_cents: centavos,
                    fee: 1050,
                    vat_withheld: Number(retenido.times(100).toFixed(0)),
                    vat_withheld_currency: 'GTQ',
                },
                `msg_${unico('w')}`,
            )
            const r = await new ProcesarWebhookPasarela().execute(
                { proveedor: 'recurrente', ...w },
                contextoSistema('webhook'),
            )
            const asiento = await lineas('pago', r.pago_id!)
            const banco = asiento.find((l) => String(l[0]).startsWith('1.1.02'))
            assert.equal(banco?.[1], aTexto(dec(cobro.monto).minus('10.50').minus(retenido)))
            assert.isDefined(asiento.find((l) => l[0] === '1.1.05'))
        })
    }).fails('H45: vat_withheld de Recurrente se ignora')
})

test.group('Auditor contable · egresos del cajero', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    async function cajero(e: Empresas, fondo: string) {
        const c = await usuarioConRoles(['cajero'])
        const ctx = contextoPrueba(c.usuario.id)
        const caja = await new CrearCaja().execute(
            { nombre: unico('Caja'), cajero_id: c.usuario.id, empresa_id: e.B },
            e.ctx,
        )
        await new AbrirCaja().execute({ caja_id: caja.id, fondo_inicial: fondo }, ctx)
        return { ctx, cajaId: caja.id }
    }

    test('el egreso del cajero va contra la cuenta de su caja y baja su esperado; el libro cuadra', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const c = await cajero(e, '600.00')
        const eg = await new RegistrarEgreso().execute(
            { categoria: 'otros', metodo: 'caja', caja_id: c.cajaId, monto: '123.45', descripcion: 'cable' },
            c.ctx,
        )
        const asiento = await lineas('egreso', eg.id)
        assert.deepEqual(asiento.map((l) => [l[1], l[2]]).sort(), [
            ['0.00', '123.45'],
            ['123.45', '0.00'],
        ])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H46: el cajero registra un egreso con fecha anterior a la apertura de su turno', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const c = await cajero(e, '600.00')
        const ayer = new Date(`${hoyGuatemala()}T12:00:00Z`)
        ayer.setUTCDate(ayer.getUTCDate() - 1)
        const error = await errorDe(
            new RegistrarEgreso().execute(
                {
                    categoria: 'otros',
                    metodo: 'caja',
                    caja_id: c.cajaId,
                    monto: '50.00',
                    descripcion: 'con fecha de ayer',
                    fecha: ayer.toISOString().slice(0, 10),
                },
                c.ctx,
            ),
        )
        assert.equal(error.status, 422)
    }).fails('H46: el egreso del cajero acepta una fecha anterior a su turno')

    test('H47: el cajero saca de su caja más efectivo del que tiene (esperado negativo)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const c = await cajero(e, '100.00')
        const error = await errorDe(
            new RegistrarEgreso().execute(
                {
                    categoria: 'otros',
                    metodo: 'caja',
                    caja_id: c.cajaId,
                    monto: '300.00',
                    descripcion: 'más que el fondo',
                },
                c.ctx,
            ),
        )
        assert.equal(error.status, 422)
    }).fails('H47: el egreso del cajero no se limita al efectivo de su turno')
})
