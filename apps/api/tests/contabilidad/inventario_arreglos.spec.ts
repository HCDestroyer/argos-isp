import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { errorDe, saldoCuenta, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, proveedorEn } from '#tests/ledger/ayudas_compras'
import { bodegaEn, productoEn, saldoInventario } from '#tests/inventario/ayudas_inventario'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { dec } from '#ledger/dinero'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import RegistrarCompraDesdeEgreso from '#ledger/actions/registrar_compra_desde_egreso'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import AnularCompra from '#ledger/actions/anular_compra'
import CrearReglaConciliacion from '#ledger/actions/crear_regla_conciliacion'
import DepreciarActivos from '#ledger/actions/depreciar_activos'
import AsignarComodato from '#inventario/actions/asignar_comodato'
import DevolverComodato from '#inventario/actions/devolver_comodato'
import DeclararPerdidaComodato from '#inventario/actions/declarar_perdida_comodato'
import TrasladarInventario from '#inventario/actions/trasladar_inventario'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'
import { ConsumidorInventario } from '#inventario/consumidor'

/**
 * Auditor contable · verificación adversarial de los arreglos de A3 a H39–H43 (rama
 * `a3/inventario-b`, a5df8c0 y c15a016) y del equipo de comodato en Q0 (decisión del líder): variantes
 * que la prueba de cada hallazgo no cubre.
 *
 * - **H54** (menor, arreglado en e4c872b): el arreglo de H42 cuenta los movimientos de la unidad posteriores a su
 *   entrada con `NOT (origen_tipo = 'compra' AND origen_id = ?)`; los del comodato tienen
 *   `origen_tipo` NULL y esa condición da NULL, así que no cuentan. Una unidad prestada y devuelta el
 *   mismo mes (sin depreciación, mismo costo) deja anular su compra. El libro cuadra (el costo no
 *   cambió), pero no se cumple la regla «tal como entró». Arreglo: `x.origen_tipo IS DISTINCT FROM
 *   'compra' OR x.origen_id IS DISTINCT FROM ?`.
 */

async function pequenoContribuyente(e: EmpresasGt, empresaId: number, desde = '2014-01-01') {
    await new CambiarRegimen().execute(
        {
            empresa_id: empresaId,
            regimen: 'pequeno_contribuyente',
            vigente_desde: desde,
            motivo: 'Inscripción',
        },
        e.ctx,
    )
}

function fact(proveedorId: number, lineas: unknown[], extra: Record<string, unknown> = {}) {
    return {
        proveedor_id: proveedorId,
        tipo_documento: 'FACT',
        numero: unico('F'),
        fecha_documento: haceMeses(0),
        condicion: 'credito',
        ...extra,
        lineas,
    } as never
}

/** Equipos de serie comprados a crédito, Q300 de base cada uno. */
async function equipos(e: EmpresasGt, n: number, fecha = haceMeses(0)) {
    const onu = await productoEn(e.B, e.ctx, { nombre: 'ONU GPON', tipo: 'equipo', seguimiento: 'serie' })
    const bodega = await bodegaEn(e.B, e.ctx)
    const proveedor = await proveedorEn(e.B, e.ctx)
    const compra = await new RegistrarCompra().execute(
        fact(
            proveedor.id,
            [
                {
                    descripcion: 'ONU',
                    tipo: 'bien',
                    total: dec('336').times(n).toFixed(2),
                    cantidad: n,
                    producto_id: onu.id,
                    bodega_id: bodega.id,
                    unidades: Array.from({ length: n }, () => ({ serie: unico('ZTEG') })),
                },
            ],
            { fecha_documento: fecha },
        ),
        e.ctx,
    )
    const filas = await db.from('inventario.unidades').where('compra_id', compra.id).orderBy('id')
    const unidades = filas.map((u) => Number(u.id))
    return { onu, bodega, proveedor, compra, unidades }
}

test.group('Auditor contable · arreglos de H39–H43 y comodato en Q0', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('H40: el pequeño contribuyente no toma crédito fiscal ni pidiéndolo, ni en gastos, ni desde un egreso, ni en su NCRE; antes del cambio de régimen sí', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await pequenoContribuyente(e, e.C, haceMeses(0))
        const proveedor = await proveedorEn(e.C, e.ctx)
        const pedido = await errorDe(
            new RegistrarCompra().execute(
                fact(proveedor.id, [{ descripcion: 'Router', tipo: 'bien', total: '112.00' }], {
                    credito_fiscal: true,
                }),
                e.ctx,
            ),
        )
        assert.include(pedido.reglas, 'credito_no_permitido')
        const gasto = await new RegistrarCompra().execute(
            fact(proveedor.id, [{ descripcion: 'Enlace', tipo: 'servicio', total: '224.00' }]),
            e.ctx,
        )
        assert.isFalse(gasto.credito_fiscal)
        const ncre = await new RegistrarCompra().execute(
            fact(proveedor.id, [{ descripcion: 'Descuento', tipo: 'servicio', total: '22.40' }], {
                tipo_documento: 'NCRE',
                compra_referencia_id: gasto.id,
            }),
            e.ctx,
        )
        assert.isFalse(ncre.credito_fiscal)
        const egreso = await new RegistrarEgreso().execute(
            {
                categoria: 'energia',
                monto: '560.00',
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.C)!,
                proveedor: 'EEGSA',
                fecha: haceMeses(0),
            },
            e.ctx,
        )
        const desdeEgreso = await new RegistrarCompraDesdeEgreso().execute(
            {
                egreso_id: egreso.id,
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('E'),
                fecha_documento: haceMeses(0),
                lineas: [{ descripcion: 'Energía', categoria: 'energia', total: '560.00' }],
            },
            e.ctx,
        )
        assert.isFalse(desdeEgreso.credito_fiscal)
        const sinCredito = await saldoCuenta(e.C, CUENTAS_GT.IVA_CREDITO)
        assert.equal(dec(sinCredito).toFixed(2), '0.00')
        // un documento del mes anterior al cambio de régimen todavía da crédito
        const anterior = await new RegistrarCompra().execute(
            fact(proveedor.id, [{ descripcion: 'Router', tipo: 'bien', total: '112.00' }], {
                fecha_documento: haceMeses(1, 20),
            }),
            e.ctx,
        )
        assert.isTrue(anterior.credito_fiscal)
        assert.equal(await saldoCuenta(e.C, CUENTAS_GT.IVA_CREDITO), '12.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H39: una regla de conciliación con contrapartida 1.1.14 (o una hija) responde 422', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        for (const contrapartida of [CUENTAS_GT.INVENTARIOS, `${CUENTAS_GT.INVENTARIOS}.01`]) {
            const error = await errorDe(
                new CrearReglaConciliacion().execute(
                    {
                        empresa_id: e.B,
                        nombre: unico('Regla'),
                        tipo_condicion: 'contiene',
                        patron: 'conectores',
                        accion: 'contrapartida',
                        contrapartida,
                    } as never,
                    e.ctx,
                ),
            )
            assert.equal(error.status, 422, contrapartida)
        }
    })

    test('H43 por la API: desde_comodato en el cuerpo de POST /activos/:id/dar-de-baja no salta el 409 activo_en_comodato', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        const { unidades } = await equipos(e, 1)
        const { servicioId } = await servicioEn(e.B)
        const asignada = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidades[0]! },
            e.ctx,
        )
        const respuesta = await client
            .post(`/api/v1/activos/${asignada.activo_id}/dar-de-baja`)
            .bearerToken(e.token)
            .header('X-Empresa-Id', String(e.B))
            .json({ tipo: 'retiro', motivo: 'auditoría: salto por la API', desde_comodato: true })
        assert.equal(respuesta.status(), 409)
        assert.include(JSON.stringify(respuesta.body()), 'activo_en_comodato')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H42 variantes: trasladada y de vuelta se anula y cuadra; devuelta del comodato el mismo mes y con la NCRE anulada, el libro cuadra', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const otra = await bodegaEn(e.B, e.ctx)
        // 1. trasladada a otra bodega y de vuelta: está tal como entró
        const a = await equipos(e, 1)
        for (const [origen, destino] of [
            [a.bodega.id, otra.id],
            [otra.id, a.bodega.id],
        ]) {
            await new TrasladarInventario().execute(
                {
                    producto_id: a.onu.id,
                    bodega_origen_id: origen!,
                    bodega_destino_id: destino!,
                    unidad_ids: a.unidades,
                },
                e.ctx,
            )
        }
        await new AnularCompra().execute({ compra_id: a.compra.id, motivo: 'auditoría' }, e.ctx)
        assert.deepEqual(await saldoInventario(a.onu.id, a.bodega.id), ['0.000', '0.00'])
        // 2. prestada y devuelta el mismo mes: sin depreciación vale lo mismo, pero ya no está como entró
        const b = await equipos(e, 1)
        const { servicioId } = await servicioEn(e.B)
        await new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: b.unidades[0]! }, e.ctx)
        const devuelta = await new DevolverComodato().execute(
            { servicio_id: servicioId, unidad_id: b.unidades[0]!, bodega_id: b.bodega.id },
            e.ctx,
        )
        assert.equal(devuelta.costo, '300.00')
        // (pasa: H54) la anulación no daña el libro, porque el costo no cambió
        await new AnularCompra()
            .execute({ compra_id: b.compra.id, motivo: 'auditoría' }, e.ctx)
            .catch(() => null)
        await afirmarLibro(assert, [e.B, e.C])
        // 3. devuelta al proveedor con NCRE y la NCRE anulada: la compra queda como esté, el libro cuadra
        const c = await equipos(e, 1)
        const nota = await new RegistrarCompra().execute(
            fact(
                c.proveedor.id,
                [
                    {
                        descripcion: 'Devolución',
                        tipo: 'bien',
                        total: '336.00',
                        cantidad: 1,
                        producto_id: c.onu.id,
                        bodega_id: c.bodega.id,
                        unidad_ids: c.unidades,
                    },
                ],
                { tipo_documento: 'NCRE', compra_referencia_id: c.compra.id },
            ),
            e.ctx,
        )
        await new AnularCompra().execute({ compra_id: nota.id, motivo: 'auditoría' }, e.ctx)
        await new AnularCompra()
            .execute({ compra_id: c.compra.id, motivo: 'auditoría' }, e.ctx)
            .catch(() => null)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H54 (arreglado): una unidad prestada y devuelta el mismo mes (mismo costo) no está «tal como entró»: anular su compra debe ser 409 unidades_en_uso', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const b = await equipos(e, 1)
        const { servicioId } = await servicioEn(e.B)
        await new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: b.unidades[0]! }, e.ctx)
        await new DevolverComodato().execute(
            { servicio_id: servicioId, unidad_id: b.unidades[0]!, bodega_id: b.bodega.id },
            e.ctx,
        )
        // el conteo de «otros movimientos» de H42 compara origen_tipo = 'compra' con NULL (los del
        // comodato no tienen origen): NOT (NULL AND …) es NULL y la fila no cuenta
        const usada = await errorDe(
            new AnularCompra().execute({ compra_id: b.compra.id, motivo: 'auditoría' }, e.ctx),
        )
        assert.equal(usada.codigo, 'unidades_en_uso')
    })

    test('comodato en Q0: un equipo totalmente depreciado vuelve en Q0, se presta otra vez con un activo en Q0 sin asientos, se retira, vuelve, se devuelve y se pierde; todo cuadra con los inv. 15 y 24', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const equipo = await productoEn(e.B, e.ctx, {
            nombre: 'Laptop técnico',
            tipo: 'equipo',
            seguimiento: 'serie',
            clase_activo: 'computacion',
        })
        const bodega = await bodegaEn(e.B, e.ctx)
        const inicio = haceMeses(40, 3)
        const inicial = await new CargarSaldoInicial().execute(
            {
                producto_id: equipo.id,
                bodega_id: bodega.id,
                unidad: { serie: unico('LT') },
                costo_total: '100.00',
                fecha: inicio,
            },
            e.ctx,
        )
        const unidadId = inicial.unidad_id!
        const { servicioId } = await servicioEn(e.B, { instalacion: inicio })
        const primera = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidadId, fecha: haceMeses(40, 5) },
            e.ctx,
        )
        await new DepreciarActivos().execute({ activo_id: primera.activo_id! }, e.ctx)
        const vuelta = await new DevolverComodato().execute(
            { servicio_id: servicioId, unidad_id: unidadId, bodega_id: bodega.id },
            e.ctx,
        )
        assert.equal(vuelta.costo, '0.00', 'totalmente depreciado')
        await afirmarLibro(assert, [e.B, e.C])

        const asientos = async () => {
            const fila = await db.from('ledger.asientos').where('empresa_id', e.B).count('* as n').first()
            return Number(fila.n)
        }
        const antes = await asientos()
        const segunda = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidadId },
            e.ctx,
        )
        const activo = await db.from('ledger.activos').where('id', segunda.activo_id!).firstOrFail()
        assert.equal(activo.costo, '0.00')
        // retiro y reactivación con el activo en Q0
        const consumidor = new ConsumidorInventario()
        await db.from('core.servicios').where('id', servicioId).update({ estado: 'retirado' })
        await consumidor.procesar({
            id: unico('ev'),
            evento: 'servicio.estado_cambiado',
            payload: {
                servicio_id: servicioId,
                empresa_id: e.B,
                de: 'suspendido',
                a: 'retirado',
                motivo: 'baja',
            },
        })
        await db.from('core.servicios').where('id', servicioId).update({ estado: 'activo' })
        await consumidor.procesar({
            id: unico('ev'),
            evento: 'servicio.estado_cambiado',
            payload: {
                servicio_id: servicioId,
                empresa_id: e.B,
                de: 'retirado',
                a: 'activo',
                motivo: 'vuelve',
            },
        })
        await new DepreciarActivos().execute({ activo_id: segunda.activo_id! }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
        await new DevolverComodato().execute(
            { servicio_id: servicioId, unidad_id: unidadId, bodega_id: bodega.id },
            e.ctx,
        )
        const tercera = await new AsignarComodato().execute(
            { servicio_id: servicioId, unidad_id: unidadId },
            e.ctx,
        )
        await new DeclararPerdidaComodato().execute(
            { servicio_id: servicioId, unidad_id: unidadId, motivo: 'auditoría: no lo devolvió' },
            e.ctx,
        )
        assert.equal(await asientos(), antes, 'el comodato en Q0 no escribe asientos')
        const bajas = await db.from('ledger.activos_bajas').where('activo_id', tercera.activo_id!)
        assert.deepEqual(
            bajas.map((b) => [b.tipo, b.valor_libros, b.asiento_id]),
            [['retiro', '0.00', null]],
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})
