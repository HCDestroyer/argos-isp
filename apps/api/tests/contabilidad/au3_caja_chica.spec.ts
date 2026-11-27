import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { contextoPrueba, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import CrearCaja from '#ledger/actions/crear_caja'
import RecibirEntrega from '#ledger/actions/recibir_entrega'
import RegistrarGastoCajaChica from '#ledger/actions/registrar_gasto_caja_chica'
import RegistrarCompraDesdeEgreso from '#ledger/actions/registrar_compra_desde_egreso'
import ReponerCajaChica from '#ledger/actions/reponer_caja_chica'
import ContarCaja from '#ledger/actions/contar_caja'
import AnularEgreso from '#ledger/actions/anular_egreso'
import { estadoCajaChica } from '#ledger/caja_chica'
import { saldoCustodia } from '#ledger/custodia'
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
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, proveedorEn } from '#tests/ledger/ayudas_compras'
import { unicoBd } from '#tests/billing/ayudas_billing'

/**
 * Auditor contable · AU3 · caja chica (B9, plan de contabilidad §5.7). Recorre el camino completo
 * (gasto, gasto con factura que pasa a Compras, reposición desde el banco y desde la custodia,
 * conteo con diferencia) con `verificarLibro` después de **cada paso** (invariantes 4, 9, 13 y 27), y ataca
 * cada invariante nueva con mutaciones como DBA dentro de una transacción que siempre se revierte.
 */

const CUSTODIA = CUENTAS_GT.EFECTIVO_EN_CUSTODIA
const FOTO = { contenido: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]), nombre: 'ticket.jpg' }

async function libroBien(assert: Parameters<typeof afirmarLibro>[0], e: EmpresasGt) {
    await afirmarLibro(assert, [e.B, e.C])
}

/** Mutaciones como DBA en una transacción que se revierte; devuelve las invariantes rotas. */
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
        })
        return [...new Set(violaciones.map((v) => v.invariante.split(' ')[0]!))]
    } finally {
        await trx.rollback()
    }
}

const sinTriggers = (trx: TransactionClientContract, ...tablas: string[]) =>
    Promise.all(tablas.map((t) => trx.rawQuery(`ALTER TABLE ${t} DISABLE TRIGGER USER`)))

function cajaChica(e: EmpresasGt, encargadoId: number | null = null, empresaId = e.B) {
    return new CrearCaja().execute(
        { nombre: unico('Caja chica'), tipo: 'gastos', cajero_id: encargadoId, empresa_id: empresaId },
        e.ctx,
    )
}

const gasto = (cajaId: number, monto: string, extra: Record<string, unknown> = {}) => ({
    caja_id: cajaId,
    categoria: 'vehiculos' as const,
    monto,
    descripcion: 'Combustible moto 2',
    archivo: FOTO,
    ...extra,
})

const desdeBanco = (e: EmpresasGt, cajaId: number, empresaId = e.B) =>
    new ReponerCajaChica().execute(
        {
            caja_id: cajaId,
            desde: 'banco',
            cuenta_bancaria_id: e.cuentas.get(empresaId)!,
            referencia: 'cheque',
        },
        e.ctx,
    )

async function custodiaTexto(empresaId: number, usuarioId: number) {
    const saldo = await saldoCustodia(db.connection(), empresaId, usuarioId)
    return saldo.toFixed(2)
}

/** Custodia de `persona` con Q`monto` de lo cobrado en la caja de cobros de la empresa (entrega recibida). */
async function conCustodia(e: EmpresasGt, persona: { ctx: ReturnType<typeof contextoPrueba>; id: number }) {
    const cobros = e.cajas.get(e.B)!
    const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
    await new RegistrarPago().execute(
        { cliente_id: s.clienteId, metodo: 'caja', monto: '500.00', caja_id: cobros, empresa_id: e.B },
        e.ctx,
    )
    const turno = await new CerrarCaja().execute(
        { caja_id: cobros, contado: '600.00', entregado_a: persona.id },
        e.ctx,
    )
    await new RecibirEntrega().execute({ entrega_id: turno.entrega_id! }, persona.ctx)
}

test.group('Auditor contable · AU3 · caja chica (B9)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('camino completo: gasto, gasto con factura a Compras, reposición desde el banco y la custodia, conteo con diferencia; el libro verificado en cada paso', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const conta = await usuarioConRoles(['contabilidad'])
        const contaCtx = contextoPrueba(conta.usuario.id)
        const encargado = await usuarioConRoles(['cajero'])
        const encargadoCtx = contextoPrueba(encargado.usuario.id)
        await conCustodia(e, { ctx: contaCtx, id: conta.usuario.id })
        await libroBien(assert, e)

        // nace vacía: 0 efectivo, sin fondo vigente
        const caja = await cajaChica(e, encargado.usuario.id)
        const codigo = await codigoCaja(caja.id)
        await libroBien(assert, e)

        // 1. la primera reposición (desde el banco) pone el fondo de Q2,000
        const primera = await desdeBanco(e, caja.id)
        assert.containSubset(primera, {
            origen: 'banco',
            monto: '2000.00',
            fondo: '2000.00',
            efectivo_antes: '0.00',
        })
        assert.equal(await saldoCuenta(e.B, codigo), '2000.00')
        await libroBien(assert, e)

        // 2. un gasto con su comprobante
        const g1 = await new RegistrarGastoCajaChica().execute(gasto(caja.id, '150.00'), encargadoCtx)
        assert.equal(await saldoCuenta(e.B, codigo), '1850.00')
        await libroBien(assert, e)

        // 3. un gasto con factura: se registra igual y pasa a Compras sin tocar el efectivo
        const g2 = await new RegistrarGastoCajaChica().execute(
            gasto(caja.id, '112.00', {
                categoria: 'otros',
                descripcion: 'Papelería con factura',
                con_factura: true,
            }),
            encargadoCtx,
        )
        assert.isTrue(g2.pasar_a_compras)
        await libroBien(assert, e)
        const proveedor = await proveedorEn(e.B, e.ctx)
        const compra = await new RegistrarCompraDesdeEgreso().execute(
            {
                egreso_id: g2.egreso.id,
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: await unicoBd('CC'),
                fecha_documento: haceMeses(0),
                lineas: [{ descripcion: 'Papelería', categoria: 'otros', total: '112.00' }],
            },
            e.ctx,
        )
        assert.equal(compra.egreso_id, g2.egreso.id)
        assert.equal(
            await saldoCuenta(e.B, codigo),
            '1738.00',
            'la compra reclasifica el gasto: el efectivo no se mueve',
        )
        await libroBien(assert, e)

        // 4. conteo con diferencia: faltante de Q10 a cargo del encargado
        const conteo = await new ContarCaja().execute(
            { caja_id: caja.id, contado: '1728.00', motivo: 'faltó un billete de Q10' },
            e.ctx,
        )
        assert.equal(conteo.diferencia, '-10.00')
        assert.deepEqual(await lineas('conteo_caja', conteo.id), [
            [CUENTAS.FALTANTES_CAJA, '10.00', '0.00'],
            [codigo, '0.00', '10.00'],
        ])
        await libroBien(assert, e)
        // un conteo cuadrado no deja asiento y tampoco rompe nada
        const cuadrado = await new ContarCaja().execute({ caja_id: caja.id, contado: '1728.00' }, e.ctx)
        assert.lengthOf(await lineas('conteo_caja', cuadrado.id), 0)
        await libroBien(assert, e)

        // 5. reposición desde la custodia: gastos (150 + 112) + faltante (10) = 272, sale de 1.1.15 de quien repone
        const antesCustodia = await saldoCustodia(db.connection(), e.B, conta.usuario.id)
        const desdeCustodia = await new ReponerCajaChica().execute(
            { caja_id: caja.id, desde: 'custodia', referencia: 'sobre del viernes' },
            contaCtx,
        )
        assert.containSubset(desdeCustodia, {
            origen: 'custodia',
            custodio_id: conta.usuario.id,
            monto: '272.00',
            fondo: '2000.00',
            efectivo_antes: '1728.00',
            gastos: 2,
            conteos: 1,
        })
        assert.deepEqual(await lineas('reposicion_caja', desdeCustodia.id), [
            [codigo, '272.00', '0.00'],
            [CUSTODIA, '0.00', '272.00'],
        ])
        assert.equal(await custodiaTexto(e.B, conta.usuario.id), antesCustodia.minus('272.00').toFixed(2))
        assert.equal(await saldoCuenta(e.B, codigo), '2000.00')
        const sellada = await estadoCajaChica(caja.id)
        assert.containSubset(sellada, {
            cuadra: true,
            efectivo: '2000.00',
            fondo_vigente: '2000.00',
            por_reponer: '0.00',
            comprobantes: { cantidad: 0, monto: '0.00' },
            diferencias: { cantidad: 0, monto: '0.00' },
        })
        await libroBien(assert, e)

        // 6. ciclo siguiente desde el banco: gasto, sobrante en el conteo y reposición que lo descuenta
        await new RegistrarGastoCajaChica().execute(gasto(caja.id, '80.00'), encargadoCtx)
        const sobrante = await new ContarCaja().execute(
            { caja_id: caja.id, contado: '1925.00', motivo: 'sobraron Q5 de un vuelto' },
            e.ctx,
        )
        assert.equal(sobrante.diferencia, '5.00')
        await libroBien(assert, e)
        const segunda = await desdeBanco(e, caja.id)
        assert.containSubset(segunda, {
            monto: '75.00',
            fondo: '2000.00',
            efectivo_antes: '1925.00',
            gastos: 1,
            conteos: 1,
        })
        assert.equal(await saldoCuenta(e.B, codigo), '2000.00')
        await libroBien(assert, e)

        // 7. anular un gasto aún sin reponer devuelve el efectivo y el libro sigue cuadrando; uno sellado no se anula
        const g3 = await new RegistrarGastoCajaChica().execute(gasto(caja.id, '45.00'), encargadoCtx)
        await libroBien(assert, e)
        await new AnularEgreso().execute({ egreso_id: g3.egreso.id, motivo: 'duplicado' }, e.ctx)
        assert.equal(await saldoCuenta(e.B, codigo), '2000.00')
        await libroBien(assert, e)
        const sellado = await errorDe(
            new AnularEgreso().execute({ egreso_id: g1.egreso.id, motivo: 'tarde' }, e.ctx),
        )
        assert.deepEqual([sellado.status, sellado.codigo], [409, 'gasto_repuesto'])
        await libroBien(assert, e)

        // 8. la caja chica de una empresa no toca a la otra: la C no tiene caja chica ni movimientos
        assert.equal(await saldoCuenta(e.C, CUSTODIA), '0')
        assert.deepEqual(await verificarLibro([e.C]), [])
    })

    test('multiempresa: dos cajas chicas con su fondo cada una, la misma persona repone en las dos desde su custodia por empresa', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const conta = await usuarioConRoles(['contabilidad'])
        const contaCtx = contextoPrueba(conta.usuario.id)
        // custodia de la persona en B (Q400) y en C (Q200)
        await conCustodia(e, { ctx: contaCtx, id: conta.usuario.id })
        const cobrosC = e.cajas.get(e.C)!
        const sC = await servicioFacturado(e.C, '2026-10-01', { instalacion: '2026-09-01' })
        await new RegistrarPago().execute(
            { cliente_id: sC.clienteId, metodo: 'caja', monto: '300.00', caja_id: cobrosC, empresa_id: e.C },
            e.ctx,
        )
        const turnoC = await new CerrarCaja().execute(
            { caja_id: cobrosC, contado: '400.00', entregado_a: conta.usuario.id },
            e.ctx,
        )
        await new RecibirEntrega().execute({ entrega_id: turnoC.entrega_id! }, contaCtx)
        await libroBien(assert, e)

        const chicaB = await cajaChica(e, null, e.B)
        const chicaC = await cajaChica(e, null, e.C)
        // una caja chica no se repone con el banco de otra empresa
        const cruzada = await errorDe(
            new ReponerCajaChica().execute(
                { caja_id: chicaB.id, desde: 'banco', cuenta_bancaria_id: e.cuentas.get(e.C)! },
                e.ctx,
            ),
        )
        assert.deepEqual([cruzada.status, cruzada.reglas], [422, ['cuenta_de_otra_empresa']])
        await desdeBanco(e, chicaB.id, e.B)
        await desdeBanco(e, chicaC.id, e.C)
        await new RegistrarGastoCajaChica().execute(gasto(chicaB.id, '120.00'), e.ctx)
        await new RegistrarGastoCajaChica().execute(gasto(chicaC.id, '60.00'), e.ctx)
        await libroBien(assert, e)

        await new ReponerCajaChica().execute({ caja_id: chicaB.id, desde: 'custodia' }, contaCtx)
        await new ReponerCajaChica().execute({ caja_id: chicaC.id, desde: 'custodia' }, contaCtx)
        assert.equal(await saldoCuenta(e.B, await codigoCaja(chicaB.id)), '2000.00')
        assert.equal(await saldoCuenta(e.C, await codigoCaja(chicaC.id)), '2000.00')
        // cada custodia bajó solo por lo repuesto en su empresa
        assert.equal(await custodiaTexto(e.B, conta.usuario.id), '280.00')
        assert.equal(await custodiaTexto(e.C, conta.usuario.id), '140.00')
        await libroBien(assert, e)

        await libroBien(assert, e)
    })

    test('mutaciones: cada invariante de la caja chica (27) detecta lo que le toca', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const conta = await usuarioConRoles(['contabilidad'])
        const contaCtx = contextoPrueba(conta.usuario.id)
        const otra = await usuarioConRoles(['contabilidad'])
        await conCustodia(e, { ctx: contaCtx, id: conta.usuario.id })
        const caja = await cajaChica(e)
        await desdeBanco(e, caja.id)
        const g = await new RegistrarGastoCajaChica().execute(gasto(caja.id, '100.00'), e.ctx)
        const conteo = await new ContarCaja().execute(
            { caja_id: caja.id, contado: '1895.00', motivo: 'faltan Q5' },
            e.ctx,
        )
        const repo = await new ReponerCajaChica().execute({ caja_id: caja.id, desde: 'custodia' }, contaCtx)
        const g2 = await new RegistrarGastoCajaChica().execute(gasto(caja.id, '30.00'), e.ctx)
        await libroBien(assert, e)
        const filaCaja = await db.from('ledger.cajas').where('id', caja.id).select('cuenta_id').firstOrFail()
        const cuentaCaja = Number(filaCaja.cuenta_id)
        const sin = (rotas: string[], esperada: string) =>
            assert.include(rotas, esperada, `debía detectarse ${esperada}; salió: ${rotas.join(', ')}`)

        // a. un gasto metido a mano en la caja chica, sin asiento ni comprobante
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.egresos')
                await trx.rawQuery(
                    `INSERT INTO ledger.egresos (empresa_id, categoria_id, monto, metodo, caja_id, fecha, descripcion)
                     SELECT empresa_id, categoria_id, 77.00, 'caja', caja_id, fecha, 'a mano' FROM ledger.egresos WHERE id = ?`,
                    [g2.egreso.id],
                )
            }),
            '27.caja_chica_no_cuadra',
        )
        // b. el efectivo del libro baja sin gasto ni conteo (un movimiento de la caja cambia de cuenta)
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.movimientos')
                await trx.rawQuery(
                    `UPDATE ledger.movimientos SET haber = haber + 1 WHERE id = (SELECT m.id FROM ledger.movimientos m
                       JOIN ledger.asientos a ON a.id = m.asiento_id WHERE a.origen_tipo = 'egreso' AND a.origen_id = ? AND m.haber > 0)`,
                    [g2.egreso.id],
                )
            }),
            '27.caja_chica_no_cuadra',
        )
        // c. la reposición cambia de monto y de fondo (el CHECK se cumple) pero el asiento sigue en el viejo
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.reposiciones')
                await trx.rawQuery(
                    `UPDATE ledger.reposiciones SET monto = monto + 10, fondo = fondo + 10 WHERE id = ?`,
                    [repo.id],
                )
            }),
            '27.reposicion_mal_contabilizada',
        )
        // d. el comprobante de un gasto sellado desaparece
        const sellado = await verificarLibro([e.B])
        assert.deepEqual(sellado, [])
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.egresos_comprobantes')
                await trx.rawQuery(`DELETE FROM ledger.egresos_comprobantes WHERE egreso_id = ?`, [
                    g.egreso.id,
                ])
            }),
            '27.reposicion_distinta_de_sus_documentos',
        )
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.egresos_comprobantes')
                await trx.rawQuery(`DELETE FROM ledger.egresos_comprobantes WHERE egreso_id = ?`, [
                    g.egreso.id,
                ])
            }),
            '27.gasto_de_caja_chica_mal',
        )
        // e. un gasto sellado se anula por debajo (sin pasar por la acción)
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.egresos_anulaciones')
                await trx.rawQuery(
                    `INSERT INTO ledger.egresos_anulaciones (egreso_id, asiento_id, motivo)
                     SELECT e.id, (SELECT min(id) FROM ledger.asientos WHERE origen_tipo = 'egreso' AND origen_id = e.id), 'por debajo'
                       FROM ledger.egresos e WHERE e.id = ?`,
                    [g.egreso.id],
                )
            }),
            '27.reposicion_distinta_de_sus_documentos',
        )
        // f. el conteo cambia de diferencia (y de contado) sin tocar su asiento
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.conteos_caja')
                await trx.rawQuery(
                    `UPDATE ledger.conteos_caja SET contado = contado + 2, diferencia = diferencia + 2 WHERE id = ?`,
                    [conteo.id],
                )
            }),
            '27.conteo_mal_contabilizado',
        )
        // g. la reposición dice que salió de la custodia de otra persona
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.reposiciones')
                await trx.rawQuery(`UPDATE ledger.reposiciones SET custodio_id = ? WHERE id = ?`, [
                    otra.usuario.id,
                    repo.id,
                ])
            }),
            '13.custodia_distinta',
        )
        // h. un turno y un cobro en la caja chica
        sin(
            await fabricado([e.B], async (trx) => {
                await trx.rawQuery(`INSERT INTO ledger.cajas_turnos (caja_id, fondo_inicial) VALUES (?, 0)`, [
                    caja.id,
                ])
            }),
            '27.caja_chica_con_turnos_cobros_o_pagos',
        )
        // i. un pago a un proveedor desde la caja chica
        sin(
            await fabricado([e.B], async (trx) => {
                const proveedor = await proveedorEn(e.B, e.ctx)
                await sinTriggers(trx, 'ledger.pagos_proveedores')
                await trx.rawQuery(
                    `INSERT INTO ledger.pagos_proveedores (empresa_id, proveedor_id, fecha, metodo, caja_id, cuenta_id, monto)
                     VALUES (?, ?, current_date, 'caja', ?, ?, 1.00)`,
                    [e.B, proveedor.id, caja.id, cuentaCaja],
                )
            }),
            '27.caja_chica_con_turnos_cobros_o_pagos',
        )
        // j. la reposición sale del banco que no es de la empresa del documento (otra cuenta del libro)
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.reposiciones')
                await trx.rawQuery(
                    `UPDATE ledger.reposiciones SET cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = ? AND empresa_id IS NULL LIMIT 1)
                      WHERE id = ?`,
                    [CUENTAS.GASTO_OTROS, repo.id],
                )
            }),
            '27.reposicion_mal_contabilizada',
        )
        // nada de lo anterior quedó en la base
        assert.deepEqual(await verificarLibro([e.B, e.C]), [])
    })
})
