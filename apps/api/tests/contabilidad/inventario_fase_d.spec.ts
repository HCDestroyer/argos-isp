import { test } from '@japa/runner'
import { randomInt, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { errorDe, saldoCuenta, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro, type OpcionesVerificacion } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, nitUnico, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { bodegaEn, comprarInventario, productoEn, saldoInventario } from '#tests/inventario/ayudas_inventario'
import { comprarSeries } from '#tests/inventario/ayudas_fase_d'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import CrearTraslado from '#inventario/actions/crear_traslado'
import RecibirTraslado from '#inventario/actions/recibir_traslado'
import CancelarTraslado from '#inventario/actions/cancelar_traslado'
import ConfigurarInventario from '#inventario/actions/configurar_inventario'
import DesactivarBodega from '#inventario/actions/desactivar_bodega'
import ConsumirInventario from '#inventario/actions/consumir_inventario'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'
import CrearProductosLote from '#inventario/actions/crear_productos_lote'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import AnularFactura from '#billing/actions/anular_factura'
import CerrarApertura from '#ledger/actions/cerrar_apertura'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'

/**
 * Auditor contable · inventario fase D (rama `a3/inventario-v2`, pedido del PM del 31 de octubre;
 * `contratos/inventario.md` D.1–D.8). Escenarios borde de lo contable: órdenes de traslado con redondeo,
 * varias órdenes del mismo producto en tránsito, faltantes y cancelaciones por cantidad y por serie;
 * `consumible_cobro` (IVA, reintento con la misma clave, `cargo_duplicado`, anulación que devuelve el
 * costo); saldo inicial por lote fuera de periodo; multiempresa; y que los checks nuevos (25.*) detectan
 * lo que deben. Los hallazgos abiertos van con `.fails` y su invariante en `HALLAZGOS_ABIERTOS`:
 *
 * - **H74 · alta**: confirmar un borrador de compra no exige que el proveedor sea el NIT emisor de la
 *   factura (`proveedor.id` de otro NIT o `proveedor.crear.nit` distinto) ni revisa la autorización FEL;
 *   la misma factura queda dos veces (doble crédito fiscal) o en el libro de compras con otro NIT.
 * - **H75 · alta**: confirmar un borrador no exige `moneda = GTQ` (una factura en USD entra con sus
 *   montos como quetzales) ni que Σ líneas = `totales.total` (una línea que la IA no leyó deja la
 *   compra por menos que la factura).
 * - **H76 · media**: el saldo inicial (y el lote con entrada, D.4) entra contra 2.9.01 después del
 *   cierre de la apertura: inventario contra patrimonio sin compra, sin IVA ni proveedor.
 * - **H78 · media** (sobre el arreglo de H75 en 5c17a24): la tolerancia de Q0.01 por línea deja confirmar
 *   una factura cuyas líneas no suman su total; la compra (y la CxP) queda por Σ líneas. En FEL el
 *   GranTotal es exactamente Σ Total de los ítems: la diferencia solo puede ser una lectura mal hecha.
 * - **H77 · baja**: una bodega origen con todo en tránsito se desactiva (su saldo es 0) y el faltante o
 *   la cancelación devuelven la existencia a una bodega inactiva.
 */

const PLANTILLA = readFileSync(new URL('../inventario/fixtures/fel_fact.xml', import.meta.url), 'utf8')

function xmlFel(datos: { nit: string; receptor: string; serie: string; numero: string; moneda?: string }) {
    return Buffer.from(
        PLANTILLA.replaceAll('{{NIT}}', datos.nit)
            .replaceAll('{{RECEPTOR}}', datos.receptor)
            .replaceAll('{{SERIE}}', datos.serie)
            .replaceAll('{{NUMERO}}', datos.numero)
            .replaceAll('{{FECHA}}', hoyGuatemala())
            .replaceAll('{{DESC1}}', 'CABLE UTP Cat 6 (exterior)')
            .replaceAll('{{CANT2}}', '50')
            .replaceAll('CodigoMoneda="GTQ"', `CodigoMoneda="${datos.moneda ?? 'GTQ'}"`),
    )
}

function documento() {
    return {
        serie: `A${randomInt(1_000_000, 9_999_999)}`,
        numero: String(randomInt(100_000_000, 999_999_999)),
    }
}

async function nitEmpresa(empresaId: number) {
    const fila = await db.from('core.empresas').where('id', empresaId).select('nit').firstOrFail()
    return String(fila.nit)
}

async function concepto(empresaId: number): Promise<number> {
    await db.rawQuery('SELECT billing.sembrar_catalogos_cargo(?)', [empresaId])
    const fila = await db
        .from('billing.conceptos_cargo')
        .where({ empresa_id: empresaId, nombre: 'Equipo' })
        .select('id')
        .firstOrFail()
    return Number(fila.id)
}

async function bodegaTransito(empresaId: number): Promise<number> {
    const fila = await db
        .from('inventario.bodegas')
        .where({ empresa_id: empresaId, tipo: 'transito' })
        .firstOrFail()
    return Number(fila.id)
}

/** Las dos empresas sin firma obligatoria (se recibe con `aceptacion_sistema`). */
async function sinFirma(e: EmpresasGt) {
    for (const empresa of [e.B, e.C]) {
        await new ConfigurarInventario().execute(
            { empresa_id: empresa, traslado_firma_obligatoria: false, version: 0 },
            e.ctx,
        )
    }
}

function recibir(e: EmpresasGt, id: number, lineas?: Array<Record<string, unknown>>) {
    return new RecibirTraslado().execute(
        { id, metodo_recepcion: 'aceptacion_sistema', registro_global: true, lineas: lineas as never },
        e.ctx,
    )
}

/** Violaciones de la verificación (con los hallazgos abiertos), solo su nombre corto. */
async function invariantes(empresas: number[], cliente?: OpcionesVerificacion['cliente']) {
    const v = await verificarLibro(empresas, {
        incluirHallazgosAbiertos: true,
        sinFuncionesProducto: true,
        cliente,
    })
    return v.map((x) => x.invariante.split(' ')[0]!)
}

async function cargarXml(client: any, e: EmpresasGt, xml: Buffer) {
    const r = await estado(
        client
            .post('/api/v1/compras/borradores')
            .bearerToken(e.token)
            .headers({ 'X-Empresa-Id': String(e.B) })
            .file('archivo', xml, { filename: `${unico('f')}.xml` }),
        201,
    )
    return r.body()
}

function confirmar(
    client: any,
    e: EmpresasGt,
    b: { id: number; version: number },
    cuerpo: Record<string, unknown>,
) {
    return client
        .post(`/api/v1/compras/borradores/${b.id}/confirmar`)
        .bearerToken(e.token)
        .headers({ 'X-Empresa-Id': String(e.B) })
        .header('Idempotency-Key', unico('confirmar'))
        .json({ version: b.version, condicion: 'credito', lineas: [], ...cuerpo })
}

async function contarAsientos(empresaId: number): Promise<number> {
    const fila = await db.from('ledger.asientos').where('empresa_id', empresaId).count('* as n').first()
    return Number(fila.n)
}

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
    const error = await errorDe(promesa)
    return error.codigo
}

async function statusDe(peticion: PromiseLike<{ status: () => number }>): Promise<number> {
    const respuesta = await peticion
    return respuesta.status()
}

async function cuerpoDe(peticion: PromiseLike<{ body: () => any }>) {
    const respuesta = await peticion
    return respuesta.body()
}

async function documentoDe(promesa: Promise<{ documento: string }>): Promise<string> {
    const resultado = await promesa
    return resultado.documento
}

test.group('Auditor contable · inventario fase D', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('traslados por cantidad: redondeo del faltante, dos órdenes del mismo producto en tránsito, cancelación; sin asiento, promedio nunca negativo y 1.1.14 = kardex', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await sinFirma(e)
        const central = await bodegaEn(e.B, e.ctx)
        const destino = await bodegaEn(e.B, e.ctx)
        const cable = await productoEn(e.B, e.ctx)
        const tornillo = await productoEn(e.B, e.ctx, { nombre: 'Tornillo', unidad: 'unidad' })
        // 3 a Q10.00 (base) y 4 a Q0.05: los centavos no se reparten exactos
        await comprarInventario(e.B, e.ctx, {
            producto_id: cable.id,
            bodega_id: central.id,
            cantidad: 3,
            total: '11.20',
        })
        await comprarInventario(e.B, e.ctx, {
            producto_id: tornillo.id,
            bodega_id: central.id,
            cantidad: 4,
            total: '0.06',
        })
        const asientos = await contarAsientos(e.B)

        // orden A: 2 de 3 metros (6.67) y 3 de 4 tornillos; orden B: el último metro (3.33, vacía el origen)
        const a = await new CrearTraslado().execute(
            {
                bodega_origen_id: central.id,
                bodega_destino_id: destino.id,
                lineas: [
                    { producto_id: cable.id, cantidad: '2' },
                    { producto_id: tornillo.id, cantidad: '3' },
                ],
            },
            e.ctx,
        )
        const b = await new CrearTraslado().execute(
            {
                bodega_origen_id: central.id,
                bodega_destino_id: destino.id,
                lineas: [{ producto_id: cable.id, cantidad: '1' }],
            },
            e.ctx,
        )
        assert.equal(a.lineas[0]!.costo_total, '6.67')
        assert.equal(b.lineas[0]!.costo_total, '3.33')
        assert.deepEqual(await saldoInventario(cable.id, central.id), ['0.000', '0.00'])
        const transito = await bodegaTransito(e.B)
        assert.deepEqual(await saldoInventario(cable.id, transito), ['3.000', '10.00'])
        assert.deepEqual(await invariantes([e.B, e.C]), [])

        // B llega completa; A llega con 1 de 2 metros (3.34 → 3.33 recibido + 3.34 vuelve) y 0.001 tornillos
        await recibir(e, b.id)
        const ra = await recibir(e, a.id, [
            { linea_id: a.lineas[0]!.id, cantidad_recibida: '1' },
            { linea_id: a.lineas[1]!.id, cantidad_recibida: '0.001' },
        ])
        assert.equal(ra.estado, 'recibida_con_diferencias')
        assert.equal(ra.lineas[0]!.costo_recibido, '3.34', 'round(1 × 6.67 / 2)')
        // el faltante vuelve al origen al costo de la línea: 6.67 − 3.34
        assert.deepEqual(await saldoInventario(cable.id, central.id), ['1.000', '3.33'])
        assert.deepEqual(await saldoInventario(cable.id, destino.id), ['2.000', '6.67'])
        assert.deepEqual(await saldoInventario(cable.id, transito), ['0.000', '0.00'])
        const enviado = ra.lineas[1]!.costo_total
        assert.equal(ra.lineas[1]!.costo_recibido, '0.00', 'una milésima de tornillo no llega a un centavo')
        assert.deepEqual(await saldoInventario(tornillo.id, transito), ['0.000', '0.00'])
        const [, valorOrigen] = await saldoInventario(tornillo.id, central.id)
        assert.equal(valorOrigen, '0.05', `vuelve todo lo enviado (${enviado}) y queda el valor de la compra`)

        // una tercera orden que se cancela devuelve exactamente lo que salió
        const c = await new CrearTraslado().execute(
            {
                bodega_origen_id: central.id,
                bodega_destino_id: destino.id,
                lineas: [{ producto_id: tornillo.id, cantidad: '3.999' }],
            },
            e.ctx,
        )
        await new CancelarTraslado().execute({ id: c.id, motivo: 'auditoría' }, e.ctx)
        assert.deepEqual(await saldoInventario(tornillo.id, central.id), ['3.999', '0.05'])
        const asientosDespues = await contarAsientos(e.B)
        assert.equal(asientosDespues, asientos, 'las órdenes no generan asientos')
        // una orden cerrada no se recibe ni se cancela otra vez
        assert.equal(await codigoDe(recibir(e, a.id)), 'traslado_ya_recibido')
        assert.equal(
            await codigoDe(new CancelarTraslado().execute({ id: a.id, motivo: 'x' }, e.ctx)),
            'orden_no_en_transito',
        )
        assert.equal(await codigoDe(recibir(e, c.id)), 'traslado_cancelado')
        assert.deepEqual(await invariantes([e.B, e.C]), [])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('traslados por serie: faltante por serie vuelve al origen a su costo, cancelación de unidades; las unidades nunca quedan en tránsito sin orden', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await sinFirma(e)
        const central = await bodegaEn(e.B, e.ctx)
        const destino = await bodegaEn(e.B, e.ctx)
        const onu = await productoEn(e.B, e.ctx, {
            nombre: 'ONU',
            unidad: 'unidad',
            tipo: 'equipo',
            seguimiento: 'serie',
        })
        const onus = await comprarSeries(e.B, e.ctx, { producto_id: onu.id, bodega_id: central.id, n: 3 })
        const orden = await new CrearTraslado().execute(
            {
                bodega_origen_id: central.id,
                bodega_destino_id: destino.id,
                lineas: [{ producto_id: onu.id, unidad_ids: [onus[0]!.id, onus[1]!.id] }],
            },
            e.ctx,
        )
        const otra = await new CrearTraslado().execute(
            {
                bodega_origen_id: central.id,
                bodega_destino_id: destino.id,
                lineas: [{ producto_id: onu.id, unidad_ids: [onus[2]!.id] }],
            },
            e.ctx,
        )
        assert.deepEqual(await invariantes([e.B]), [])
        await recibir(e, orden.id, [{ linea_id: orden.lineas[0]!.id, series_faltantes: [onus[1]!.serie] }])
        await new CancelarTraslado().execute({ id: otra.id, motivo: 'auditoría' }, e.ctx)
        const unidades = await db
            .from('inventario.unidades')
            .whereIn(
                'id',
                onus.map((u) => u.id),
            )
            .orderBy('id')
        assert.deepEqual(
            unidades.map((u) => Number(u.bodega_id)),
            [destino.id, central.id, central.id],
        )
        assert.deepEqual(await saldoInventario(onu.id, central.id), ['2.000', '600.00'])
        assert.deepEqual(await saldoInventario(onu.id, destino.id), ['1.000', '300.00'])
        assert.deepEqual(await invariantes([e.B]), [])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('los checks 25.* detectan un movimiento en tránsito sin su orden y una orden que no cuadra con su kardex (en una transacción que se deshace)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const central = await bodegaEn(e.B, e.ctx)
        const destino = await bodegaEn(e.B, e.ctx)
        const cable = await productoEn(e.B, e.ctx)
        await comprarInventario(e.B, e.ctx, {
            producto_id: cable.id,
            bodega_id: central.id,
            cantidad: 10,
            total: '11.20',
        })
        const orden = await new CrearTraslado().execute(
            {
                bodega_origen_id: central.id,
                bodega_destino_id: destino.id,
                lineas: [{ producto_id: cable.id, cantidad: '2' }],
            },
            e.ctx,
        )
        const transito = await bodegaTransito(e.B)
        const trx = await db.transaction()
        try {
            const base = {
                empresa_id: e.B,
                tipo: 'traslado',
                fecha: hoyGuatemala(),
                producto_id: cable.id,
                costo_unitario: '1.000000',
                actor_tipo: 'sistema',
                request_id: randomUUID(),
            }
            const { rows } = await trx.rawQuery(`SELECT nextval('inventario.traslados_seq')::bigint AS id`)
            const trasladoId = Number(rows[0].id)
            // un par a mano: central → tránsito, sin orden
            await trx.table('inventario.movimientos').insert([
                {
                    ...base,
                    bodega_id: central.id,
                    cantidad: '-1',
                    costo_total: '-1.00',
                    traslado_id: trasladoId,
                },
                { ...base, bodega_id: transito, cantidad: '1', costo_total: '1.00', traslado_id: trasladoId },
            ])
            // la línea de la orden dice 3 (el kardex 2)
            await trx
                .from('inventario.ordenes_traslado_lineas')
                .where('orden_id', orden.id)
                .update({ cantidad: '3' })
            const encontrados = await invariantes([e.B], trx)
            for (const inv of [
                '25.movimiento_de_orden_ajeno',
                '25.transito_distinto_de_sus_ordenes',
                '25.orden_de_traslado_distinta_de_su_kardex',
            ]) {
                assert.include(encontrados, inv)
            }
        } finally {
            await trx.rollback()
        }
        assert.deepEqual(await invariantes([e.B]), [])
    })

    test('consumible_cobro: IVA del cargo, reintento con la misma Idempotency-Key sin doble cobro ni doble costo, cargo_duplicado y anulación que devuelve el costo al kardex', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const conceptoId = await concepto(e.B)
        const bodega = await bodegaEn(e.B, e.ctx)
        const conector = await productoEn(e.B, e.ctx, {
            nombre: 'Conector cobrado',
            unidad: 'unidad',
            modalidad: 'consumible_cobro',
            precio_venta: '10.00',
            concepto_cargo_id: conceptoId,
        })
        // 3 a Q1.00 base: el costo de 3 es 3.00 (el promedio a 3 decimales no se arrastra)
        await comprarInventario(e.B, e.ctx, {
            producto_id: conector.id,
            bodega_id: bodega.id,
            cantidad: 6,
            total: '6.72',
        })
        const { servicioId } = await servicioEn(e.B)
        const orden = randomUUID()
        const clave = `iris:consumo:${orden}`
        const cuerpo = {
            lineas: [
                { producto_id: conector.id, cantidad: '2' },
                { producto_id: conector.id, cantidad: '1' },
            ],
            bodega_id: bodega.id,
            servicio_id: servicioId,
            origen_tipo: 'iris_orden',
            origen_id: orden,
        }
        const pedir = () =>
            estado(
                client
                    .post('/api/v1/inventario/consumos')
                    .bearerToken(e.token)
                    .headers(cabecera)
                    .header('Idempotency-Key', clave)
                    .json(cuerpo),
                201,
            )
        const primera = await cuerpoDe(pedir())
        const segunda = await cuerpoDe(pedir())
        assert.equal(segunda.factura_id, primera.factura_id)
        assert.deepEqual(
            primera.cargos.map((c: { monto: string }) => c.monto),
            ['20.00', '10.00'],
        )
        const facturas = await db.from('billing.facturas').where('origen_externo_id', orden)
        assert.lengthOf(facturas, 1, 'un solo cargo')
        const factura = facturas[0]!
        // Q30.00 con IVA: base 26.79, IVA 3.21 (cada línea 17.86 + 2.14 y 8.93 + 1.07)
        assert.equal(factura.total, '30.00')
        assert.equal(factura.iva, '3.21')
        const ingreso = await partidas('factura', factura.id)
        const haber = ingreso.filter(([, , h]) => h !== '0.00').map(([c, , h]) => `${c}:${h}`)
        assert.sameMembers(
            haber.filter((h) => h.startsWith(CUENTAS.IVA_DEBITO)),
            [`${CUENTAS.IVA_DEBITO}:3.21`],
        )
        const ventas = await db
            .from('inventario.movimientos')
            .where({ empresa_id: e.B, tipo: 'venta' })
            .orderBy('id')
        assert.lengthOf(ventas, 2, 'una venta por línea, sin duplicar en el reintento')
        assert.deepEqual(
            ventas.map((v) => v.costo_total),
            ['-2.00', '-1.00'],
        )
        assert.deepEqual(await saldoInventario(conector.id, bodega.id), ['3.000', '3.00'])
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.COSTO_EQUIPO_VENDIDO), '3.00')

        // un cargo a mano de la misma orden con ese producto: 409; sin producto (la visita) sí
        const manual = (productoId: number | null) =>
            new EmitirCargoUnico().execute(
                {
                    servicio_id: servicioId,
                    origen_tipo: 'iris_orden',
                    origen_id: orden,
                    lineas: [
                        {
                            concepto_id: conceptoId,
                            precio_unitario: '10.00',
                            cantidad: '1',
                            ...(productoId ? { producto_id: productoId, bodega_id: bodega.id } : {}),
                        },
                    ],
                },
                e.ctx,
            )
        assert.equal(await codigoDe(manual(conector.id)), 'cargo_duplicado')
        assert.equal(await documentoDe(manual(null)), 'factura')

        // la anulación del cargo devuelve el costo y la existencia a la bodega; el producto se puede volver a cobrar
        await new AnularFactura().execute({ factura_id: factura.id, motivo: 'auditoría' }, e.ctx)
        assert.deepEqual(await saldoInventario(conector.id, bodega.id), ['6.000', '6.00'])
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.COSTO_EQUIPO_VENDIDO), '0.00')
        const reversos = await db
            .from('inventario.movimientos')
            .where({ empresa_id: e.B, tipo: 'reverso_venta' })
        assert.lengthOf(reversos, 2)
        assert.equal(await documentoDe(manual(conector.id)), 'factura')
        assert.deepEqual(await invariantes([e.B, e.C]), [])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('multiempresa: orden a una bodega de otra empresa, consumo con bodega de otra empresa y borrador con producto de otra empresa no escriben nada', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const central = await bodegaEn(e.B, e.ctx)
        const ajena = await bodegaEn(e.C, e.ctx)
        const cable = await productoEn(e.B, e.ctx)
        const cableC = await productoEn(e.C, e.ctx)
        await comprarInventario(e.B, e.ctx, {
            producto_id: cable.id,
            bodega_id: central.id,
            cantidad: 10,
            total: '11.20',
        })
        const conteo = async () => {
            const fila = await db
                .from('inventario.movimientos')
                .whereIn('empresa_id', [e.B, e.C])
                .count('* as n')
                .first()
            return Number(fila.n)
        }
        const antes = await conteo()
        const traslado = await errorDe(
            new CrearTraslado().execute(
                {
                    bodega_origen_id: central.id,
                    bodega_destino_id: ajena.id,
                    lineas: [{ producto_id: cable.id, cantidad: '1' }],
                },
                e.ctx,
            ),
        )
        assert.equal(traslado.status, 404)
        const { servicioId } = await servicioEn(e.B)
        const consumo = await errorDe(
            new ConsumirInventario().execute(
                { producto_id: cable.id, cantidad: '1', bodega_id: ajena.id, servicio_id: servicioId },
                e.ctx,
            ),
        )
        assert.equal(consumo.status, 404)
        const doc = documento()
        const b = await cargarXml(
            client,
            e,
            xmlFel({ nit: await nitUnico(), receptor: await nitEmpresa(e.B), ...doc }),
        )
        const ajeno = await confirmar(client, e, b, {
            proveedor: { crear: { nombre: 'Proveedor' } },
            lineas: [{ indice: 0, producto: { id: cableC.id }, bodega_id: central.id }],
        })
        assert.include([404, 422], ajeno.status(), JSON.stringify(ajeno.body()))
        assert.equal(await conteo(), antes)
        const compras = await db
            .from('ledger.compras')
            .where('empresa_id', e.B)
            .whereRaw('upper(numero) = ?', [doc.numero])
        assert.lengthOf(compras, 0)
        assert.deepEqual(await invariantes([e.B, e.C]), [])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('lote con entrada (saldo inicial): fecha en un mes cerrado o futura no entra, y nada del lote queda', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const bodega = await bodegaEn(e.B, e.ctx)
        const cerrado = haceMeses(2, 10)
        const [anio, mes] = cerrado.split('-').map(Number)
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: anio!, mes: mes! }, e.ctx)
        const lote = (fecha: string) =>
            new CrearProductosLote().execute(
                {
                    empresa_id: e.B,
                    productos: [
                        {
                            sku: unico('SKU'),
                            nombre: 'Cable importado',
                            unidad: 'metro',
                            tipo: 'material',
                            entrada: { bodega_id: bodega.id, cantidad: '10', costo_unitario: '2.00', fecha },
                        },
                    ],
                },
                e.ctx,
            )
        assert.equal(await codigoDe(lote(cerrado)), 'periodo_cerrado')
        const futura = await errorDe(lote('2999-01-01'))
        assert.equal(futura.status, 422)
        const productos = await db
            .from('inventario.productos')
            .where('empresa_id', e.B)
            .count('* as n')
            .first()
        assert.equal(Number(productos.n), 0, 'el lote es todo o nada')
        assert.include(['0', '0.00'], await saldoCuenta(e.B, CUENTAS.SALDOS_APERTURA))
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H74 · alta: la misma factura confirmada desde un borrador con el NIT emisor mal leído entra dos veces (misma serie, número y autorización FEL)', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const receptor = await nitEmpresa(e.B)
        const doc = documento()
        const primera = await cargarXml(client, e, xmlFel({ nit: await nitUnico(), receptor, ...doc }))
        await estado(
            confirmar(client, e, primera, { proveedor: { crear: { nombre: 'Distribuidora' } } }),
            200,
        )
        // la misma factura, con el NIT del emisor mal leído (la IA o una captura a mano)
        const segunda = await cargarXml(client, e, xmlFel({ nit: await nitUnico(), receptor, ...doc }))
        const r = confirmar(client, e, segunda, {
            proveedor: { crear: { nombre: 'Distribuidora (otra vez)' } },
        })
        const status = await statusDe(r)
        assert.deepEqual(await invariantes([e.B]), [])
        assert.equal(status, 409, 'compra_duplicada por la autorización FEL')
    })

    test('H74 · alta: confirmar con un proveedor de otro NIT deja la compra en el libro de compras con un NIT que no emitió la factura', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const otro = await proveedorEn(e.B, e.ctx)
        const b = await cargarXml(
            client,
            e,
            xmlFel({ nit: await nitUnico(), receptor: await nitEmpresa(e.B), ...documento() }),
        )
        const r = confirmar(client, e, b, { proveedor: { id: otro.id } })
        const status = await statusDe(r)
        assert.deepEqual(await invariantes([e.B]), [])
        assert.equal(status, 422, 'proveedor_distinto')
    })

    test('H75 · alta: una factura en USD se registra con sus montos como quetzales', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const b = await cargarXml(
            client,
            e,
            xmlFel({ nit: await nitUnico(), receptor: await nitEmpresa(e.B), ...documento(), moneda: 'USD' }),
        )
        assert.equal(b.datos.moneda, 'USD')
        const r = confirmar(client, e, b, { proveedor: { crear: { nombre: 'Importadora' } } })
        const status = await statusDe(r)
        assert.deepEqual(await invariantes([e.B]), [])
        assert.equal(status, 422, 'moneda')
    })

    test('H75 · alta: un borrador cuyas líneas no suman el total de la factura se confirma por lo que suman las líneas', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const b = await cargarXml(
            client,
            e,
            xmlFel({ nit: await nitUnico(), receptor: await nitEmpresa(e.B), ...documento() }),
        )
        // la IA (o el usuario) perdió la última línea: totales sigue en 392.00
        const datos = { ...b.datos, lineas: b.datos.lineas.slice(0, 2) }
        const editado = await estado(
            client
                .post(`/api/v1/compras/borradores/${b.id}/editar`)
                .bearerToken(e.token)
                .headers({ 'X-Empresa-Id': String(e.B) })
                .json({ version: b.version, datos }),
            200,
        )
        const r = confirmar(client, e, editado.body(), { proveedor: { crear: { nombre: 'Distribuidora' } } })
        const status = await statusDe(r)
        assert.deepEqual(await invariantes([e.B]), [])
        assert.equal(status, 422, 'totales_descuadrados')
    })

    test('H78 · media: la tolerancia de H75 (Q0.01 por línea) registra la compra por Σ líneas (Q392.00) y no por el total de la factura (Q392.03): la CxP no es la de la factura', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const b = await cargarXml(
            client,
            e,
            xmlFel({ nit: await nitUnico(), receptor: await nitEmpresa(e.B), ...documento() }),
        )
        // en FEL el GranTotal es exactamente Σ Total de los ítems: una diferencia es una lectura mal hecha
        const datos = { ...b.datos, totales: { ...b.datos.totales, total: '392.03' } }
        const editado = await estado(
            client
                .post(`/api/v1/compras/borradores/${b.id}/editar`)
                .bearerToken(e.token)
                .headers({ 'X-Empresa-Id': String(e.B) })
                .json({ version: b.version, datos }),
            200,
        )
        const r = confirmar(client, e, editado.body(), { proveedor: { crear: { nombre: 'Distribuidora' } } })
        const status = await statusDe(r)
        assert.deepEqual(await invariantes([e.B]), [])
        assert.equal(status, 422, 'totales_descuadrados')
    })

    test('H76 · media: después del cierre de la apertura, un lote con entrada vuelve a mover 2.9.01 (inventario contra patrimonio sin compra)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const bodega = await bodegaEn(e.B, e.ctx)
        const existente = await productoEn(e.B, e.ctx)
        await new CargarSaldoInicial().execute(
            {
                producto_id: existente.id,
                bodega_id: bodega.id,
                cantidad: '5',
                costo_total: '50.00',
                fecha: haceMeses(1, 1),
            },
            e.ctx,
        )
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: haceMeses(1, 1) }, e.ctx)
        assert.equal(await saldoCuenta(e.B, CUENTAS.SALDOS_APERTURA), '0.00')
        const lote = await new CrearProductosLote()
            .execute(
                {
                    empresa_id: e.B,
                    productos: [
                        {
                            sku: await unicoBd('SKU', 'inventario.productos'),
                            nombre: 'Router comprado ayer',
                            unidad: 'unidad',
                            tipo: 'material',
                            entrada: { bodega_id: bodega.id, cantidad: '20', costo_unitario: '300.00' },
                        },
                    ],
                },
                e.ctx,
            )
            .then(
                () => null,
                (error: { status?: number }) => error,
            )
        assert.deepEqual(await invariantes([e.B]), [])
        assert.equal(lote?.status, 409, 'apertura_cerrada')
        assert.equal(await saldoCuenta(e.B, CUENTAS.SALDOS_APERTURA), '0.00')
    })

    test('H77 · baja: el origen con todo en tránsito se desactiva y el faltante vuelve a una bodega inactiva', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await sinFirma(e)
        const origen = await bodegaEn(e.B, e.ctx)
        const destino = await bodegaEn(e.B, e.ctx)
        const cable = await productoEn(e.B, e.ctx)
        await comprarInventario(e.B, e.ctx, {
            producto_id: cable.id,
            bodega_id: origen.id,
            cantidad: 4,
            total: '4.48',
        })
        const orden = await new CrearTraslado().execute(
            {
                bodega_origen_id: origen.id,
                bodega_destino_id: destino.id,
                lineas: [{ producto_id: cable.id, cantidad: '4' }],
            },
            e.ctx,
        )
        const desactivar = await errorDe(
            new DesactivarBodega().execute({ id: origen.id, version: origen.version }, e.ctx),
        )
        assert.equal(
            desactivar.codigo,
            'bodega_con_traslados',
            'una bodega con órdenes en tránsito no se desactiva',
        )
        await recibir(e, orden.id, [{ linea_id: orden.lineas[0]!.id, cantidad_recibida: '1' }])
    })
})
