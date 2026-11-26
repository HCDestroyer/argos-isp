import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import CrearCaja from '#ledger/actions/crear_caja'
import DepositarCaja from '#ledger/actions/depositar_caja'
import EntregarCaja from '#ledger/actions/entregar_caja'
import RecibirEntrega from '#ledger/actions/recibir_entrega'
import RechazarEntrega from '#ledger/actions/rechazar_entrega'
import ConfigurarCajas from '#ledger/actions/configurar_cajas'
import { ajustesCajas, resumenCustodia, saldoCustodia, venceCustodia } from '#ledger/custodia'
import { calcularChecksCustodia } from '#ledger/checks'
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
 * B1 del plan de contabilidad (§5.7, corrige E1): caja de cobros → custodia («Recibí») → banco.
 * Debe = Haber se verifica en cada asiento (restricción de la base); aquí, además, que la cuenta de
 * la caja, 1.1.15 y 1.1.11 digan dónde está el efectivo después de cada paso.
 */

const CUSTODIA = CUENTAS_GT.EFECTIVO_EN_CUSTODIA
const TRANSITO = CUENTAS_GT.FONDOS_EN_TRANSITO

/** Cobra `cobro` en efectivo en la caja de B (abierta con Q100 por las ayudas). */
async function cobrar(e: EmpresasGt, cobro: string, empresaId = e.B) {
    const cajaId = e.cajas.get(empresaId)!
    const s = await servicioFacturado(empresaId, '2026-10-01', { instalacion: '2026-09-01' })
    await new RegistrarPago().execute(
        { cliente_id: s.clienteId, metodo: 'caja', monto: cobro, caja_id: cajaId, empresa_id: empresaId },
        e.ctx,
    )
    return { cajaId, caja: await codigoCaja(cajaId) }
}

/** Contador (contabilidad: recibe entregas) con su contexto. */
async function contador() {
    const c = await usuarioConRoles(['contabilidad'])
    return { ...c, ctx: contextoPrueba(c.usuario.id) }
}

/** Libro cuadrado en la empresa: Σ debe = Σ haber. */
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

test.group('B1 · cajas de cobros, custodia y entrega con «Recibí»', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('entrega a otra persona: sin asiento hasta «Recibí»; con diferencia exige motivo y queda a cargo de quien entregó', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const conta = await contador()
        const { cajaId, caja } = await cobrar(e, '500.00')
        // fondo 100 + 500; sin fondo_siguiente queda el fondo fijo de fábrica (Q200)
        const turno = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '600.00', entregado_a: conta.usuario.id },
            e.ctx,
        )
        assert.equal(turno.fondo_siguiente, '200.00')
        assert.equal(turno.entregado_monto, '400.00')
        assert.equal(turno.entrega_estado, 'por_recibir')
        const entregaId = turno.entrega_id!
        assert.lengthOf(await lineas('entrega_caja', entregaId), 0)
        // sigue a nombre del cajero: en la cuenta de la caja
        assert.equal(await saldoCuenta(e.B, caja), '500.00')
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'caja.entregada')
            .whereRaw(`(payload->>'entrega_id')::bigint = ?`, [entregaId])
            .first()
        assert.containSubset(evento.payload, {
            monto: '400.00',
            autoentrega: false,
            recibe_id: conta.usuario.id,
        })

        // solo la persona a quien va
        const ajena = await errorDe(new RecibirEntrega().execute({ entrega_id: entregaId }, e.ctx))
        assert.deepEqual([ajena.status, ajena.codigo], [403, 'entrega_de_otra_persona'])
        // contó Q390: la diferencia exige motivo
        const sinMotivo = await errorDe(
            new RecibirEntrega().execute({ entrega_id: entregaId, contado: '390.00' }, conta.ctx),
        )
        assert.equal(sinMotivo.status, 422)
        const recibida = await new RecibirEntrega().execute(
            { entrega_id: entregaId, contado: '390.00', motivo: 'faltó un billete de Q10' },
            conta.ctx,
        )
        assert.containSubset(recibida, { estado: 'recibida', contado: '390.00', diferencia: '-10.00' })
        assert.deepEqual(await lineas('entrega_caja', entregaId), [
            [CUSTODIA, '390.00', '0.00'],
            [CUENTAS.FALTANTES_CAJA, '10.00', '0.00'],
            [caja, '0.00', '400.00'],
        ])
        assert.equal(await saldoCuenta(e.B, caja), '100.00')
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '390.00')
        const custodia = await saldoCustodia(db.connection(), e.B, conta.usuario.id)
        assert.equal(custodia.toFixed(2), '390.00')
        const otraVez = await errorDe(new RecibirEntrega().execute({ entrega_id: entregaId }, conta.ctx))
        assert.deepEqual([otraVez.status, otraVez.codigo], [409, 'entrega_resuelta'])
        await libroCuadra(assert, e.B)
    })

    test('«lo deposito yo»: se recibe al cerrar; se deposita al día siguiente sin turno abierto y sin pasar la custodia', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { cajaId, caja } = await cobrar(e, '150.00')
        const turno = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '250.00', fondo_siguiente: '100.00', entregado_a: e.usuarioId },
            e.ctx,
        )
        assert.equal(turno.entrega_estado, 'recibida')
        assert.deepEqual(await lineas('entrega_caja', turno.entrega_id!), [
            [CUSTODIA, '150.00', '0.00'],
            [caja, '0.00', '150.00'],
        ])
        assert.equal(await saldoCuenta(e.B, caja), '0.00')

        const banco = e.banco.get(e.B)!
        const excede = await errorDe(
            new DepositarCaja().execute(
                {
                    desde: 'custodia',
                    monto: '150.01',
                    boleta: unico('B1'),
                    cuenta_bancaria_id: banco.id,
                    empresa_id: e.B,
                },
                e.ctx,
            ),
        )
        assert.equal(excede.codigo, 'deposito_excede_custodia')
        // sin caja ni turno: de la custodia
        const deposito = await new DepositarCaja().execute(
            { monto: '150.00', boleta: unico('B1'), cuenta_bancaria_id: banco.id, empresa_id: e.B },
            e.ctx,
        )
        assert.containSubset(deposito, {
            origen: 'custodia',
            caja_id: null,
            turno_id: null,
            custodio_id: e.usuarioId,
        })
        assert.deepEqual(await lineas('deposito', deposito.id), [
            [TRANSITO, '150.00', '0.00'],
            [CUSTODIA, '0.00', '150.00'],
        ])
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '0.00')
        assert.equal(await saldoCuenta(e.B, TRANSITO), '150.00')

        // el turno siguiente abre con lo que quedó, sin escribirlo
        const nuevo = await new AbrirCaja().execute({ caja_id: cajaId }, e.ctx)
        assert.deepEqual([nuevo.fondo_inicial, nuevo.fondo_esperado], ['100.00', '100.00'])
        await libroCuadra(assert, e.B)
    })

    test('«No lo recibí»: sin asiento; el turno se entrega otra vez; receptor sin permiso y «lo deposito yo» apagado se rechazan', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const conta = await contador()
        const otro = await contador()
        const { cajaId, caja } = await cobrar(e, '300.00')
        const sinPermiso = await usuarioConRoles(['soporte'])
        const rechazo = await errorDe(
            new CerrarCaja().execute(
                {
                    caja_id: cajaId,
                    contado: '400.00',
                    fondo_siguiente: '100.00',
                    entregado_a: sinPermiso.usuario.id,
                },
                e.ctx,
            ),
        )
        assert.equal(rechazo.codigo, 'receptor_sin_permiso')

        const turno = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '400.00', fondo_siguiente: '100.00', entregado_a: conta.usuario.id },
            e.ctx,
        )
        const vigente = await errorDe(
            new EntregarCaja().execute({ turno_id: turno.id, entregado_a: otro.usuario.id }, e.ctx),
        )
        assert.equal(vigente.codigo, 'entrega_vigente')
        const rechazada = await new RechazarEntrega().execute(
            { entrega_id: turno.entrega_id!, motivo: 'no me llegó el sobre' },
            conta.ctx,
        )
        assert.equal(rechazada.estado, 'rechazada')
        assert.equal(await saldoCuenta(e.B, caja), '300.00')

        // la empresa apaga «lo deposito yo»
        const antes = await ajustesCajas(e.B)
        assert.deepEqual([antes.version, antes.de_fabrica, antes.fondo_cobros], [0, true, '200.00'])
        const ajustes = await new ConfigurarCajas().execute(
            { empresa_id: e.B, version: 0, autoentrega: false, custodia_tope: '250.00' },
            e.ctx,
        )
        assert.deepEqual([ajustes.version, ajustes.autoentrega, ajustes.custodia_tope], [1, false, '250.00'])
        const conflicto = await errorDe(
            new ConfigurarCajas().execute({ empresa_id: e.B, version: 0, autoentrega: true }, e.ctx),
        )
        assert.equal(conflicto.status, 409)
        const apagada = await errorDe(
            new EntregarCaja().execute({ turno_id: turno.id, entregado_a: e.usuarioId }, e.ctx),
        )
        assert.equal(apagada.codigo, 'autoentrega_apagada')

        const otraVez = await new EntregarCaja().execute(
            { turno_id: turno.id, entregado_a: otro.usuario.id },
            e.ctx,
        )
        assert.containSubset(otraVez, { origen: 'reentrega', estado: 'por_recibir', monto: '300.00' })
        await new RecibirEntrega().execute({ entrega_id: otraVez.id }, otro.ctx)
        // pasa el tope de Q250: avisa, no bloquea
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'caja.entrega_recibida')
            .whereRaw(`(payload->>'entrega_id')::bigint = ?`, [otraVez.id])
            .first()
        assert.containSubset(evento.payload, { custodia: '300.00', sobre_tope: true })
        const resumen = await resumenCustodia(e.B, otro.usuario.id)
        assert.containSubset(resumen.personas[0], {
            saldo: '300.00',
            sobre_tope: true,
            fuera_de_plazo: false,
        })
        await libroCuadra(assert, e.B)
    })

    test('multiempresa: la custodia de una empresa no se deposita en otra; ajustes por empresa', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { cajaId } = await cobrar(e, '120.00')
        await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '220.00', fondo_siguiente: '100.00', entregado_a: e.usuarioId },
            e.ctx,
        )
        const bancoC = e.banco.get(e.C)!
        const enC = await errorDe(
            new DepositarCaja().execute(
                { monto: '120.00', boleta: unico('C'), cuenta_bancaria_id: bancoC.id, empresa_id: e.C },
                e.ctx,
            ),
        )
        assert.equal(enC.codigo, 'deposito_excede_custodia')
        // con la cuenta de C desde la custodia de B: la cuenta es de otra empresa
        const cuentaAjena = await errorDe(
            new DepositarCaja().execute(
                { monto: '120.00', boleta: unico('C'), cuenta_bancaria_id: bancoC.id, empresa_id: e.B },
                e.ctx,
            ),
        )
        assert.equal(cuentaAjena.status, 422)
        await new ConfigurarCajas().execute({ empresa_id: e.C, version: 0, fondo_cobros: '300.00' }, e.ctx)
        const deB = await ajustesCajas(e.B)
        const deC = await ajustesCajas(e.C)
        assert.equal(deB.fondo_cobros, '200.00')
        assert.equal(deC.fondo_cobros, '300.00')
        assert.equal(await saldoCuenta(e.C, CUSTODIA), '0')
        assert.equal(await saldoCuenta(e.B, CUSTODIA), '120.00')
    })

    test('revisión del cierre: entregas por recibir, 1.1.15 = documentos, plazo en días hábiles', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const conta = await contador()
        const { cajaId } = await cobrar(e, '80.00')
        const turno = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '180.00', fondo_siguiente: '100.00', entregado_a: conta.usuario.id },
            e.ctx,
        )
        const periodo = `${new Date().toISOString().slice(0, 7)}-01`
        const antes = await calcularChecksCustodia(db.connection(), e.B, periodo)
        assert.containSubset(
            antes.find((c) => c.clave === 'entregas_recibidas'),
            {
                resultado: 'anomalia',
                obtenido: '1',
            },
        )
        await new RecibirEntrega().execute({ entrega_id: turno.entrega_id! }, conta.ctx)
        const despues = await calcularChecksCustodia(db.connection(), e.B, periodo)
        assert.containSubset(
            despues.find((c) => c.clave === 'entregas_recibidas'),
            { resultado: 'ok' },
        )
        assert.containSubset(
            despues.find((c) => c.clave === 'custodia_cuadra'),
            {
                resultado: 'ok',
                esperado: '80.00',
                obtenido: '80.00',
            },
        )
        assert.containSubset(
            despues.find((c) => c.clave === 'custodia_en_plazo'),
            { resultado: 'ok' },
        )
        // viernes 27 nov 2026 + 1 día hábil = lunes 30; 0 días = el mismo día
        assert.equal(venceCustodia('2026-11-27', 1, new Set()), '2026-11-30')
        assert.equal(venceCustodia('2026-11-27', 0, new Set()), '2026-11-27')
        assert.equal(venceCustodia('2026-11-27', 1, new Set(['2026-11-30'])), '2026-12-01')
    })

    test('crear caja: tipo cobros con fondo fijo propio; la caja chica llega en B9', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const caja = await new CrearCaja().execute(
            { nombre: unico('Caja'), empresa_id: e.B, fondo_fijo: '350.00' },
            e.ctx,
        )
        assert.containSubset(caja, { tipo: 'cobros', fondo_fijo: '350.00', fondo_fijo_efectivo: '350.00' })
        const turno = await new AbrirCaja().execute({ caja_id: caja.id }, e.ctx)
        assert.deepEqual([turno.fondo_inicial, turno.fondo_esperado], ['350.00', '350.00'])
        const chica = await errorDe(
            new CrearCaja().execute({ nombre: unico('Chica'), empresa_id: e.B, tipo: 'gastos' }, e.ctx),
        )
        assert.equal(chica.codigo, 'tipo_no_disponible')
    })
})

test.group('B1 · API de custodia y entregas', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('recibir con Idempotency-Key una sola vez; custodia y entregas: las propias o, con cajas.ver_custodia, todas', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const conta = await contador()
        const cajero = await usuarioConRoles(['cajero'])
        const { cajaId } = await cobrar(e, '70.00')
        const turno = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '170.00', fondo_siguiente: '100.00', entregado_a: conta.usuario.id },
            e.ctx,
        )
        const clave = unico('recibir')
        const peticion = () =>
            client
                .post(`/api/v1/cajas/entregas/${turno.entrega_id}/recibir`)
                .bearerToken(conta.token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', clave)
                .json({})
        const primera = await estado(peticion(), 200)
        const segunda = await estado(peticion(), 200)
        assert.deepEqual(segunda.body(), primera.body())
        assert.lengthOf(await lineas('entrega_caja', turno.entrega_id!), 2)
        // el cajero no tiene cajas.recibir_entrega
        await estado(
            client
                .post(`/api/v1/cajas/entregas/${turno.entrega_id}/rechazar`)
                .bearerToken(cajero.token)
                .header('X-Empresa-Id', String(e.B))
                .json({ motivo: 'prueba' }),
            403,
        )

        const propia = await estado(
            client.get('/api/v1/cajas/custodia').bearerToken(conta.token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        // contabilidad tiene cajas.ver_custodia: ve a todos los de la empresa
        assert.containSubset(propia.body(), { total: '70.00', ajustes: { fondo_cobros: '200.00' } })
        const delCajero = await estado(
            client
                .get('/api/v1/cajas/custodia')
                .bearerToken(cajero.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.deepEqual(
            delCajero.body().personas.map((p: { usuario_id: number }) => p.usuario_id),
            [cajero.usuario.id],
        )
        const entregas = await estado(
            client
                .get('/api/v1/cajas/entregas?estado=recibida')
                .bearerToken(conta.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        const ids: number[] = entregas.body().data.map((x: { id: number }) => x.id)
        assert.isTrue(ids.includes(turno.entrega_id!))
        const ajenas = await estado(
            client
                .get('/api/v1/cajas/entregas')
                .bearerToken(cajero.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.lengthOf(ajenas.body().data, 0)

        const ajustes = await estado(
            client.get('/api/v1/cajas/ajustes').bearerToken(conta.token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.containSubset(ajustes.body(), { version: 0, custodia_plazo_dias: 1, custodia_tope: '5000.00' })
        await estado(
            client
                .put('/api/v1/cajas/ajustes')
                .bearerToken(cajero.token)
                .header('X-Empresa-Id', String(e.B))
                .json({ version: 0, fondo_cobros: '150.00' }),
            403,
        )

        const deposito = await estado(
            client
                .post('/api/v1/custodia/depositar')
                .bearerToken(conta.token)
                .header('X-Empresa-Id', String(e.B))
                .json({ monto: '70.00', boleta: unico('B'), cuenta_bancaria_id: e.banco.get(e.B)!.id }),
            201,
        )
        assert.containSubset(deposito.body(), { origen: 'custodia', custodio_id: conta.usuario.id })
    })
})
