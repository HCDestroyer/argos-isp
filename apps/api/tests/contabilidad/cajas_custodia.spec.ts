import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { contextoPrueba, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { cuentaBancariaPrueba, unicoBd } from '#tests/billing/ayudas_billing'
import RegistrarPago from '#billing/actions/registrar_pago'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import CrearCaja from '#ledger/actions/crear_caja'
import DepositarCaja from '#ledger/actions/depositar_caja'
import EntregarCaja from '#ledger/actions/entregar_caja'
import RechazarEntrega from '#ledger/actions/rechazar_entrega'
import RecibirEntrega from '#ledger/actions/recibir_entrega'
import ActualizarLocalizacion from '#fiscal/actions/actualizar_localizacion'
import { saldoCustodia } from '#ledger/custodia'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    codigoCaja,
    errorDe,
    lineas,
    saldoCuenta,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · AU2 del plan de contabilidad (`contratos/plan-contabilidad.md` §5.7 y §7): el
 * camino del efectivo de B1 (caja de cobros → custodia → banco) con el libro verificado después de
 * cada paso, y las invariantes nuevas atacadas con mutaciones que se revierten.
 *
 * Las empresas de este archivo abren su caja **sin** `fondo_inicial` (con el fondo esperado), así
 * que aquí se exige también `exigirFondoEsperado`.
 */

const CUSTODIA = CUENTAS_GT.EFECTIVO_EN_CUSTODIA
const TRANSITO = CUENTAS_GT.FONDOS_EN_TRANSITO
const ESTRICTO = { exigirFondoEsperado: true }

/** Dos empresas con su caja de cobros abierta con el fondo fijo (Q200), sin fondo escrito a mano. */
async function prepararCajas() {
    const B = await crearEmpresaFila()
    const C = await crearEmpresaFila()
    const { usuario, token } = await usuarioConRoles(['admin'])
    const ctx = contextoPrueba(usuario.id)
    const cajas = new Map<number, number>()
    const banco = new Map<number, { id: number }>()
    for (const empresaId of [B, C]) {
        await new ActualizarLocalizacion().execute({ empresa_id: empresaId }, ctx)
        const caja = await new CrearCaja().execute(
            { nombre: await unicoBd('Caja'), cajero_id: usuario.id, empresa_id: empresaId },
            ctx,
        )
        const turno = await new AbrirCaja().execute({ caja_id: caja.id }, ctx)
        if (turno.fondo_inicial !== '200.00') throw new Error('la caja debía abrir con el fondo fijo')
        cajas.set(empresaId, caja.id)
        banco.set(empresaId, await cuentaBancariaPrueba('Banrural', empresaId))
    }
    return { B, C, usuarioId: usuario.id, token, ctx, cajas, banco }
}
type Cajas = Awaited<ReturnType<typeof prepararCajas>>

/** Cobra en efectivo en la caja de la empresa. */
async function cobrar(e: Cajas, cobro: string, empresaId = e.B) {
    const cajaId = e.cajas.get(empresaId)!
    const s = await servicioFacturado(empresaId, '2026-10-01', { instalacion: '2026-09-01' })
    await new RegistrarPago().execute(
        { cliente_id: s.clienteId, metodo: 'caja', monto: cobro, caja_id: cajaId, empresa_id: empresaId },
        e.ctx,
    )
    return { cajaId, caja: await codigoCaja(cajaId) }
}

/** Una persona con permiso para recibir entregas, con su contexto. */
async function receptor() {
    const c = await usuarioConRoles(['contabilidad'])
    return { ...c, ctx: contextoPrueba(c.usuario.id) }
}

async function libroBien(assert: Parameters<typeof afirmarLibro>[0], e: Cajas) {
    await afirmarLibro(assert, [e.B, e.C], ESTRICTO)
}

/** Mutaciones como DBA dentro de una transacción que siempre se revierte; devuelve las invariantes rotas. */
async function fabricado(
    empresas: number[],
    paso: (trx: TransactionClientContract) => Promise<void>,
): Promise<string[]> {
    const trx = await db.transaction()
    try {
        await paso(trx)
        const violaciones = await verificarLibro(empresas, {
            cliente: trx,
            incluirHallazgosAbiertos: true,
            sinFuncionesProducto: true,
            ...ESTRICTO,
        })
        return violaciones.map((v) => v.invariante.split(' ')[0]!)
    } finally {
        await trx.rollback()
    }
}

/** Custodia (recibido − depositado) de una persona en la empresa, con 2 decimales. */
async function custodiaDe(empresaId: number, usuarioId: number): Promise<string> {
    const saldo = await saldoCustodia(db.connection(), empresaId, usuarioId)
    return saldo.toFixed(2)
}

const sinTriggers = async (trx: TransactionClientContract, tabla: string, ...triggers: string[]) => {
    for (const t of triggers) await trx.rawQuery(`ALTER TABLE ${tabla} DISABLE TRIGGER ${t}`)
}

test.group('Auditor contable · AU2 · efectivo de las cajas de cobros (B1)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('entrega con diferencia: faltante en el cierre y en «Recibí», cada uno a cargo de quien corresponde; el libro cuadra tras cada paso', async ({
        assert,
    }) => {
        const e = await prepararCajas()
        const conta = await receptor()
        const { cajaId, caja } = await cobrar(e, '500.00')
        await libroBien(assert, e)

        // esperado 200 + 500 = 700; contó 690 (faltante 10 del cajero) y entrega 490 dejando 200 de fondo
        const turno = await new CerrarCaja().execute(
            {
                caja_id: cajaId,
                contado: '690.00',
                fondo_siguiente: '200.00',
                entregado_a: conta.usuario.id,
                motivo: 'faltante de prueba',
            },
            e.ctx,
        )
        assert.equal(turno.diferencia, '-10.00')
        assert.equal(turno.entregado_monto, '490.00')
        assert.equal(turno.entrega_estado, 'por_recibir')
        // aún sin asiento de entrega: el efectivo sigue en la caja del libro (500 − 10 de faltante)
        assert.lengthOf(await lineas('entrega_caja', turno.entrega_id!), 0)
        assert.equal(await saldoCuenta(e.B, caja), '490.00')
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '0')
        await libroBien(assert, e)

        // «Recibí» contando 480: otro faltante de 10, ahora de quien entregó
        await new RecibirEntrega().execute(
            { entrega_id: turno.entrega_id!, contado: '480.00', motivo: 'faltó un billete de Q10' },
            conta.ctx,
        )
        assert.deepEqual(await lineas('entrega_caja', turno.entrega_id!), [
            [CUSTODIA, '480.00', '0.00'],
            [CUENTAS.FALTANTES_CAJA, '10.00', '0.00'],
            [caja, '0.00', '490.00'],
        ])
        assert.equal(await saldoCuenta(e.B, caja), '0.00')
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '480.00')
        assert.equal(await custodiaDe(e.B, conta.usuario.id), '480.00')
        await libroBien(assert, e)

        // el turno siguiente abre con el fondo que quedó, sin escribirlo
        const nuevo = await new AbrirCaja().execute({ caja_id: cajaId }, e.ctx)
        assert.deepEqual([nuevo.fondo_inicial, nuevo.fondo_esperado], ['200.00', '200.00'])
        await libroBien(assert, e)
    })

    test('«No lo recibí»: sin asiento, el efectivo sigue en la caja; la reentrega a otra persona se recibe y el libro cuadra', async ({
        assert,
    }) => {
        const e = await prepararCajas()
        const conta = await receptor()
        const otra = await receptor()
        const { cajaId, caja } = await cobrar(e, '300.00')
        const turno = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '500.00', fondo_siguiente: '200.00', entregado_a: conta.usuario.id },
            e.ctx,
        )
        await libroBien(assert, e)
        await new RechazarEntrega().execute(
            { entrega_id: turno.entrega_id!, motivo: 'no me llegó el sobre' },
            conta.ctx,
        )
        assert.lengthOf(await lineas('entrega_caja', turno.entrega_id!), 0)
        assert.equal(await saldoCuenta(e.B, caja), '300.00')
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '0')
        await libroBien(assert, e)

        // una entrega rechazada no se recibe después
        const tarde = await errorDe(
            new RecibirEntrega().execute({ entrega_id: turno.entrega_id! }, conta.ctx),
        )
        assert.equal(tarde.codigo, 'entrega_resuelta')

        const otraVez = await new EntregarCaja().execute(
            { turno_id: turno.id, entregado_a: otra.usuario.id },
            e.ctx,
        )
        await libroBien(assert, e)
        await new RecibirEntrega().execute({ entrega_id: otraVez.id }, otra.ctx)
        assert.equal(await saldoCuenta(e.B, caja), '0.00')
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '300.00')
        assert.equal(await custodiaDe(e.B, conta.usuario.id), '0.00')
        assert.equal(await custodiaDe(e.B, otra.usuario.id), '300.00')
        await libroBien(assert, e)
    })

    test('«lo deposito yo»: se recibe al cerrar y se deposita desde la custodia, sin turno abierto, en pedazos; nunca más de lo recibido', async ({
        assert,
    }) => {
        const e = await prepararCajas()
        const { cajaId, caja } = await cobrar(e, '150.00')
        const turno = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '350.00', fondo_siguiente: '200.00', entregado_a: e.usuarioId },
            e.ctx,
        )
        assert.equal(turno.entrega_estado, 'recibida')
        assert.equal(await saldoCuenta(e.B, caja), '0.00')
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '150.00')
        await libroBien(assert, e)

        const banco = e.banco.get(e.B)!
        const depositar = (monto: string) =>
            new DepositarCaja().execute(
                { monto, boleta: unico('AU2'), cuenta_bancaria_id: banco.id, empresa_id: e.B },
                e.ctx,
            )
        const primero = await depositar('100.00')
        assert.containSubset(primero, { origen: 'custodia', caja_id: null, turno_id: null })
        assert.deepEqual(await lineas('deposito', primero.id), [
            [TRANSITO, '100.00', '0.00'],
            [CUSTODIA, '0.00', '100.00'],
        ])
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '50.00')
        await libroBien(assert, e)

        const excede = await errorDe(depositar('50.01'))
        assert.equal(excede.codigo, 'deposito_excede_custodia')
        await libroBien(assert, e)
        await depositar('50.00')
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '0.00')
        assert.equal(await saldoCuenta(e.B, TRANSITO), '150.00')
        await libroBien(assert, e)
    })

    test('depósito desde la custodia sin turno: cada persona deposita solo lo suyo y la custodia cuadra por persona', async ({
        assert,
    }) => {
        const e = await prepararCajas()
        const conta = await receptor()
        const { cajaId } = await cobrar(e, '400.00')
        // primer turno: 400 a la contadora; segundo turno (fondo esperado 200): 120 al admin («lo deposito yo»)
        await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '600.00', fondo_siguiente: '200.00', entregado_a: conta.usuario.id },
            e.ctx,
        )
        const t2 = await new AbrirCaja().execute({ caja_id: cajaId }, e.ctx)
        assert.equal(t2.fondo_inicial, '200.00')
        await cobrar(e, '120.00')
        const turno2 = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '320.00', fondo_siguiente: '200.00', entregado_a: e.usuarioId },
            e.ctx,
        )
        assert.equal(turno2.entregado_monto, '120.00')
        // la contadora recibe lo suyo
        const pendientes = await db
            .from('ledger.entregas as x')
            .leftJoin('ledger.entregas_recepciones as r', 'r.entrega_id', 'x.id')
            .where('x.empresa_id', e.B)
            .whereNull('r.id')
            .select('x.id')
        assert.lengthOf(pendientes, 1)
        await new RecibirEntrega().execute({ entrega_id: pendientes[0]!.id }, conta.ctx)
        await libroBien(assert, e)

        const banco = e.banco.get(e.B)!
        const depositar = (ctx: typeof e.ctx, monto: string) =>
            new DepositarCaja().execute(
                { monto, boleta: unico('AU2'), cuenta_bancaria_id: banco.id, empresa_id: e.B },
                ctx,
            )
        // el admin solo tiene 120: no puede sacar la custodia de la contadora
        const ajeno = await errorDe(depositar(e.ctx, '121.00'))
        assert.equal(ajeno.codigo, 'deposito_excede_custodia')
        await depositar(conta.ctx, '300.00')
        await depositar(e.ctx, '120.00')
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '100.00')
        assert.equal(await custodiaDe(e.B, conta.usuario.id), '100.00')
        assert.equal(await custodiaDe(e.B, e.usuarioId), '0.00')
        await libroBien(assert, e)
    })

    test('multiempresa: la misma persona recibe en dos empresas y su custodia, su 1.1.15 y su libro quedan separados', async ({
        assert,
    }) => {
        const e = await prepararCajas()
        const a = await cobrar(e, '200.00', e.B)
        const b = await cobrar(e, '90.00', e.C)
        await new CerrarCaja().execute(
            { caja_id: a.cajaId, contado: '400.00', fondo_siguiente: '200.00', entregado_a: e.usuarioId },
            e.ctx,
        )
        await new CerrarCaja().execute(
            { caja_id: b.cajaId, contado: '290.00', fondo_siguiente: '200.00', entregado_a: e.usuarioId },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '200.00')
        assert.equal(await saldoCuenta(e.C, CUSTODIA), '90.00')
        await libroBien(assert, e)

        // lo de C no se deposita contra el banco de B ni se saca más de lo que hay en C
        const enC = await errorDe(
            new DepositarCaja().execute(
                {
                    monto: '90.01',
                    boleta: unico('AU2'),
                    cuenta_bancaria_id: e.banco.get(e.C)!.id,
                    empresa_id: e.C,
                },
                e.ctx,
            ),
        )
        assert.equal(enC.codigo, 'deposito_excede_custodia')
        await new DepositarCaja().execute(
            {
                monto: '90.00',
                boleta: unico('AU2'),
                cuenta_bancaria_id: e.banco.get(e.C)!.id,
                empresa_id: e.C,
            },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.C, CUSTODIA), '0.00')
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '200.00')
        assert.equal(await custodiaDe(e.B, e.usuarioId), '200.00')
        // cada empresa se verifica sola y juntas
        await afirmarLibro(assert, e.B, ESTRICTO)
        await afirmarLibro(assert, e.C, ESTRICTO)
        await libroBien(assert, e)
    })
})

test.group('Auditor contable · AU2 · las invariantes de la custodia detectan errores', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    /** Una entrega recibida (Q300, contó Q290) y un depósito de Q100 desde la custodia, sin conciliar. */
    async function conEfectivoEnCustodia() {
        const e = await prepararCajas()
        const conta = await receptor()
        const { cajaId } = await cobrar(e, '300.00')
        const turno = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '500.00', fondo_siguiente: '200.00', entregado_a: conta.usuario.id },
            e.ctx,
        )
        await new RecibirEntrega().execute(
            { entrega_id: turno.entrega_id!, contado: '290.00', motivo: 'faltaron Q10' },
            conta.ctx,
        )
        const deposito = await new DepositarCaja().execute(
            {
                monto: '100.00',
                boleta: unico('AU2'),
                cuenta_bancaria_id: e.banco.get(e.B)!.id,
                empresa_id: e.B,
            },
            conta.ctx,
        )
        return { e, conta, turno, deposito }
    }

    test('el camino sano no rompe ninguna invariante (línea base de las mutaciones)', async ({ assert }) => {
        const { e } = await conEfectivoEnCustodia()
        await libroBien(assert, e)
        assert.deepEqual(await fabricado([e.B, e.C], async () => {}), [])
    })

    test('un asiento de ajuste a mano contra 1.1.15 rompe «1.1.15 = recibido − depositado»', async ({
        assert,
    }) => {
        const { e } = await conEfectivoEnCustodia()
        const rotas = await fabricado([e.B, e.C], async (trx) => {
            await trx.rawQuery(`ALTER TABLE ledger.asientos DISABLE TRIGGER USER`)
            await trx.rawQuery(`ALTER TABLE ledger.movimientos DISABLE TRIGGER USER`)
            const [a] = (await trx
                .insertQuery()
                .table('ledger.asientos')
                .insert({
                    empresa_id: e.B,
                    fecha: hoyGuatemala(),
                    descripcion: 'ajuste a mano',
                    origen_tipo: 'ajuste',
                    origen_id: 0,
                })
                .returning('id')) as Array<{ id: number }>
            const cuentas = (await trx
                .from('ledger.cuentas')
                .whereIn('codigo', [CUSTODIA, CUENTAS.CAJAS])
                .where((q) => q.whereNull('empresa_id').orWhere('empresa_id', e.B))
                .select('id', 'codigo')) as Array<{ id: number; codigo: string }>
            const custodia = cuentas.find((c) => c.codigo === CUSTODIA)!
            const banco = await trx
                .from('ledger.cuentas')
                .where('codigo', CUENTAS.BANCO_PRINCIPAL)
                .firstOrFail()
            await trx
                .insertQuery()
                .table('ledger.movimientos')
                .multiInsert([
                    { asiento_id: a!.id, cuenta_id: custodia.id, debe: '25.00', haber: '0' },
                    { asiento_id: a!.id, cuenta_id: banco.id, debe: '0', haber: '25.00' },
                ])
        })
        assert.include(rotas, '13.custodia_distinta')
    })

    test('inflar lo recibido (1.1.15 y la caja, cuadrado) rompe la entrega mal contabilizada y la custodia', async ({
        assert,
    }) => {
        const { e, turno } = await conEfectivoEnCustodia()
        const rotas = await fabricado([e.B, e.C], async (trx) => {
            await sinTriggers(trx, 'ledger.movimientos', 'movimientos_inmutable', 'movimientos_validar')
            const asiento = await trx
                .from('ledger.asientos')
                .where({ origen_tipo: 'entrega_caja', origen_id: turno.entrega_id! })
                .firstOrFail()
            await trx.rawQuery(
                `UPDATE ledger.movimientos SET debe = debe + 5 WHERE asiento_id = ? AND cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = ? LIMIT 1)`,
                [asiento.id, CUSTODIA],
            )
            await trx.rawQuery(
                `UPDATE ledger.movimientos SET haber = haber + 5 WHERE asiento_id = ? AND haber > 0
                    AND cuenta_id IN (SELECT cuenta_id FROM ledger.cajas)`,
                [asiento.id],
            )
        })
        assert.include(rotas, '9.entrega_de_caja_mal_contabilizada')
        assert.include(rotas, '13.custodia_distinta')
    })

    test('la diferencia de «Recibí» llevada a otra cuenta, o sin asiento, rompe la entrega mal contabilizada', async ({
        assert,
    }) => {
        const { e, turno } = await conEfectivoEnCustodia()
        // el faltante a una cuenta de ingresos en lugar de Faltantes de caja
        const cuenta = await fabricado([e.B, e.C], async (trx) => {
            await sinTriggers(trx, 'ledger.movimientos', 'movimientos_inmutable', 'movimientos_validar')
            const asiento = await trx
                .from('ledger.asientos')
                .where({ origen_tipo: 'entrega_caja', origen_id: turno.entrega_id! })
                .firstOrFail()
            await trx.rawQuery(
                `UPDATE ledger.movimientos SET cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = ? AND empresa_id IS NULL LIMIT 1)
                  WHERE asiento_id = ? AND debe = 10`,
                [CUENTAS.SOBRANTES_CAJA, asiento.id],
            )
        })
        assert.include(cuenta, '9.entrega_de_caja_mal_contabilizada')
        // la recepción desaparece (como DBA): el asiento queda sin su «Recibí»
        const sinRecepcion = await fabricado([e.B, e.C], async (trx) => {
            await sinTriggers(trx, 'ledger.entregas_recepciones', 'entregas_recepciones_inmutable')
            await trx.rawQuery(`DELETE FROM ledger.entregas_recepciones WHERE entrega_id = ?`, [
                turno.entrega_id!,
            ])
        })
        assert.include(sinRecepcion, '9.entrega_de_caja_mal_contabilizada')
        assert.include(sinRecepcion, '13.custodia_distinta')
    })

    test('un asiento entrega_caja sin entrega y una entrega con otra empresa se detectan', async ({
        assert,
    }) => {
        const { e, turno } = await conEfectivoEnCustodia()
        const huerfano = await fabricado([e.B, e.C], async (trx) => {
            await sinTriggers(trx, 'ledger.asientos', 'asientos_inmutable')
            await trx.rawQuery(
                `UPDATE ledger.asientos SET origen_id = origen_id + 100000 WHERE origen_tipo = 'entrega_caja' AND origen_id = ?`,
                [turno.entrega_id!],
            )
        })
        assert.include(huerfano, '9.asiento_de_entrega_sin_entrega')
    })

    test('un depósito desde la custodia atribuido a otra persona, o por más de lo recibido, rompe la custodia por persona', async ({
        assert,
    }) => {
        const { e, deposito } = await conEfectivoEnCustodia()
        const otra = await usuarioConRoles(['contabilidad'])
        const persona = await fabricado([e.B, e.C], async (trx) => {
            await sinTriggers(trx, 'ledger.depositos', 'depositos_inmutable')
            await trx.rawQuery(`UPDATE ledger.depositos SET custodio_id = ? WHERE id = ?`, [
                otra.usuario.id,
                deposito.id,
            ])
        })
        assert.include(persona, '13.custodia_distinta')
        // el depósito pasa de Q100 a Q400 (con su asiento): sale más de lo que se recibió
        const exceso = await fabricado([e.B, e.C], async (trx) => {
            await sinTriggers(trx, 'ledger.depositos', 'depositos_inmutable')
            await sinTriggers(trx, 'ledger.movimientos', 'movimientos_inmutable', 'movimientos_validar')
            await trx.rawQuery(`UPDATE ledger.depositos SET monto = 400 WHERE id = ?`, [deposito.id])
            await trx.rawQuery(
                `UPDATE ledger.movimientos m SET debe = CASE WHEN debe > 0 THEN 400 ELSE 0 END, haber = CASE WHEN haber > 0 THEN 400 ELSE 0 END
                   FROM ledger.asientos a WHERE a.id = m.asiento_id AND a.origen_tipo = 'deposito' AND a.origen_id = ?`,
                [deposito.id],
            )
        })
        assert.include(exceso, '13.custodia_distinta')
    })

    test('un depósito de la custodia que sale de otra cuenta (no 1.1.15) rompe el tránsito mal contabilizado', async ({
        assert,
    }) => {
        const { e, deposito } = await conEfectivoEnCustodia()
        const rotas = await fabricado([e.B, e.C], async (trx) => {
            await sinTriggers(trx, 'ledger.movimientos', 'movimientos_inmutable', 'movimientos_validar')
            await trx.rawQuery(
                `UPDATE ledger.movimientos m SET cuenta_id = (SELECT cuenta_id FROM ledger.cajas WHERE empresa_id = ? LIMIT 1)
                   FROM ledger.asientos a, ledger.cuentas c
                  WHERE a.id = m.asiento_id AND a.origen_tipo = 'deposito' AND a.origen_id = ?
                    AND c.id = m.cuenta_id AND c.codigo = ?`,
                [e.B, deposito.id, CUSTODIA],
            )
        })
        assert.include(rotas, '13.transito_mal_contabilizado')
        assert.include(rotas, '13.custodia_distinta')
    })

    test('un fondo esperado que no es lo que quedó, y una apertura con otro fondo, se detectan', async ({
        assert,
    }) => {
        const { e } = await conEfectivoEnCustodia()
        const cajaId = e.cajas.get(e.B)!
        await new AbrirCaja().execute({ caja_id: cajaId }, e.ctx)
        const turno = await db
            .from('ledger.cajas_turnos')
            .where('caja_id', cajaId)
            .orderBy('id', 'desc')
            .firstOrFail()
        const esperado = await fabricado([e.B, e.C], async (trx) => {
            await sinTriggers(trx, 'ledger.cajas_turnos', 'cajas_turnos_inmutable')
            await trx.rawQuery(`UPDATE ledger.cajas_turnos SET fondo_esperado = 150 WHERE id = ?`, [turno.id])
        })
        assert.include(esperado, '4.fondo_esperado_mal_calculado')
        assert.include(esperado, '4.apertura_con_fondo_distinto_del_esperado')
        // solo la apertura con otro fondo: se ve únicamente con la opción estricta
        const libre = await fabricado([e.B, e.C], async (trx) => {
            await sinTriggers(trx, 'ledger.cajas_turnos', 'cajas_turnos_inmutable')
            await trx.rawQuery(`UPDATE ledger.cajas_turnos SET fondo_inicial = 999.99 WHERE id = ?`, [
                turno.id,
            ])
        })
        assert.include(libre, '4.apertura_con_fondo_distinto_del_esperado')
        assert.notInclude(libre, '4.fondo_esperado_mal_calculado')
        const sinEstricto = await verificarLibro([e.B, e.C], { sinFuncionesProducto: true })
        assert.notInclude(
            sinEstricto.map((v) => v.invariante.split(' ')[0]),
            '4.apertura_con_fondo_distinto_del_esperado',
        )
    })

    test('una entrega por un monto distinto de lo entregado al cerrar, o de un turno sin entrega, rompe la entrega de turno', async ({
        assert,
    }) => {
        const { e, turno } = await conEfectivoEnCustodia()
        const monto = await fabricado([e.B, e.C], async (trx) => {
            await sinTriggers(trx, 'ledger.cajas_turnos', 'cajas_turnos_inmutable')
            await trx.rawQuery(`ALTER TABLE ledger.cajas_turnos DROP CONSTRAINT cajas_turnos_entrega`)
            await trx.rawQuery(
                `UPDATE ledger.cajas_turnos SET entregado_monto = entregado_monto + 1 WHERE id = ?`,
                [turno.id],
            )
        })
        assert.include(monto, '4.entrega_de_turno_mal_calculada')
        const sinEntregado = await fabricado([e.B, e.C], async (trx) => {
            await sinTriggers(trx, 'ledger.cajas_turnos', 'cajas_turnos_inmutable')
            await trx.rawQuery(`ALTER TABLE ledger.cajas_turnos DROP CONSTRAINT cajas_turnos_entrega`)
            await trx.rawQuery(`UPDATE ledger.cajas_turnos SET entregado_a = NULL WHERE id = ?`, [turno.id])
        })
        assert.include(sinEntregado, '4.entrega_de_turno_mal_calculada')
    })

    test('inv. 18: las claves del efectivo se admiten; un cierre con una pendiente o un aviso en anomalía se detecta', async ({
        assert,
    }) => {
        const e = await prepararCajas()
        const mes = DateTime.fromISO(hoyGuatemala(), { zone: 'utc' }).minus({ months: 2 }).startOf('month')
        await new CerrarPeriodo().execute({ empresa_id: e.C, anio: mes.year, mes: mes.month }, e.ctx)
        const periodo = mes.toISODate()!
        const cerrado = await db
            .from('ledger.cierres_mensuales')
            .where({ empresa_id: e.C, periodo })
            .firstOrFail()
        const fila = (clave: string, resultado: 'ok' | 'anomalia', extra: Record<string, unknown> = {}) => ({
            empresa_id: e.C,
            tipo: 'mensual',
            periodo,
            clave,
            automatico: true,
            valor_esperado: '0',
            valor_obtenido: resultado === 'ok' ? '0' : '1',
            resultado,
            estado: resultado === 'ok' ? 'revisado' : 'anomalia',
            created_at: cerrado.created_at,
            ...extra,
        })
        const insertar = (trx: TransactionClientContract, ...filas: Array<ReturnType<typeof fila>>) =>
            trx.insertQuery().table('ledger.cierres_checks').multiInsert(filas)

        // las tres claves en orden: no rompen nada (el aviso siempre ok)
        assert.deepEqual(
            await fabricado([e.B, e.C], async (trx) => {
                await insertar(
                    trx,
                    fila('entregas_recibidas', 'ok'),
                    fila('custodia_cuadra', 'ok'),
                    fila('custodia_en_plazo', 'ok'),
                )
            }),
            [],
        )
        // una pendiente al cerrarse
        assert.include(
            await fabricado([e.B, e.C], async (trx) => {
                await insertar(trx, fila('entregas_recibidas', 'ok'), fila('custodia_cuadra', 'anomalia'))
            }),
            '18.cierre_con_checks_pendientes',
        )
        // calculaba una de las dos y la otra falta: el cierre no las tenía todas
        assert.include(
            await fabricado([e.B, e.C], async (trx) => {
                await insertar(trx, fila('entregas_recibidas', 'ok'))
            }),
            '18.cierre_con_checks_pendientes',
        )
        // el aviso nunca es anomalía
        assert.include(
            await fabricado([e.B, e.C], async (trx) => {
                await insertar(
                    trx,
                    fila('entregas_recibidas', 'ok'),
                    fila('custodia_cuadra', 'ok'),
                    fila('custodia_en_plazo', 'anomalia'),
                )
            }),
            '18.check_mal_formado',
        )
        // una clave del efectivo que no existe
        assert.include(
            await fabricado([e.B, e.C], async (trx) => {
                await insertar(trx, fila('custodia_inventada', 'ok'))
            }),
            '18.check_mal_formado',
        )
    })
})
