import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import CrearCaja from '#ledger/actions/crear_caja'
import RecibirEntrega from '#ledger/actions/recibir_entrega'
import ConfigurarCajas from '#ledger/actions/configurar_cajas'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import AnularEgreso from '#ledger/actions/anular_egreso'
import RegistrarGastoCajaChica from '#ledger/actions/registrar_gasto_caja_chica'
import ReponerCajaChica from '#ledger/actions/reponer_caja_chica'
import ContarCaja from '#ledger/actions/contar_caja'
import AdjuntarComprobanteEgreso from '#ledger/actions/adjuntar_comprobante_egreso'
import { estadoCajaChica, exigirSalidaDeCaja } from '#ledger/caja_chica'
import { ajustesCajas, saldoCustodia } from '#ledger/custodia'
import { calcularChecksCustodia } from '#ledger/checks'
import { dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    codigoCaja,
    errorDe,
    lineas,
    saldoCuenta,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'

/**
 * B9 del plan de contabilidad (§5.7): caja chica con fondo fijo. En cada paso se comprueba la
 * invariante «efectivo + comprobantes sin reponer − diferencias de conteo = fondo» y Debe = Haber.
 */

const CUSTODIA = CUENTAS_GT.EFECTIVO_EN_CUSTODIA
/** Una foto JPEG mínima (la firma basta para el tipo). */
const FOTO = { contenido: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), nombre: 'ticket.jpg' }

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

/** efectivo + comprobantes − diferencias = fondo vigente, y el efectivo es el saldo de su cuenta. */
async function cuadra(
    assert: { equal: (a: unknown, b: unknown, m?: string) => void; isTrue: (v: unknown, m?: string) => void },
    cajaId: number,
    efectivo: string,
) {
    const estado = await estadoCajaChica(cajaId)
    assert.isTrue(estado.cuadra, `la caja chica ${cajaId} cuadra: ${JSON.stringify(estado)}`)
    assert.equal(estado.efectivo, efectivo)
    assert.equal(
        dec(estado.efectivo).plus(estado.comprobantes.monto).minus(estado.diferencias.monto).toFixed(2),
        estado.fondo_vigente,
    )
    assert.equal(dec(await saldoCuenta(estado.empresa_id, await codigoCaja(cajaId))).toFixed(2), efectivo)
    await libroCuadra(assert, estado.empresa_id)
    return estado
}

async function cajaChica(e: EmpresasGt, encargadoId: number | null = null, empresaId = e.B) {
    return new CrearCaja().execute(
        { nombre: unico('Caja chica'), tipo: 'gastos', cajero_id: encargadoId, empresa_id: empresaId },
        e.ctx,
    )
}

function gasto(cajaId: number, monto: string, extra: Record<string, unknown> = {}) {
    return {
        caja_id: cajaId,
        categoria: 'vehiculos' as const,
        monto,
        descripcion: 'Combustible moto 2',
        archivo: FOTO,
        ...extra,
    }
}

/** Repone desde el banco de la empresa (su cuenta bancaria propia). */
function desdeBanco(e: EmpresasGt, cajaId: number) {
    return new ReponerCajaChica().execute(
        {
            caja_id: cajaId,
            desde: 'banco',
            cuenta_bancaria_id: e.cuentas.get(e.B)!,
            referencia: 'cheque 1042',
        },
        e.ctx,
    )
}

test.group('B9 · caja chica con fondo fijo', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('nace vacía con el fondo de fábrica (Q2,000); no abre turnos ni cobra; la primera reposición pone el fondo desde el banco', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const caja = await cajaChica(e)
        assert.containSubset(caja, { tipo: 'gastos', fondo_fijo: null, fondo_fijo_efectivo: '2000.00' })
        const vacia = await cuadra(assert, caja.id, '0.00')
        assert.containSubset(vacia, { fondo_fijo: '2000.00', fondo_vigente: '0.00', por_reponer: '2000.00' })

        const turno = await errorDe(new AbrirCaja().execute({ caja_id: caja.id }, e.ctx))
        assert.deepEqual([turno.status, turno.codigo], [422, 'caja_chica_sin_turno'])
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
        const cobro = await errorDe(
            new RegistrarPago().execute(
                {
                    cliente_id: s.clienteId,
                    metodo: 'caja',
                    monto: '10.00',
                    caja_id: caja.id,
                    empresa_id: e.B,
                },
                e.ctx,
            ),
        )
        assert.deepEqual([cobro.status, cobro.reglas], [422, ['caja_chica_no_cobra']])

        // sin efectivo no hay gasto
        const sinFondo = await errorDe(new RegistrarGastoCajaChica().execute(gasto(caja.id, '10.00'), e.ctx))
        assert.deepEqual([sinFondo.status, sinFondo.codigo], [422, 'efectivo_insuficiente'])

        const distinto = await errorDe(
            new ReponerCajaChica().execute(
                {
                    caja_id: caja.id,
                    desde: 'banco',
                    cuenta_bancaria_id: e.cuentas.get(e.B)!,
                    monto: '1000.00',
                },
                e.ctx,
            ),
        )
        assert.deepEqual([distinto.status, distinto.codigo], [422, 'monto_distinto'])
        const reposicion = await desdeBanco(e, caja.id)
        assert.containSubset(reposicion, {
            origen: 'banco',
            monto: '2000.00',
            fondo: '2000.00',
            efectivo_antes: '0.00',
            gastos: 0,
            cuenta_codigo: e.banco.get(e.B)!.codigo,
        })
        assert.deepEqual(await lineas('reposicion_caja', reposicion.id), [
            [await codigoCaja(caja.id), '2000.00', '0.00'],
            [e.banco.get(e.B)!.codigo, '0.00', '2000.00'],
        ])
        await cuadra(assert, caja.id, '2000.00')
        const nada = await errorDe(desdeBanco(e, caja.id))
        assert.deepEqual([nada.status, nada.codigo], [422, 'nada_que_reponer'])
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'caja_chica.repuesta')
            .whereRaw(`(payload->>'reposicion_id')::bigint = ?`, [reposicion.id])
            .firstOrFail()
        assert.containSubset(evento.payload, {
            origen: 'banco',
            monto: '2000.00',
            fondo: '2000.00',
            gastos: 0,
        })
    })

    test('gasto con comprobante obligatorio y sin tope por gasto: solo el efectivo lo limita; el encargado registra los de su caja', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const encargado = await usuarioConRoles(['cajero'])
        const otro = await usuarioConRoles(['cajero'])
        const caja = await cajaChica(e, encargado.usuario.id)
        await desdeBanco(e, caja.id)

        const sinArchivo = await errorDe(
            new RegistrarGastoCajaChica().execute({ ...gasto(caja.id, '150.00'), archivo: null }, e.ctx),
        )
        assert.deepEqual([sinArchivo.status, sinArchivo.reglas], [422, ['required']])
        const noFoto = await errorDe(
            new RegistrarGastoCajaChica().execute(
                { ...gasto(caja.id, '150.00'), archivo: { contenido: new Uint8Array([1, 2, 3]) } },
                e.ctx,
            ),
        )
        assert.deepEqual([noFoto.status, noFoto.reglas], [422, ['tipo']])
        const ajena = await errorDe(
            new RegistrarGastoCajaChica().execute(gasto(caja.id, '150.00'), contextoPrueba(otro.usuario.id)),
        )
        assert.deepEqual([ajena.status, ajena.codigo], [403, 'caja_ajena'])

        const r = await new RegistrarGastoCajaChica().execute(
            gasto(caja.id, '150.00'),
            contextoPrueba(encargado.usuario.id),
        )
        assert.containSubset(r, { pasar_a_compras: false })
        assert.containSubset(r.egreso, {
            metodo: 'caja',
            caja_id: caja.id,
            turno_id: null,
            monto: '150.00',
            con_comprobante: true,
            reposicion_id: null,
        })
        assert.deepEqual(await lineas('egreso', r.egreso.id), [
            [CUENTAS.GASTO_VEHICULOS, '150.00', '0.00'],
            [await codigoCaja(caja.id), '0.00', '150.00'],
        ])
        await cuadra(assert, caja.id, '1850.00')

        // sin tope por gasto (el PM): Q1,500 de una vez entra; más de lo que hay, no
        const grande = await new RegistrarGastoCajaChica().execute(
            gasto(caja.id, '1500.00', {
                categoria: 'otros',
                descripcion: 'paso por terreno',
                con_factura: true,
            }),
            e.ctx,
        )
        assert.isTrue(grande.pasar_a_compras)
        const estado = await cuadra(assert, caja.id, '350.00')
        assert.containSubset(estado.comprobantes, { cantidad: 2, monto: '1650.00', sin_archivo: 0 })
        assert.equal(estado.porcentaje, 17)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'caja_chica.gasto_registrado')
            .whereRaw(`(payload->>'egreso_id')::bigint = ?`, [grande.egreso.id])
            .firstOrFail()
        assert.containSubset(evento.payload, { con_factura: true, efectivo: '350.00', bajo_minimo: true })
        const excede = await errorDe(new RegistrarGastoCajaChica().execute(gasto(caja.id, '350.01'), e.ctx))
        assert.deepEqual([excede.status, excede.codigo], [422, 'efectivo_insuficiente'])

        // POST /egresos no registra gastos de caja chica (no lleva el comprobante)
        const sinComprobante = await errorDe(
            new RegistrarEgreso().execute(
                { categoria: 'otros', monto: '10.00', metodo: 'caja', caja_id: caja.id, descripcion: 'x' },
                e.ctx,
            ),
        )
        assert.deepEqual(
            [sinComprobante.status, sinComprobante.codigo],
            [422, 'gasto_caja_chica_con_comprobante'],
        )
        // la caja chica no paga a proveedores al crédito ni impuestos
        const proveedor = await errorDe(
            db.transaction((trx) => exigirSalidaDeCaja(trx, caja.id, dec('1.00'), 'pago_proveedor')),
        )
        assert.deepEqual([proveedor.status, proveedor.codigo], [422, 'caja_chica_solo_gastos'])
    })

    test('N2: con caja chica en la empresa, ningún gasto sale de una caja de cobros; sin ella, la vía de siempre sigue', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cobrosB = e.cajas.get(e.B)!
        const cobrosC = e.cajas.get(e.C)!
        // antes de tener caja chica: el egreso del turno sigue igual
        await new RegistrarEgreso().execute(
            { categoria: 'otros', monto: '20.00', metodo: 'caja', caja_id: cobrosB, descripcion: 'antes' },
            e.ctx,
        )
        await cajaChica(e)
        const ahora = await errorDe(
            new RegistrarEgreso().execute(
                {
                    categoria: 'otros',
                    monto: '20.00',
                    metodo: 'caja',
                    caja_id: cobrosB,
                    descripcion: 'después',
                },
                e.ctx,
            ),
        )
        assert.deepEqual([ahora.status, ahora.codigo], [422, 'gasto_desde_caja_chica'])
        // la empresa C no tiene caja chica: sus cajas de cobros siguen pagando gastos
        await new RegistrarEgreso().execute(
            { categoria: 'otros', monto: '20.00', metodo: 'caja', caja_id: cobrosC, descripcion: 'C' },
            e.ctx,
        )
        await libroCuadra(assert, e.B)
        await libroCuadra(assert, e.C)
    })

    test('conteo sorpresa: la diferencia exige motivo, queda a cargo del encargado y la siguiente reposición la repone', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const encargado = await usuarioConRoles(['cajero'])
        const caja = await cajaChica(e, encargado.usuario.id)
        await desdeBanco(e, caja.id)
        await new RegistrarGastoCajaChica().execute(gasto(caja.id, '300.00'), e.ctx)

        const cuadrado = await new ContarCaja().execute({ caja_id: caja.id, contado: '1700.00' }, e.ctx)
        assert.containSubset(cuadrado, { esperado: '1700.00', diferencia: '0.00', comprobantes: '300.00' })
        assert.lengthOf(await lineas('conteo_caja', cuadrado.id), 0)

        const sinMotivo = await errorDe(
            new ContarCaja().execute({ caja_id: caja.id, contado: '1690.00' }, e.ctx),
        )
        assert.deepEqual([sinMotivo.status, sinMotivo.reglas], [422, ['required']])
        const faltante = await new ContarCaja().execute(
            { caja_id: caja.id, contado: '1690.00', motivo: 'faltó un billete de Q10' },
            e.ctx,
        )
        assert.containSubset(faltante, {
            diferencia: '-10.00',
            responsable_id: encargado.usuario.id,
            repuesto: false,
        })
        assert.deepEqual(await lineas('conteo_caja', faltante.id), [
            [CUENTAS.FALTANTES_CAJA, '10.00', '0.00'],
            [await codigoCaja(caja.id), '0.00', '10.00'],
        ])
        const estado = await cuadra(assert, caja.id, '1690.00')
        assert.containSubset(estado.diferencias, { cantidad: 1, monto: '-10.00' })
        assert.equal(estado.por_reponer, '310.00')
        const sobrante = await new ContarCaja().execute(
            { caja_id: caja.id, contado: '1695.00', motivo: 'apareció un vuelto' },
            e.ctx,
        )
        assert.deepEqual(await lineas('conteo_caja', sobrante.id), [
            [await codigoCaja(caja.id), '5.00', '0.00'],
            [CUENTAS.SOBRANTES_CAJA, '0.00', '5.00'],
        ])
        await cuadra(assert, caja.id, '1695.00')

        const reposicion = await desdeBanco(e, caja.id)
        assert.containSubset(reposicion, { monto: '305.00', gastos: 1, conteos: 2 })
        const despues = await cuadra(assert, caja.id, '2000.00')
        assert.containSubset(despues, {
            comprobantes: { cantidad: 0, monto: '0.00' },
            diferencias: { cantidad: 0, monto: '0.00' },
        })
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'caja.contada')
            .whereRaw(`(payload->>'conteo_id')::bigint = ?`, [faltante.id])
            .firstOrFail()
        assert.containSubset(evento.payload, { diferencia: '-10.00', responsable_id: encargado.usuario.id })
    })

    test('reponer desde la custodia: sale de 1.1.15 de quien repone, sella los gastos (ya no se anulan) y la custodia sigue cuadrando', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const conta = await usuarioConRoles(['contabilidad'])
        const contaCtx = contextoPrueba(conta.usuario.id)
        // Q600 en la caja de cobros (fondo 100 + 500); se entregan Q400 al contador
        const cobros = e.cajas.get(e.B)!
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '500.00', caja_id: cobros, empresa_id: e.B },
            e.ctx,
        )
        const turno = await new CerrarCaja().execute(
            { caja_id: cobros, contado: '600.00', entregado_a: conta.usuario.id },
            e.ctx,
        )
        await new RecibirEntrega().execute({ entrega_id: turno.entrega_id! }, contaCtx)

        // el fondo de esta empresa es Q300; la primera reposición sale del banco
        const ajustes = await ajustesCajas(e.B)
        await new ConfigurarCajas().execute(
            { empresa_id: e.B, version: ajustes.version, fondo_caja_chica: '300.00' },
            e.ctx,
        )
        const caja = await cajaChica(e)
        assert.equal(caja.fondo_fijo_efectivo, '300.00')
        await desdeBanco(e, caja.id)
        const g1 = await new RegistrarGastoCajaChica().execute(gasto(caja.id, '120.00'), e.ctx)
        // un gasto sin archivo (p. ej. el de una compra al contado) frena la reposición
        const g2 = await new RegistrarEgreso().execute(
            {
                categoria: 'otros',
                monto: '30.00',
                metodo: 'caja',
                caja_id: caja.id,
                descripcion: 'cinchos',
                desde_caja_chica: true,
            },
            e.ctx,
        )
        assert.isFalse(g2.con_comprobante)
        const pendiente = await estadoCajaChica(caja.id)
        assert.equal(pendiente.comprobantes.sin_archivo, 1)
        const sinComprobante = await errorDe(
            new ReponerCajaChica().execute({ caja_id: caja.id, desde: 'custodia' }, contaCtx),
        )
        assert.deepEqual([sinComprobante.status, sinComprobante.codigo], [422, 'gastos_sin_comprobante'])
        await new AdjuntarComprobanteEgreso().execute({ egreso_id: g2.id, archivo: FOTO }, e.ctx)
        const repetido = await errorDe(
            new AdjuntarComprobanteEgreso().execute({ egreso_id: g2.id, archivo: FOTO }, e.ctx),
        )
        assert.deepEqual([repetido.status, repetido.codigo], [409, 'comprobante_existente'])

        // quien no tiene custodia no repone desde ella
        const sinCustodia = await errorDe(
            new ReponerCajaChica().execute({ caja_id: caja.id, desde: 'custodia' }, e.ctx),
        )
        assert.deepEqual([sinCustodia.status, sinCustodia.codigo], [422, 'custodia_insuficiente'])
        const r = await new ReponerCajaChica().execute(
            { caja_id: caja.id, desde: 'custodia', monto: '150.00' },
            contaCtx,
        )
        assert.containSubset(r, {
            origen: 'custodia',
            custodio_id: conta.usuario.id,
            monto: '150.00',
            gastos: 2,
        })
        assert.deepEqual(await lineas('reposicion_caja', r.id), [
            [await codigoCaja(caja.id), '150.00', '0.00'],
            [CUSTODIA, '0.00', '150.00'],
        ])
        const custodia = await saldoCustodia(db.connection(), e.B, conta.usuario.id)
        assert.equal(custodia.toFixed(2), '250.00')
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '250.00')
        const periodo = new Date().toISOString().slice(0, 7)
        const checks = await calcularChecksCustodia(db.connection(), e.B, periodo)
        assert.containSubset(
            checks.find((c) => c.clave === 'custodia_cuadra'),
            { esperado: '250.00', obtenido: '250.00', resultado: 'ok' },
        )
        await cuadra(assert, caja.id, '300.00')

        // sellados: ya no se anulan
        const sellado = await errorDe(
            new AnularEgreso().execute({ egreso_id: g1.egreso.id, motivo: 'error' }, e.ctx),
        )
        assert.deepEqual([sellado.status, sellado.codigo], [409, 'gasto_repuesto'])
        // uno sin reponer sí: su efectivo vuelve a la caja y sigue cuadrando
        const g3 = await new RegistrarGastoCajaChica().execute(gasto(caja.id, '45.00'), e.ctx)
        await cuadra(assert, caja.id, '255.00')
        await new AnularEgreso().execute({ egreso_id: g3.egreso.id, motivo: 'se registró dos veces' }, e.ctx)
        await cuadra(assert, caja.id, '300.00')
    })

    test('multiempresa: la caja chica se repone solo con un banco de su empresa', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const caja = await cajaChica(e)
        const cruzada = await errorDe(
            new ReponerCajaChica().execute(
                { caja_id: caja.id, desde: 'banco', cuenta_bancaria_id: e.cuentas.get(e.C)! },
                e.ctx,
            ),
        )
        assert.deepEqual([cruzada.status, cruzada.reglas], [422, ['cuenta_de_otra_empresa']])
        await cuadra(assert, caja.id, '0.00')
    })
})
