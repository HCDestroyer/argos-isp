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
    servicioFacturado,
    type Empresas,
} from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { empresasSinFel, neto } from '#tests/contabilidad/ayudas_libros'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import RegistrarSaldoInicial from '#billing/actions/registrar_saldo_inicial'
import RegistrarPagoHistorico from '#billing/actions/registrar_pago_historico'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import CrearCobroPasarela from '#billing/actions/crear_cobro_pasarela'
import ProcesarWebhookPasarela from '#billing/actions/procesar_webhook_pasarela'
import { CABECERAS_SVIX, firmarSvix } from '#billing/pasarelas/recurrente'
import CerrarApertura from '#ledger/actions/cerrar_apertura'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import CrearCaja from '#ledger/actions/crear_caja'
import AbrirCaja from '#ledger/actions/abrir_caja'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import CrearProveedorCobro from '#ledger/actions/crear_proveedor_cobro'
import LiquidarCobros from '#ledger/actions/liquidar_cobros'
import ConciliarPasarela from '#billing/actions/conciliar_pasarela'
import AnularFactura from '#billing/actions/anular_factura'
import AnularSaldoInicial from '#billing/actions/anular_saldo_inicial'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import { cuentaBancariaPrueba, servicioCortado, unicoBd } from '#tests/billing/ayudas_billing'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import CrearPremio from '#lealtad/actions/crear_premio'
import Canjear from '#lealtad/actions/canjear'
import RevertirCanje from '#lealtad/actions/revertir_canje'
import VencerPuntos from '#lealtad/actions/vencer_puntos'
import { saldoPuntos } from '#lealtad/puntos'
import { construirLibro, finDeMes } from '#fiscal/libros_legales'
import { calcularDatos } from '#fiscal/declaraciones'
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
 * Hallazgos de la primera revisión: H48 a H53 (arreglados por A3 en 28ee679; H49 desapareció con H50).
 * Verificación final de 28ee679: H60 a H64 (arreglados por A3 en 9f4a260).
 * Verificación de 9f4a260 (`a3/pedidos-panel`): H65 y H66 (arreglados por A3 en a693f85).
 * Verificación de `a3/ajustes-reembolso` y `a3/reembolso-montos`: H70–H73 (arreglados por A3 en cb9201a y 5c6f26d).
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
            id_externo: await unicoBd('f'),
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
    ).map((m) => [m.codigo, m.tipo, m.debe, m.haber] as [string, string, string, string])
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
                id_externo: await unicoBd('s'),
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
                id_externo: await unicoBd('p'),
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

    test('H49 (desaparece con H50, 28ee679): la NCRE de una importada tardía (después del cierre, con fecha anterior) va a ingresos y 2.9.01 conserva su total hasta el próximo cierre', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await importar(e.ctx, e.B, '50.00', '2026-09-05')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: hoyGuatemala() }, e.ctx)
        const tardia = await importar(e.ctx, e.B, '112.00', '2026-09-20')
        assert.equal(await apertura(e.B), '-112.00')
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: tardia.id, monto: '112.00', motivo: 'auditoría: acredita la tardía' },
            e.ctx,
        )
        const movimientos = await movimientosDeNota(nota.id)
        assert.deepEqual(movimientos.map((m) => [m[1], m[2], m[3]]).sort(), [
            ['activo', '0.00', '112.00'],
            ['ingreso', '100.00', '0.00'],
            ['pasivo', '12.00', '0.00'],
        ])
        assert.equal(await apertura(e.B), '-112.00')
        // el segundo cierre traslada la tardía completa y 2.9.01 vuelve a 0
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: hoyGuatemala() }, e.ctx)
        assert.equal(await apertura(e.B), '0.00')
        await sinViolaciones(assert, [e.B, e.C])
    })
})

test.group('Auditor contable · H27 en el libro de ventas y la declaración', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('H48 (arreglado en 28ee679): la nota de crédito sin FEL sobre una importada sale en el libro de ventas del mes y la declaración de IVA rebaja su débito', async ({
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
        // la declaración de IVA del mes sale del libro: débito −12.00 (la base −100.00 en ventas)
        const datos = await calcularDatos(db.connection(), e.B, 'iva_mensual', mes.desde)
        assert.equal((datos.totales as Record<string, string>).debito, '-12.00')
        assert.equal((datos.totales as Record<string, string>).base_ventas, '-100.00')
        // y la base rebaja los ingresos del mes por lo mismo que el libro
        const ingresos = await db.rawQuery(
            `SELECT coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text AS s
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE a.empresa_id = ? AND c.tipo = 'ingreso' AND a.fecha BETWEEN ? AND ?`,
            [e.B, mes.desde, mes.hasta],
        )
        assert.equal(ingresos.rows[0].s, '100.00')
        await sinViolaciones(assert, [e.B, e.C])
    })

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
        // H50: 2.9.01 conserva el total importado y la base va a ingresos
        assert.equal(await apertura(e.B), aTexto(CERO.minus(f.total)))
        let base = CERO
        for (const n of notas) {
            for (const m of await movimientosDeNota(n.id)) {
                if (m[1] === 'ingreso') base = base.plus(m[2]).minus(m[3])
            }
        }
        assert.equal(aTexto(base), aTexto(dec(f.total).minus(f.iva)))
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H50 (decisión del líder, 28ee679): la base de la NCRE sobre una importada rebaja los ingresos del periodo en la cuenta de su línea; 2.9.01 y patrimonio no se tocan', async ({
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
        assert.isUndefined(movimientos.find((m) => m[1] === 'patrimonio' || m[0] === '2.9.01'))
        assert.equal(await apertura(e.B), '0.00')
        assert.equal(await saldoCuenta(e.B, '3.3.01'), '-112.00')
        await sinViolaciones(assert, [e.B, e.C])
    })
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

/** total del checkout que responde la consulta simulada cuando la prueba no lo fija */
let totalSimulado = 0

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
                : { id: checkout, status: 'paid', total_in_cents: total || totalSimulado }
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
        const checkout = `ch_${await unicoBd('a')}`
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
                `msg_${await unicoBd('u')}`,
            )
            const legacy = webhook(
                {
                    event_type: 'payment_intent.succeeded',
                    checkout: { id: checkout },
                    amount_in_cents: centavos,
                    fee: 1050,
                },
                `msg_${await unicoBd('l')}`,
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
            // un solo asiento: Banco por el neto, 5.1.02 por la comisión y CxC por el bruto (en la empresa
            // principal no se corre afirmarLibro: otras pruebas dejan cierres de fixture sin resumen)
            const asiento = await lineas('pago', uno.pago_id!)
            assert.deepEqual(
                asiento.map((l) => [l[0].startsWith('1.1.02') ? 'banco' : l[0], l[1], l[2]]),
                [
                    ['banco', aTexto(dec(cobro.monto).minus('10.50')), '0.00'],
                    ['5.1.02', '10.50', '0.00'],
                    ['1.1.03', '0.00', cobro.monto],
                ],
            )
        })
    })

    test('H51 (arreglado en 28ee679): el IVA que retiene la emisora (`vat_withheld`) va a 1.1.05 como RET_IVA_TAR y el banco queda en bruto − comisión − retención', async ({
        assert,
    }) => {
        const datos = await servicioCortado()
        const checkout = `ch_${await unicoBd('v')}`
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
                `msg_${await unicoBd('w')}`,
            )
            const r = await new ProcesarWebhookPasarela().execute(
                { proveedor: 'recurrente', ...w },
                contextoSistema('webhook'),
            )
            const asiento = await lineas('pago', r.pago_id!)
            const banco = asiento.find((l) => String(l[0]).startsWith('1.1.02'))
            assert.equal(banco?.[1], aTexto(dec(cobro.monto).minus('10.50').minus(retenido)))
            assert.deepEqual(
                asiento.find((l) => l[0] === '1.1.05'),
                ['1.1.05', aTexto(retenido), '0.00'],
            )
            assert.deepEqual(
                asiento.find((l) => l[0] === '1.1.03'),
                ['1.1.03', '0.00', cobro.monto],
            )
            const pago = await db.from('billing.pagos').where('id', r.pago_id!).firstOrFail()
            assert.include(pago, { monto: cobro.monto, retenido: aTexto(retenido), comision: '10.50' })
            const constancia = await db
                .from('ledger.constancias_retencion')
                .where('pago_id', r.pago_id!)
                .select('monto', 'impuesto', 'direccion')
            assert.deepEqual(constancia, [
                { monto: aTexto(retenido), impuesto: 'iva', direccion: 'recibida' },
            ])
        })
    })
})

test.group('Auditor contable · egresos del cajero', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    async function cajero(e: Empresas, fondo: string) {
        const c = await usuarioConRoles(['cajero'])
        const ctx = contextoPrueba(c.usuario.id)
        const caja = await new CrearCaja().execute(
            { nombre: await unicoBd('Caja'), cajero_id: c.usuario.id, empresa_id: e.B },
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

    test('H52 (arreglado en 28ee679): el cajero no registra un egreso con fecha anterior a la apertura de su turno', async ({
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
        assert.deepEqual([error.status, error.reglas], [422, ['anterior_al_turno']])
    })

    test('H53 (arreglado en 28ee679): el cajero no saca más efectivo del que tiene su turno; hasta lo que tiene, sí', async ({
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
        assert.deepEqual([error.status, error.codigo], [422, 'efectivo_insuficiente'])
        // dos egresos simultáneos que juntos pasan el efectivo: solo uno entra
        const dos = await Promise.allSettled(
            ['60.00', '60.00'].map((monto) =>
                new RegistrarEgreso().execute(
                    { categoria: 'otros', metodo: 'caja', caja_id: c.cajaId, monto, descripcion: 'a la vez' },
                    c.ctx,
                ),
            ),
        )
        assert.lengthOf(
            dos.filter((r) => r.status === 'fulfilled'),
            1,
        )
        // el resto exacto sí sale y el turno cierra en cero
        await new RegistrarEgreso().execute(
            {
                categoria: 'otros',
                metodo: 'caja',
                caja_id: c.cajaId,
                monto: '40.00',
                descripcion: 'el resto',
            },
            c.ctx,
        )
        const cerrada = await new CerrarCaja().execute({ caja_id: c.cajaId, contado: '0.00' }, c.ctx)
        assert.equal(cerrada.esperado, '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })
})

/** Cobro en línea de Recurrente de un servicio facturado en la empresa B, ya pagado por webhook. */
async function cobroPagado(e: Empresas, checkout: string, extra: Record<string, unknown> = {}) {
    const s = await servicioFacturado(e.B, '2026-10-01', { precio: '300.00', instalacion: '2026-09-01' })
    const cobro = await new CrearCobroPasarela().execute(
        { cliente_id: s.clienteId },
        contextoSistema('portal'),
    )
    const centavos = Number(dec(cobro.monto).times(100).toFixed(0))
    totalSimulado = centavos
    const pago = await new ProcesarWebhookPasarela().execute(
        {
            proveedor: 'recurrente',
            ...webhook(
                {
                    event_type: 'payment_intent.succeeded',
                    checkout: { id: checkout },
                    amount_in_cents: centavos,
                    fee: 1050,
                    ...extra,
                },
                `msg_${await unicoBd('p')}`,
            ),
        },
        contextoSistema('webhook'),
    )
    return { s, cobro, pago, centavos }
}

async function deudaDe(empresaId: number, clienteId: number) {
    return saldoCuenta(empresaId, '1.1.03', clienteId)
}

test.group('Auditor contable · verificación final de 28ee679', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('anular una importada: con la apertura abierta corrige la importación (2.9.01); con la apertura cerrada es 409 y se acredita con NCRE a ingresos', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const abierta = await importar(e.ctx, e.B, '112.00', '2026-09-05')
        await new AnularFactura().execute(
            { factura_id: abierta.id, motivo: 'auditoría: importación errónea' },
            e.ctx,
        )
        assert.equal(await apertura(e.B), '0.00')
        const cerrada = await importar(e.ctx, e.B, '224.00', '2026-09-06')
        // el reverso de la anulada es de hoy: el cierre con fecha de hoy lo incluye
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: hoyGuatemala() }, e.ctx)
        const error = await errorDe(
            new AnularFactura().execute(
                { factura_id: cerrada.id, motivo: 'auditoría: tras el cierre' },
                e.ctx,
            ),
        )
        assert.deepEqual([error.status, error.codigo], [409, 'importada_con_apertura_cerrada'])
        assert.equal(await apertura(e.B), '0.00')
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: cerrada.id, monto: '224.00', motivo: 'auditoría: se acredita' },
            e.ctx,
        )
        assert.equal(nota.iva, '24.00')
        assert.equal(await deudaDe(e.B, cerrada.clienteId), '0.00')
        assert.equal(await apertura(e.B), '0.00')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H60 (arreglado en 9f4a260): un reembolso parcial de Recurrente deja deuda solo por lo reembolsado', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const checkout = `ch_${await unicoBd('r')}`
        await conRecurrente(checkout, 0, async () => {
            const { s, cobro, centavos } = await cobroPagado(e, checkout)
            assert.equal(await deudaDe(e.B, s.clienteId), '0.00')
            // devuelve un tercio
            const parcial = Math.floor(centavos / 3)
            await new ProcesarWebhookPasarela().execute(
                {
                    proveedor: 'recurrente',
                    ...webhook(
                        {
                            event_type: 'refund.update',
                            refund: {
                                id: 're_parcial',
                                status: 'succeeded',
                                customer_refunded_amount_in_cents: parcial,
                            },
                            intentable: { checkout: { id: checkout } },
                        },
                        `msg_${await unicoBd('rp')}`,
                    ),
                },
                contextoSistema('webhook'),
            )
            // lo devuelto vuelve a deberse, no el cobro completo
            assert.equal(await deudaDe(e.B, s.clienteId), deCentavosTexto(parcial))
            assert.notEqual(await deudaDe(e.B, s.clienteId), cobro.monto)
        })
    })

    test('reembolso total: anula el pago, la deuda vuelve y el libro cuadra', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const checkout = `ch_${await unicoBd('t')}`
        await conRecurrente(checkout, 0, async () => {
            const { s, cobro, centavos, pago } = await cobroPagado(e, checkout)
            const r = await new ProcesarWebhookPasarela().execute(
                {
                    proveedor: 'recurrente',
                    ...webhook(
                        {
                            event_type: 'refund.update',
                            refund: {
                                id: 're_total',
                                status: 'succeeded',
                                customer_refunded_amount_in_cents: centavos,
                            },
                            intentable: { checkout: { id: checkout } },
                        },
                        `msg_${await unicoBd('rt')}`,
                    ),
                },
                contextoSistema('webhook'),
            )
            assert.equal(r.pago_id, pago.pago_id)
            const fila = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
            assert.equal(fila.estado, 'anulado')
            assert.equal(await deudaDe(e.B, s.clienteId), cobro.monto)
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('monto distinto del cobro: no registra el pago ni toca el libro', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const checkout = `ch_${await unicoBd('m')}`
        await conRecurrente(checkout, 0, async () => {
            const s = await servicioFacturado(e.B, '2026-10-01', {
                precio: '300.00',
                instalacion: '2026-09-01',
            })
            const cobro = await new CrearCobroPasarela().execute(
                { cliente_id: s.clienteId },
                contextoSistema('portal'),
            )
            const antes = await deudaDe(e.B, s.clienteId)
            const r = await new ProcesarWebhookPasarela().execute(
                {
                    proveedor: 'recurrente',
                    ...webhook(
                        {
                            event_type: 'payment_intent.succeeded',
                            checkout: { id: checkout },
                            amount_in_cents: Number(dec(cobro.monto).times(100).toFixed(0)) - 1,
                            fee: 100,
                        },
                        `msg_${await unicoBd('md')}`,
                    ),
                },
                contextoSistema('webhook'),
            )
            assert.deepEqual([r.pago_id, r.ignorado], [null, 'monto_distinto'])
            assert.equal(await deudaDe(e.B, s.clienteId), antes)
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H61 (arreglado en 9f4a260): con Recurrente como proveedor de cobro, un pago con `vat_withheld` se registra (retención a 1.1.05, puente por monto − retenido)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const banco = await cuentaBancariaPrueba('Banrural', e.B)
        const proveedor = await new CrearProveedorCobro().execute(
            {
                empresa_id: e.B,
                metodo: 'pasarela',
                pasarela: 'recurrente',
                nombre: 'Recurrente',
                cuenta_bancaria_id: banco.id,
            },
            e.ctx,
        )
        const checkout = `ch_${await unicoBd('pc')}`
        await conRecurrente(checkout, 0, async () => {
            const { pago } = await cobroPagado(e, checkout, { vat_withheld: 482 })
            assert.isNotNull(pago.pago_id)
            const fila = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
            assert.include(fila, { retenido: '4.82', proveedor_cobro_id: proveedor.id })
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H62 (arreglado en 9f4a260): en pequeño contribuyente la importada va sin IVA, su nota no toca 2.1.02 y sale en el libro de ventas por su total', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        await new CambiarRegimen().execute(
            {
                empresa_id: e.B,
                regimen: 'pequeno_contribuyente',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción',
            },
            e.ctx,
        )
        const f = await importar(e.ctx, e.B, '200.00', '2026-08-10')
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '50.00', motivo: 'auditoría: rebaja PC' },
            e.ctx,
        )
        const hoy = hoyGuatemala()
        const ventas = await construirLibro('ventas', e.B, { desde: inicioDeMes(hoy), hasta: finDeMes(hoy) })
        // PC: sin IVA desglosado ni 2.1.02; la nota rebaja el total del libro (base del 5 %) por su monto
        assert.deepEqual(
            {
                iva_importada: f.iva,
                iva_nota: nota.iva,
                debito: aTexto(await saldoCuenta(e.B, '2.1.02')),
                total_libro: ventas.reporte.totales.total,
            },
            { iva_importada: '0.00', iva_nota: '0.00', debito: '0.00', total_libro: '-50.00' },
        )
    })

    test('H63 (arreglado en 9f4a260): anular un saldo inicial que ya entró en el cierre de apertura es 409 y 2.9.01 no se reabre', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cliente = await crearClienteFila()
        const saldo = await new RegistrarSaldoInicial().execute(
            {
                origen: 'auditoria',
                id_externo: await unicoBd('s'),
                cliente_id: cliente,
                empresa_id: e.B,
                monto: '80.00',
                fecha: '2026-09-07',
            },
            e.ctx,
        )
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        const r = await errorDe(
            new AnularSaldoInicial().execute(
                { saldo_inicial_id: saldo.saldo_inicial_id, motivo: 'auditoría: tras el cierre' },
                e.ctx,
            ),
        )
        assert.deepEqual([r.status, r.codigo], [409, 'saldo_con_apertura_cerrada'])
        assert.equal(await apertura(e.B), '0.00')
    })

    test('H64 (arreglado en 9f4a260): una importada con fecha posterior al último cierre se anula contra 2.9.01', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await importar(e.ctx, e.B, '50.00', '2026-09-05')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        const tardia = await importar(e.ctx, e.B, '112.00', '2026-10-01')
        await new AnularFactura().execute(
            { factura_id: tardia.id, motivo: 'auditoría: importación errónea' },
            e.ctx,
        )
        assert.equal(await apertura(e.B), '0.00')
    })
})

function deCentavosTexto(centavos: number) {
    return aTexto(dec(String(centavos)).div(100))
}

/** Aviso de reembolso de Recurrente (`refund.update` hecho) por `centavos`. */
async function reembolso(checkout: string, id: string, centavos: number) {
    return new ProcesarWebhookPasarela().execute(
        {
            proveedor: 'recurrente',
            ...webhook(
                {
                    event_type: 'refund.update',
                    refund: { id, status: 'succeeded', customer_refunded_amount_in_cents: centavos },
                    intentable: { checkout: { id: checkout } },
                },
                `msg_${await unicoBd('re')}`,
            ),
        },
        contextoSistema('webhook'),
    )
}

async function bancoNeto(empresaId: number) {
    const { rows } = await db.rawQuery(
        `SELECT coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text AS s
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE a.empresa_id = ? AND c.codigo LIKE '1.1.02%'`,
        [empresaId],
    )
    return rows[0].s as string
}

test.group('Auditor contable · verificación de 9f4a260 (a3/pedidos-panel)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('reembolsos parciales repetidos y uno total al final: la deuda sigue lo reembolsado, el banco baja por cada reembolso, la comisión queda una vez y la conciliación cuadra', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const checkout = `ch_${await unicoBd('rr')}`
        await conRecurrente(checkout, 0, async () => {
            const { s, cobro, pago } = await cobroPagado(e, checkout)
            const bruto = dec(cobro.monto)
            const banco0 = dec(await bancoNeto(e.B))
            const r1 = await reembolso(checkout, 're_a', 5000)
            assert.isDefined(r1.pago_reemplazo_id)
            assert.equal(await deudaDe(e.B, s.clienteId), '50.00')
            // el mismo reembolso otra vez (otro svix-id): no se aplica dos veces
            const repetido = await reembolso(checkout, 're_a', 5000)
            assert.equal(repetido.ignorado, 'reembolso_ya_aplicado')
            assert.equal(await deudaDe(e.B, s.clienteId), '50.00')
            const r2 = await reembolso(checkout, 're_b', 2525)
            assert.isDefined(r2.pago_reemplazo_id)
            assert.equal(await deudaDe(e.B, s.clienteId), '75.25')
            assert.equal(aTexto(dec(await bancoNeto(e.B)).minus(banco0)), '-75.25')
            assert.equal(await saldoCuenta(e.B, '5.1.02'), '10.50')
            const conciliacion = await new ConciliarPasarela().execute(
                { fecha: hoyGuatemala() },
                contextoSistema('cron'),
            )
            assert.deepEqual(
                conciliacion.diferencias.filter((d) => d.cobro_id === cobro.id),
                [],
            )
            // el resto completo: anula el último pago de reemplazo
            const resto = Number(bruto.minus('75.25').times(100).toFixed(0))
            const r3 = await reembolso(checkout, 're_c', resto)
            assert.isUndefined(r3.pago_reemplazo_id)
            assert.equal(await deudaDe(e.B, s.clienteId), aTexto(bruto))
            // H73 (5c6f26d): sin el monto de la cuenta la comisión se conserva también en el total: el
            // banco baja todo lo reembolsado y 5.1.02 queda con la comisión una sola vez
            assert.equal(aTexto(dec(await bancoNeto(e.B)).minus(banco0)), aTexto(CERO.minus(bruto)))
            assert.equal(aTexto(await saldoCuenta(e.B, '5.1.02')), '10.50')
            const vigentes = await db
                .from('billing.pagos')
                .where('cliente_id', s.clienteId)
                .where('estado', 'registrado')
                .count('* as n')
                .firstOrFail()
            assert.equal(Number(vigentes.n), 0)
            assert.isNotNull(pago.pago_id)
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H65 (arreglado en a693f85): un reembolso que deja menos que la comisión se aplica: la deuda vuelve por lo reembolsado y el banco recibe el neto negativo', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const checkout = `ch_${await unicoBd('rc')}`
        await conRecurrente(checkout, 0, async () => {
            const { s, cobro, centavos } = await cobroPagado(e, checkout)
            // devuelve todo menos Q5.00 (la comisión es Q10.50)
            const r = await reembolso(checkout, 're_casi', centavos - 500)
            assert.isUndefined(r.ignorado, r.error)
            assert.equal(await deudaDe(e.B, s.clienteId), aTexto(dec(cobro.monto).minus('5.00')))
            // el reemplazo: Banco al haber por 5.50 (5.00 − 10.50 de comisión), 5.1.02 y CxC por 5.00
            const reemplazo = await lineas('pago', r.pago_reemplazo_id!)
            assert.deepEqual(
                reemplazo.map((l) => [l[0].startsWith('1.1.02') ? 'banco' : l[0], l[1], l[2]]),
                [
                    ['banco', '0.00', '5.50'],
                    ['5.1.02', '10.50', '0.00'],
                    ['1.1.03', '0.00', '5.00'],
                ],
            )
            const conciliacion = await new ConciliarPasarela().execute(
                { fecha: hoyGuatemala() },
                contextoSistema('cron'),
            )
            assert.deepEqual(
                conciliacion.diferencias.filter((d) => d.cobro_id === cobro.id),
                [],
            )
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('una disputa repetida emite pago.disputa_abierta una sola vez y no toca el libro', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const checkout = `ch_${await unicoBd('d')}`
        await conRecurrente(checkout, 0, async () => {
            const { pago } = await cobroPagado(e, checkout)
            const antes = await bancoNeto(e.B)
            for (const tipo of ['dispute.create', 'dispute.update', 'dispute.update']) {
                await new ProcesarWebhookPasarela().execute(
                    {
                        proveedor: 'recurrente',
                        ...webhook(
                            { event_type: tipo, id: 'dp_1', reason: 'fraude', checkout: { id: checkout } },
                            `msg_${await unicoBd('dp')}`,
                        ),
                    },
                    contextoSistema('webhook'),
                )
            }
            const eventos = await db
                .from('audit.outbox')
                .where('evento', 'pago.disputa_abierta')
                .whereRaw(`(payload->>'pago_id')::bigint = ?`, [pago.pago_id!])
                .count('* as n')
                .firstOrFail()
            assert.equal(Number(eventos.n), 1)
            assert.equal(await bancoNeto(e.B), antes)
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('proveedor de cobro con retención: pago, liquidación por monto − retenido y contracargo del reembolso; el puente vuelve a 0', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const banco = await cuentaBancariaPrueba('Banrural', e.B)
        const proveedor = await new CrearProveedorCobro().execute(
            {
                empresa_id: e.B,
                metodo: 'pasarela',
                pasarela: 'recurrente',
                nombre: 'Recurrente',
                cuenta_bancaria_id: banco.id,
            },
            e.ctx,
        )
        const checkout = `ch_${await unicoBd('lq')}`
        await conRecurrente(checkout, 0, async () => {
            const { s, cobro, pago, centavos } = await cobroPagado(e, checkout, { vat_withheld: 482 })
            const fila = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
            assert.include(fila, { monto: cobro.monto, retenido: '4.82', proveedor_cobro_id: proveedor.id })
            const puente = aTexto(dec(cobro.monto).minus('4.82'))
            assert.equal(await saldoCuenta(e.B, proveedor.cuenta_codigo), puente)
            assert.equal(await saldoCuenta(e.B, '1.1.05'), '4.82')
            await new LiquidarCobros().execute(
                {
                    proveedor_cobro_id: proveedor.id,
                    referencia: await unicoBd('liq'),
                    bruto: puente,
                    comision: '10.50',
                    pagos: [pago.pago_id!],
                    cuenta_bancaria_id: banco.id,
                },
                e.ctx,
            )
            assert.equal(await saldoCuenta(e.B, proveedor.cuenta_codigo), '0.00')
            // reembolso total después de liquidado: contracargo pendiente (−puente) que se liquida
            await reembolso(checkout, 're_lq', centavos)
            assert.equal(await deudaDe(e.B, s.clienteId), cobro.monto)
            assert.equal(await saldoCuenta(e.B, '1.1.05'), '0.00')
            assert.equal(await saldoCuenta(e.B, proveedor.cuenta_codigo), aTexto(CERO.minus(puente)))
            await new LiquidarCobros().execute(
                {
                    proveedor_cobro_id: proveedor.id,
                    referencia: await unicoBd('liq'),
                    bruto: aTexto(CERO.minus(puente)),
                    comision: '0.00',
                    pagos: [],
                    contracargos: [pago.pago_id!],
                    cuenta_bancaria_id: banco.id,
                },
                e.ctx,
            )
            assert.equal(await saldoCuenta(e.B, proveedor.cuenta_codigo), '0.00')
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('un webhook con error de negocio responde 2xx sin dejar nada a medias (ni pago, ni asiento, ni evento de pago)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const checkout = `ch_${await unicoBd('eb')}`
        await conRecurrente(checkout, 0, async () => {
            const s = await servicioFacturado(e.B, '2026-10-01', {
                precio: '300.00',
                instalacion: '2026-09-01',
            })
            const cobro = await new CrearCobroPasarela().execute(
                { cliente_id: s.clienteId },
                contextoSistema('portal'),
            )
            const centavos = Number(dec(cobro.monto).times(100).toFixed(0))
            const asientos = await db
                .from('ledger.asientos')
                .where('empresa_id', e.B)
                .count('* as n')
                .firstOrFail()
            // comisión mayor que el pago: RegistrarPago la rechaza (error de negocio)
            const r = await new ProcesarWebhookPasarela().execute(
                {
                    proveedor: 'recurrente',
                    ...webhook(
                        {
                            event_type: 'payment_intent.succeeded',
                            checkout: { id: checkout },
                            amount_in_cents: centavos,
                            fee: centavos + 100,
                        },
                        `msg_${await unicoBd('eb')}`,
                    ),
                },
                contextoSistema('webhook'),
            )
            assert.equal(r.ignorado, 'error_de_negocio')
            const despues = await db
                .from('ledger.asientos')
                .where('empresa_id', e.B)
                .count('* as n')
                .firstOrFail()
            assert.equal(Number(despues.n), Number(asientos.n))
            const pagos = await db
                .from('billing.pagos')
                .where('referencia', checkout)
                .count('* as n')
                .firstOrFail()
            assert.equal(Number(pagos.n), 0)
            const filaCobro = await db.from('billing.pasarela_cobros').where('id', cobro.id).firstOrFail()
            assert.notEqual(filaCobro.estado, 'pagado')
            const nuevos = await db
                .from('audit.outbox')
                .where('id', '>', 0)
                .whereIn('evento', ['pago.registrado', 'servicio.estado_cambiado'])
                .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [s.clienteId])
                .count('* as n')
                .firstOrFail()
            assert.equal(Number(nuevos.n), 0)
            // la conciliación lo reporta
            const conciliacion = await new ConciliarPasarela().execute(
                { fecha: hoyGuatemala() },
                contextoSistema('cron'),
            )
            assert.deepInclude(
                conciliacion.diferencias.filter((d) => d.cobro_id === cobro.id).map((d) => d.tipo),
                'pago_sin_registrar',
            )
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H66 (arreglado en a693f85): una importada tardía con fecha anterior al cierre (entró después de él, nunca trasladada) se anula contra 2.9.01', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await importar(e.ctx, e.B, '50.00', '2026-09-05')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: hoyGuatemala() }, e.ctx)
        const tardia = await importar(e.ctx, e.B, '112.00', '2026-09-20')
        await new AnularFactura().execute(
            { factura_id: tardia.id, motivo: 'auditoría: importación tardía errónea' },
            e.ctx,
        )
        assert.equal(await apertura(e.B), '0.00')
    })
})

/** Reembolso con monto debitado al comercio distinto del devuelto al cliente. */
async function reembolsoConCuenta(checkout: string, id: string, cliente: number, cuenta: number) {
    return new ProcesarWebhookPasarela().execute(
        {
            proveedor: 'recurrente',
            ...webhook(
                {
                    event_type: 'refund.update',
                    refund: {
                        id,
                        status: 'succeeded',
                        customer_refunded_amount_in_cents: cliente,
                        account_refunded_amount_in_cents: cuenta,
                    },
                    intentable: { checkout: { id: checkout } },
                },
                `msg_${await unicoBd('rc')}`,
            ),
        },
        contextoSistema('webhook'),
    )
}

test.group('Auditor contable · verificación de a3/ajustes-reembolso', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('reembolso que no deja más que lo retenido: constancias en proporción, el libro cuadra y la conciliación está limpia', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const checkout = `ch_${await unicoBd('rr')}`
        await conRecurrente(checkout, 0, async () => {
            const { s, cobro, centavos } = await cobroPagado(e, checkout, { vat_withheld: 482 })
            // quedan Q4.00 (menos que lo retenido, Q4.82, y que la comisión, Q10.50)
            const r = await reembolso(checkout, 're_ret', centavos - 400)
            assert.isDefined(r.pago_reemplazo_id)
            assert.equal(await deudaDe(e.B, s.clienteId), aTexto(dec(cobro.monto).minus('4.00')))
            const pago = await db.from('billing.pagos').where('id', r.pago_reemplazo_id!).firstOrFail()
            assert.equal(pago.monto, '4.00')
            assert.isTrue(dec(pago.retenido).lt('4.00'))
            const conciliacion = await new ConciliarPasarela().execute(
                { fecha: hoyGuatemala() },
                contextoSistema('cron'),
            )
            assert.deepEqual(
                conciliacion.diferencias.filter((d) => d.cobro_id === cobro.id),
                [],
            )
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H70 (decisión del líder, cb9201a): las constancias del reemplazo se prorratean siempre: sin salto entre dejar Q4.83 y Q4.82, y 1.1.05 + banco bajan juntos lo reembolsado', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const resultado: Array<{ ret: string; dinero: string }> = []
        for (const queda of [483, 482]) {
            const checkout = `ch_${await unicoBd('h70')}`
            await conRecurrente(checkout, 0, async () => {
                const { centavos } = await cobroPagado(e, checkout, { vat_withheld: 482 })
                const ret0 = dec(await saldoCuenta(e.B, '1.1.05'))
                const banco0 = dec(await bancoNeto(e.B))
                await reembolso(checkout, `re_${queda}`, centavos - queda)
                const dRet = dec(await saldoCuenta(e.B, '1.1.05')).minus(ret0)
                const dBanco = dec(await bancoNeto(e.B)).minus(banco0)
                resultado.push({ ret: aTexto(dRet), dinero: aTexto(dRet.plus(dBanco)) })
                // 1.1.05 y el banco juntos bajan exactamente lo reembolsado (sin el monto de la cuenta)
                assert.equal(
                    aTexto(dRet.plus(dBanco)),
                    aTexto(
                        dec(String(centavos - queda))
                            .div(100)
                            .negated(),
                    ),
                )
            })
        }
        // un centavo más de reembolso mueve 1.1.05 a lo sumo un centavo
        assert.isTrue(
            dec(resultado[0]!.ret).minus(resultado[1]!.ret).abs().lte('0.01'),
            JSON.stringify(resultado),
        )
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H71 (arreglado en cb9201a): parcial con comisión devuelta: la deuda vuelve por lo del cliente, el banco baja lo debitado a la cuenta y 5.1.02 baja la diferencia; la conciliación cuadra', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const checkout = `ch_${await unicoBd('h71')}`
        await conRecurrente(checkout, 0, async () => {
            const { s, cobro } = await cobroPagado(e, checkout)
            const antes = dec(await bancoNeto(e.B))
            // devuelve Q100.00 al cliente; a la cuenta del comercio le debitan Q95.00 (devuelve Q5.00 de comisión)
            await reembolsoConCuenta(checkout, 're_cta', 10000, 9500)
            assert.equal(aTexto(dec(await bancoNeto(e.B)).minus(antes)), '-95.00')
            assert.equal(await deudaDe(e.B, s.clienteId), '100.00')
            assert.equal(aTexto(await saldoCuenta(e.B, '5.1.02')), '5.50')
            const conciliacion = await new ConciliarPasarela().execute(
                { fecha: hoyGuatemala() },
                contextoSistema('cron'),
            )
            assert.deepEqual(
                conciliacion.diferencias.filter((d) => d.cobro_id === cobro.id),
                [],
            )
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('reembolso total con comisión devuelta en parte: la deuda vuelve entera, el banco baja lo debitado a la cuenta y 5.1.02 queda con la parte no devuelta (ajuste sin documento que el verificador acepta)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const checkout = `ch_${await unicoBd('tot')}`
        await conRecurrente(checkout, 0, async () => {
            const { s, cobro, centavos } = await cobroPagado(e, checkout)
            const antes = dec(await bancoNeto(e.B))
            // devuelve todo al cliente; a la cuenta le debitan todo menos Q3.00 (comisión devuelta)
            await reembolsoConCuenta(checkout, 're_tot', centavos, centavos - 300)
            assert.equal(await deudaDe(e.B, s.clienteId), cobro.monto)
            assert.equal(
                aTexto(dec(await bancoNeto(e.B)).minus(antes)),
                aTexto(
                    dec(String(centavos - 300))
                        .div(100)
                        .negated(),
                ),
            )
            assert.equal(aTexto(await saldoCuenta(e.B, '5.1.02')), '7.50')
            const conciliacion = await new ConciliarPasarela().execute(
                { fecha: hoyGuatemala() },
                contextoSistema('cron'),
            )
            assert.deepEqual(
                conciliacion.diferencias.filter((d) => d.cobro_id === cobro.id),
                [],
            )
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('proveedor de cobro con el monto de la cuenta: la comisión devuelta no toca el pago (sale en la liquidación); reemplazo y contracargo se liquidan y el puente vuelve a 0', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const banco = await cuentaBancariaPrueba('Banrural', e.B)
        const proveedor = await new CrearProveedorCobro().execute(
            {
                empresa_id: e.B,
                metodo: 'pasarela',
                pasarela: 'recurrente',
                nombre: 'Recurrente',
                cuenta_bancaria_id: banco.id,
            },
            e.ctx,
        )
        const checkout = `ch_${await unicoBd('pmc')}`
        await conRecurrente(checkout, 0, async () => {
            const { s, pago } = await cobroPagado(e, checkout)
            const original = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
            await new LiquidarCobros().execute(
                {
                    proveedor_cobro_id: proveedor.id,
                    referencia: await unicoBd('liq'),
                    bruto: original.monto,
                    comision: '10.50',
                    pagos: [pago.pago_id!],
                    cuenta_bancaria_id: banco.id,
                },
                e.ctx,
            )
            const r = await reembolsoConCuenta(checkout, 're_pmc', 10000, 9500)
            assert.isUndefined(r.ignorado, r.error)
            assert.equal(await deudaDe(e.B, s.clienteId), '100.00')
            const reemplazo = await db.from('billing.pagos').where('id', r.pago_reemplazo_id!).firstOrFail()
            assert.equal(reemplazo.comision, '0.00')
            // en el puente: −pago (contracargo pendiente) + reemplazo
            assert.equal(
                aTexto(await saldoCuenta(e.B, proveedor.cuenta_codigo)),
                aTexto(dec(reemplazo.monto).minus(original.monto)),
            )
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H72 (arreglado en 5c6f26d): si la cuenta del comercio paga más que lo devuelto al cliente, el exceso es gasto 5.1.02: deuda por lo del cliente, banco por lo de la cuenta', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const checkout = `ch_${await unicoBd('h72')}`
        await conRecurrente(checkout, 0, async () => {
            const { s } = await cobroPagado(e, checkout)
            const antes = dec(await bancoNeto(e.B))
            // devuelve Q100.00 al cliente y le cobran Q102.00 a la cuenta (Q2.00 de cargo por reembolso)
            const r = await reembolsoConCuenta(checkout, 're_cargo', 10000, 10200)
            assert.isUndefined(r.ignorado, r.error)
            assert.equal(await deudaDe(e.B, s.clienteId), '100.00')
            assert.equal(aTexto(dec(await bancoNeto(e.B)).minus(antes)), '-102.00')
            assert.equal(aTexto(await saldoCuenta(e.B, '5.1.02')), '12.50')
        })
        // una comisión devuelta mayor que la del pago sigue siendo 422 (y el reembolso no se aplica)
        const otro = `ch_${await unicoBd('h72b')}`
        await conRecurrente(otro, 0, async () => {
            const x = await cobroPagado(e, otro)
            const malo = await reembolsoConCuenta(otro, 're_malo', 10000, 8000)
            assert.equal(malo.ignorado, 'error_de_negocio')
            assert.include(malo.error ?? '', 'reembolso_monto_cuenta')
            assert.equal(await deudaDe(e.B, x.s.clienteId), '0.00')
        })
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('H73 (arreglado en 5c6f26d): sin el monto de la cuenta la comisión se conserva igual en el total y en el que deja Q0.01; el banco baja todo lo reembolsado', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const comisiones: string[] = []
        for (const deja of [1, 0]) {
            const checkout = `ch_${await unicoBd('h73')}`
            await conRecurrente(checkout, 0, async () => {
                const { centavos } = await cobroPagado(e, checkout)
                const antes = dec(await saldoCuenta(e.B, '5.1.02'))
                await reembolso(checkout, `re_${deja}`, centavos - deja)
                comisiones.push(aTexto(dec(await saldoCuenta(e.B, '5.1.02')).minus(antes)))
            })
        }
        // la misma regla en los dos: la comisión cobrada se queda (§15 #104)
        assert.deepEqual(comisiones, ['0.00', '0.00'])
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('proveedor de cobro: reembolso que deja menos que la comisión y que lo retenido; el reemplazo se liquida y el puente vuelve a 0', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const banco = await cuentaBancariaPrueba('Banrural', e.B)
        const proveedor = await new CrearProveedorCobro().execute(
            {
                empresa_id: e.B,
                metodo: 'pasarela',
                pasarela: 'recurrente',
                nombre: 'Recurrente',
                cuenta_bancaria_id: banco.id,
            },
            e.ctx,
        )
        const checkout = `ch_${await unicoBd('pq')}`
        await conRecurrente(checkout, 0, async () => {
            const { pago, centavos } = await cobroPagado(e, checkout, { vat_withheld: 482 })
            const r = await reembolso(checkout, 're_pq', centavos - 400)
            const reemplazo = await db.from('billing.pagos').where('id', r.pago_reemplazo_id!).firstOrFail()
            const puenteReemplazo = dec(reemplazo.monto).minus(reemplazo.retenido)
            assert.isTrue(puenteReemplazo.gt(0))
            const original = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
            // sin liquidar todavía: el original anulado no deja contracargo; queda solo el reemplazo
            assert.equal(original.estado, 'anulado')
            assert.equal(await saldoCuenta(e.B, proveedor.cuenta_codigo), aTexto(puenteReemplazo))
            await new LiquidarCobros().execute(
                {
                    proveedor_cobro_id: proveedor.id,
                    referencia: await unicoBd('liq'),
                    bruto: aTexto(puenteReemplazo),
                    comision: '0.00',
                    pagos: [r.pago_reemplazo_id!],
                    cuenta_bancaria_id: banco.id,
                },
                e.ctx,
            )
            assert.equal(await saldoCuenta(e.B, proveedor.cuenta_codigo), '0.00')
        })
        await sinViolaciones(assert, [e.B, e.C])
    })
})

test.group('Auditor contable · notas viejas sobre importadas (8a6efcd)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('una nota vieja (base a 2.9.01, IVA 0) y una nueva por el resto: la nueva lleva el IVA de lo que queda, el libro trae solo la nueva y el verificador acepta la vieja', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        const f = await importar(e.ctx, e.B, '112.00', '2026-08-10')
        const hoy = hoyGuatemala()
        const [vieja] = (await db
            .table('billing.notas_credito')
            .insert({
                factura_id: f.id,
                cliente_id: f.clienteId,
                empresa_id: e.B,
                fecha: hoy,
                subtotal: '30.00',
                iva: '0.00',
                monto: '30.00',
                motivo: 'auditoría: nota anterior a H50',
                receptor: JSON.stringify({ id: 'CF', nombre: 'Consumidor final' }),
            })
            .returning('id')) as Array<{ id: number }>
        await new RegistrarAsiento().execute(
            {
                empresa_id: e.B,
                fecha: hoy,
                descripcion: 'Nota anterior a H50',
                origen_tipo: 'nota_credito',
                origen_id: vieja!.id,
                movimientos: [
                    { cuenta: '2.9.01', debe: '30.00' },
                    { cuenta: '1.1.03', haber: '30.00', cliente_id: f.clienteId },
                ],
            },
            e.ctx,
        )
        // como la aplicaba el código anterior: la nota cubre 30.00 de la factura
        await db.from('billing.facturas').where('id', f.id).increment('pagado', 30)
        const nueva = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '82.00', motivo: 'auditoría: el resto' },
            e.ctx,
        )
        assert.equal(nueva.iva, '8.79')
        assert.equal(await deudaDe(e.B, f.clienteId), '0.00')
        const ventas = await construirLibro('ventas', e.B, { desde: inicioDeMes(hoy), hasta: finDeMes(hoy) })
        assert.deepEqual([ventas.reporte.totales.total, ventas.reporte.totales.iva], ['-82.00', '-8.79'])
        await sinViolaciones(assert, [e.B, e.C])
    })
})
