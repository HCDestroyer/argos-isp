import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import CrearConceptoCargo from '#billing/actions/crear_concepto_cargo'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CrearCaja from '#ledger/actions/crear_caja'
import EditarCaja from '#ledger/actions/editar_caja'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import AnularEgreso from '#ledger/actions/anular_egreso'
import RegistrarGastoCajaChica from '#ledger/actions/registrar_gasto_caja_chica'
import RegistrarCompraDesdeEgreso from '#ledger/actions/registrar_compra_desde_egreso'
import ReponerCajaChica from '#ledger/actions/reponer_caja_chica'
import { facturaNoFiscal, listarRecibos, reciboDePago } from '#billing/recibos'
import { listarCajas } from '#ledger/cajas'
import { libroDiario, libroMayor, listarCuentas } from '#ledger/consultas'
import { balanceSaldos, estadoResultados } from '#ledger/estados_financieros'
import { resultadosDelRango } from '#fiscal/declaraciones_renta'
import { construirLibro } from '#fiscal/libros_legales'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { codigoCaja, errorDe, lineas } from '#tests/contabilidad/ayudas_contabilidad'
import type { Empresas } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { proveedorEn, haceMeses } from '#tests/ledger/ayudas_compras'
import { unicoBd } from '#tests/billing/ayudas_billing'
import {
    IVA_POR_CERTIFICAR,
    cola,
    datosNit,
    dtesDe,
    empresasFel,
    factura,
    saldo,
    servicioFel,
} from '#tests/fiscal/ayudas_fel'

/**
 * Auditor contable · AU3 · caja sin factura y cargos no facturables (B11, plan de contabilidad §5.7 y
 * `contratos/fel-establecimientos.md` lote 3). Cobro con recibo, factura fuera de la SAT, cargo no
 * facturable, gasto interno, anulación del pago, visibilidad por usuario y multiempresa, con
 * `verificarLibro` después de **cada paso** (invariantes 4, 9, 12, 13, 27 y 28), más mutaciones como DBA
 * dentro de una transacción que siempre se revierte.
 */

const INTERNOS: string = CUENTAS_GT.INGRESOS_INTERNOS
const GASTOS_INTERNOS: string = CUENTAS_GT.GASTOS_INTERNOS
const FOTO = { contenido: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 4, 3]), nombre: 'recibo.jpg' }

async function libroBien(assert: Parameters<typeof afirmarLibro>[0], e: Empresas) {
    await afirmarLibro(assert, [e.B, e.C])
}

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

async function estadoFactura(id: number) {
    const f = await factura(id)
    return f.estado
}
async function ivaFactura(id: number) {
    const f = await factura(id)
    return f.iva
}
async function motivoMarca(id: number) {
    const m = await facturaNoFiscal(db.connection(), id)
    return m?.motivo
}
async function estadoDte(id: number) {
    const d = await dtesDe('factura', id)
    return d[0]?.estado
}
async function cuentasDeFactura(id: number) {
    const l = await lineas('factura', id)
    return l.map((x) => x[0]).sort()
}
async function totalRecibos(empresaId: number) {
    const fila = await db.from('billing.recibos').where('empresa_id', empresaId).count('* as n').first()
    return Number(fila?.n)
}
async function idDe(promesa: Promise<{ id: number }>) {
    const r = await promesa
    return r.id
}
async function idsDeCajas(empresaId: number, usuarioId: number) {
    const cajas = await listarCajas(undefined, [empresaId], undefined, usuarioId)
    return cajas.map((c) => c.id)
}

/** Caja de cobros sin factura de la empresa, abierta. */
async function cajaSinFactura(e: Empresas, empresaId = e.B, usuarios: number[] = []) {
    const caja = await new CrearCaja().execute(
        { nombre: unico('Caja sin factura'), empresa_id: empresaId, fiscal: false, usuarios },
        e.ctx,
    )
    await new AbrirCaja().execute({ caja_id: caja.id }, e.ctx)
    return caja
}

const cobrar = (e: Empresas, clienteId: number, monto: string, cajaId: number, empresaId = e.B) =>
    new RegistrarPago().execute(
        { cliente_id: clienteId, metodo: 'caja', monto, caja_id: cajaId, empresa_id: empresaId },
        e.ctx,
    )

/** Libro de ventas del año de la empresa: filas que no son el total. */
async function filasDeVentas(empresaId: number) {
    const libro = await construirLibro('ventas', empresaId, { desde: '2026-01-01', hasta: '2026-12-31' })
    return libro.reporte.filas.filter((f) => f.fila !== 'total')
}

test.group('Auditor contable · AU3 · caja sin factura (B11)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('cobro con recibo, factura fuera de la SAT y anulación del pago: el libro verificado en cada paso, con FEL obligatoria', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const caja = await cajaSinFactura(e)
        await libroBien(assert, e)
        const s = await servicioFel(e, 'pagar', '112.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await libroBien(assert, e)

        // pago parcial: recibo 1, la factura sigue siendo aviso (IVA en 2.1.11) y nada va a 4.3.01
        const p1 = await cobrar(e, s.clienteId, '12.00', caja.id)
        assert.containSubset(await reciboDePago(p1.id), {
            numero: 1,
            motivo: 'caja_sin_factura',
            monto: '12.00',
        })
        assert.equal(await saldo(e.B, INTERNOS), '0.00')
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '-12.00')
        await libroBien(assert, e)

        // el pago que la completa: sale de la SAT, base e IVA por certificar pasan a 4.3.01
        const p2 = await cobrar(e, s.clienteId, '100.00', caja.id)
        assert.containSubset(await reciboDePago(p2.id), { numero: 2, facturas_no_fiscales: [f.id] })
        const marca = await facturaNoFiscal(db.connection(), f.id)
        assert.deepEqual(await lineas('recibo_interno', marca!.id), [
            [CUENTAS.INGRESOS_INTERNET, '100.00', '0.00'],
            [IVA_POR_CERTIFICAR, '12.00', '0.00'],
            [INTERNOS, '0.00', '112.00'],
        ])
        assert.equal(await saldo(e.B, INTERNOS), '-112.00')
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '0.00')
        assert.equal(await saldo(e.B, CUENTAS.IVA_DEBITO), '0.00', 'ningún IVA débito: no hay factura fiscal')
        assert.equal(await saldo(e.B, CUENTAS.INGRESOS_INTERNET), '0.00')
        await libroBien(assert, e)

        // la cola FEL no la toma, no hay DTE ni fila en el libro de ventas
        await cola(e)
        assert.lengthOf(await dtesDe('factura', f.id), 0)
        assert.lengthOf(await filasDeVentas(e.B), 0)
        await libroBien(assert, e)

        // el resultado de la renta no ve la cuenta interna: la factura no suma ingreso gravado
        const renta = await resultadosDelRango(db.connection(), e.B, '2026-01-01', '2026-12-31')
        assert.equal(renta.ingresos.toFixed(2), '0.00')

        // anular el pago que la completó: la factura vuelve a ser aviso (IVA a 2.1.11), 4.3.01 en cero
        await new AnularPago().execute({ pago_id: p2.id, motivo: 'billete falso' }, e.ctx)
        assert.isNull(await facturaNoFiscal(db.connection(), f.id))
        assert.equal(await saldo(e.B, INTERNOS), '0.00')
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '-12.00')
        assert.equal(await saldo(e.B, CUENTAS.INGRESOS_INTERNET), '-100.00')
        await libroBien(assert, e)
        // el recibo del pago anulado queda como historia (el número no se reutiliza)
        assert.containSubset(await reciboDePago(p2.id), { numero: 2, anulado: true })
        await libroBien(assert, e)

        // se vuelve a cobrar, ahora en una caja fiscal: se certifica entera y el recibo no se repite
        await cobrar(e, s.clienteId, '100.00', e.cajas.get(e.B)!)
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.equal(dte?.estado, 'certificado')
        assert.equal(await estadoFactura(f.id), 'pagada')
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '0.00')
        assert.equal(await saldo(e.B, CUENTAS.IVA_DEBITO), '-12.00')
        assert.equal(await saldo(e.B, INTERNOS), '0.00')
        await libroBien(assert, e)
        assert.lengthOf(await filasDeVentas(e.B), 1)
        assert.equal(await totalRecibos(e.B), 2, 'el pago en la caja fiscal no emite recibo')
        await libroBien(assert, e)
    })

    test('pago repartido: si algo se cobró en una caja fiscal, la factura se certifica entera y la caja sin factura igual entrega su recibo', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const caja = await cajaSinFactura(e)
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await cobrar(e, s.clienteId, '50.00', e.cajas.get(e.B)!)
        await libroBien(assert, e)
        const p = await cobrar(e, s.clienteId, '100.00', caja.id)
        assert.containSubset(await reciboDePago(p.id), { numero: 1, facturas_no_fiscales: [] })
        assert.isNull(await facturaNoFiscal(db.connection(), f.id))
        assert.equal(await saldo(e.B, INTERNOS), '0.00')
        await libroBien(assert, e)
        await cola(e)
        assert.equal(await estadoDte(f.id), 'certificado')
        await libroBien(assert, e)
    })

    test('multiempresa: cada empresa numera sus recibos desde 1 sin huecos, y sus cuentas internas no se mezclan', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const cajaB = await cajaSinFactura(e, e.B)
        const cajaC = await cajaSinFactura(e, e.C)
        const cliente = await crearClienteFila(datosNit())
        const sB = await servicioFel(e, 'pagar', '112.00', cliente, e.B)
        const sC1 = await servicioFel(e, 'pagar', '224.00', await crearClienteFila(datosNit()), e.C)
        const pagos: number[] = []
        // intercaladas: B, C, C, B
        pagos.push(await idDe(cobrar(e, sB.clienteId, '60.00', cajaB.id, e.B)))
        pagos.push(await idDe(cobrar(e, sC1.clienteId, '100.00', cajaC.id, e.C)))
        pagos.push(await idDe(cobrar(e, sC1.clienteId, '124.00', cajaC.id, e.C)))
        pagos.push(await idDe(cobrar(e, sB.clienteId, '52.00', cajaB.id, e.B)))
        const numeros = await Promise.all(pagos.map(async (id) => (await reciboDePago(id))!.numero))
        assert.deepEqual(numeros, [1, 1, 2, 2])
        assert.equal(await saldo(e.B, INTERNOS), '-112.00')
        assert.equal(await saldo(e.C, INTERNOS), '-224.00')
        await libroBien(assert, e)
        // un pago que falla no gasta número: la factura ya está cubierta, no se acepta una caja de otra empresa
        const ajena = await errorDe(cobrar(e, sB.clienteId, '10.00', cajaC.id, e.B))
        assert.isAtLeast(ajena.status, 400)
        const otro = await cobrar(e, sB.clienteId, '10.00', cajaB.id, e.B)
        assert.equal((await reciboDePago(otro.id))!.numero, 3)
        await libroBien(assert, e)
        // el reporte consolidado trae los de las dos y el de una empresa solo los suyos
        const consolidado = await listarRecibos({ limit: 50 }, [e.B, e.C])
        assert.lengthOf(consolidado.data, 5)
        const soloB = await listarRecibos({ limit: 50 }, [e.B])
        assert.deepEqual(soloB.data.map((r) => r.numero).sort(), [1, 2, 3])
        assert.isTrue(soloB.data.every((r) => r.empresa_id === e.B))
    })

    test('cargo no facturable: sin IVA, a 4.3.01, sin DTE; su cobro emite recibo aunque la caja sea fiscal, y una nota de crédito lo reduce en 4.3.01', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const concepto = await new CrearConceptoCargo().execute(
            {
                empresa_id: e.B,
                nombre: unico('Permiso de poste'),
                tipo: 'otro',
                cuenta_codigo: CUENTAS.OTROS_INGRESOS,
                facturable: false,
            },
            e.ctx,
        )
        const clienteId = await crearClienteFila(datosNit())
        const cargo = await new EmitirCargoUnico().execute(
            {
                cliente_id: clienteId,
                empresa_id: e.B,
                lineas: [{ concepto_id: concepto.id, precio_unitario: '50.00' }],
            },
            e.ctx,
        )
        assert.equal(await ivaFactura(cargo.id), '0.00')
        assert.equal(await motivoMarca(cargo.id), 'cargo_no_facturable')
        assert.deepEqual(await cuentasDeFactura(cargo.id), [CUENTAS.CXC_CLIENTES, INTERNOS].sort())
        assert.equal(await saldo(e.B, INTERNOS), '-50.00')
        assert.equal(await saldo(e.B, CUENTAS.OTROS_INGRESOS), '0.00')
        await libroBien(assert, e)
        await cola(e)
        assert.lengthOf(await dtesDe('factura', cargo.id), 0)
        assert.lengthOf(await filasDeVentas(e.B), 0)
        await libroBien(assert, e)

        // cobro en una caja fiscal: recibo de cargo no facturable
        const p = await cobrar(e, clienteId, '30.00', e.cajas.get(e.B)!)
        assert.containSubset(await reciboDePago(p.id), {
            motivo: 'cargo_no_facturable',
            numero: 1,
            monto: '30.00',
        })
        await libroBien(assert, e)

        // nota de crédito: debita 4.3.01 (su cuenta), nunca 4.1.xx ni IVA
        await new EmitirNotaCredito().execute(
            { factura_id: cargo.id, monto: '10.00', motivo: 'descuento' },
            e.ctx,
        )
        assert.equal(await saldo(e.B, INTERNOS), '-40.00')
        await libroBien(assert, e)

        // el resto, en una caja sin factura: otro recibo; la marca ya existe y no hay asiento recibo_interno
        const sf = await cajaSinFactura(e)
        const p2 = await cobrar(e, clienteId, '10.00', sf.id)
        assert.containSubset(await reciboDePago(p2.id), {
            motivo: 'caja_sin_factura',
            numero: 2,
            facturas_no_fiscales: [],
        })
        assert.equal(await saldo(e.B, INTERNOS), '-40.00')
        await libroBien(assert, e)

        // un cargo facturable del mismo cliente sigue su camino normal (factura, IVA, DTE)
        const normal = await new CrearConceptoCargo().execute(
            { empresa_id: e.B, nombre: unico('Visita'), tipo: 'otro', cuenta_codigo: CUENTAS.OTROS_INGRESOS },
            e.ctx,
        )
        const cargoNormal = await new EmitirCargoUnico().execute(
            {
                cliente_id: clienteId,
                empresa_id: e.B,
                lineas: [{ concepto_id: normal.id, precio_unitario: '112.00' }],
            },
            e.ctx,
        )
        assert.isNull(await facturaNoFiscal(db.connection(), cargoNormal.id))
        assert.equal(await saldo(e.B, INTERNOS), '-40.00')
        await libroBien(assert, e)
        // anular el pago del cargo interno no devuelve nada a la SAT: ya nació fuera
        await new AnularPago().execute({ pago_id: p.id, motivo: 'cheque rechazado' }, e.ctx)
        assert.equal(await motivoMarca(cargo.id), 'cargo_no_facturable')
        assert.equal(await saldo(e.B, INTERNOS), '-40.00')
        await libroBien(assert, e)
    })

    test('gasto interno: el egreso de una caja sin factura va a 5.7.01 (no deducible), también el de una caja chica sin factura; anular lo revierte; no pasan a Compras', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const caja = await cajaSinFactura(e)
        // la vía de siempre (todavía sin caja chica en la empresa): egreso desde el turno de la caja sin factura
        const eg = await new RegistrarEgreso().execute(
            { categoria: 'otros', monto: '40.00', metodo: 'caja', caja_id: caja.id, descripcion: 'propina' },
            e.ctx,
        )
        assert.equal(eg.cuenta_codigo, GASTOS_INTERNOS)
        assert.deepEqual(await lineas('egreso', eg.id), [
            [GASTOS_INTERNOS, '40.00', '0.00'],
            [await codigoCaja(caja.id), '0.00', '40.00'],
        ])
        assert.equal(await saldo(e.B, GASTOS_INTERNOS), '40.00')
        assert.equal(await saldo(e.B, CUENTAS.GASTO_OTROS), '0.00')
        await libroBien(assert, e)
        // sin factura no hay compra: no se pasa a Compras
        const proveedor = await proveedorEn(e.B, e.ctx)
        const aCompras = await errorDe(
            new RegistrarCompraDesdeEgreso().execute(
                {
                    egreso_id: eg.id,
                    proveedor_id: proveedor.id,
                    tipo_documento: 'FACT',
                    numero: await unicoBd('SF'),
                    fecha_documento: haceMeses(0),
                    lineas: [{ descripcion: 'x', categoria: 'otros', total: '40.00' }],
                },
                e.ctx,
            ),
        )
        assert.deepEqual([aCompras.status, aCompras.codigo], [409, 'egreso_sin_factura'])
        await new AnularEgreso().execute({ egreso_id: eg.id, motivo: 'error' }, e.ctx)
        assert.equal(await saldo(e.B, GASTOS_INTERNOS), '0.00')
        await libroBien(assert, e)

        // caja chica sin factura: reposición desde el banco, gasto interno y la invariante de la caja chica
        const chica = await new CrearCaja().execute(
            { nombre: unico('Chica sin factura'), tipo: 'gastos', fiscal: false, empresa_id: e.B },
            e.ctx,
        )
        await new ReponerCajaChica().execute(
            { caja_id: chica.id, desde: 'banco', cuenta_bancaria_id: e.cuentas.get(e.B)! },
            e.ctx,
        )
        await libroBien(assert, e)
        const g = await new RegistrarGastoCajaChica().execute(
            {
                caja_id: chica.id,
                categoria: 'otros',
                monto: '300.00',
                descripcion: 'Paso por terreno',
                archivo: FOTO,
            },
            e.ctx,
        )
        assert.equal(g.egreso.cuenta_codigo, GASTOS_INTERNOS)
        assert.equal(await saldo(e.B, GASTOS_INTERNOS), '300.00')
        await libroBien(assert, e)
        // ya con caja chica, la caja de cobros sin factura no paga gastos (N2)
        const n2 = await errorDe(
            new RegistrarEgreso().execute(
                { categoria: 'otros', monto: '5.00', metodo: 'caja', caja_id: caja.id, descripcion: 'x' },
                e.ctx,
            ),
        )
        assert.deepEqual([n2.status, n2.codigo], [422, 'gasto_desde_caja_chica'])
        // el gasto normal de la caja chica fiscal de otra empresa no toca 5.7.01
        assert.equal(await saldo(e.C, GASTOS_INTERNOS), '0.00')
        await libroBien(assert, e)
        // la reposición repone el gasto interno y el efectivo vuelve al fondo
        await new ReponerCajaChica().execute(
            { caja_id: chica.id, desde: 'banco', cuenta_bancaria_id: e.cuentas.get(e.B)! },
            e.ctx,
        )
        await libroBien(assert, e)
        // el ISR no ve el gasto interno
        const renta = await resultadosDelRango(db.connection(), e.B, '2026-01-01', '2026-12-31')
        assert.equal(renta.gastos.toFixed(2), '0.00')
    })

    test('cambiar la bandera fiscal de una caja con historia no rompe ningún documento: el recibo y la marca conservan lo de su día', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const caja = await cajaSinFactura(e)
        const s = await servicioFel(e, 'pagar', '112.00', await crearClienteFila(datosNit()))
        const p = await cobrar(e, s.clienteId, '112.00', caja.id)
        await libroBien(assert, e)
        const hoy = await db.from('ledger.cajas').where('id', caja.id).firstOrFail()
        await new EditarCaja().execute({ caja_id: caja.id, version: hoy.version, fiscal: true }, e.ctx)
        await libroBien(assert, e)
        // y un cobro nuevo en la caja ya fiscal no emite recibo
        const s2 = await servicioFel(e, 'pagar', '112.00', await crearClienteFila(datosNit()))
        const p2 = await cobrar(e, s2.clienteId, '112.00', caja.id)
        assert.isNull(await reciboDePago(p2.id))
        assert.containSubset(await reciboDePago(p.id), { numero: 1 })
        await libroBien(assert, e)
        // otra caja sin factura con historia: cambiada por debajo (sin la acción, sin audit.cambios) sí la detecta el auditor
        const otra = await cajaSinFactura(e)
        const s3 = await servicioFel(e, 'pagar', '112.00', await crearClienteFila(datosNit()))
        await cobrar(e, s3.clienteId, '112.00', otra.id)
        await libroBien(assert, e)
        const silenciosa = await fabricado([e.B], async (trx) => {
            await trx.rawQuery(`UPDATE ledger.cajas SET fiscal = true WHERE id = ?`, [otra.id])
        })
        assert.include(silenciosa, '28.recibo_mal_ligado')
        // la que cambió con la acción deja su rastro y sus documentos viejos siguen siendo válidos aunque la bandera cambie otra vez
        const conRastro = await fabricado([e.B], async (trx) => {
            await trx.rawQuery(`UPDATE ledger.cajas SET fiscal = false WHERE id = ?`, [caja.id])
        })
        assert.deepEqual(conRastro, [])
    })

    test('visibilidad por usuario: la caja sin factura solo la ve su lista; sin el permiso, las cuentas internas salen agregadas y los totales no cambian', async ({
        assert,
        client,
    }) => {
        const e = await empresasFel('obligatoria')
        const dentro = await usuarioConRoles(['cajero'])
        const fuera = await usuarioConRoles(['cajero'])
        const conta = await usuarioConRoles(['contabilidad'])
        const caja = await cajaSinFactura(e, e.B, [dentro.usuario.id])
        const s = await servicioFel(e, 'pagar', '112.00', await crearClienteFila(datosNit()))
        await cobrar(e, s.clienteId, '112.00', caja.id)
        const eg = await new RegistrarEgreso().execute(
            { categoria: 'otros', monto: '25.00', metodo: 'caja', caja_id: caja.id, descripcion: 'propina' },
            e.ctx,
        )
        assert.equal(eg.cuenta_codigo, GASTOS_INTERNOS)
        await libroBien(assert, e)

        // cajas: quien está en la lista y quien tiene el permiso la ven; los demás no, ni por la API
        const ids = (usuarioId: number) => idsDeCajas(e.B, usuarioId)
        assert.include(await ids(dentro.usuario.id), caja.id)
        assert.include(await ids(conta.usuario.id), caja.id)
        assert.notInclude(await ids(fuera.usuario.id), caja.id)
        const lista = await client
            .get('/api/v1/cajas')
            .bearerToken(fuera.token)
            .header('X-Empresa-Id', String(e.B))
        assert.isFalse((lista.body() as Array<{ id: number }>).some((c) => c.id === caja.id))
        const turnos = await client
            .get(`/api/v1/cajas/${caja.id}/turnos`)
            .bearerToken(fuera.token)
            .header('X-Empresa-Id', String(e.B))
        assert.equal(turnos.status(), 404)
        // el reporte de recibos exige el permiso
        const recibos = await client
            .get('/api/v1/recibos')
            .bearerToken(fuera.token)
            .header('X-Empresa-Id', String(e.B))
        assert.equal(recibos.status(), 403)
        const recibosConta = await client
            .get('/api/v1/recibos')
            .bearerToken(conta.token)
            .header('X-Empresa-Id', String(e.B))
        assert.equal(recibosConta.status(), 200)

        // plan de cuentas, diario y mayor
        const completas = await listarCuentas(null, true)
        const sinInternas = await listarCuentas(null, false)
        const codigos = (cs: Array<{ codigo: string }>) => cs.map((c) => c.codigo)
        assert.includeMembers(codigos(completas), [INTERNOS, GASTOS_INTERNOS])
        assert.notIncludeMembers(codigos(sinInternas), [INTERNOS])
        assert.notIncludeMembers(codigos(sinInternas), [GASTOS_INTERNOS])
        const interna = completas.find((c: { codigo: string }) => c.codigo === INTERNOS) as { id: number }
        const mayor = await errorDe(libroMayor({ cuenta_id: interna.id, limit: 10 }, [e.B], false))
        assert.deepEqual([mayor.status, mayor.codigo], [403, 'cuenta_interna_restringida'])
        const diarioFull = await libroDiario({ limit: 100 }, [e.B], true)
        const diarioRestringido = await libroDiario({ limit: 100 }, [e.B], false)
        const conInterna = (d: typeof diarioFull) =>
            d.data.filter((a) =>
                a.movimientos.some((m) => [INTERNOS, GASTOS_INTERNOS].includes(String(m.cuenta_codigo))),
            )
        assert.isAbove(conInterna(diarioFull).length, 0)
        assert.lengthOf(conInterna(diarioRestringido), 0)

        // balance y estado de resultados: las internas agregadas, los totales iguales y cuadrando
        const completo = await balanceSaldos({}, [e.B], true)
        const restringido = await balanceSaldos({}, [e.B], false)
        assert.deepEqual(restringido.total.totales, completo.total.totales)
        assert.isFalse(restringido.total.cuentas.some((c) => [INTERNOS, GASTOS_INTERNOS].includes(c.codigo)))
        const agregadas = restringido.total.cuentas.filter((c) => c.nombre === 'Interno (restringido)')
        assert.lengthOf(agregadas, 2)
        assert.deepEqual(agregadas.map((c) => [c.tipo, c.saldo]).sort(), [
            ['gasto', '25.00'],
            ['ingreso', '112.00'],
        ])
        const resCompleto = await estadoResultados({ desde: '2026-01-01' }, [e.B], true)
        const resRestringido = await estadoResultados({ desde: '2026-01-01' }, [e.B], false)
        assert.deepEqual(resRestringido.total.totales, resCompleto.total.totales)
        assert.isFalse(
            resRestringido.total.cuentas.some((c) => [INTERNOS, GASTOS_INTERNOS].includes(c.codigo)),
        )
        // ninguna de las dos cuentas entra a la renta
        const renta = await resultadosDelRango(db.connection(), e.B, '2026-01-01', '2026-12-31')
        assert.deepEqual([renta.ingresos.toFixed(2), renta.gastos.toFixed(2)], ['0.00', '0.00'])
        await libroBien(assert, e)
    })

    test('mutaciones: cada invariante de la caja sin factura (28) detecta lo que le toca', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const caja = await cajaSinFactura(e)
        const s = await servicioFel(e, 'pagar', '112.00', await crearClienteFila(datosNit()))
        await cobrar(e, s.clienteId, '112.00', caja.id)
        const s2 = await servicioFel(e, 'pagar', '224.00', await crearClienteFila(datosNit()))
        await cobrar(e, s2.clienteId, '224.00', caja.id)
        const concepto = await new CrearConceptoCargo().execute(
            {
                empresa_id: e.B,
                nombre: unico('Permiso'),
                tipo: 'otro',
                cuenta_codigo: CUENTAS.OTROS_INGRESOS,
                facturable: false,
            },
            e.ctx,
        )
        const cargo = await new EmitirCargoUnico().execute(
            {
                cliente_id: await crearClienteFila(datosNit()),
                empresa_id: e.B,
                lineas: [{ concepto_id: concepto.id, precio_unitario: '50.00' }],
            },
            e.ctx,
        )
        const eg = await new RegistrarEgreso().execute(
            { categoria: 'otros', monto: '40.00', metodo: 'caja', caja_id: caja.id, descripcion: 'propina' },
            e.ctx,
        )
        const f = s.facturas[0]!
        const marca = (await facturaNoFiscal(db.connection(), f.id))!
        await libroBien(assert, e)
        const sin = (rotas: string[], esperada: string) =>
            assert.include(rotas, esperada, `debía detectarse ${esperada}; salió: ${rotas.join(', ')}`)

        // a. los recibos pierden un número (secuencia adelantada) o se saltan uno
        sin(
            await fabricado([e.B], async (trx) => {
                await trx.rawQuery(
                    `UPDATE billing.recibos_secuencias SET ultimo = ultimo + 2 WHERE empresa_id = ?`,
                    [e.B],
                )
            }),
            '28.recibos_no_correlativos',
        )
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'billing.recibos')
                await trx.rawQuery(
                    `UPDATE billing.recibos SET numero = 5 WHERE empresa_id = ? AND numero = 2`,
                    [e.B],
                )
            }),
            '28.recibos_no_correlativos',
        )
        // b. el recibo dice otro monto, otro cliente o una caja fiscal
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'billing.recibos')
                await trx.rawQuery(
                    `UPDATE billing.recibos SET monto = monto - 1 WHERE empresa_id = ? AND numero = 1`,
                    [e.B],
                )
            }),
            '28.recibo_mal_ligado',
        )
        sin(
            await fabricado([e.B], async (trx) => {
                await trx.rawQuery(`UPDATE ledger.cajas SET fiscal = true WHERE id = ?`, [caja.id])
            }),
            '28.recibo_mal_ligado',
        )
        // c. un pago en la caja sin factura sin su recibo
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'billing.recibos', 'billing.facturas_no_fiscales')
                await trx.rawQuery(
                    `DELETE FROM billing.facturas_no_fiscales WHERE recibo_id IN (SELECT id FROM billing.recibos WHERE empresa_id = ? AND numero = 2)`,
                    [e.B],
                )
                await trx.rawQuery(`DELETE FROM billing.recibos WHERE empresa_id = ? AND numero = 2`, [e.B])
            }),
            '28.recibo_mal_ligado',
        )
        // d. un DTE para una factura fuera de la SAT
        sin(
            await fabricado([e.B], async (trx) => {
                await trx.rawQuery(
                    `INSERT INTO fiscal.dte (empresa_id, documento_tipo, documento_id, tipo_dte, estado, proveedor, ambiente, identificador, receptor, total, iva)
                     VALUES (?, 'factura', ?, 'FACT', 'pendiente', 'falso', 'pruebas', gen_random_uuid(), '{}'::jsonb, 112, 12)`,
                    [e.B, f.id],
                )
            }),
            '28.factura_fuera_de_la_sat_mal_marcada',
        )
        // e. un cargo no facturable con IVA
        sin(
            await fabricado([e.B], async (trx) => {
                await trx.rawQuery(`UPDATE billing.facturas SET iva = 6 WHERE id = ?`, [cargo.id])
            }),
            '28.factura_fuera_de_la_sat_mal_marcada',
        )
        // f. la marca sigue vigente pero la factura ya no está pagada
        sin(
            await fabricado([e.B], async (trx) => {
                await trx.rawQuery(`UPDATE billing.facturas SET estado = 'parcial' WHERE id = ?`, [f.id])
            }),
            '28.factura_fuera_de_la_sat_mal_marcada',
        )
        // g. el asiento recibo_interno manda el ingreso a otra cuenta (y 4.3.01 deja de cuadrar con sus documentos)
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.movimientos')
                await trx.rawQuery(
                    `UPDATE ledger.movimientos SET cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = ? AND empresa_id IS NULL LIMIT 1)
                      WHERE cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = ? AND empresa_id IS NULL LIMIT 1)
                        AND asiento_id = (SELECT id FROM ledger.asientos WHERE origen_tipo = 'recibo_interno' AND origen_id = ?)`,
                    [CUENTAS.OTROS_INGRESOS, INTERNOS, marca.id],
                )
            }),
            '28.recibo_interno_mal_contabilizado',
        )
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.movimientos')
                await trx.rawQuery(
                    `UPDATE ledger.movimientos SET cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = ? AND empresa_id IS NULL LIMIT 1)
                      WHERE cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = ? AND empresa_id IS NULL LIMIT 1)
                        AND asiento_id = (SELECT id FROM ledger.asientos WHERE origen_tipo = 'recibo_interno' AND origen_id = ?)`,
                    [CUENTAS.OTROS_INGRESOS, INTERNOS, marca.id],
                )
            }),
            '28.cuenta_4_3_01_distinta_de_sus_documentos',
        )
        // h. el cargo no facturable lleva su ingreso a una cuenta fiscal
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.movimientos')
                await trx.rawQuery(
                    `UPDATE ledger.movimientos SET cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = ? AND empresa_id IS NULL LIMIT 1)
                      WHERE cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = ? AND empresa_id IS NULL LIMIT 1)
                        AND asiento_id = (SELECT id FROM ledger.asientos WHERE origen_tipo = 'factura' AND origen_id = ?)`,
                    [CUENTAS.OTROS_INGRESOS, INTERNOS, cargo.id],
                )
            }),
            '28.recibo_interno_mal_contabilizado',
        )
        // i. el gasto interno cae en una cuenta deducible (el egreso dice 5.7.01 y el asiento otra cuenta)
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.movimientos')
                await trx.rawQuery(
                    `UPDATE ledger.movimientos SET cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = ? AND empresa_id IS NULL LIMIT 1)
                      WHERE cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = ? AND empresa_id IS NULL LIMIT 1)
                        AND asiento_id = (SELECT id FROM ledger.asientos WHERE origen_tipo = 'egreso' AND origen_id = ?)`,
                    [CUENTAS.GASTO_OTROS, GASTOS_INTERNOS, eg.id],
                )
            }),
            '28.cuenta_5_7_01_distinta_de_sus_egresos',
        )
        // j. un egreso de una caja sin factura que no es interno, y uno interno de una caja con factura
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.egresos')
                await trx.rawQuery(`UPDATE ledger.egresos SET cuenta_id = NULL WHERE id = ?`, [eg.id])
            }),
            '28.cuenta_5_7_01_distinta_de_sus_egresos',
        )
        sin(
            await fabricado([e.B], async (trx) => {
                await sinTriggers(trx, 'ledger.egresos')
                await trx.rawQuery(`UPDATE ledger.egresos SET caja_id = ? WHERE id = ?`, [
                    e.cajas.get(e.B)!,
                    eg.id,
                ])
            }),
            '28.cuenta_5_7_01_distinta_de_sus_egresos',
        )
        // k. el pago de otra empresa en la marca
        sin(
            await fabricado([e.B, e.C], async (trx) => {
                await sinTriggers(trx, 'billing.facturas_no_fiscales')
                await trx.rawQuery(`UPDATE billing.facturas_no_fiscales SET empresa_id = ? WHERE id = ?`, [
                    e.C,
                    marca.id,
                ])
            }),
            '28.asiento_de_recibo_o_caja_de_otra_empresa',
        )
        // nada de lo anterior quedó en la base
        assert.deepEqual(await verificarLibro([e.B, e.C]), [])
    })
})
