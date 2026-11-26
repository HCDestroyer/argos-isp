import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import DepositarCaja from '#ledger/actions/depositar_caja'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { resumenFondosEnTransito } from '#ledger/transitos'
import { esperadoDelTurno } from '#ledger/resumen_turno'
import { saldoClientePorEmpresa } from '#ledger/consultas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { carteraVencida } from '#billing/reportes/reportes'
import {
    codigoCaja,
    errorDe,
    pendientes,
    saldoCuenta,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
import { EscenarioGenerativo } from '#tests/contabilidad/escenario_generativo'
import type { Violacion } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'

/**
 * Auditor contable · AU1 del plan de contabilidad (`.claude/integration/contratos/plan-contabilidad.md`,
 * §4 y §7). Fija con pruebas el comportamiento de HOY de E1, E3, E5 y E8 antes de corregirlo.
 *
 * Convención (igual que los hallazgos de las fases):
 *  - «hoy (Ex): …» describe el defecto tal como existe; pasa mientras el defecto exista y se
 *    borra (o se reescribe) cuando el lote que lo corrige llegue.
 *  - «esperado (Ex): …» es el comportamiento correcto y va `.fails(motivo)`: pasa mientras el
 *    defecto exista y se pone en rojo cuando B1, B5 o B6 lo corrijan; ese día se le quita `.fails`
 *    (AU2). Nunca se usa skip.
 *  - E8 no es un defecto: debe pasar ya y seguir pasando.
 */

/** Cobra `monto` en efectivo en la caja, cierra el turno entregando `entregado` (fondo siguiente 100). */
async function turnoConEntrega(e: EmpresasGt, cobro: string) {
    const cajaId = e.cajas.get(e.B)!
    const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
    await new RegistrarPago().execute(
        { cliente_id: s.clienteId, metodo: 'caja', monto: cobro, caja_id: cajaId, empresa_id: e.B },
        e.ctx,
    )
    const caja = await codigoCaja(cajaId)
    const libroAntes = await saldoCuenta(e.B, caja)
    // fondo 100 + cobro; queda de fondo 100 y el resto se entrega a un usuario
    const contado = String(Number(cobro) + 100)
    const turno = await new CerrarCaja().execute(
        { caja_id: cajaId, contado, fondo_siguiente: '100.00', entregado_a: e.usuarioId },
        e.ctx,
    )
    return { cajaId, caja, libroAntes, turno, clienteId: s.clienteId }
}

test.group('Auditor contable · AU1 · E1 · la entrega al cerrar la caja no tiene asiento', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('hoy (E1): al cerrar con entrega el efectivo sigue en la caja del libro y no hay asiento de la entrega', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { cajaId, caja, libroAntes, turno } = await turnoConEntrega(e, '150.00')
        assert.equal(turno.entregado_monto, '150.00')
        assert.equal(turno.entregado_a, e.usuarioId)
        assert.equal(turno.fondo_siguiente, '100.00')
        // el cierre cuadró (diferencia 0): no deja ningún asiento
        const asientos = await db
            .from('ledger.asientos')
            .where({ origen_tipo: 'cierre_caja', origen_id: turno.id })
        assert.lengthOf(asientos, 0)
        // el efectivo entregado sigue sumando en la cuenta de la caja
        assert.equal(await saldoCuenta(e.B, caja), libroAntes)
        assert.equal(libroAntes, '150.00')
        assert.exists(cajaId)
    })

    test('hoy (E1): lo entregado ayer no se puede depositar: sin turno abierto, o con turno nuevo supera su efectivo', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { cajaId } = await turnoConEntrega(e, '150.00')
        const banco = e.banco.get(e.B)!
        const sinTurno = await errorDe(
            new DepositarCaja().execute(
                { caja_id: cajaId, monto: '150.00', boleta: 'E1-A', cuenta_bancaria_id: banco.id },
                e.ctx,
            ),
        )
        assert.equal(sinTurno.codigo, 'sin_turno_abierto')
        // el turno nuevo abre con el fondo que quedó (Q100): no alcanza para los Q150 entregados
        await new AbrirCaja().execute({ caja_id: cajaId, fondo_inicial: '100.00' }, e.ctx)
        const excede = await errorDe(
            new DepositarCaja().execute(
                { caja_id: cajaId, monto: '150.00', boleta: 'E1-B', cuenta_bancaria_id: banco.id },
                e.ctx,
            ),
        )
        assert.equal(excede.codigo, 'deposito_excede_efectivo')
    })

    test('hoy (E1): el fondo de apertura es libre: nada lo compara con el fondo que quedó al cerrar', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { cajaId, turno } = await turnoConEntrega(e, '150.00')
        assert.equal(turno.fondo_siguiente, '100.00')
        const nuevo = await new AbrirCaja().execute({ caja_id: cajaId, fondo_inicial: '999.99' }, e.ctx)
        assert.equal(nuevo.fondo_inicial, '999.99')
    })

    test('esperado (E1): al cerrar con entrega, el efectivo entregado sale de la caja del libro', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { caja, libroAntes, turno } = await turnoConEntrega(e, '150.00')
        const despues = Number(await saldoCuenta(e.B, caja))
        assert.equal(despues, Number(libroAntes) - Number(turno.entregado_monto))
    }).fails('E1 abierto hasta B1: la entrega no genera asiento y el efectivo sigue en la cuenta de la caja')

    test('esperado (E1): lo entregado al cerrar se puede depositar al día siguiente aunque el fondo nuevo sea menor', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { cajaId } = await turnoConEntrega(e, '150.00')
        const banco = e.banco.get(e.B)!
        await new AbrirCaja().execute({ caja_id: cajaId, fondo_inicial: '100.00' }, e.ctx)
        const deposito = await new DepositarCaja().execute(
            { caja_id: cajaId, monto: '150.00', boleta: 'E1-C', cuenta_bancaria_id: banco.id },
            e.ctx,
        )
        assert.equal(deposito.monto, '150.00')
    }).fails(
        'E1 abierto hasta B1: el depósito solo sale del efectivo del turno abierto (deposito_excede_efectivo)',
    )

    test('esperado (E1): lo entregado al cerrar se puede depositar aunque la caja no tenga turno abierto', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { cajaId } = await turnoConEntrega(e, '150.00')
        const banco = e.banco.get(e.B)!
        const deposito = await new DepositarCaja().execute(
            { caja_id: cajaId, monto: '150.00', boleta: 'E1-D', cuenta_bancaria_id: banco.id },
            e.ctx,
        )
        assert.equal(deposito.monto, '150.00')
    }).fails('E1 abierto hasta B1: el depósito exige un turno abierto (sin_turno_abierto)')
})

/** Caja con un cobro de Q150 y un depósito mal digitado de Q100 (debía ser Q80). */
async function depositoMalDigitado(e: EmpresasGt) {
    const cajaId = e.cajas.get(e.B)!
    const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
    await new RegistrarPago().execute(
        { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', caja_id: cajaId, empresa_id: e.B },
        e.ctx,
    )
    const banco = e.banco.get(e.B)!
    const deposito = await new DepositarCaja().execute(
        { caja_id: cajaId, monto: '100.00', boleta: 'E3-MAL', cuenta_bancaria_id: banco.id },
        e.ctx,
    )
    const asiento = await db
        .from('ledger.asientos')
        .where({ origen_tipo: 'deposito', origen_id: deposito.id })
        .whereNull('reversa_de')
        .select('id')
        .firstOrFail()
    const turno = await db
        .from('ledger.cajas_turnos')
        .where('caja_id', cajaId)
        .whereNull('cerrado_en')
        .select('id')
        .firstOrFail()
    return {
        cajaId,
        caja: await codigoCaja(cajaId),
        deposito,
        asientoId: Number(asiento.id),
        turnoId: Number(turno.id),
    }
}

/** La salida que hoy ofrece el sistema: un asiento de ajuste que devuelve el dinero a la caja. */
async function corregirConAjuste(e: EmpresasGt, caja: string, monto: string) {
    await new RegistrarAsiento().execute(
        {
            empresa_id: e.B,
            fecha: new Date().toISOString().slice(0, 10),
            descripcion: 'auditoría E3: corrección del depósito mal digitado',
            origen_tipo: 'ajuste',
            movimientos: [
                { cuenta: caja, debe: monto },
                { cuenta: CUENTAS_GT.FONDOS_EN_TRANSITO, haber: monto },
            ],
        },
        e.ctx,
    )
}

test.group('Auditor contable · AU1 · E3 · un depósito de caja no se puede anular', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('hoy (E3): el reverso directo del asiento del depósito se rechaza y remite a un asiento de ajuste', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { asientoId } = await depositoMalDigitado(e)
        const error = await errorDe(
            new RevertirAsiento().execute({ asiento_id: asientoId, motivo: 'auditoría E3' }, e.ctx),
        )
        assert.equal(error.codigo, 'reverso_por_documento')
        assert.include(error.detalle, 'asiento de ajuste')
    })

    test('hoy (E3): corregido con un ajuste, la fila del depósito sigue viva: en tránsito, restando del esperado y descuadrando 1.1.11', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { caja, deposito, turnoId } = await depositoMalDigitado(e)
        await corregirConAjuste(e, caja, '100.00')
        // el libro quedó corregido: la caja recuperó los Q100 y 1.1.11 volvió a 0
        assert.equal(await saldoCuenta(e.B, caja), '150.00')
        assert.equal(Number(await saldoCuenta(e.B, CUENTAS_GT.FONDOS_EN_TRANSITO)), 0)
        // pero la fila del documento no se enteró
        const fila = await db.from('ledger.depositos').where('id', deposito.id).firstOrFail()
        assert.equal(fila.monto, '100.00')
        // sigue restando en el esperado del turno: 100 fondo + 150 cobro − 100 depósito
        const esperado = await esperadoDelTurno(db.connection(), turnoId)
        assert.equal(esperado.toFixed(2), '150.00')
        // y sigue «en tránsito»: el check de fondos en tránsito ve 100 pendientes contra 0 en el libro
        const [resumen] = await resumenFondosEnTransito([e.B])
        assert.deepEqual(
            { saldo_libro: resumen!.saldo_libro, pendiente: resumen!.pendiente, cuadra: resumen!.cuadra },
            { saldo_libro: '0.00', pendiente: '100.00', cuadra: false },
        )
    })

    test('esperado (E3): un depósito mal digitado, una vez corregido, vuelve a sumar en el efectivo del turno', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { caja, turnoId } = await depositoMalDigitado(e)
        // B5 trae `anular_deposito`; cuando exista, esta corrección pasa a ser esa acción (AU2)
        await corregirConAjuste(e, caja, '100.00')
        // 100 fondo + 150 cobro, sin el depósito corregido
        const esperado = await esperadoDelTurno(db.connection(), turnoId)
        assert.equal(esperado.toFixed(2), '250.00')
    }).fails('E3 abierto hasta B5: el depósito corregido sigue restando en el esperado del turno')

    test('esperado (E3): un depósito mal digitado, una vez corregido, deja de estar en tránsito y 1.1.11 cuadra', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { caja } = await depositoMalDigitado(e)
        await corregirConAjuste(e, caja, '100.00')
        const [resumen] = await resumenFondosEnTransito([e.B])
        assert.deepEqual(
            { pendiente: resumen!.pendiente, cuadra: resumen!.cuadra },
            { pendiente: '0.00', cuadra: true },
        )
    }).fails(
        'E3 abierto hasta B5: la fila del depósito queda «en tránsito» y el check de fondos en tránsito no cuadra',
    )
})

/**
 * Lo que el cliente debía al corte: facturas con periodo hasta el corte, sin ningún pago anterior a
 * él (el cobro de la prueba es de hoy). Se calcula con las facturas y no con el libro porque el
 * generador de las pruebas emite las facturas atrasadas con el asiento de hoy; B6 leerá el auxiliar,
 * y su prueba debe emitir con fecha propia (AU2).
 */
async function debidoAlCorte(clienteId: number, corte: string): Promise<string> {
    const fila = await db
        .from('billing.facturas')
        .where('cliente_id', clienteId)
        .whereRaw('periodo <= ?::date', [corte])
        .select(db.raw('coalesce(sum(total), 0)::text as total'))
        .firstOrFail()
    return Number(fila.total).toFixed(2)
}

/** Servicio con tres facturas de 2026 (ago–oct), todas cobradas HOY. El corte pedido es anterior al cobro. */
async function carteraPagadaDespuesDelCorte(e: EmpresasGt) {
    const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-08-01', precio: '200.00' })
    const abiertas = await pendientes([e.B], s.clienteId)
    const total = abiertas.reduce((a, f) => a + (Number(f.total) - Number(f.pagado)), 0)
    await new RegistrarPago().execute(
        { cliente_id: s.clienteId, metodo: 'caja', monto: total.toFixed(2), empresa_id: e.B },
        e.ctx,
    )
    const corte = '2026-10-15'
    const alCorte = async () =>
        carteraVencida({ corte, cliente_id: s.clienteId }, undefined, { empresas: [e.B], consolidado: false })
    return { s, total: total.toFixed(2), corte, alCorte }
}

test.group('Auditor contable · AU1 · E5 · cartera vencida a una fecha pasada', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('hoy (E5): con corte pasado usa el saldo de hoy: lo pagado después del corte desaparece de la cartera', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { s, total, corte, alCorte } = await carteraPagadaDespuesDelCorte(e)
        assert.isAbove(Number(total), 0, 'el cliente debía algo al corte')
        // al corte el cliente debía `total` (ningún pago era anterior)
        assert.equal(await debidoAlCorte(s.clienteId, corte), total)
        // el reporte a esa fecha dice 0, igual que el reporte de hoy
        const reporte = await alCorte()
        assert.equal(reporte.totales.total, '0.00')
        const hoy = await carteraVencida({ cliente_id: s.clienteId }, undefined, {
            empresas: [e.B],
            consolidado: false,
        })
        assert.equal(hoy.totales.total, reporte.totales.total)
    })

    test('esperado (E5): la cartera al corte es lo que se debía a esa fecha (aunque se haya pagado después)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { s, corte, alCorte } = await carteraPagadaDespuesDelCorte(e)
        const reporte = await alCorte()
        assert.equal(reporte.totales.total, await debidoAlCorte(s.clienteId, corte))
    }).fails('E5 abierto hasta B6: el reporte usa total − pagado de hoy con la antigüedad del corte')
})

/**
 * E8: el saldo del cliente sale del libro (`saldoCliente`) y de las facturas (`total − pagado`).
 * Debe cuadrar después de CADA operación, no solo en la revisión mensual del cierre. Hoy cuadra:
 * estas pruebas lo exigen para que ningún lote del plan lo rompa (B1 a B5 tocan cajas, pagos y
 * saldos a favor).
 */
async function saldosDescuadrados(empresas: number[]): Promise<Violacion[]> {
    const clientes = (await db
        .from('billing.facturas')
        .whereIn('empresa_id', empresas)
        .distinct('cliente_id')
        .select('cliente_id')) as Array<{ cliente_id: number }>
    const descuadres: unknown[] = []
    for (const fila of clientes) {
        const clienteId = Number(fila.cliente_id)
        const libro = await saldoClientePorEmpresa(clienteId)
        const facturas = (await db
            .from('billing.facturas')
            .whereIn('empresa_id', empresas)
            .where('cliente_id', clienteId)
            .whereIn('estado', ['emitida', 'parcial', 'vencida'])
            .groupBy('empresa_id')
            .select('empresa_id', db.raw('coalesce(sum(total - pagado), 0)::text as pendiente'))) as Array<{
            empresa_id: number
            pendiente: string
        }>
        for (const empresaId of empresas) {
            const delLibro = (libro.get(empresaId)?.toFixed(2) ?? '0.00') as string
            const dePendiente = Number(
                facturas.find((f) => Number(f.empresa_id) === empresaId)?.pendiente ?? '0',
            ).toFixed(2)
            if (delLibro !== dePendiente) {
                descuadres.push({
                    cliente_id: clienteId,
                    empresa_id: empresaId,
                    libro: delLibro,
                    facturas: dePendiente,
                })
            }
        }
    }
    return descuadres.length > 0
        ? [
              {
                  invariante: '8.saldo_por_libro_distinto_de_saldo_por_facturas',
                  detalle: descuadres.slice(0, 20),
              },
          ]
        : []
}

test.group(
    'Auditor contable · AU1 · E8 · saldo por libro = saldo por facturas tras cada operación',
    (group) => {
        group.each.teardown(() => soloEmpresaPrincipal())

        for (const [semilla, fel, fase4, fase5] of [
            [20261017, false, false, false],
            [777, false, false, false],
            [4242, true, false, false],
            [1618, true, true, false],
            [5813, true, true, true],
        ] as const) {
            const pasos = fase5 ? 150 : fel ? 120 : 50
            test(`semilla ${semilla}${fase5 ? ' f5' : fase4 ? ' f4' : fel ? ' fel' : ''}: ${pasos} pasos, el saldo del libro y el de las facturas coinciden después de cada paso`, async ({
                assert,
            }) => {
                let revisiones = 0
                const escenario = new EscenarioGenerativo(semilla, {
                    fel,
                    fase4,
                    fase5,
                    alVerificar: async (empresas) => {
                        revisiones++
                        return saldosDescuadrados(empresas)
                    },
                })
                await escenario.preparar()
                const resultado = await escenario.correr(pasos)
                const rotos = resultado.hallazgos.filter((h) =>
                    h.violacion.invariante.startsWith('8.saldo_por_libro'),
                )
                assert.deepEqual(
                    rotos.map((h) => ({ paso: h.paso, detalle: h.violacion.detalle })),
                    [],
                    `E8 roto en la semilla ${semilla}`,
                )
                assert.equal(revisiones, pasos, 'la revisión corrió después de cada paso')
                // la comparación no es vacía: el escenario dejó saldos pendientes que comparar
                const conSaldo = await db
                    .from('billing.facturas')
                    .whereIn('empresa_id', escenario.empresasDelEscenario)
                    .whereIn('estado', ['emitida', 'parcial', 'vencida'])
                    .whereRaw('total > pagado')
                    .count('* as n')
                    .firstOrFail()
                assert.isAbove(Number(conSaldo.n), 0, 'hay facturas pendientes al final')
            }).timeout(600_000)
        }
    },
)
