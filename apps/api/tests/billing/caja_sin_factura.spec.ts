import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import CrearConceptoCargo from '#billing/actions/crear_concepto_cargo'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CrearCaja from '#ledger/actions/crear_caja'
import EditarCaja from '#ledger/actions/editar_caja'
import RegistrarGastoCajaChica from '#ledger/actions/registrar_gasto_caja_chica'
import ReponerCajaChica from '#ledger/actions/reponer_caja_chica'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import { avisosPorCertificar } from '#fiscal/fel/cola'
import { facturaNoFiscal, listarRecibos, reciboDePago } from '#billing/recibos'
import { listarCajas } from '#ledger/cajas'
import { libroMayor, listarCuentas } from '#ledger/consultas'
import { estadoResultados } from '#ledger/estados_financieros'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { codigoCaja, errorDe, lineas } from '#tests/contabilidad/ayudas_contabilidad'
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
import type { Empresas } from '#tests/contabilidad/ayudas_contabilidad'

/**
 * B11 del plan de contabilidad: caja sin factura (recibo no fiscal, cuenta interna, visibilidad) y
 * cargos no facturables por concepto. Debe = Haber en cada paso.
 */

const INTERNOS = CUENTAS_GT.INGRESOS_INTERNOS
const GASTOS_INTERNOS = CUENTAS_GT.GASTOS_INTERNOS
const FOTO = { contenido: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), nombre: 'recibo.jpg' }

async function libroCuadra(
    assert: { equal: (a: unknown, b: unknown, m?: string) => void },
    empresaId: number,
) {
    const fila = await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .where('a.empresa_id', empresaId)
        .select(
            db.raw('coalesce(sum(m.debe), 0)::text as debe'),
            db.raw('coalesce(sum(m.haber), 0)::text as haber'),
        )
        .firstOrFail()
    assert.equal(fila.debe, fila.haber, `Debe = Haber en la empresa ${empresaId}`)
}

/** Caja de cobros sin factura de la empresa B, abierta. */
async function cajaSinFactura(e: Empresas, usuarios: number[] = []) {
    const caja = await new CrearCaja().execute(
        { nombre: unico('Caja sin factura'), empresa_id: e.B, fiscal: false, usuarios },
        e.ctx,
    )
    await new AbrirCaja().execute({ caja_id: caja.id }, e.ctx)
    return caja
}

test.group('B11 · caja sin factura', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('con FEL obligatoria se permite con aviso; el cobro emite recibo correlativo, la factura no se certifica y su ingreso pasa a la cuenta interna', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const caja = await cajaSinFactura(e)
        assert.isFalse(caja.fiscal)
        assert.isString(caja.aviso_sin_factura)

        const s = await servicioFel(e, 'pagar', '112.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        // pago parcial: recibo, la factura sigue siendo aviso
        const p1 = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '12.00', caja_id: caja.id, empresa_id: e.B },
            e.ctx,
        )
        const r1 = await reciboDePago(p1.id)
        assert.containSubset(r1, {
            numero: 1,
            motivo: 'caja_sin_factura',
            monto: '12.00',
            facturas_no_fiscales: [],
        })
        assert.isNull(await facturaNoFiscal(db.connection(), f.id))

        const p2 = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '100.00', caja_id: caja.id, empresa_id: e.B },
            e.ctx,
        )
        const r2 = await reciboDePago(p2.id)
        assert.containSubset(r2, { numero: 2, facturas_no_fiscales: [f.id] })
        const marca = await facturaNoFiscal(db.connection(), f.id)
        assert.equal(marca?.motivo, 'caja_sin_factura')
        // 112 = 100 de base + 12 de IVA por certificar: los dos pasan a 4.3.01
        assert.deepEqual(await lineas('recibo_interno', marca!.id), [
            [CUENTAS.INGRESOS_INTERNET, '100.00', '0.00'],
            [IVA_POR_CERTIFICAR, '12.00', '0.00'],
            [INTERNOS, '0.00', '112.00'],
        ])
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '0.00')
        assert.equal(await saldo(e.B, INTERNOS), '-112.00')
        // la cola FEL no la toma; no hay DTE
        assert.notInclude(await avisosPorCertificar(500, [f.id]), f.id)
        await cola(e)
        assert.lengthOf(await dtesDe('factura', f.id), 0)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'recibo.emitido')
            .whereRaw(`(payload->>'pago_id')::bigint = ?`, [p2.id])
            .firstOrFail()
        assert.containSubset(evento.payload, { numero: 2, facturas_no_fiscales: [f.id] })
        await libroCuadra(assert, e.B)

        // anular el pago: la factura vuelve a ser aviso y se revierte la reclasificación
        await new AnularPago().execute({ pago_id: p2.id, motivo: 'billete falso' }, e.ctx)
        assert.isNull(await facturaNoFiscal(db.connection(), f.id))
        assert.equal(await saldo(e.B, INTERNOS), '0.00')
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '-12.00')
        await libroCuadra(assert, e.B)
        // el pago mixto está prohibido: con p1 (sin factura) vigente, una caja fiscal no puede tocar la factura
        await assert.rejects(
            () =>
                new RegistrarPago().execute(
                    {
                        cliente_id: s.clienteId,
                        metodo: 'caja',
                        monto: '100.00',
                        caja_id: e.cajas.get(e.B)!,
                        empresa_id: e.B,
                    },
                    e.ctx,
                ),
            /sin factura/,
        )
        // sin ningún cobro sin factura, cubierta en una caja fiscal: se certifica como siempre
        await new AnularPago().execute({ pago_id: p1.id, motivo: 'billete falso' }, e.ctx)
        await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '112.00',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
            },
            e.ctx,
        )
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.equal(dte?.estado, 'certificado')
        const pagada = await factura(f.id)
        assert.equal(pagada.estado, 'pagada')
        await libroCuadra(assert, e.B)
    })

    test('pago mixto prohibido: caja sin factura sobre una factura con cobros en caja fiscal (422 pago_mixto_fiscal)', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const caja = await cajaSinFactura(e)
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        const cobrar = (monto: string, cajaId: number) =>
            new RegistrarPago().execute(
                { cliente_id: s.clienteId, metodo: 'caja', monto, caja_id: cajaId, empresa_id: e.B },
                e.ctx,
            )
        const mixto = async (promesa: Promise<unknown>) => {
            const error = (await promesa.then(
                () => null,
                (x) => x,
            )) as { status?: number; code?: string; message?: string } | null
            assert.isNotNull(error, 'debió rechazarse')
            assert.equal(error!.status, 422)
            assert.equal(error!.code, 'E_PAGO_MIXTO_FISCAL')
            assert.match(
                error!.message ?? '',
                /una parte en una caja con factura y otra en una caja sin factura/,
            )
        }
        const fiscal = e.cajas.get(e.B)!
        await cobrar('50.00', fiscal)
        // la caja sin factura no completa lo que empezó una caja fiscal
        await mixto(cobrar('100.00', caja.id))
        assert.isNull(await facturaNoFiscal(db.connection(), f.id))
        // y la fiscal sí puede terminarla
        await cobrar('100.00', fiscal)
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.equal(dte?.estado, 'certificado')
        await libroCuadra(assert, e.B)
    })

    test('pago mixto prohibido, al revés: caja fiscal sobre una factura con cobros en caja sin factura (422 pago_mixto_fiscal)', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const caja = await cajaSinFactura(e)
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        const cobrar = (monto: string, cajaId: number) =>
            new RegistrarPago().execute(
                { cliente_id: s.clienteId, metodo: 'caja', monto, caja_id: cajaId, empresa_id: e.B },
                e.ctx,
            )
        await cobrar('50.00', caja.id)
        const error = (await cobrar('100.00', e.cajas.get(e.B)!).then(
            () => null,
            (x) => x,
        )) as { status?: number; code?: string } | null
        assert.isNotNull(error)
        assert.equal(error!.status, 422)
        assert.equal(error!.code, 'E_PAGO_MIXTO_FISCAL')
        // lo rechazado no dejó rastro y la caja sin factura sí la termina fuera de la SAT
        const p = await cobrar('100.00', caja.id)
        assert.containSubset(await reciboDePago(p.id), { facturas_no_fiscales: [f.id] })
        await cola(e)
        assert.lengthOf(await dtesDe('factura', f.id), 0)
        await libroCuadra(assert, e.B)
    })

    test('caja chica sin factura: sus gastos van a la cuenta interna; no paga compras', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const chica = await new CrearCaja().execute(
            { nombre: unico('Chica sin factura'), tipo: 'gastos', fiscal: false, empresa_id: e.B },
            e.ctx,
        )
        await new ReponerCajaChica().execute(
            { caja_id: chica.id, desde: 'banco', cuenta_bancaria_id: e.cuentas.get(e.B)! },
            e.ctx,
        )
        const g = await new RegistrarGastoCajaChica().execute(
            {
                caja_id: chica.id,
                categoria: 'otros',
                monto: '300.00',
                descripcion: 'Paso por terreno · Finca El Roble',
                archivo: FOTO,
            },
            e.ctx,
        )
        assert.equal(g.egreso.cuenta_codigo, GASTOS_INTERNOS)
        assert.deepEqual(await lineas('egreso', g.egreso.id), [
            [GASTOS_INTERNOS, '300.00', '0.00'],
            [await codigoCaja(chica.id), '0.00', '300.00'],
        ])
        await libroCuadra(assert, e.B)
    })

    test('cargo no facturable por concepto: sin IVA, a la cuenta interna, sin DTE; su cobro emite recibo aunque la caja sea fiscal', async ({
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
        assert.isFalse(concepto.facturable)
        const clienteId = await crearClienteFila(datosNit())
        const cargo = await new EmitirCargoUnico().execute(
            {
                cliente_id: clienteId,
                empresa_id: e.B,
                lineas: [{ concepto_id: concepto.id, precio_unitario: '50.00' }],
            },
            e.ctx,
        )
        assert.equal(cargo.documento, 'factura')
        const facturaId = cargo.id
        const fila = await factura(facturaId)
        assert.equal(fila.iva, '0.00')
        const marca = await facturaNoFiscal(db.connection(), facturaId)
        assert.equal(marca?.motivo, 'cargo_no_facturable')
        const asiento = await lineas('factura', facturaId)
        assert.deepEqual(asiento.map((l) => l[0]).sort(), [CUENTAS.CXC_CLIENTES, INTERNOS].sort())
        const p = await new RegistrarPago().execute(
            {
                cliente_id: clienteId,
                metodo: 'caja',
                monto: '50.00',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
            },
            e.ctx,
        )
        assert.containSubset(await reciboDePago(p.id), { motivo: 'cargo_no_facturable', numero: 1 })
        await cola(e)
        assert.lengthOf(await dtesDe('factura', facturaId), 0)
        await libroCuadra(assert, e.B)

        // un cargo puede marcarse no facturable aunque el concepto lo sea (con permiso)
        const normal = await new CrearConceptoCargo().execute(
            { empresa_id: e.B, nombre: unico('Visita'), tipo: 'otro', cuenta_codigo: CUENTAS.OTROS_INGRESOS },
            e.ctx,
        )
        const control = await new EmitirCargoUnico().execute(
            {
                cliente_id: clienteId,
                empresa_id: e.B,
                facturable: false,
                lineas: [{ concepto_id: normal.id, precio_unitario: '30.00' }],
            },
            e.ctx,
        )
        const marcaControl = await facturaNoFiscal(db.connection(), control.id)
        assert.equal(marcaControl?.motivo, 'cargo_no_facturable')
        // mezclar facturables y no facturables en un cargo: 422
        const mixto = await errorDe(
            new EmitirCargoUnico().execute(
                {
                    cliente_id: clienteId,
                    empresa_id: e.B,
                    lineas: [
                        { concepto_id: normal.id, precio_unitario: '30.00' },
                        { concepto_id: concepto.id, precio_unitario: '30.00' },
                    ],
                },
                e.ctx,
            ),
        )
        assert.deepEqual([mixto.status, mixto.codigo], [422, 'cargo_mixto'])
    })

    test('visibilidad: la caja sin factura solo la ven sus usuarios; las cuentas internas, quien tiene el permiso (los demás ven una línea agregada)', async ({
        assert,
        client,
    }) => {
        const e = await empresasFel('opcional')
        const cajero = await usuarioConRoles(['cajero'])
        const otro = await usuarioConRoles(['cajero'])
        const conta = await usuarioConRoles(['contabilidad'])
        const caja = await cajaSinFactura(e, [cajero.usuario.id])
        const deCajero = await listarCajas(undefined, [e.B], undefined, cajero.usuario.id)
        const deOtro = await listarCajas(undefined, [e.B], undefined, otro.usuario.id)
        assert.isTrue(deCajero.some((c) => c.id === caja.id))
        assert.isFalse(deOtro.some((c) => c.id === caja.id))
        // por la API: a quien no está en la lista la caja no le existe
        const lista = await client
            .get('/api/v1/cajas')
            .bearerToken(otro.token)
            .header('X-Empresa-Id', String(e.B))
        assert.isFalse((lista.body() as Array<{ id: number }>).some((c) => c.id === caja.id))
        const turnos = await client
            .get(`/api/v1/cajas/${caja.id}/turnos`)
            .bearerToken(otro.token)
            .header('X-Empresa-Id', String(e.B))
        assert.equal(turnos.status(), 404)
        // quien tiene el permiso de las cuentas internas la ve igual
        const deConta = await listarCajas(undefined, [e.B], undefined, conta.usuario.id)
        assert.isTrue(deConta.some((c) => c.id === caja.id))
        // editar: quitar la lista la abre a todos (version)
        const editada = await new EditarCaja().execute(
            { caja_id: caja.id, version: caja.version, usuarios: [] },
            e.ctx,
        )
        assert.deepEqual(editada.usuarios, [])
        const conflicto = await errorDe(
            new EditarCaja().execute({ caja_id: caja.id, version: caja.version, fiscal: true }, e.ctx),
        )
        assert.equal(conflicto.status, 409)

        const s = await servicioFel(e, 'pagar', '112.00', await crearClienteFila(datosNit()))
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '112.00', caja_id: caja.id, empresa_id: e.B },
            e.ctx,
        )
        const conInternas = await listarCuentas(null, true)
        const sinInternas = await listarCuentas(null, false)
        assert.isTrue(conInternas.some((c: { codigo: string }) => c.codigo === INTERNOS))
        assert.isFalse(sinInternas.some((c: { codigo: string }) => c.codigo === INTERNOS))
        const interna = conInternas.find((c: { codigo: string }) => c.codigo === INTERNOS) as { id: number }
        const mayor = await errorDe(libroMayor({ cuenta_id: interna.id, limit: 10 }, [e.B], false))
        assert.deepEqual([mayor.status, mayor.codigo], [403, 'cuenta_interna_restringida'])
        const completo = await estadoResultados({ desde: '2026-01-01' }, [e.B], true)
        const restringido = await estadoResultados({ desde: '2026-01-01' }, [e.B], false)
        assert.isTrue(completo.total.cuentas.some((c) => c.codigo === INTERNOS))
        assert.isFalse(restringido.total.cuentas.some((c) => c.codigo === INTERNOS))
        const agregada = restringido.total.cuentas.find((c) => c.nombre === 'Interno (restringido)')
        assert.equal(agregada?.saldo, '112.00')
        assert.deepEqual(restringido.total.totales, completo.total.totales)
        const recibos = await listarRecibos({ limit: 50 }, [e.B])
        assert.lengthOf(recibos.data, 1)
        await libroCuadra(assert, e.B)
    })

    test('una caja de cobros sin factura no se usa para compras; su egreso (vía vieja) va a la cuenta interna', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const caja = await cajaSinFactura(e)
        const eg = await new RegistrarEgreso().execute(
            { categoria: 'otros', monto: '10.00', metodo: 'caja', caja_id: caja.id, descripcion: 'poste' },
            e.ctx,
        )
        assert.equal(eg.cuenta_codigo, GASTOS_INTERNOS)
        await libroCuadra(assert, e.B)
    })
})
