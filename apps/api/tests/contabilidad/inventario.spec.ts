import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { errorDe, saldoCuenta, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { hacerAgenteRetencion, haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import { bodegaEn, comprarInventario, productoEn, saldoInventario } from '#tests/inventario/ayudas_inventario'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import { dec } from '#ledger/dinero'
import { valorKardex } from '#inventario/kardex'
import { balanceSaldos, estadoResultados } from '#ledger/estados_financieros'
import { saldoActivo } from '#fiscal/declaraciones_renta'
import { compararRegimenes } from '#fiscal/comparador'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import AnularCompra from '#ledger/actions/anular_compra'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import CerrarEjercicio from '#ledger/actions/cerrar_ejercicio'
import ImportarExtracto from '#ledger/actions/importar_extracto'
import RegistrarDesdeExtracto from '#ledger/actions/registrar_desde_extracto'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import ConsumirInventario from '#inventario/actions/consumir_inventario'
import TrasladarInventario from '#inventario/actions/trasladar_inventario'
import AjustarInventario from '#inventario/actions/ajustar_inventario'
import DarDeBajaInventario from '#inventario/actions/dar_de_baja_inventario'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'
import CrearSorteo, { type EntradaSorteo } from '#lealtad/actions/crear_sorteo'
import EditarSorteo from '#lealtad/actions/editar_sorteo'
import PublicarBasesSorteo from '#lealtad/actions/publicar_bases_sorteo'
import AbrirSorteo from '#lealtad/actions/abrir_sorteo'
import CerrarCorteSorteo from '#lealtad/actions/cerrar_corte_sorteo'
import MarcarRequisitoSorteo from '#lealtad/actions/marcar_requisito_sorteo'
import EjecutarSorteo from '#lealtad/actions/ejecutar_sorteo'
import EntregarPremioSorteo from '#lealtad/actions/entregar_premio_sorteo'
import { REQUISITOS_PARA_EJECUTAR } from '#lealtad/sorteos'

/**
 * Auditor contable · inventario interno, fase A (rama `a3/inventario-a`, `contratos/inventario.md`).
 * Los invariantes de §8 (1, 2, 4 y 5) y los del auditor están en el inv. 24 de `verificar_libro.ts`;
 * aquí cada escenario se arma con las acciones y termina en `afirmarLibro`.
 *
 * Hallazgos de la fase A (arreglados por A3 en a5df8c0; quedan como pruebas normales, detalle en
 * `.claude/integration/a3.md`):
 *
 * - **H39** (alta, arreglado: `esCuentaDelKardex` en premios, extractos, reglas y compras): `1.1.14 Inventarios` se mueve sin kardex desde otros módulos. El premio de un
 *   sorteo en bienes acepta `contrapartida: cuenta` con `cuenta_codigo = 1.1.14` (no está en
 *   `CONTROL_NO_PERMITIDAS`) y `contrapartida: compra` con una línea de inventario (acredita la cuenta
 *   de la línea, 1.1.14, por su base); una línea del extracto bancario acepta 1.1.14 de contrapartida
 *   (`contrapartidaProhibida`). En los tres el libro y el kardex dejan de cuadrar (inv. 24.1 y 24.5).
 * - **H40** (media, arreglado: sin crédito fiscal con el régimen de la fecha del documento): una empresa del régimen de pequeño contribuyente toma crédito fiscal por
 *   defecto en una FACT con IVA (`prepararCompra` solo mira el documento): el IVA va a 1.1.04 y el
 *   inventario entra a la base, cuando su IVA no es acreditable y es costo.
 * - Fase B (rama `a3/inventario-b`): los de comodato y unidades están en `inventario_comodato.spec.ts`.
 * - **H41** (menor, arreglado: con existencia, el promedio; sin costo, > 0): un ajuste positivo (sobrante) acepta `costo_unitario` a voluntad aunque el
 *   producto tenga existencia y promedio en la bodega (§5: «al último costo promedio»), y acepta
 *   `costo_unitario = 0` sin costo conocido (entra a Q0, sin asiento), en vez de 422 `costo_requerido`.
 */

const AYER = new Date(Date.now() - 24 * 3600 * 1000)
const MANANA = new Date(Date.now() + 24 * 3600 * 1000)

/** Viola los invariantes en una transacción que se revierte y devuelve los nombres cortos. */
async function fabricado(empresas: number[], paso: (trx: TransactionClientContract) => Promise<void>) {
    const trx = await db.transaction()
    try {
        await paso(trx)
        const violaciones = await verificarLibro(empresas, { cliente: trx })
        return violaciones.map((v) => v.invariante.split(' ')[0]!)
    } finally {
        await trx.rollback()
    }
}

/** Valor del kardex de la empresa (lectura de A3), a centavos. */
async function valorDe(empresaId: number) {
    const valor = await valorKardex(empresaId)
    return valor.toFixed(2)
}

async function nombresDeViolaciones(empresas: number[]) {
    const violaciones = await verificarLibro(empresas)
    return violaciones.map((v) => v.invariante.split(' ')[0]!)
}

async function escenario() {
    const e = await prepararEmpresasGt()
    const producto = await productoEn(e.B, e.ctx)
    const bodega = await bodegaEn(e.B, e.ctx)
    return { e, producto, bodega }
}

async function compra(
    e: EmpresasGt,
    empresaId: number,
    linea: Record<string, unknown>,
    extra: Record<string, unknown> = {},
    proveedor?: { id: number },
) {
    const p = proveedor ?? (await proveedorEn(empresaId, e.ctx))
    return new RegistrarCompra().execute(
        {
            proveedor_id: p.id,
            tipo_documento: 'FACT',
            numero: await unicoBd('F'),
            fecha_documento: hoyGuatemala(),
            condicion: 'credito',
            ...extra,
            lineas: [{ descripcion: 'Inventario', tipo: 'bien', ...linea }],
        } as never,
        e.ctx,
    )
}

async function entradaDe(compraId: number) {
    return db
        .from('inventario.movimientos')
        .where({ origen_tipo: 'compra', origen_id: compraId, tipo: 'entrada_compra' })
        .select('cantidad', 'costo_total')
        .first()
}

function bases(): EntradaSorteo['bases'] {
    return {
        mecanica: 'Sorteo electrónico con argos-sorteo-v1 ante notario',
        regla_participacion: '1 boleto por cada servicio al día al corte',
        plazo_reclamo_dias: 30,
        no_reclamados: 'Pasan al suplente en orden',
        publicacion_resultados: 'Portal del ISP el mismo día',
        resolucion_gobernacion: 'GD-2026-077',
        fuente_valor_publico: 'Números del primer premio de la Lotería Santa Lucía del día del sorteo',
    }
}

/** Sorteo ejecutado en B con un premio en bienes (router, Q100 sin ISR); devuelve sorteo y ganador. */
async function sorteoConBien(e: EmpresasGt) {
    await programaConReglas(e.B, e.ctx, { diferimiento: true })
    const creado = await new CrearSorteo().execute(
        {
            empresa_id: e.B,
            nombre: unico('Sorteo del auditor'),
            criterios: { boletos_por_servicio: 1, admite_canje: false },
            inscripcion_desde: hoyGuatemala(),
            corte_en: AYER,
            fecha_sorteo: MANANA,
            lugar: 'Oficinas centrales',
            suplentes: 0,
            premios: [{ nombre: 'Router', valor: '100.00', tipo: 'bien', retiene_isr: false }],
        },
        e.ctx,
    )
    await new EditarSorteo().execute({ id: creado.id, version: creado.version, bases: bases() }, e.ctx)
    await new PublicarBasesSorteo().execute({ id: creado.id }, e.ctx)
    await new MarcarRequisitoSorteo().execute(
        { sorteo_id: creado.id, clave: 'bases_diaco', estado: 'cumplido', evidencia: 'Prensa' },
        e.ctx,
    )
    await new AbrirSorteo().execute({ id: creado.id }, e.ctx)
    for (let i = 0; i < 2; i++) await servicioEn(e.B, { instalacion: '2026-10-01' })
    await new CerrarCorteSorteo().execute({ id: creado.id }, e.ctx)
    for (const clave of REQUISITOS_PARA_EJECUTAR) {
        await new MarcarRequisitoSorteo().execute(
            { sorteo_id: creado.id, clave, estado: 'cumplido', evidencia: `Ref. ${clave}` },
            e.ctx,
        )
    }
    const sorteo = await new EjecutarSorteo().execute(
        { id: creado.id, valor_publico: '90210', valor_publico_evidencia: 'acta del notario' },
        e.ctx,
    )
    const ganador = sorteo.ganadores.find((g) => g.premio_posicion === 1)!
    return { sorteo, ganador }
}

test.group('Auditor contable · inventario fase A', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('inv. 24 detecta: movimiento sin asiento, saldo editado, 1.1.14 sin kardex, asiento con otra contrapartida, traslado cojo y existencia negativa a una fecha', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        const otra = await bodegaEn(e.B, e.ctx)
        await comprarInventario(e.B, e.ctx, {
            producto_id: producto.id,
            bodega_id: bodega.id,
            cantidad: 10,
            total: '112.00',
        })
        const consumo = await new ConsumirInventario().execute(
            { producto_id: producto.id, bodega_id: bodega.id, cantidad: '2' },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
        const empresas = [e.B, e.C]
        const insertar = (trx: TransactionClientContract, datos: Record<string, unknown>) =>
            trx
                .insertQuery()
                .table('inventario.movimientos')
                .insert({
                    empresa_id: e.B,
                    fecha: hoyGuatemala(),
                    producto_id: producto.id,
                    bodega_id: bodega.id,
                    actor_tipo: 'sistema',
                    ...datos,
                })

        // una salida con costo y sin asiento: 1.1.14 ≠ kardex y movimiento mal formado
        const sinAsiento = await fabricado(empresas, async (trx) => {
            await insertar(trx, {
                tipo: 'consumo',
                cantidad: '-1',
                costo_unitario: '10',
                costo_total: '-10.00',
            })
        })
        assert.includeMembers(sinAsiento, [
            '24.libro_distinto_del_kardex_a_una_fecha',
            '24.movimiento_mal_formado',
        ])
        // la proyección editada a mano
        assert.include(
            await fabricado(empresas, async (trx) => {
                await trx.rawQuery('ALTER TABLE inventario.saldos DISABLE TRIGGER USER')
                await trx.rawQuery(`UPDATE inventario.saldos SET valor = valor + 1 WHERE producto_id = ?`, [
                    producto.id,
                ])
            }),
            '24.saldos_distintos_del_kardex',
        )
        // un asiento que mueve 1.1.14 sin kardex
        assert.includeMembers(
            await fabricado(empresas, async (trx) => {
                await new RegistrarAsiento().execute(
                    {
                        empresa_id: e.B,
                        fecha: hoyGuatemala(),
                        descripcion: 'inventario a mano',
                        origen_tipo: 'ajuste',
                        movimientos: [
                            { cuenta: CUENTAS_GT.INVENTARIOS, debe: '5.00' },
                            { cuenta: CUENTAS.GASTO_OTROS, haber: '5.00' },
                        ],
                    },
                    e.ctx,
                    { trx },
                )
            }),
            ['24.libro_distinto_del_kardex_a_una_fecha', '24.asiento_mueve_1114_distinto_del_kardex'],
        )
        // el consumo contra otra cuenta (un ingreso), con el mismo monto
        assert.include(
            await fabricado(empresas, async (trx) => {
                await trx.rawQuery('ALTER TABLE ledger.movimientos DISABLE TRIGGER USER')
                await trx.rawQuery(
                    `UPDATE ledger.movimientos SET cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo = '4.2.04')
                      WHERE asiento_id = ? AND cuenta_id <> (SELECT id FROM ledger.cuentas WHERE codigo = '1.1.14')`,
                    [consumo.asiento_id!],
                )
            }),
            '24.asiento_propio_con_otra_contrapartida',
        )
        // un traslado de una sola pata, y una salida fechada antes de la entrada
        const cojo = await fabricado(empresas, async (trx) => {
            await trx.rawQuery('ALTER TABLE inventario.saldos DISABLE TRIGGER USER')
            await insertar(trx, {
                tipo: 'traslado',
                bodega_id: otra.id,
                cantidad: '1',
                costo_unitario: '0',
                costo_total: '0.00',
                traslado_id: 999_999,
            })
            await insertar(trx, {
                tipo: 'traslado',
                fecha: '2020-01-01',
                cantidad: '-1',
                costo_unitario: '0',
                costo_total: '0.00',
                traslado_id: 999_998,
            })
        })
        assert.includeMembers(cojo, ['24.traslado_mal_formado', '24.existencia_negativa_en_una_fecha'])
    })

    test('promedio y redondeos: entradas a precios distintos y salidas fraccionarias; nunca valor sin existencia ni negativo; la última salida lleva el resto', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        const tecnico = await bodegaEn(e.B, e.ctx)
        await new CargarSaldoInicial().execute(
            { producto_id: producto.id, bodega_id: bodega.id, cantidad: '3', costo_total: '0.01' },
            e.ctx,
        )
        // 0.01 / 3: las salidas parciales se redondean a 0.00 y 0.01, y nunca bajo cero
        for (const cantidad of ['1', '1']) {
            await new ConsumirInventario().execute(
                { producto_id: producto.id, bodega_id: bodega.id, cantidad },
                e.ctx,
            )
        }
        assert.deepEqual(await saldoInventario(producto.id, bodega.id), ['1.000', '0.00'])
        const proveedor = await proveedorEn(e.B, e.ctx)
        for (const [cantidad, total] of [
            [7, '33.33'],
            [3, '100.01'],
            [11, '0.13'],
            [1, '999.99'],
        ] as const) {
            await comprarInventario(e.B, e.ctx, {
                producto_id: producto.id,
                bodega_id: bodega.id,
                cantidad,
                total,
                proveedorId: proveedor.id,
            })
        }
        const pasos: Array<() => Promise<unknown>> = [
            () =>
                new ConsumirInventario().execute(
                    { producto_id: producto.id, bodega_id: bodega.id, cantidad: '0.333' },
                    e.ctx,
                ),
            () =>
                new TrasladarInventario().execute(
                    {
                        producto_id: producto.id,
                        bodega_origen_id: bodega.id,
                        bodega_destino_id: tecnico.id,
                        cantidad: '4.777',
                    },
                    e.ctx,
                ),
            () =>
                new DarDeBajaInventario().execute(
                    {
                        producto_id: producto.id,
                        bodega_id: bodega.id,
                        cantidad: '1.001',
                        causa: 'danado',
                        motivo: 'golpe',
                    },
                    e.ctx,
                ),
            () =>
                new AjustarInventario().execute(
                    { producto_id: producto.id, bodega_id: bodega.id, cantidad: '-0.007', motivo: 'conteo' },
                    e.ctx,
                ),
            () =>
                new AjustarInventario().execute(
                    {
                        producto_id: producto.id,
                        bodega_id: tecnico.id,
                        cantidad: '0.5',
                        motivo: 'sobrante del técnico',
                    },
                    e.ctx,
                ),
            () =>
                new ConsumirInventario().execute(
                    { producto_id: producto.id, bodega_id: tecnico.id, cantidad: '2.2' },
                    e.ctx,
                ),
            () =>
                new TrasladarInventario().execute(
                    {
                        producto_id: producto.id,
                        bodega_origen_id: tecnico.id,
                        bodega_destino_id: bodega.id,
                        cantidad: '0.077',
                    },
                    e.ctx,
                ),
        ]
        for (const paso of pasos) await paso()
        // vaciar las dos bodegas en salidas fraccionarias: la última lleva todo el valor
        for (const b of [bodega.id, tecnico.id]) {
            let [cantidad] = await saldoInventario(producto.id, b)
            while (dec(cantidad!).gt(0)) {
                const sale = dec(cantidad!).gt('1.5') ? '1.499' : cantidad!
                await new ConsumirInventario().execute(
                    { producto_id: producto.id, bodega_id: b, cantidad: sale },
                    e.ctx,
                )
                ;[cantidad] = await saldoInventario(producto.id, b)
            }
            assert.deepEqual(await saldoInventario(producto.id, b), ['0.000', '0.00'])
        }
        assert.equal(await valorDe(e.B), '0.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.INVENTARIOS), '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('costo de la compra: con crédito fiscal la base; FACT sin crédito, FPEQ y RECIBO el total con IVA; al contado, a crédito y con retenciones', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        const linea = (total: string, cantidad = 1) => ({
            total,
            cantidad,
            producto_id: producto.id,
            bodega_id: bodega.id,
        })
        const conCredito = await compra(e, e.B, linea('112.00', 2))
        assert.deepEqual(await entradaDe(conCredito.id), { cantidad: '2.000', costo_total: '100.00' })
        const sinCredito = await compra(e, e.B, linea('112.00'), { credito_fiscal: false })
        assert.deepEqual(await entradaDe(sinCredito.id), { cantidad: '1.000', costo_total: '112.00' })
        assert.deepEqual(await partidas('compra', sinCredito.id), [
            [CUENTAS_GT.INVENTARIOS, '112.00', '0.00', '+C_SIN_CREDITO'],
            [CUENTAS_GT.PROVEEDORES, '0.00', '112.00', null],
        ])
        const pequeno = await proveedorEn(e.B, e.ctx, { tipo: 'pequeno_contribuyente' })
        const fpeq = await compra(e, e.B, linea('50.00'), { tipo_documento: 'FPEQ' }, pequeno)
        assert.deepEqual(await entradaDe(fpeq.id), { cantidad: '1.000', costo_total: '50.00' })
        const recibo = await compra(e, e.B, linea('30.00'), { tipo_documento: 'RECIBO' })
        assert.deepEqual(await entradaDe(recibo.id), { cantidad: '1.000', costo_total: '30.00' })
        const contado = await compra(e, e.B, linea('224.00', 4), {
            condicion: 'contado',
            metodo: 'caja',
            caja_id: e.cajas.get(e.B)!,
        })
        assert.deepEqual(await entradaDe(contado.id), { cantidad: '4.000', costo_total: '200.00' })
        // agente de retención de IVA: la retención baja lo que se paga, no el costo del inventario
        await hacerAgenteRetencion(e.B, e.ctx)
        const retenida = await compra(e, e.B, linea('33600.00', 10))
        assert.isAbove(retenida.retenciones.length, 0, 'la compra lleva retención')
        assert.deepEqual(await entradaDe(retenida.id), { cantidad: '10.000', costo_total: '30000.00' })
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.INVENTARIOS), await valorDe(e.B))
        assert.equal(await valorDe(e.B), '30492.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('NCRE de devolución por cantidad (fase B): al costo de la compra, el residuo en la última, sin crédito con el IVA; la cuenta 1.1.14 a mano sigue en 422', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        const proveedor = await proveedorEn(e.B, e.ctx)
        // 3 a Q10.00 sin crédito fiscal (Q3.33, Q3.33 y Q3.34) y otra compra a otro precio en la bodega
        const original = await compra(
            e,
            e.B,
            { total: '10.00', cantidad: 3, producto_id: producto.id, bodega_id: bodega.id },
            { credito_fiscal: false },
            proveedor,
        )
        await compra(e, e.B, { total: '112.00', cantidad: 1, producto_id: producto.id, bodega_id: bodega.id })
        const ncre = async (total: string, cantidad: number, numero?: string) =>
            compra(
                e,
                e.B,
                { total, cantidad, producto_id: producto.id, bodega_id: bodega.id },
                {
                    tipo_documento: 'NCRE',
                    compra_referencia_id: original.id,
                    numero: numero ?? (await unicoBd('NC')),
                },
                proveedor,
            )
        const primera = await ncre('3.33', 1)
        const segunda = await ncre('3.33', 1)
        const ultima = await errorDe(ncre('3.33', 1))
        assert.equal(ultima.codigo, 'devolucion_distinta_del_costo', 'la última lleva el residuo: Q3.34')
        const tercera = await ncre('3.34', 1)
        const nadaMas = await errorDe(ncre('0.01', 1))
        assert.equal(nadaMas.status, 422, 'nada más que devolver')
        assert.deepEqual(await saldoInventario(producto.id, bodega.id), ['1.000', '100.00'])
        // anular la de en medio la reingresa al mismo costo
        await new AnularCompra().execute({ compra_id: segunda.id, motivo: 'auditoría' }, e.ctx)
        assert.deepEqual(await saldoInventario(producto.id, bodega.id), ['2.000', '103.33'])
        assert.isOk(primera.id && tercera.id)
        // ni siquiera con la cuenta de inventario a mano
        const aMano = await errorDe(
            compra(
                e,
                e.B,
                { total: '5.00', cuenta: CUENTAS_GT.INVENTARIOS },
                { tipo_documento: 'NCRE', compra_referencia_id: original.id },
                proveedor,
            ),
        )
        assert.equal(aMano.status, 422)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('anular una compra: después de un traslado 409 sin escribir nada; con existencia y valor suficientes revierte al mismo costo', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        const tecnico = await bodegaEn(e.B, e.ctx)
        const datos = { producto_id: producto.id, bodega_id: bodega.id, cantidad: 10, total: '56.00' }
        const a = await comprarInventario(e.B, e.ctx, datos)
        await new TrasladarInventario().execute(
            {
                producto_id: producto.id,
                bodega_origen_id: bodega.id,
                bodega_destino_id: tecnico.id,
                cantidad: '6',
            },
            e.ctx,
        )
        const antes = await db.from('inventario.movimientos').where('empresa_id', e.B).count('* as n').first()
        const trasladada = await errorDe(
            new AnularCompra().execute({ compra_id: a.id, motivo: 'auditoría' }, e.ctx),
        )
        assert.equal(trasladada.status, 409)
        assert.equal(trasladada.codigo, 'existencia_insuficiente')
        const despues = await db
            .from('inventario.movimientos')
            .where('empresa_id', e.B)
            .count('* as n')
            .first()
        assert.equal(Number(despues.n), Number(antes.n))
        // otra compra al mismo precio y un consumo: la bodega tiene 4 + 10 − 4 = 10 a Q5
        const b = await comprarInventario(e.B, e.ctx, datos)
        await new ConsumirInventario().execute(
            { producto_id: producto.id, bodega_id: bodega.id, cantidad: '4' },
            e.ctx,
        )
        await new AnularCompra().execute({ compra_id: b.id, motivo: 'auditoría' }, e.ctx)
        assert.deepEqual(await saldoInventario(producto.id, bodega.id), ['0.000', '0.00'])
        assert.deepEqual(await saldoInventario(producto.id, tecnico.id), ['6.000', '30.00'])
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.INVENTARIOS), '30.00')
        // a un precio distinto, la anulación que dejaría valor sin existencia responde 409 (decisión del líder)
        const c = await comprarInventario(e.B, e.ctx, { ...datos, cantidad: 2, total: '22.40' })
        await comprarInventario(e.B, e.ctx, { ...datos, cantidad: 2, total: '44.80' })
        await new ConsumirInventario().execute(
            { producto_id: producto.id, bodega_id: bodega.id, cantidad: '2' },
            e.ctx,
        )
        const caro = await errorDe(
            new AnularCompra().execute({ compra_id: c.id, motivo: 'auditoría' }, e.ctx),
        )
        assert.equal(caro.codigo, 'valor_insuficiente')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('multiempresa: producto o bodega de otra empresa responde 404 en compra, consumo, traslado y saldo inicial; ningún asiento mezcla empresas', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        const productoC = await productoEn(e.C, e.ctx)
        const bodegaC = await bodegaEn(e.C, e.ctx)
        await comprarInventario(e.B, e.ctx, {
            producto_id: producto.id,
            bodega_id: bodega.id,
            cantidad: 5,
            total: '56.00',
        })
        await comprarInventario(e.C, e.ctx, {
            producto_id: productoC.id,
            bodega_id: bodegaC.id,
            cantidad: 5,
            total: '56.00',
        })
        const cruzados = [
            () =>
                compra(e, e.B, {
                    total: '11.20',
                    cantidad: 1,
                    producto_id: producto.id,
                    bodega_id: bodegaC.id,
                }),
            () =>
                compra(e, e.B, {
                    total: '11.20',
                    cantidad: 1,
                    producto_id: productoC.id,
                    bodega_id: bodega.id,
                }),
            () =>
                new ConsumirInventario().execute(
                    { producto_id: producto.id, bodega_id: bodegaC.id, cantidad: '1' },
                    e.ctx,
                ),
            () =>
                new TrasladarInventario().execute(
                    {
                        producto_id: producto.id,
                        bodega_origen_id: bodega.id,
                        bodega_destino_id: bodegaC.id,
                        cantidad: '1',
                    },
                    e.ctx,
                ),
            () =>
                new CargarSaldoInicial().execute(
                    { producto_id: productoC.id, bodega_id: bodega.id, cantidad: '1', costo_total: '1.00' },
                    e.ctx,
                ),
        ]
        for (const intento of cruzados) {
            const error = await errorDe(intento())
            assert.equal(error.status, 404, error.detalle)
        }
        assert.equal(await valorDe(e.B), '50.00')
        assert.equal(await valorDe(e.C), '50.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('traslado sin asiento: 1.1.14 no cambia y el valor viaja al promedio de origen; concurrencia: dos salidas simultáneas del último stock, una sola pasa', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        const tecnico = await bodegaEn(e.B, e.ctx)
        await comprarInventario(e.B, e.ctx, {
            producto_id: producto.id,
            bodega_id: bodega.id,
            cantidad: 3,
            total: '11.20',
        })
        const asientos = await db.from('ledger.asientos').where('empresa_id', e.B).count('* as n').first()
        const traslado = await new TrasladarInventario().execute(
            {
                producto_id: producto.id,
                bodega_origen_id: bodega.id,
                bodega_destino_id: tecnico.id,
                cantidad: '1',
            },
            e.ctx,
        )
        assert.equal(traslado.salida.costo_total, '-3.33')
        assert.equal(traslado.entrada.costo_total, '3.33')
        const despues = await db.from('ledger.asientos').where('empresa_id', e.B).count('* as n').first()
        assert.equal(Number(despues.n), Number(asientos.n), 'el traslado no tiene asiento')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.INVENTARIOS), '10.00')

        // dos consumos del último stock del técnico a la vez
        const resultados = await Promise.allSettled([
            new ConsumirInventario().execute(
                { producto_id: producto.id, bodega_id: tecnico.id, cantidad: '1' },
                e.ctx,
            ),
            new ConsumirInventario().execute(
                { producto_id: producto.id, bodega_id: tecnico.id, cantidad: '1' },
                e.ctx,
            ),
        ])
        assert.deepEqual(resultados.map((r) => r.status).sort(), ['fulfilled', 'rejected'])
        const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult
        const motivo = await errorDe(Promise.reject(rechazo.reason))
        assert.equal(motivo.codigo, 'existencia_insuficiente')
        // y una salida y una anulación de la compra a la vez sobre la bodega de origen
        assert.deepEqual(await saldoInventario(producto.id, tecnico.id), ['0.000', '0.00'])
        await Promise.allSettled([
            new ConsumirInventario().execute(
                { producto_id: producto.id, bodega_id: bodega.id, cantidad: '2' },
                e.ctx,
            ),
            new ConsumirInventario().execute(
                { producto_id: producto.id, bodega_id: bodega.id, cantidad: '1' },
                e.ctx,
            ),
        ])
        const [cantidad] = await saldoInventario(producto.id, bodega.id)
        assert.include(['0.000', '1.000'], cantidad!)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('saldo inicial contra 2.9.01: mientras no se reclasifique, apertura_cero lo muestra; con fecha pasada y en un mes cerrado, el bloqueo de siempre', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        const otra = await bodegaEn(e.B, e.ctx)
        const inicial = await new CargarSaldoInicial().execute(
            {
                producto_id: producto.id,
                bodega_id: bodega.id,
                cantidad: '12.5',
                costo_unitario: '3.333333',
                fecha: haceMeses(1, 15),
            },
            e.ctx,
        )
        assert.equal(inicial.costo_total, '41.67')
        assert.deepEqual(await partidas('inventario', inicial.id), [
            [CUENTAS_GT.INVENTARIOS, '41.67', '0.00', null],
            [CUENTAS.SALDOS_APERTURA, '0.00', '41.67', null],
        ])
        assert.equal(await saldoCuenta(e.B, CUENTAS.SALDOS_APERTURA), '-41.67')
        // el mes de dos meses atrás, cerrado: un saldo inicial con esa fecha no entra (ni al kardex)
        const cerrado = haceMeses(2, 10)
        const [anio, mes] = cerrado.split('-').map(Number)
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: anio!, mes: mes! }, e.ctx)
        const bloqueado = await errorDe(
            new CargarSaldoInicial().execute(
                {
                    producto_id: producto.id,
                    bodega_id: otra.id,
                    cantidad: '1',
                    costo_total: '1.00',
                    fecha: cerrado,
                },
                e.ctx,
            ),
        )
        assert.equal(bloqueado.codigo, 'periodo_cerrado')
        assert.deepEqual(await saldoInventario(producto.id, otra.id), ['0.000', '0.00'])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('cierre anual con inventario: 5.2.07, 5.6.02 y 4.2.04 cierran a resultados; 1.1.14 queda; balance y estado de resultados cuadran; ISO y comparador leen 1.1.14', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        const ANIO = 2024
        await new CargarSaldoInicial().execute(
            {
                producto_id: producto.id,
                bodega_id: bodega.id,
                cantidad: '10',
                costo_total: '80.00',
                fecha: `${ANIO}-02-01`,
            },
            e.ctx,
        )
        // movimientos del año en las cuentas nuevas (las acciones del kardex van con la fecha de hoy)
        for (const [debe, haber, monto] of [
            [CUENTAS_GT.MATERIALES_INSTALACION, '1.1.02.01', '7.00'],
            [CUENTAS_GT.MERMAS_INVENTARIO, '1.1.02.01', '3.00'],
            [CUENTAS_GT.COSTO_EQUIPO_VENDIDO, '1.1.02.01', '4.00'],
            ['1.1.02.01', CUENTAS_GT.SOBRANTES_INVENTARIO, '2.00'],
            ['1.1.02.01', '4.1.01', '100.00'],
        ] as const) {
            await new RegistrarAsiento().execute(
                {
                    empresa_id: e.B,
                    fecha: `${ANIO}-05-10`,
                    descripcion: 'movimiento del auditor',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: debe, debe: monto },
                        { cuenta: haber, haber: monto },
                    ],
                },
                e.ctx,
            )
        }
        // el contador reclasifica los saldos de apertura a capital (apertura_cero, §10.5)
        await new RegistrarAsiento().execute(
            {
                empresa_id: e.B,
                fecha: `${ANIO}-02-01`,
                descripcion: 'reclasificación de la apertura del inventario',
                origen_tipo: 'ajuste',
                movimientos: [
                    { cuenta: CUENTAS.SALDOS_APERTURA, debe: '80.00' },
                    { cuenta: CUENTAS_GT.CAPITAL_SOCIAL, haber: '80.00' },
                ],
            },
            e.ctx,
        )
        const activo = await saldoActivo(db.connection(), e.B, `${ANIO}-12-31`)
        assert.equal(activo.toFixed(2), '168.00')
        const resultados = await estadoResultados({ desde: `${ANIO}-01-01`, hasta: `${ANIO}-12-31` }, [e.B])
        assert.deepEqual(resultados.empresas[0]!.totales, {
            ingresos: '102.00',
            gastos: '14.00',
            resultado: '88.00',
        })
        for (let mes = 1; mes <= 11; mes++) {
            await new CerrarPeriodo().execute({ empresa_id: e.B, anio: ANIO, mes }, e.ctx)
        }
        await new CerrarEjercicio().execute({ empresa_id: e.B, anio: ANIO, isr: { monto: '0.00' } }, e.ctx)
        const fin = `${ANIO}-12-31`
        const balance = await balanceSaldos({ hasta: fin }, [e.B])
        const cuentas = new Map(balance.empresas[0]!.cuentas.map((c) => [c.codigo, c.saldo]))
        assert.equal(cuentas.get(CUENTAS_GT.INVENTARIOS), '80.00')
        for (const codigo of [
            CUENTAS_GT.MATERIALES_INSTALACION,
            CUENTAS_GT.MERMAS_INVENTARIO,
            CUENTAS_GT.COSTO_EQUIPO_VENDIDO,
            CUENTAS_GT.SOBRANTES_INVENTARIO,
        ]) {
            assert.equal(cuentas.get(codigo) ?? '0.00', '0.00', codigo)
        }
        assert.isTrue(balance.empresas[0]!.totales.cuadra)
        // hoy: un consumo del saldo de 2024 y el comparador con 1.1.14 en el activo
        await new ConsumirInventario().execute(
            { producto_id: producto.id, bodega_id: bodega.id, cantidad: '2.5' },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.INVENTARIOS), '60.00')
        const comparador = await compararRegimenes([e.B], null)
        assert.lengthOf(comparador.empresas, 1)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H39 (arreglado): el premio de un sorteo con contrapartida cuenta 1.1.14 acredita inventarios sin kardex', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        await comprarInventario(e.B, e.ctx, {
            producto_id: producto.id,
            bodega_id: bodega.id,
            cantidad: 2,
            total: '224.00',
        })
        const { sorteo, ganador } = await sorteoConBien(e)
        const intento = await new EntregarPremioSorteo()
            .execute(
                {
                    sorteo_id: sorteo.id,
                    ganador_id: ganador.id,
                    contrapartida: 'cuenta',
                    cuenta_codigo: CUENTAS_GT.INVENTARIOS,
                },
                e.ctx,
            )
            .then(() => null)
            .catch((error) => error)
        // lo correcto: 422 (1.1.14 es la cuenta del kardex); si entra, el libro deja de cuadrar
        assert.deepEqual(
            { rechazado: intento !== null, violaciones: await nombresDeViolaciones([e.B, e.C]) },
            { rechazado: true, violaciones: [] },
            'el premio no debe acreditar 1.1.14',
        )
    })

    test('H39 (arreglado): el premio de un sorteo con contrapartida compra de una línea de inventario acredita 1.1.14 por la base sin kardex', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        const comprada = await comprarInventario(e.B, e.ctx, {
            producto_id: producto.id,
            bodega_id: bodega.id,
            cantidad: 2,
            total: '224.00',
        })
        const linea = await db.from('ledger.compras_lineas').where('compra_id', comprada.id).firstOrFail()
        const { sorteo, ganador } = await sorteoConBien(e)
        const intento = await new EntregarPremioSorteo()
            .execute(
                {
                    sorteo_id: sorteo.id,
                    ganador_id: ganador.id,
                    contrapartida: 'compra',
                    compra_linea_id: Number(linea.id),
                    unidades: 1,
                },
                e.ctx,
            )
            .then(() => null)
            .catch((error) => error)
        // lo correcto: 422 hasta que la entrega saque la unidad del kardex (o una salida propia)
        assert.deepEqual(
            { rechazado: intento !== null, violaciones: await nombresDeViolaciones([e.B, e.C]) },
            { rechazado: true, violaciones: [] },
            'la entrega no debe acreditar 1.1.14 sin su salida del kardex',
        )
    })

    test('H39 (arreglado): una línea del extracto bancario con contrapartida 1.1.14 mueve inventarios sin kardex', async ({
        assert,
    }) => {
        const { e } = await escenario()
        const hoy = hoyGuatemala()
        const extracto = await new ImportarExtracto().execute(
            {
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                desde: hoy,
                hasta: hoy,
                saldo_inicial: '0.00',
                saldo_final: '-15.00',
                lineas: [
                    { fecha: hoy, descripcion: 'COMPRA CONECTORES', referencia: 'X-1', monto: '-15.00' },
                ],
            },
            e.ctx,
        )
        const linea = await db.from('ledger.extractos_lineas').where('extracto_id', extracto.id).firstOrFail()
        const error = await errorDe(
            new RegistrarDesdeExtracto().execute(
                { linea_id: Number(linea.id), cuenta: CUENTAS_GT.INVENTARIOS },
                e.ctx,
            ),
        ).catch(() => null)
        assert.deepEqual(
            { rechazado: error !== null, violaciones: await nombresDeViolaciones([e.B, e.C]) },
            { rechazado: true, violaciones: [] },
            'la contrapartida 1.1.14 debe responder 422 (contrapartida)',
        )
    })

    test('H40 (arreglado): una empresa de pequeño contribuyente no tiene crédito fiscal: su FACT entra al inventario con el IVA', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await new CambiarRegimen().execute(
            {
                empresa_id: e.C,
                regimen: 'pequeno_contribuyente',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción',
            },
            e.ctx,
        )
        const producto = await productoEn(e.C, e.ctx)
        const bodega = await bodegaEn(e.C, e.ctx)
        const comprada = await comprarInventario(e.C, e.ctx, {
            producto_id: producto.id,
            bodega_id: bodega.id,
            cantidad: 1,
            total: '112.00',
        })
        await afirmarLibro(assert, [e.B, e.C])
        const entrada = await entradaDe(comprada.id)
        assert.deepEqual(
            {
                credito_fiscal: comprada.credito_fiscal,
                kardex: entrada?.costo_total,
                iva_credito: dec(await saldoCuenta(e.C, CUENTAS_GT.IVA_CREDITO)).toFixed(2),
            },
            { credito_fiscal: false, kardex: '112.00', iva_credito: '0.00' },
        )
    })

    test('H41 (arreglado): un sobrante con existencia entra al promedio de la bodega, no al costo_unitario que se teclee; sin costo conocido, costo 0 es 422', async ({
        assert,
    }) => {
        const { e, producto, bodega } = await escenario()
        const nuevo = await productoEn(e.B, e.ctx)
        await comprarInventario(e.B, e.ctx, {
            producto_id: producto.id,
            bodega_id: bodega.id,
            cantidad: 10,
            total: '67.20',
        })
        const sobrante = await new AjustarInventario().execute(
            {
                producto_id: producto.id,
                bodega_id: bodega.id,
                cantidad: '1',
                motivo: 'conteo',
                costo_unitario: '1000',
            },
            e.ctx,
        )
        const gratis = await errorDe(
            new AjustarInventario().execute(
                {
                    producto_id: nuevo.id,
                    bodega_id: bodega.id,
                    cantidad: '5',
                    motivo: 'conteo',
                    costo_unitario: '0',
                },
                e.ctx,
            ),
        ).catch(() => null)
        await afirmarLibro(assert, [e.B, e.C])
        assert.deepEqual(
            { sobrante: sobrante.costo_total, sin_costo: gratis?.reglas ?? 'entró a Q0' },
            { sobrante: '6.00', sin_costo: ['costo_requerido'] },
        )
    })
})
