import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { unicoBd } from '#tests/billing/ayudas_billing'
import RegistrarPago from '#billing/actions/registrar_pago'
import DepositarCaja from '#ledger/actions/depositar_caja'
import ImportarExtracto from '#ledger/actions/importar_extracto'
import ConciliarLinea from '#ledger/actions/conciliar_linea'
import AnularConciliacion from '#ledger/actions/anular_conciliacion'
import ConfigurarDiferencias from '#ledger/actions/configurar_diferencias'
import CrearMotivoDiferencia from '#ledger/actions/crear_motivo_diferencia'
import EditarMotivoDiferencia from '#ledger/actions/editar_motivo_diferencia'
import PedirAprobacionDiferencia from '#ledger/actions/pedir_aprobacion_diferencia'
import AprobarDiferencia from '#ledger/actions/aprobar_diferencia'
import RechazarDiferencia from '#ledger/actions/rechazar_diferencia'
import AceptarSugerencias from '#ledger/actions/aceptar_sugerencias'
import MarcarPorIdentificar from '#ledger/actions/marcar_por_identificar'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { lineasDeExtracto, movimientosSinConciliar, reporteConciliacion } from '#ledger/conciliacion'
import {
    leerAjustesConciliacion,
    listarDiferencias,
    motivosEfectivos,
    usadoDelTopeHoy,
    verDiferencia,
} from '#ledger/diferencias_conciliacion'
import { sugerenciasDeExtracto } from '#ledger/sugerencias_conciliacion'
import { listarDepositos, resumenFondosEnTransito } from '#ledger/transitos'
import { aTexto, dec } from '#ledger/dinero'
import { calcularChecks } from '#ledger/checks'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { errorDe, saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibroConDiferencias, prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'

/**
 * Plan de contabilidad B3 (§5.8): diferencias al conciliar con motivo, tope por línea y por día,
 * aprobación por otro usuario, sugerencias, aceptar en lote, «por identificar» y deshacer (E11).
 * Después de cada escenario, el auditor del libro (Debe = Haber, auxiliares, inmutabilidad).
 */

async function usado(empresaId: number, usuarioId: number) {
    return aTexto(await usadoDelTopeHoy(empresaId, usuarioId, hoyGuatemala()))
}

async function diferencias(filtros: Parameters<typeof listarDiferencias>[0], empresas: number[]) {
    const pagina = await listarDiferencias(filtros, empresas)
    return pagina.data
}

async function motivo(empresaId: number, codigo: string) {
    const lista = await motivosEfectivos(empresaId)
    return lista.find((m) => m.codigo === codigo)!
}

/** Pago por depósito del cliente a la cuenta bancaria de la empresa y su movimiento del banco. */
async function pagoAlBanco(e: EmpresasGt, empresaId: number, monto: string, referencia: string) {
    const s = await servicioFacturado(empresaId, '2026-10-01', { instalacion: '2026-07-01' })
    const banco = e.banco.get(empresaId)!
    const pago = await new RegistrarPago().execute(
        {
            cliente_id: s.clienteId,
            metodo: 'deposito',
            monto,
            referencia,
            cuenta_bancaria_id: banco.id,
            empresa_id: empresaId,
        },
        e.ctx,
    )
    const pendientes = await movimientosSinConciliar(empresaId, banco.cuenta_id)
    const mov = pendientes.find((m) => m.origen_tipo === 'pago' && m.origen_id === pago.id)!
    return { pago, movimiento: mov.movimiento_id }
}

async function extracto(
    e: EmpresasGt,
    empresaId: number,
    lineas: Array<{ descripcion: string; monto: string; referencia?: string }>,
) {
    const hoy = hoyGuatemala()
    const banco = e.banco.get(empresaId)!
    const total = lineas.reduce((s, l) => s + Math.round(Number.parseFloat(l.monto) * 100), 0)
    const ext = await new ImportarExtracto().execute(
        {
            cuenta_bancaria_id: banco.id,
            desde: hoy,
            hasta: hoy,
            saldo_inicial: '0.00',
            saldo_final: (total / 100).toFixed(2),
            lineas: lineas.map((l) => ({ fecha: hoy, ...l })),
        },
        e.ctx,
    )
    return { extracto: ext, lineas: await lineasDeExtracto(ext.id) }
}

test.group('B3 · diferencias al conciliar', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('motivo dentro y fuera de su límite: la comisión entra con su asiento y la línea queda conciliada', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const banco = e.banco.get(e.B)!
        const deposito = await new DepositarCaja().execute(
            { caja_id: e.cajas.get(e.B)!, monto: '100.00', boleta: 'B-4471', cuenta_bancaria_id: banco.id },
            e.ctx,
        )
        const { lineas } = await extracto(e, e.B, [
            { descripcion: 'DEPOSITO EFECTIVO', referencia: 'B-4471', monto: '95.00' },
        ])
        const linea = lineas[0]!
        const comision = await motivo(e.B, 'comision_banco')
        const redondeo = await motivo(e.B, 'redondeo')

        // sin motivo: descuadrada (y dice cómo explicarla)
        const sin = await errorDe(
            new ConciliarLinea().execute({ linea_id: linea.id, depositos: [deposito.id] }, e.ctx),
        )
        assert.equal(sin.codigo, 'conciliacion_descuadrada')
        // los motivos no suman la diferencia
        const mal = await errorDe(
            new ConciliarLinea().execute(
                {
                    linea_id: linea.id,
                    depositos: [deposito.id],
                    diferencias: [{ motivo_id: comision.id, monto: '4.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(mal.codigo, 'diferencias_descuadradas')
        // redondeo: solo hasta Q 0.05
        const fuera = await errorDe(
            new ConciliarLinea().execute(
                {
                    linea_id: linea.id,
                    depositos: [deposito.id],
                    diferencias: [{ motivo_id: redondeo.id, monto: '5.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(fuera.codigo, 'motivo_no_aplica')
        assert.include(fuera.reglas, 'motivo_no_aplica')

        const conciliacion = await new ConciliarLinea().execute(
            {
                linea_id: linea.id,
                depositos: [deposito.id],
                diferencias: [{ motivo_id: comision.id, monto: '5.00', nota: 'cobro por depósito' }],
            },
            e.ctx,
        )
        assert.equal(conciliacion.monto, '95.00')
        assert.sameMembers(
            conciliacion.movimientos.map((m) => m.origen_tipo),
            ['deposito', 'diferencia_conciliacion'],
        )
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.GASTOS_BANCARIOS), '5.00')
        assert.equal(await saldoCuenta(e.B, banco.codigo), '95.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.FONDOS_EN_TRANSITO), '0.00')
        const [dif] = await diferencias({}, [e.B])
        assert.equal(dif!.estado, 'aplicada')
        assert.equal(dif!.monto, '5.00')
        assert.equal(dif!.sentido, 'menos')
        assert.isNotNull(dif!.asiento_id)
        assert.equal(await usado(e.B, e.usuarioId), '5.00')
        const [reporte] = await reporteConciliacion([e.B], { cuenta_id: banco.cuenta_id })
        assert.isTrue(reporte!.cuadra)
        assert.lengthOf(reporte!.libro_en_transito, 0)
        await afirmarLibroConDiferencias(assert, [e.B, e.C])
    })

    test('tope por línea y por día; la aprobación la da otro usuario; rechazar deja la línea libre', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const otro = await usuarioConRoles(['contabilidad'])
        const ctxOtro = contextoPrueba(otro.usuario.id)
        const ajustes = await new ConfigurarDiferencias().execute(
            { empresa_id: e.B, version: 0, tope_linea: '3.00', tope_dia: '6.00' },
            e.ctx,
        )
        assert.equal(ajustes.tope_linea, '3.00')
        assert.include(
            ajustes.aprobadores.map((a) => a.usuario_id),
            otro.usuario.id,
        )
        const conflicto = await errorDe(
            new ConfigurarDiferencias().execute({ empresa_id: e.B, version: 0, tope_dia: '9.00' }, e.ctx),
        )
        assert.equal(conflicto.codigo, 'conflicto_version')

        const p1 = await pagoAlBanco(e, e.B, '50.00', await unicoBd('T1'))
        const p2 = await pagoAlBanco(e, e.B, '50.00', await unicoBd('T2'))
        const p3 = await pagoAlBanco(e, e.B, '50.00', await unicoBd('T3'))
        const p4 = await pagoAlBanco(e, e.B, '50.00', await unicoBd('T4'))
        const { lineas } = await extracto(e, e.B, [
            { descripcion: 'TRANSFERENCIA 1', monto: '46.00' },
            { descripcion: 'TRANSFERENCIA 2', monto: '47.00' },
            { descripcion: 'TRANSFERENCIA 3', monto: '47.00' },
            { descripcion: 'TRANSFERENCIA 4', monto: '49.00' },
        ])
        const [l1, l2, l3, l4] = lineas
        const comision = await motivo(e.B, 'comision_banco')
        const conDif = (lineaId: number, mov: number, monto: string) => ({
            linea_id: lineaId,
            movimientos: [mov],
            diferencias: [{ motivo_id: comision.id, monto }],
        })

        // Q 4.00 > tope por línea Q 3.00
        const sobre = await errorDe(
            new ConciliarLinea().execute(conDif(l1!.id, p1.movimiento, '4.00'), e.ctx),
        )
        assert.equal(sobre.codigo, 'diferencia_requiere_aprobacion')
        assert.deepEqual(sobre.reglas, ['tope_linea'])
        const sinExplicar = await errorDe(
            new PedirAprobacionDiferencia().execute(
                { ...conDif(l1!.id, p1.movimiento, '4.00'), explicacion: '' },
                e.ctx,
            ),
        )
        assert.include(sinExplicar.reglas, 'required')
        const pedida = await new PedirAprobacionDiferencia().execute(
            { ...conDif(l1!.id, p1.movimiento, '4.00'), explicacion: 'el banco cobró la transferencia' },
            e.ctx,
        )
        assert.equal(pedida.estado, 'pendiente')
        assert.isNull(pedida.asiento_id)
        assert.deepEqual(pedida.razones, ['tope_linea'])
        const outbox = await db
            .from('audit.outbox')
            .where('evento', 'banco.diferencia_pendiente')
            .whereRaw(`(payload->>'diferencia_id')::bigint = ?`, [pedida.id])
            .first()
        assert.include(outbox.payload.aprobadores, otro.usuario.id)
        // la línea apartada no se concilia por otro camino ni se pide dos veces
        const apartada = await errorDe(
            new ConciliarLinea().execute(conDif(l1!.id, p1.movimiento, '4.00'), e.ctx),
        )
        assert.equal(apartada.codigo, 'diferencia_pendiente')
        // nadie aprueba lo suyo
        const propia = await errorDe(new AprobarDiferencia().execute({ diferencia_id: pedida.id }, e.ctx))
        assert.equal(propia.status, 403)
        assert.equal(propia.codigo, 'autoaprobacion')
        // mientras espera no hay asiento
        assert.isTrue(dec(await saldoCuenta(e.B, CUENTAS_GT.GASTOS_BANCARIOS)).isZero())
        const aprobada = await new AprobarDiferencia().execute({ diferencia_id: pedida.id }, ctxOtro)
        assert.equal(aprobada.estado, 'aprobada')
        assert.equal(aprobada.decidido_por, otro.usuario.id)
        assert.isNotNull(aprobada.asiento_id)
        const tras = await lineasDeExtracto(lineas[0]!.extracto_id)
        assert.isTrue(tras[0]!.conciliada)
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.GASTOS_BANCARIOS), '4.00')
        const otraVez = await errorDe(new AprobarDiferencia().execute({ diferencia_id: pedida.id }, ctxOtro))
        assert.equal(otraVez.codigo, 'diferencia_decidida')
        // lo aprobado no gasta el tope de quien lo pidió
        assert.equal(await usado(e.B, e.usuarioId), '0.00')

        // tope por día: Q 3 + Q 3 = Q 6 (cabe); Q 1 más pasa de Q 6
        const c2 = await new ConciliarLinea().execute(conDif(l2!.id, p2.movimiento, '3.00'), e.ctx)
        await new ConciliarLinea().execute(conDif(l3!.id, p3.movimiento, '3.00'), e.ctx)
        const dia = await errorDe(new ConciliarLinea().execute(conDif(l4!.id, p4.movimiento, '1.00'), e.ctx))
        assert.equal(dia.codigo, 'diferencia_requiere_aprobacion')
        assert.deepEqual(dia.reglas, ['tope_dia'])
        const p = await new PedirAprobacionDiferencia().execute(
            { ...conDif(l4!.id, p4.movimiento, '1.00'), explicacion: 'comisión del día' },
            e.ctx,
        )
        const pendientes = await listarDiferencias({ estado: 'pendiente' }, [e.B])
        assert.deepEqual(
            pendientes.data.map((d) => d.id),
            [p.id],
        )
        const sinMotivo = await errorDe(
            new RechazarDiferencia().execute({ diferencia_id: p.id, motivo: '' }, ctxOtro),
        )
        assert.include(sinMotivo.reglas, 'required')
        const rechazada = await new RechazarDiferencia().execute(
            { diferencia_id: p.id, motivo: 'pedir al banco el detalle' },
            ctxOtro,
        )
        assert.equal(rechazada.estado, 'rechazada')
        assert.equal(rechazada.motivo_rechazo, 'pedir al banco el detalle')
        // deshacer una conciliación con diferencia libera su parte del tope: ahora cabe
        await new AnularConciliacion().execute({ conciliacion_id: c2.id, motivo: 'línea equivocada' }, e.ctx)
        assert.equal(await usado(e.B, e.usuarioId), '3.00')
        await new ConciliarLinea().execute(conDif(l4!.id, p4.movimiento, '1.00'), e.ctx)
        assert.equal(await usado(e.B, e.usuarioId), '4.00')
        // la diferencia deshecha quedó anulada con su reverso y la línea 2 vuelve a conciliarse
        const anulada = await diferencias({ estado: 'anulada' }, [e.B])
        assert.lengthOf(anulada, 1)
        assert.equal(anulada[0]!.linea_id, l2!.id)
        // la línea 2 vuelve a estar libre, pero hoy ya no cabe en el tope (Q 4 + Q 3 > Q 6)
        const lleno = await errorDe(
            new ConciliarLinea().execute(conDif(l2!.id, p2.movimiento, '3.00'), e.ctx),
        )
        assert.deepEqual(lleno.reglas, ['tope_dia'])
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.GASTOS_BANCARIOS), '8.00')
        const [reporte] = await reporteConciliacion([e.B], { cuenta_id: e.banco.get(e.B)!.cuenta_id })
        assert.isTrue(reporte!.cuadra)
        assert.deepEqual(
            reporte!.extracto_en_transito.map((x) => x.id),
            [l2!.id],
        )
        // un asiento de diferencia no se revierte directo: se deshace la conciliación
        const directo = await errorDe(
            new RevertirAsiento().execute({ asiento_id: aprobada.asiento_id!, motivo: 'probar' }, e.ctx),
        )
        assert.equal(directo.codigo, 'reverso_por_documento')
        await afirmarLibroConDiferencias(assert, [e.B, e.C])
    })

    test('«otra razón» siempre pide aprobación con la cuenta que se elija; faltante a cargo de quien llevó el depósito', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const otro = await usuarioConRoles(['contabilidad'])
        const banco = e.banco.get(e.B)!
        const deposito = await new DepositarCaja().execute(
            { caja_id: e.cajas.get(e.B)!, monto: '80.00', boleta: 'B-4502', cuenta_bancaria_id: banco.id },
            e.ctx,
        )
        const pago = await pagoAlBanco(e, e.B, '30.00', await unicoBd('OT'))
        const { lineas } = await extracto(e, e.B, [
            { descripcion: 'DEPOSITO B-4502', monto: '70.00' },
            { descripcion: 'CREDITO', monto: '30.50' },
        ])
        const otra = await motivo(e.B, 'otra')
        const faltante = await motivo(e.B, 'faltante_deposito')

        // el faltante solo se ofrece con un depósito
        const noDeposito = await errorDe(
            new ConciliarLinea().execute(
                {
                    linea_id: lineas[1]!.id,
                    movimientos: [pago.movimiento],
                    diferencias: [{ motivo_id: faltante.id, monto: '0.50' }],
                },
                e.ctx,
            ),
        )
        assert.equal(noDeposito.codigo, 'motivo_no_aplica')
        // otra razón: sin cuenta, 422; con caja o banco, 422
        const sinCuenta = await errorDe(
            new PedirAprobacionDiferencia().execute(
                {
                    linea_id: lineas[1]!.id,
                    movimientos: [pago.movimiento],
                    diferencias: [{ motivo_id: otra.id, monto: '0.50' }],
                    explicacion: 'el cliente depositó de más',
                },
                e.ctx,
            ),
        )
        assert.include(sinCuenta.reglas, 'required')
        const conBanco = await errorDe(
            new PedirAprobacionDiferencia().execute(
                {
                    linea_id: lineas[1]!.id,
                    movimientos: [pago.movimiento],
                    diferencias: [{ motivo_id: otra.id, monto: '0.50', cuenta: banco.codigo }],
                    explicacion: 'el cliente depositó de más',
                },
                e.ctx,
            ),
        )
        assert.include(conBanco.reglas, 'contrapartida')
        const dentro = await errorDe(
            new ConciliarLinea().execute(
                {
                    linea_id: lineas[1]!.id,
                    movimientos: [pago.movimiento],
                    diferencias: [{ motivo_id: otra.id, monto: '0.50', cuenta: '4.1.03' }],
                },
                e.ctx,
            ),
        )
        assert.equal(dentro.codigo, 'diferencia_requiere_aprobacion')
        assert.deepEqual(dentro.reglas, ['motivo'])
        const pedida = await new PedirAprobacionDiferencia().execute(
            {
                linea_id: lineas[1]!.id,
                movimientos: [pago.movimiento],
                diferencias: [{ motivo_id: otra.id, monto: '0.50', cuenta: '4.1.03' }],
                explicacion: 'el cliente depositó de más',
            },
            e.ctx,
        )
        const aprobada = await new AprobarDiferencia().execute(
            { diferencia_id: pedida.id },
            contextoPrueba(otro.usuario.id),
        )
        assert.equal(aprobada.sentido, 'mas')
        assert.equal(await saldoCuenta(e.B, '4.1.03'), '-0.50')

        // faltante del depósito (sin límite propio, cuenta contra el tope: Q 10 de Q 10 por línea)
        const conFaltante = await new ConciliarLinea().execute(
            {
                linea_id: lineas[0]!.id,
                depositos: [deposito.id],
                diferencias: [{ motivo_id: faltante.id, monto: '10.00' }],
            },
            e.ctx,
        )
        assert.equal(conFaltante.monto, '70.00')
        const difs = await diferencias({}, [e.B])
        const dif = difs.find((d) => d.linea_id === lineas[0]!.id)!
        assert.equal(dif.partes[0]!.responsable_id, e.usuarioId)
        assert.equal(dif.partes[0]!.cuenta, CUENTAS.FALTANTES_CAJA)
        assert.equal(await saldoCuenta(e.B, CUENTAS.FALTANTES_CAJA), '10.00')
        await afirmarLibroConDiferencias(assert, [e.B, e.C])
    })

    test('E11: deshacer la conciliación de un depósito revierte su llegada y su diferencia; el depósito vuelve a tránsito', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const banco = e.banco.get(e.B)!
        const deposito = await new DepositarCaja().execute(
            { caja_id: e.cajas.get(e.B)!, monto: '60.00', boleta: 'E11', cuenta_bancaria_id: banco.id },
            e.ctx,
        )
        const { lineas } = await extracto(e, e.B, [
            { descripcion: 'DEPOSITO E11', referencia: 'E11', monto: '58.00' },
        ])
        const comision = await motivo(e.B, 'comision_banco')
        const entrada = {
            linea_id: lineas[0]!.id,
            depositos: [deposito.id],
            diferencias: [{ motivo_id: comision.id, monto: '2.00' }],
        }
        const c = await new ConciliarLinea().execute(entrada, e.ctx)
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.FONDOS_EN_TRANSITO), '0.00')
        await new AnularConciliacion().execute({ conciliacion_id: c.id, motivo: 'era otro depósito' }, e.ctx)
        // la llegada se revirtió: el depósito vuelve a estar en camino; la comisión también se revirtió
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.FONDOS_EN_TRANSITO), '60.00')
        assert.equal(await saldoCuenta(e.B, banco.codigo), '0.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.GASTOS_BANCARIOS), '0.00')
        const depositos = await listarDepositos({}, [e.B])
        const estados = new Map(depositos.data.map((d) => [d.id, d.estado]))
        assert.equal(estados.get(deposito.id), 'en_transito')
        // los pares anulados no quedan como partidas en tránsito ni se ofrecen para conciliar
        assert.lengthOf(await movimientosSinConciliar(e.B, banco.cuenta_id), 0)
        let [reporte] = await reporteConciliacion([e.B], { cuenta_id: banco.cuenta_id })
        assert.lengthOf(reporte!.libro_en_transito, 0)
        assert.isTrue(reporte!.cuadra)
        await afirmarLibroConDiferencias(assert, [e.B, e.C])
        // y se concilia otra vez como al principio
        await new ConciliarLinea().execute(entrada, e.ctx)
        ;[reporte] = await reporteConciliacion([e.B], { cuenta_id: banco.cuenta_id })
        assert.isTrue(reporte!.cuadra)
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.GASTOS_BANCARIOS), '2.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.FONDOS_EN_TRANSITO), '0.00')
        const [transito] = await resumenFondosEnTransito([e.B])
        assert.isTrue(transito!.cuadra)
        const descuadres = await db.rawQuery(
            `SELECT a.id FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
              WHERE a.empresa_id = ? GROUP BY a.id HAVING sum(m.debe) <> sum(m.haber)`,
            [e.B],
        )
        assert.lengthOf(descuadres.rows, 0)
        await afirmarLibroConDiferencias(assert, [e.B, e.C])
    })

    test('sugerencias por nivel, aceptar las seguras en lote (sin duplicar) y «por identificar»', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const r1 = await unicoBd('S1')
        const a = await pagoAlBanco(e, e.B, '100.00', r1)
        await pagoAlBanco(e, e.B, '120.00', await unicoBd('S2'))
        await pagoAlBanco(e, e.B, '120.00', await unicoBd('S3'))
        const r4 = await unicoBd('S4')
        const d = await pagoAlBanco(e, e.B, '200.00', r4)
        const { extracto: ext, lineas } = await extracto(e, e.B, [
            { descripcion: 'DEPOSITO', referencia: r1, monto: '100.00' },
            { descripcion: 'TRANSFERENCIA', monto: '120.00' },
            { descripcion: `CREDITO ${r4}`, monto: '195.00' },
            { descripcion: 'ABONO DESCONOCIDO', monto: '777.00' },
        ])
        await new MarcarPorIdentificar().execute(
            { linea_id: lineas[3]!.id, nota: 'preguntar al banco' },
            e.ctx,
        )
        const s = await sugerenciasDeExtracto(ext.id, e.usuarioId)
        const nivel = new Map(s.lineas.map((l) => [l.linea_id, l]))
        assert.equal(nivel.get(lineas[0]!.id)!.nivel, 'segura')
        assert.equal(nivel.get(lineas[0]!.id)!.candidatos[0]!.id, a.movimiento)
        assert.equal(nivel.get(lineas[1]!.id)!.nivel, 'para_decidir')
        assert.lengthOf(nivel.get(lineas[1]!.id)!.candidatos, 2)
        const conDif = nivel.get(lineas[2]!.id)!
        assert.equal(conDif.nivel, 'con_diferencia')
        assert.equal(conDif.candidatos[0]!.id, d.movimiento)
        assert.equal(conDif.candidatos[0]!.diferencia, '-5.00')
        const motivos = new Map(conDif.motivos.map((m) => [m.nombre, m]))
        assert.isTrue(motivos.get('Comisión del banco')!.aplica)
        assert.isFalse(motivos.get('Redondeo')!.aplica)
        assert.equal(motivos.get('Redondeo')!.razon, 'Solo hasta Q 0.05')
        assert.isFalse(motivos.get('Faltó efectivo en el depósito')!.aplica)
        const porIdentificar = nivel.get(lineas[3]!.id)!
        assert.equal(porIdentificar.nivel, 'por_identificar')
        assert.equal(porIdentificar.por_identificar!.nota, 'preguntar al banco')
        assert.equal(s.resumen.segura, 1)
        assert.equal(s.tope.tope_linea, '10.00')
        assert.equal(s.tope.disponible_hoy, '50.00')

        const lote = await new AceptarSugerencias().execute({ extracto_id: ext.id }, e.ctx)
        assert.deepEqual(
            lote.conciliadas.map((c) => c.linea_id),
            [lineas[0]!.id],
        )
        const otraVez = await new AceptarSugerencias().execute(
            { extracto_id: ext.id, lineas: [lineas[0]!.id, lineas[1]!.id] },
            e.ctx,
        )
        assert.lengthOf(otraVez.conciliadas, 0)
        assert.sameDeepMembers(otraVez.omitidas, [
            { linea_id: lineas[0]!.id, nivel: 'conciliada' },
            { linea_id: lineas[1]!.id, nivel: 'para_decidir' },
        ])
        const despues = await sugerenciasDeExtracto(ext.id, e.usuarioId)
        assert.equal(despues.resumen.conciliadas, 1)

        // la línea por identificar no es anomalía en el cierre; las demás sin conciliar sí
        const hoy = hoyGuatemala()
        const checks = await calcularChecks(db.connection(), e.B, 'mensual', `${hoy.slice(0, 7)}-01`)
        const check = checks.find((c) => c.clave === 'extractos_conciliados')!
        assert.equal(check.obtenido, '2')
        assert.deepEqual(check.detalle, { por_identificar: 1 })
        await afirmarLibroConDiferencias(assert, [e.B, e.C])
    })

    test('multiempresa: motivo de fábrica cambiado en una empresa no cambia en la otra; nada cruza de empresa', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const fabrica = await motivo(e.B, 'comision_banco')
        assert.isNull(fabrica.empresa_id)
        const propio = await new EditarMotivoDiferencia().execute(
            { id: fabrica.id, version: fabrica.version, empresa_id: e.B, limite_valor: '20.00' },
            e.ctx,
        )
        assert.equal(propio.empresa_id, e.B)
        assert.equal(propio.codigo, 'comision_banco')
        assert.notEqual(propio.id, fabrica.id)
        const motivoB = await motivo(e.B, 'comision_banco')
        const motivoC = await motivo(e.C, 'comision_banco')
        assert.equal(motivoB.id, propio.id)
        assert.equal(motivoC.limite_valor, '10.00')
        assert.exists(
            await db
                .from('audit.cambios')
                .where({ entidad_tipo: 'motivo_diferencia', entidad_id: propio.id, campo: 'limite_valor' })
                .first(),
        )
        const editado = await new EditarMotivoDiferencia().execute(
            { id: propio.id, version: propio.version, nombre: 'Comisión de Banrural' },
            e.ctx,
        )
        assert.equal(editado.version, 2)
        const vieja = await errorDe(
            new EditarMotivoDiferencia().execute({ id: propio.id, version: 1, nombre: 'Otra' }, e.ctx),
        )
        assert.equal(vieja.codigo, 'conflicto_version')
        const malaCuenta = await errorDe(
            new CrearMotivoDiferencia().execute(
                { empresa_id: e.B, nombre: 'Mala', cuenta_codigo: CUENTAS.CXC_CLIENTES },
                e.ctx,
            ),
        )
        assert.include(malaCuenta.reglas, 'contrapartida')
        const sinAprobacion = await errorDe(
            new CrearMotivoDiferencia().execute(
                { empresa_id: e.B, nombre: 'Sin cuenta', siempre_aprobacion: false },
                e.ctx,
            ),
        )
        assert.include(sinAprobacion.reglas, 'aprobacion_obligatoria')
        const creado = await new CrearMotivoDiferencia().execute(
            {
                empresa_id: e.B,
                nombre: 'Comisión del agente',
                sentido: 'menos',
                limite_tipo: 'porcentaje',
                limite_valor: '3.00',
                cuenta_codigo: CUENTAS.COMISIONES_PASARELAS,
                cuenta_contra_tope: false,
            },
            e.ctx,
        )
        assert.equal(creado.limite_valor, '3.00')

        // Q 15 de comisión: en B cabe (hasta Q 20, pero pasa del tope por línea), en C no aplica
        const pB = await pagoAlBanco(e, e.B, '300.00', await unicoBd('MB'))
        const pC = await pagoAlBanco(e, e.C, '300.00', await unicoBd('MC'))
        const { lineas: lB } = await extracto(e, e.B, [{ descripcion: 'X', monto: '285.00' }])
        const { lineas: lC } = await extracto(e, e.C, [{ descripcion: 'X', monto: '285.00' }])
        const enB = await errorDe(
            new ConciliarLinea().execute(
                {
                    linea_id: lB[0]!.id,
                    movimientos: [pB.movimiento],
                    diferencias: [{ motivo_id: fabrica.id, monto: '15.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(enB.codigo, 'diferencia_requiere_aprobacion')
        const enC = await errorDe(
            new ConciliarLinea().execute(
                {
                    linea_id: lC[0]!.id,
                    movimientos: [pC.movimiento],
                    diferencias: [{ motivo_id: fabrica.id, monto: '15.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(enC.codigo, 'motivo_no_aplica')
        // el motivo propio de B no vale en C; el porcentaje: 3 % de Q 300 = Q 9 < Q 15
        const ajeno = await errorDe(
            new ConciliarLinea().execute(
                {
                    linea_id: lC[0]!.id,
                    movimientos: [pC.movimiento],
                    diferencias: [{ motivo_id: creado.id, monto: '15.00' }],
                },
                e.ctx,
            ),
        )
        assert.include(ajeno.reglas, 'motivo')
        const porcentaje = await errorDe(
            new ConciliarLinea().execute(
                {
                    linea_id: lB[0]!.id,
                    movimientos: [pB.movimiento],
                    diferencias: [{ motivo_id: creado.id, monto: '15.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(porcentaje.codigo, 'motivo_no_aplica')
        // los topes son por empresa
        await new ConfigurarDiferencias().execute(
            { empresa_id: e.B, version: 0, tope_linea: '20.00', tope_dia: '20.00' },
            e.ctx,
        )
        const ajustesC = await leerAjustesConciliacion(e.C)
        assert.equal(ajustesC.tope_linea, '10.00')
        await new ConciliarLinea().execute(
            {
                linea_id: lB[0]!.id,
                movimientos: [pB.movimiento],
                diferencias: [{ motivo_id: fabrica.id, monto: '15.00' }],
            },
            e.ctx,
        )
        const difB = await diferencias({}, [e.B])
        assert.lengthOf(difB, 1)
        assert.equal(difB[0]!.partes[0]!.motivo_id, propio.id)
        assert.lengthOf(await diferencias({}, [e.C]), 0)
        const vistaB = await verDiferencia(difB[0]!.id)
        assert.equal(vistaB.empresa_id, e.B)
        await afirmarLibroConDiferencias(assert, [e.B, e.C])
    })
    test('HTTP: ajustes, motivos, conciliar con diferencia, pedir y aprobar, sugerencias; permisos', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const conta = await usuarioConRoles(['contabilidad'])
        const cajero = await usuarioConRoles(['cajero'])
        const pedir = (token: string) => (metodo: 'get' | 'post' | 'put', ruta: string, cuerpo?: object) => {
            const r = client[metodo](`/api/v1${ruta}`).bearerToken(token).header('X-Empresa-Id', String(e.B))
            return metodo === 'get' ? r : r.header('Idempotency-Key', unico('k')).json(cuerpo ?? {})
        }
        const admin = pedir(e.token)
        const otro = pedir(conta.token)

        const ajustes = await estado(admin('get', '/bancos/ajustes-conciliacion'), 200)
        assert.deepInclude(ajustes.body(), {
            empresa_id: e.B,
            tope_linea: '10.00',
            tope_dia: '50.00',
            version: 0,
        })
        await estado(admin('put', '/bancos/ajustes-conciliacion', { version: 0, tope_linea: '2.00' }), 200)
        await estado(
            pedir(cajero.token)('put', '/bancos/ajustes-conciliacion', { version: 1, tope_linea: '9.00' }),
            403,
        )
        const respMotivos = await estado(admin('get', '/bancos/motivos-diferencia'), 200)
        const motivos = respMotivos.body() as Array<{
            id: number
            codigo: string | null
        }>
        const comision = motivos.find((m) => m.codigo === 'comision_banco')!
        assert.sameMembers(
            motivos.map((m) => m.codigo),
            ['comision_banco', 'comision_cobro', 'redondeo', 'faltante_deposito', 'otra'],
        )

        const p1 = await pagoAlBanco(e, e.B, '40.00', await unicoBd('H1'))
        const p2 = await pagoAlBanco(e, e.B, '40.00', await unicoBd('H2'))
        const { extracto: ext, lineas } = await extracto(e, e.B, [
            { descripcion: 'T1', monto: '39.00' },
            { descripcion: 'T2', monto: '37.00' },
        ])
        const respSug = await estado(admin('get', `/bancos/extractos/${ext.id}/sugerencias`), 200)
        const sug = respSug.body()
        assert.equal(sug.tope.tope_linea, '2.00')
        assert.equal(sug.lineas[0].nivel, 'con_diferencia')
        const c = await estado(
            admin('post', '/bancos/conciliaciones', {
                linea_id: lineas[0]!.id,
                movimientos: [p1.movimiento],
                diferencias: [{ motivo_id: comision.id, monto: '1.00' }],
            }),
            201,
        )
        assert.equal(c.body().monto, '39.00')
        const sobre = await estado(
            admin('post', '/bancos/conciliaciones', {
                linea_id: lineas[1]!.id,
                movimientos: [p2.movimiento],
                diferencias: [{ motivo_id: comision.id, monto: '3.00' }],
            }),
            422,
        )
        assert.equal(sobre.body().type.split(':').at(-1), 'diferencia_requiere_aprobacion')
        const pedida = await estado(
            admin('post', '/bancos/diferencias', {
                linea_id: lineas[1]!.id,
                movimientos: [p2.movimiento],
                diferencias: [{ motivo_id: comision.id, monto: '3.00' }],
                explicacion: 'comisión de transferencia ACH',
            }),
            201,
        )
        const id = pedida.body().id
        const respPend = await estado(admin('get', '/bancos/diferencias-pendientes'), 200)
        const pendientes = respPend.body()
        assert.deepEqual(
            pendientes.data.map((d: { id: number }) => d.id),
            [id],
        )
        await estado(pedir(cajero.token)('post', `/bancos/diferencias/${id}/aprobar`), 403)
        await estado(admin('post', `/bancos/diferencias/${id}/aprobar`), 403)
        const aprobada = await estado(otro('post', `/bancos/diferencias/${id}/aprobar`), 200)
        assert.equal(aprobada.body().estado, 'aprobada')
        const vista = await estado(admin('get', `/bancos/diferencias/${id}`), 200)
        assert.isNotNull(vista.body().asiento_id)
        const respTodas = await estado(admin('get', '/bancos/diferencias?estado=aplicada'), 200)
        const todas = respTodas.body()
        assert.lengthOf(todas.data, 1)
        await estado(admin('post', `/bancos/extractos/${ext.id}/aceptar-seguras`, {}), 200)
        await afirmarLibroConDiferencias(assert, [e.B, e.C])
    })
})
