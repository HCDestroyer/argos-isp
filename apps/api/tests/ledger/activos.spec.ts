import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { verActivo } from '#ledger/activos'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import AnularCompra from '#ledger/actions/anular_compra'
import DepreciarActivos from '#ledger/actions/depreciar_activos'
import DarDeBajaActivo from '#ledger/actions/dar_de_baja_activo'
import RegistrarActivo from '#ledger/actions/registrar_activo'
import { ejecutarCron } from '#billing/jobs'
import { errorDe, saldoCuenta } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { afirmarLibroFase5 } from '#tests/ledger/verificar_compras'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 5 (§10.10): activos fijos desde una compra o a mano, depreciación lineal mensual con cron
 * idempotente y baja con su asiento y evento.
 */

const EQUIPO_RED = `${CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO}.01`
const DEP_EQUIPO_RED = `${CUENTAS_GT.DEPRECIACION_ACUMULADA}.01`

async function compraDeActivo(ctx: ContextoAccion, proveedorId: number, extra: Record<string, unknown> = {}) {
    return new RegistrarCompra().execute(
        {
            proveedor_id: proveedorId,
            tipo_documento: 'FACT',
            numero: unico('A'),
            fecha_documento: haceMeses(3, 5),
            condicion: 'credito',
            retenciones: [],
            lineas: [
                {
                    descripcion: 'OLT 16 puertos',
                    tipo: 'activo_fijo',
                    clase_activo: 'equipo_red',
                    total: '11200.00',
                    activo_serie: 'ZTE-123',
                    activo_ubicacion: 'Nodo central',
                    ...extra,
                },
            ],
        },
        ctx,
    )
}

async function activoDeCompra(compraId: number) {
    const fila = await db.from('ledger.activos').where('compra_id', compraId).select('id').firstOrFail()
    return verActivo(Number(fila.id))
}

test.group('Fase 5 · activos fijos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('compra con activo fijo: alta en su transacción, depreciación lineal por mes y repetir no duplica', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx)
        const sobreTope = await errorDe(compraDeActivo(e.ctx, proveedor.id, { activo_tasa_anual: '50' }))
        assert.equal(sobreTope.codigo, 'tasa_sobre_tope')
        const compra = await compraDeActivo(e.ctx, proveedor.id)
        assert.deepEqual(await partidas('compra', compra.id), [
            [EQUIPO_RED, '10000.00', '0.00', '+C_BASE_BIEN'],
            [CUENTAS_GT.IVA_CREDITO, '1200.00', '0.00', '+C_IVA'],
            [CUENTAS_GT.PROVEEDORES, '0.00', '11200.00', null],
        ])
        const activo = await activoDeCompra(compra.id)
        assert.equal(activo.costo, '10000.00')
        assert.equal(activo.tasa_anual, '10.00')
        assert.equal(activo.cuota_mensual, '83.33')
        assert.equal(activo.serie, 'ZTE-123')
        assert.equal(activo.inicio_depreciacion, haceMeses(2))

        const corrida = await new DepreciarActivos().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(corrida.cuotas, 2)
        assert.equal(corrida.monto, '166.66')
        const otra = await new DepreciarActivos().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(otra.cuotas, 0)
        // el cron con lock tampoco duplica
        await ejecutarCron('depreciar')
        const despues = await verActivo(activo.id)
        assert.equal(despues.cuotas, 2)
        assert.equal(despues.depreciacion_acumulada, '166.66')
        assert.equal(despues.valor_libros, '9833.34')
        assert.equal(await saldoCuenta(e.B, DEP_EQUIPO_RED), '-166.66')
        assert.deepEqual(await partidas('depreciacion', activo.id), [
            [CUENTAS_GT.DEPRECIACIONES, '83.33', '0.00', null],
            [DEP_EQUIPO_RED, '0.00', '83.33', null],
            [CUENTAS_GT.DEPRECIACIONES, '83.33', '0.00', null],
            [DEP_EQUIPO_RED, '0.00', '83.33', null],
        ])
        const futuro = await errorDe(new DepreciarActivos().execute({ hasta: haceMeses(0) }, e.ctx))
        assert.include(futuro.reglas, 'mes_terminado')

        // con cuotas, la compra no se anula
        const anular = await errorDe(
            new AnularCompra().execute({ compra_id: compra.id, motivo: 'no' }, e.ctx),
        )
        assert.equal(anular.codigo, 'activo_con_cuotas')

        // venta por debajo del valor en libros: pérdida 5.3.06
        const baja = await new DarDeBajaActivo().execute(
            {
                activo_id: activo.id,
                tipo: 'venta',
                motivo: 'venta a otro ISP',
                precio_venta: '9000.00',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
            },
            e.ctx,
        )
        assert.equal(baja.estado, 'dado_de_baja')
        assert.equal(baja.baja!.valor_libros, '9833.34')
        assert.deepEqual(await partidas('baja_activo', activo.id), [
            [DEP_EQUIPO_RED, '166.66', '0.00', null],
            [e.banco.get(e.B)!.codigo, '9000.00', '0.00', null],
            [CUENTAS_GT.PERDIDA_BAJA_ACTIVOS, '833.34', '0.00', null],
            [EQUIPO_RED, '0.00', '10000.00', null],
        ])
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'activo.dado_de_baja')
            .whereRaw(`payload->>'activo_id' = ?`, [String(activo.id)])
            .first()
        assert.equal(evento?.payload.valor_libros, '9833.34')
        const dosVeces = await errorDe(
            new DarDeBajaActivo().execute(
                { activo_id: activo.id, tipo: 'retiro', motivo: 'otra vez' },
                e.ctx,
            ),
        )
        assert.equal(dosVeces.codigo, 'activo_dado_de_baja')
        assert.equal(await saldoCuenta(e.B, EQUIPO_RED), '0.00')
        assert.equal(await saldoCuenta(e.B, DEP_EQUIPO_RED), '0.00')
        await afirmarLibroFase5(assert, [e.B, e.C])
    })

    test('alta a mano con depreciación inicial; retiro con ganancia o pérdida; anular una compra sin cuotas cierra su activo', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const manual = await new RegistrarActivo().execute(
            {
                empresa_id: e.B,
                clase: 'computacion',
                descripcion: 'Servidor RADIUS',
                fecha_alta: haceMeses(3, 2),
                costo: '6000.00',
                depreciacion_inicial: '1000.00',
                contrapartida: '3.1.01',
            },
            e.ctx,
        )
        assert.equal(manual.tasa_anual, '33.33')
        assert.deepEqual(await partidas('alta_activo', manual.id), [
            [`${CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO}.02`, '6000.00', '0.00', null],
            [`${CUENTAS_GT.DEPRECIACION_ACUMULADA}.02`, '0.00', '1000.00', null],
            [CUENTAS_GT.CAPITAL_SOCIAL, '0.00', '5000.00', null],
        ])
        const caja = await errorDe(
            new RegistrarActivo().execute(
                {
                    empresa_id: e.B,
                    clase: 'otros',
                    descripcion: 'x',
                    costo: '10.00',
                    contrapartida: '1.1.01.01',
                },
                e.ctx,
            ),
        )
        assert.include(caja.reglas, 'contrapartida')
        // retiro: deprecia hasta el mes anterior y la pérdida es el valor en libros
        const retiro = await new DarDeBajaActivo().execute(
            { activo_id: manual.id, tipo: 'retiro', motivo: 'quemado por un rayo' },
            e.ctx,
        )
        assert.equal(retiro.cuotas, 2)
        assert.equal(retiro.depreciacion_acumulada, '1333.30')
        assert.equal(retiro.baja!.valor_libros, '4666.70')

        const proveedor = await proveedorEn(e.B, e.ctx)
        const compra = await compraDeActivo(e.ctx, proveedor.id, { activo_tasa_anual: '5' })
        const activo = await activoDeCompra(compra.id)
        assert.equal(activo.tasa_anual, '5.00')
        await new AnularCompra().execute({ compra_id: compra.id, motivo: 'factura equivocada' }, e.ctx)
        const anulado = await verActivo(activo.id)
        assert.equal(anulado.baja!.tipo, 'anulacion')
        assert.isNull(anulado.baja!.asiento_id)
        const sinCuotas = await new DepreciarActivos().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(sinCuotas.cuotas, 0)
        await afirmarLibroFase5(assert, [e.B, e.C])
    })

    test('rutas: activos y depreciación bajo pedido', async ({ client, assert }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const alta = await estado(
            client
                .post('/api/v1/activos')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('a'))
                .json({
                    clase: 'vehiculos',
                    descripcion: 'Pick-up de instalaciones',
                    costo: '120000.00',
                    fecha_alta: haceMeses(2, 3),
                }),
            201,
        )
        const corrida = await estado(
            client.post('/api/v1/activos/depreciar').bearerToken(e.token).headers(cabecera).json({}),
            200,
        )
        assert.equal(corrida.body().cuotas, 1)
        assert.deepEqual(corrida.body().ids, [alta.body().id])
        const lista = await estado(
            client.get('/api/v1/activos').bearerToken(e.token).headers(cabecera).qs({ estado: 'vigente' }),
            200,
        )
        assert.equal(lista.body().data[0].depreciacion_acumulada, '2000.00')
        await estado(
            client
                .post(`/api/v1/activos/${alta.body().id}/dar-de-baja`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ tipo: 'retiro', motivo: 'siniestro' }),
            200,
        )
        await afirmarLibroFase5(assert, [e.B, e.C])
    })
})
