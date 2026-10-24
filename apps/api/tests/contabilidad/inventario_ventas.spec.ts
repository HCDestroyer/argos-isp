import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { errorDe, saldoCuenta, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import { bodegaEn, productoEn, saldoInventario } from '#tests/inventario/ayudas_inventario'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { inventarioValorizado } from '#inventario/reportes'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import BloquearLibro from '#ledger/actions/bloquear_libro'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import AnularFactura from '#billing/actions/anular_factura'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import SustituirFactura from '#billing/actions/sustituir_factura'
import ConsumirInventario from '#inventario/actions/consumir_inventario'
import AbrirConteo from '#inventario/actions/abrir_conteo'
import ContarInventario from '#inventario/actions/contar_inventario'
import CerrarConteo from '#inventario/actions/cerrar_conteo'
import CrearSorteo from '#lealtad/actions/crear_sorteo'
import EditarSorteo from '#lealtad/actions/editar_sorteo'
import PublicarBasesSorteo from '#lealtad/actions/publicar_bases_sorteo'
import AbrirSorteo from '#lealtad/actions/abrir_sorteo'
import CerrarCorteSorteo from '#lealtad/actions/cerrar_corte_sorteo'
import MarcarRequisitoSorteo from '#lealtad/actions/marcar_requisito_sorteo'
import EjecutarSorteo from '#lealtad/actions/ejecutar_sorteo'
import EntregarPremioSorteo from '#lealtad/actions/entregar_premio_sorteo'
import AnularEntregaSorteo from '#lealtad/actions/anular_entrega_sorteo'
import { REQUISITOS_PARA_EJECUTAR } from '#lealtad/sorteos'
import { relojFiscal } from '#fiscal/comun'
import { compararRegimenes } from '#fiscal/comparador'
import EditarParametro from '#fiscal/actions/editar_parametro'
import DarDeBajaInventario from '#inventario/actions/dar_de_baja_inventario'

/**
 * Auditor contable · inventario fase C (rama `a3/inventario-c`, `contratos/inventario.md` §5 y
 * «Desvíos de la fase C»): venta por cargo único y sus reversos, conteos, fechas pasadas, reporte
 * valorizado, premio desde el kardex, multiempresa, bloqueos y pequeño contribuyente. Los invariantes
 * nuevos: 24.venta_distinta_de_su_factura, 24.premio_del_kardex_mal_ligado y el inv. 16 con
 * `contrapartida: inventario`.
 *
 * Hallazgos (arreglados por A3 en efd7341; detalle en `.claude/integration/a3.md`):
 *
 * - **H55** (media, arreglado: 409 `fecha_con_movimientos_posteriores` y el valor también se revisa): un consumo o un faltante con fecha pasada sale al promedio de hoy. El chequeo
 *   `existencia_insuficiente_en_fecha` solo mira la cantidad: si entre la fecha pedida y hoy entró
 *   mercadería a otro precio, el valor de la bodega en las fechas intermedias queda negativo, o con
 *   valor y sin existencia (y así el reporte valorizado y 1.1.14 a esas fechas).
 * - **H56** (media, arreglado: lo esperado se guarda al capturar): un conteo toma lo esperado al cerrar, no al capturar. Si entre la captura y el
 *   cierre hay ventas o consumos, la diferencia se registra como sobrante a 4.2.04 (o faltante a 5.6.02)
 *   que no existe.
 */

async function concepto(empresaId: number): Promise<number> {
    await db.rawQuery('SELECT billing.sembrar_catalogos_cargo(?)', [empresaId])
    const fila = await db
        .from('billing.conceptos_cargo')
        .where({ empresa_id: empresaId, nombre: 'Equipo' })
        .select('id')
        .firstOrFail()
    return Number(fila.id)
}

async function comprar(
    e: EmpresasGt,
    empresaId: number,
    productoId: number,
    bodegaId: number,
    cantidad: number,
    total: string,
    fecha = hoyGuatemala(),
) {
    const proveedor = await proveedorEn(empresaId, e.ctx)
    return new RegistrarCompra().execute(
        {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: unico('F'),
            fecha_documento: fecha,
            condicion: 'credito',
            lineas: [
                {
                    descripcion: 'Material',
                    tipo: 'bien',
                    total,
                    cantidad,
                    producto_id: productoId,
                    bodega_id: bodegaId,
                },
            ],
        },
        e.ctx,
    )
}

async function vender(
    e: EmpresasGt,
    servicioId: number,
    conceptoId: number,
    linea: { producto_id: number; bodega_id: number; cantidad?: string; unidad_id?: number; precio?: string },
) {
    return new EmitirCargoUnico().execute(
        {
            servicio_id: servicioId,
            lineas: [
                {
                    concepto_id: conceptoId,
                    precio_unitario: linea.precio ?? '112.00',
                    cantidad: linea.cantidad ?? '1',
                    producto_id: linea.producto_id,
                    bodega_id: linea.bodega_id,
                    ...(linea.unidad_id ? { unidad_id: linea.unidad_id } : {}),
                },
            ],
        } as never,
        e.ctx,
    )
}

async function movimientosDe(facturaId: number) {
    const lineas = db.from('billing.facturas_lineas').where('factura_id', facturaId).select('id')
    const filas = await db.from('inventario.movimientos').whereIn('factura_linea_id', lineas).orderBy('id')
    return filas.map((m) => [m.tipo, m.cantidad, m.costo_total])
}

async function escenario() {
    const e = await prepararEmpresasGt()
    const cable = await productoEn(e.B, e.ctx)
    const bodega = await bodegaEn(e.B, e.ctx)
    const { servicioId } = await servicioEn(e.B)
    const conceptoId = await concepto(e.B)
    return { e, cable, bodega, servicioId, conceptoId }
}

test.group('Auditor contable · inventario fase C', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())
    group.each.timeout(240_000)

    test('venta al promedio; compras a otro precio y otra venta en medio; anular la primera factura reingresa al costo de su venta, no al promedio de hoy', async ({
        assert,
    }) => {
        const { e, cable, bodega, servicioId, conceptoId } = await escenario()
        await comprar(e, e.B, cable.id, bodega.id, 10, '56.00') // Q5.00
        const primera = await vender(e, servicioId, conceptoId, {
            producto_id: cable.id,
            bodega_id: bodega.id,
            cantidad: '4',
        })
        await comprar(e, e.B, cable.id, bodega.id, 10, '78.40') // Q7.00: promedio 6.25
        const segunda = await vender(e, servicioId, conceptoId, {
            producto_id: cable.id,
            bodega_id: bodega.id,
            cantidad: '3',
        })
        assert.deepEqual(await movimientosDe(primera.id), [['venta', '-4.000', '-20.00']])
        assert.deepEqual(await movimientosDe(segunda.id), [['venta', '-3.000', '-18.75']])
        await new AnularFactura().execute({ factura_id: primera.id, motivo: 'auditoría' }, e.ctx)
        assert.deepEqual(await movimientosDe(primera.id), [
            ['venta', '-4.000', '-20.00'],
            ['reverso_venta', '4.000', '20.00'],
        ])
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['17.000', '101.25'])
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.COSTO_EQUIPO_VENDIDO), '18.75')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('nota de crédito parcial: no reingresa; la que completa la línea sí, al mismo costo; la sustitución de la factura cuadra', async ({
        assert,
    }) => {
        const { e, cable, bodega, servicioId, conceptoId } = await escenario()
        await comprar(e, e.B, cable.id, bodega.id, 10, '56.00')
        const cargo = await vender(e, servicioId, conceptoId, {
            producto_id: cable.id,
            bodega_id: bodega.id,
            cantidad: '2',
            precio: '50.00',
        })
        const linea = await db
            .from('billing.facturas_lineas')
            .where('factura_id', cargo.id)
            .whereNotNull('producto_id')
            .firstOrFail()
        await new EmitirNotaCredito().execute(
            {
                factura_id: cargo.id,
                motivo: 'descuento',
                lineas: [{ linea_id: Number(linea.id), monto: '30.00' }],
            },
            e.ctx,
        )
        assert.deepEqual(
            await movimientosDe(cargo.id),
            [['venta', '-2.000', '-10.00']],
            'la parcial no reingresa',
        )
        await afirmarLibro(assert, [e.B, e.C])
        await new EmitirNotaCredito().execute(
            {
                factura_id: cargo.id,
                motivo: 'devolución',
                lineas: [{ linea_id: Number(linea.id), monto: '70.00' }],
            },
            e.ctx,
        )
        assert.deepEqual(await movimientosDe(cargo.id), [
            ['venta', '-2.000', '-10.00'],
            ['reverso_venta', '2.000', '10.00'],
        ])
        await afirmarLibro(assert, [e.B, e.C])

        // sustitución de otro cargo (si el cargo único se sustituye, revierte y vende otra vez)
        const otro = await vender(e, servicioId, conceptoId, {
            producto_id: cable.id,
            bodega_id: bodega.id,
            cantidad: '1',
        })
        await new SustituirFactura()
            .execute({ factura_id: otro.id, motivo: 'auditoría: NIT equivocado' }, e.ctx)
            .catch(() => null)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('venta de una unidad de serie a su costo y premio desde el kardex: el gasto 5.1.03 es el costo, no el valor; el ISR va aparte; anular la entrega reingresa', async ({
        assert,
    }) => {
        const { e, bodega, servicioId, conceptoId } = await escenario()
        const router = await productoEn(e.B, e.ctx, {
            nombre: 'Router',
            tipo: 'equipo',
            seguimiento: 'serie',
        })
        const proveedor = await proveedorEn(e.B, e.ctx)
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('F'),
                fecha_documento: hoyGuatemala(),
                condicion: 'credito',
                lineas: [
                    {
                        descripcion: 'Routers',
                        tipo: 'bien',
                        total: '672.00',
                        cantidad: 2,
                        producto_id: router.id,
                        bodega_id: bodega.id,
                        unidades: [{ serie: unico('RT') }, { serie: unico('RT') }],
                    },
                ],
            } as never,
            e.ctx,
        )
        const unidades = await db.from('inventario.unidades').where('compra_id', compra.id).orderBy('id')
        const venta = await vender(e, servicioId, conceptoId, {
            producto_id: router.id,
            bodega_id: bodega.id,
            unidad_id: Number(unidades[0].id),
            precio: '560.00',
        })
        assert.deepEqual(await movimientosDe(venta.id), [['venta', '-1.000', '-300.00']])
        // premio Q500 con ISR 10 %: el gasto es el costo (Q300) más el ISR asumido (Q50)
        await programaConReglas(e.B, e.ctx, { diferimiento: true })
        const ayer = new Date(Date.now() - 86400000)
        const manana = new Date(Date.now() + 86400000)
        const creado = await new CrearSorteo().execute(
            {
                empresa_id: e.B,
                nombre: unico('Sorteo'),
                criterios: { boletos_por_servicio: 1, admite_canje: false },
                inscripcion_desde: hoyGuatemala(),
                corte_en: ayer,
                fecha_sorteo: manana,
                lugar: 'Oficinas',
                suplentes: 0,
                premios: [{ nombre: 'Router', valor: '500.00', tipo: 'bien', retiene_isr: true }],
            },
            e.ctx,
        )
        await new EditarSorteo().execute(
            {
                id: creado.id,
                version: creado.version,
                bases: {
                    mecanica: 'Sorteo electrónico ante notario',
                    regla_participacion: '1 boleto por servicio',
                    plazo_reclamo_dias: 30,
                    no_reclamados: 'Al suplente',
                    publicacion_resultados: 'Portal',
                    resolucion_gobernacion: 'GD-2026-099',
                    fuente_valor_publico: 'Lotería Santa Lucía',
                },
            },
            e.ctx,
        )
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
            { id: creado.id, valor_publico: '4242', valor_publico_evidencia: 'acta' },
            e.ctx,
        )
        const ganador = sorteo.ganadores.find((g) => g.premio_posicion === 1)!
        await new EntregarPremioSorteo().execute(
            {
                sorteo_id: sorteo.id,
                ganador_id: ganador.id,
                contrapartida: 'inventario',
                producto_id: router.id,
                bodega_id: bodega.id,
                unidad_id: Number(unidades[1].id),
            } as never,
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.PREMIOS_PROMOCIONES), '350.00')
        const fila = await db.from('lealtad.sorteos_ganadores').where('id', ganador.id).firstOrFail()
        assert.deepEqual(await partidas('sorteo', ganador.id), [
            [CUENTAS_GT.PREMIOS_PROMOCIONES, '50.00', '0.00', null],
            [CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR, '0.00', '50.00', null],
        ])
        assert.isNotNull(fila.movimiento_inventario_id)
        await afirmarLibro(assert, [e.B, e.C])
        await new AnularEntregaSorteo().execute(
            {
                sorteo_id: sorteo.id,
                ganador_id: ganador.id,
                motivo: 'auditoría: entrega equivocada',
            } as never,
            e.ctx,
        )
        assert.deepEqual(await saldoInventario(router.id, bodega.id), ['1.000', '300.00'])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('reporte valorizado a fechas pasadas = 1.1.14 a esas fechas; multiempresa 404; bloqueo de ventas sin kardex; el pequeño contribuyente vende sin IVA y su costo cuadra', async ({
        assert,
    }) => {
        const { e, cable, bodega, servicioId, conceptoId } = await escenario()
        const f1 = haceMeses(2, 5)
        const f2 = haceMeses(1, 5)
        await comprar(e, e.B, cable.id, bodega.id, 10, '56.00', f1)
        await comprar(e, e.B, cable.id, bodega.id, 10, '78.40', f2)
        await new ConsumirInventario().execute(
            { producto_id: cable.id, bodega_id: bodega.id, cantidad: '2', fecha: haceMeses(1, 10) },
            e.ctx,
        )
        for (const fecha of [haceMeses(2, 1), f1, haceMeses(1, 7), haceMeses(1, 10), hoyGuatemala()]) {
            const reporte = await inventarioValorizado({ fecha }, [e.B])
            const cuadre = reporte.cuadre.find((c) => c.empresa_id === e.B)!
            assert.equal(cuadre.diferencia, '0.00', fecha)
            const libro = await db
                .from('ledger.movimientos as m')
                .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
                .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
                .where({ 'a.empresa_id': e.B, 'c.codigo': CUENTAS_GT.INVENTARIOS })
                .where('a.fecha', '<=', fecha)
                .select(db.raw('coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text as s'))
                .firstOrFail()
            assert.equal(reporte.total, libro.s, fecha)
        }
        // multiempresa: la bodega de C en un cargo de B
        const bodegaC = await bodegaEn(e.C, e.ctx)
        const ajena = await errorDe(
            vender(e, servicioId, conceptoId, { producto_id: cable.id, bodega_id: bodegaC.id }),
        )
        assert.equal(ajena.status, 404)
        // bloqueo de ventas hasta hoy: ni factura ni salida
        const antes = await saldoInventario(cable.id, bodega.id)
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'ventas', hasta: hoyGuatemala(), motivo: 'auditoría' },
            e.ctx,
        )
        const bloqueada = await errorDe(
            vender(e, servicioId, conceptoId, { producto_id: cable.id, bodega_id: bodega.id }),
        )
        assert.include([409, 422], bloqueada.status)
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), antes)
        // pequeño contribuyente
        await new CambiarRegimen().execute(
            {
                empresa_id: e.C,
                regimen: 'pequeno_contribuyente',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción',
            },
            e.ctx,
        )
        const cableC = await productoEn(e.C, e.ctx)
        await comprar(e, e.C, cableC.id, bodegaC.id, 10, '112.00')
        const servicioC = await servicioEn(e.C)
        const venta = await vender(e, servicioC.servicioId, await concepto(e.C), {
            producto_id: cableC.id,
            bodega_id: bodegaC.id,
            cantidad: '5',
        })
        assert.equal((venta as unknown as { iva: string }).iva, '0.00')
        assert.deepEqual(await movimientosDe(venta.id), [['venta', '-5.000', '-56.00']])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('comparador (174f247): el costo de ventas del ISO es solo 5.6.01 de las ventas del kardex; una baja (5.6.02) no cuenta', async ({
        assert,
    }) => {
        const original = relojFiscal.ahora
        try {
            const { e, cable, bodega, servicioId, conceptoId } = await escenario()
            const mes = hoyGuatemala().slice(0, 7)
            await new EditarParametro().execute(
                {
                    empresa_id: e.B,
                    clave: 'inicio_libros',
                    valor: `${mes.slice(0, 4)}-01-01`,
                    vigente_desde: '2014-01-01',
                    motivo: 'auditoría',
                },
                e.ctx,
            )
            await comprar(e, e.B, cable.id, bodega.id, 10, '56.00')
            await vender(e, servicioId, conceptoId, {
                producto_id: cable.id,
                bodega_id: bodega.id,
                cantidad: '4',
            })
            await new DarDeBajaInventario().execute(
                {
                    producto_id: cable.id,
                    bodega_id: bodega.id,
                    cantidad: '2',
                    causa: 'danado',
                    motivo: 'golpe',
                },
                e.ctx,
            )
            const [anio, m] = mes.split('-').map(Number) as [number, number]
            const siguiente = m === 12 ? `${anio + 1}-01` : `${anio}-${String(m + 1).padStart(2, '0')}`
            relojFiscal.ahora = () => new Date(`${siguiente}-05T18:00:00Z`)
            const r = await compararRegimenes([e.B], null)
            const datos = r.empresas[0]!.bloques.iso_piso.datos as Record<string, unknown> | null
            assert.equal(datos?.costo_ventas, '20.00')
            await afirmarLibro(assert, [e.B, e.C])
        } finally {
            relojFiscal.ahora = original
        }
    })

    test('H55 (arreglado): un consumo con fecha pasada al promedio de hoy deja el valor de la bodega negativo en una fecha intermedia', async ({
        assert,
    }) => {
        const { e, cable, bodega } = await escenario()
        // entra 1 a Q10 hace dos meses y 1 a Q100 el mes pasado: promedio de hoy Q55
        await comprar(e, e.B, cable.id, bodega.id, 1, '11.20', haceMeses(2, 5))
        await comprar(e, e.B, cable.id, bodega.id, 1, '112.00', haceMeses(1, 20))
        const consumo = await new ConsumirInventario()
            .execute(
                { producto_id: cable.id, bodega_id: bodega.id, cantidad: '1', fecha: haceMeses(1, 10) },
                e.ctx,
            )
            .then(() => null)
            .catch((error) => error)
        const intermedio = await inventarioValorizado({ fecha: haceMeses(1, 15), con_ceros: true }, [e.B])
        // lo correcto: 409 (o salir al costo que tenía la bodega en esa fecha); nunca valor negativo
        assert.deepEqual(
            { rechazado: consumo !== null, valor_intermedio_negativo: dec(intermedio.total).isNegative() },
            { rechazado: true, valor_intermedio_negativo: false },
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H56 (arreglado): un conteo con ventas entre la captura y el cierre registra un sobrante que no existe', async ({
        assert,
    }) => {
        const { e, cable, bodega, servicioId, conceptoId } = await escenario()
        await comprar(e, e.B, cable.id, bodega.id, 10, '56.00')
        const conteo = await new AbrirConteo().execute({ bodega_id: bodega.id, motivo: 'auditoría' }, e.ctx)
        // se cuentan los 10 que hay, y después se venden 2 antes de cerrar
        await new ContarInventario().execute(
            { conteo_id: conteo.id, producto_id: cable.id, contado: '10' },
            e.ctx,
        )
        await vender(e, servicioId, conceptoId, {
            producto_id: cable.id,
            bodega_id: bodega.id,
            cantidad: '2',
        })
        await new CerrarConteo().execute({ id: conteo.id }, e.ctx)
        const sobrante = await saldoCuenta(e.B, CUENTAS_GT.SOBRANTES_INVENTARIO)
        // lo correcto: sin ajuste (la bodega tenía 10 al contar y 8 después de vender)
        assert.deepEqual(
            { saldo: await saldoInventario(cable.id, bodega.id), sobrante: dec(sobrante).toFixed(2) },
            { saldo: ['8.000', '40.00'], sobrante: '0.00' },
        )
    })

    test('H55 variantes: con solo salidas posteriores la fecha pasada entra y cuadra; un reingreso posterior (reverso de venta) la bloquea; ninguna fecha queda negativa', async ({
        assert,
    }) => {
        const { e, cable, bodega, servicioId, conceptoId } = await escenario()
        await comprar(e, e.B, cable.id, bodega.id, 10, '56.00', haceMeses(2, 5))
        await new ConsumirInventario().execute(
            { producto_id: cable.id, bodega_id: bodega.id, cantidad: '3', fecha: haceMeses(1, 20) },
            e.ctx,
        )
        // una salida fechada antes de otra salida: el promedio no cambió
        await new ConsumirInventario().execute(
            { producto_id: cable.id, bodega_id: bodega.id, cantidad: '2', fecha: haceMeses(1, 10) },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
        // hoy se vende y se anula: el reverso reingresa (cantidad > 0) con fecha de hoy
        const venta = await vender(e, servicioId, conceptoId, {
            producto_id: cable.id,
            bodega_id: bodega.id,
            cantidad: '1',
        })
        await new AnularFactura().execute({ factura_id: venta.id, motivo: 'auditoría' }, e.ctx)
        const bloqueada = await errorDe(
            new ConsumirInventario().execute(
                { producto_id: cable.id, bodega_id: bodega.id, cantidad: '1', fecha: haceMeses(1, 25) },
                e.ctx,
            ),
        )
        assert.equal(bloqueada.codigo, 'fecha_con_movimientos_posteriores')
        // más de lo que había en la fecha: 409 aunque hoy alcance
        const otra = await productoEn(e.B, e.ctx)
        await comprar(e, e.B, otra.id, bodega.id, 2, '22.40', haceMeses(2, 5))
        await new ConsumirInventario().execute(
            { producto_id: otra.id, bodega_id: bodega.id, cantidad: '1' },
            e.ctx,
        )
        const negativa = await errorDe(
            new ConsumirInventario().execute(
                { producto_id: otra.id, bodega_id: bodega.id, cantidad: '2', fecha: haceMeses(1, 1) },
                e.ctx,
            ),
        )
        assert.equal(negativa.status, 409)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H56 variantes: entradas entre la captura y el cierre no son sobrante; una unidad contada y vendida antes del cierre no falla ni ajusta; recapturar toma la existencia de nuevo', async ({
        assert,
    }) => {
        const { e, cable, bodega, servicioId, conceptoId } = await escenario()
        const router = await productoEn(e.B, e.ctx, {
            nombre: 'Router',
            tipo: 'equipo',
            seguimiento: 'serie',
        })
        await comprar(e, e.B, cable.id, bodega.id, 10, '56.00')
        const proveedor = await proveedorEn(e.B, e.ctx)
        const series = [unico('RT'), unico('RT')]
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('F'),
                fecha_documento: hoyGuatemala(),
                condicion: 'credito',
                lineas: [
                    {
                        descripcion: 'Routers',
                        tipo: 'bien',
                        total: '672.00',
                        cantidad: 2,
                        producto_id: router.id,
                        bodega_id: bodega.id,
                        unidades: series.map((serie) => ({ serie })),
                    },
                ],
            } as never,
            e.ctx,
        )
        const unidades = await db.from('inventario.unidades').where('compra_id', compra.id).orderBy('id')
        const conteo = await new AbrirConteo().execute({ bodega_id: bodega.id, motivo: 'auditoría' }, e.ctx)
        await new ContarInventario().execute(
            { conteo_id: conteo.id, producto_id: cable.id, contado: '7' },
            e.ctx,
        )
        // recaptura: la existencia sigue en 10; el contado es 9 (falta 1)
        await new ContarInventario().execute(
            { conteo_id: conteo.id, producto_id: cable.id, contado: '9' },
            e.ctx,
        )
        await new ContarInventario().execute({ conteo_id: conteo.id, producto_id: router.id, series }, e.ctx)
        // después de capturar: entran 5 de cable y se vende un router contado
        await comprar(e, e.B, cable.id, bodega.id, 5, '28.00')
        await vender(e, servicioId, conceptoId, {
            producto_id: router.id,
            bodega_id: bodega.id,
            unidad_id: Number(unidades[0].id),
            precio: '560.00',
        })
        await new CerrarConteo().execute({ id: conteo.id }, e.ctx)
        assert.deepEqual(
            await saldoInventario(cable.id, bodega.id),
            ['14.000', '70.00'],
            'solo el faltante de 1',
        )
        assert.deepEqual(await saldoInventario(router.id, bodega.id), ['1.000', '300.00'])
        const sobrante = await saldoCuenta(e.B, CUENTAS_GT.SOBRANTES_INVENTARIO)
        assert.equal(dec(sobrante).toFixed(2), '0.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.MERMAS_INVENTARIO), '5.00')
        await afirmarLibro(assert, [e.B, e.C])
    })
})
