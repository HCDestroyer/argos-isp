import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import { errorDe } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { crearZonaFila } from '#tests/core/fabricas'
import {
    bodegaEn,
    comprarInventario,
    contarMovimientos,
    afirmarCuadre,
    cuadreInventario,
    productoEn,
    saldoInventario,
} from '#tests/inventario/ayudas_inventario'
import EditarProducto from '#inventario/actions/editar_producto'
import DesactivarProducto from '#inventario/actions/desactivar_producto'
import DesactivarBodega from '#inventario/actions/desactivar_bodega'
import CrearBodega from '#inventario/actions/crear_bodega'
import ConsumirInventario from '#inventario/actions/consumir_inventario'
import TrasladarInventario from '#inventario/actions/trasladar_inventario'
import AjustarInventario from '#inventario/actions/ajustar_inventario'
import DarDeBajaInventario from '#inventario/actions/dar_de_baja_inventario'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'
import AnularCompra from '#ledger/actions/anular_compra'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import BloquearLibro from '#ledger/actions/bloquear_libro'

/**
 * Inventario interno, fase A (`contratos/inventario.md` §10): casos 1, 7, 8 (sin series), 9 y 10,
 * más productos, bodegas, saldo inicial, ajustes, bajas, traslados, el tope por técnico y las
 * lecturas. Cada prueba usa empresas nuevas y termina con el libro y el kardex cuadrados.
 */

test.group('Inventario · fase A', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('1. compra de 10 a Q5 y 10 a Q7: promedio Q6; consumo de 5 = Q30 a 5.2.07; anular una compra la revierte', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cable = await productoEn(e.B, e.ctx)
        const bodega = await bodegaEn(e.B, e.ctx)
        const proveedor = await proveedorEn(e.B, e.ctx)
        // con crédito fiscal el costo es la base: Q56 → Q50 y Q78.40 → Q70
        const primera = await comprarInventario(e.B, e.ctx, {
            producto_id: cable.id,
            bodega_id: bodega.id,
            cantidad: 10,
            total: '56.00',
            proveedorId: proveedor.id,
        })
        assert.equal(primera.lineas[0]!.producto_id, cable.id)
        assert.equal(primera.lineas[0]!.bodega_id, bodega.id)
        assert.equal(primera.base_bienes, '50.00')
        assert.deepEqual(await partidas('compra', primera.id), [
            [CUENTAS_GT.INVENTARIOS, '50.00', '0.00', '+C_BASE_BIEN'],
            [CUENTAS_GT.IVA_CREDITO, '6.00', '0.00', '+C_IVA'],
            [CUENTAS_GT.PROVEEDORES, '0.00', '56.00', null],
        ])
        const segunda = await comprarInventario(e.B, e.ctx, {
            producto_id: cable.id,
            bodega_id: bodega.id,
            cantidad: 10,
            total: '78.40',
            proveedorId: proveedor.id,
        })
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['20.000', '120.00'])
        const entrada = await db
            .from('inventario.movimientos')
            .where({ origen_tipo: 'compra', origen_id: segunda.id })
            .first()
        assert.equal(entrada.tipo, 'entrada_compra')
        assert.equal(entrada.costo_unitario, '7.000000')
        assert.equal(Number(entrada.asiento_id), segunda.asiento_id)

        const consumo = await new ConsumirInventario().execute(
            { producto_id: cable.id, bodega_id: bodega.id, cantidad: '5', motivo: 'instalación' },
            e.ctx,
        )
        assert.equal(consumo.tipo, 'consumo')
        assert.equal(consumo.cantidad, '-5.000')
        assert.equal(consumo.costo_unitario, '6.000000')
        assert.equal(consumo.costo_total, '-30.00')
        assert.equal(consumo.saldo_cantidad, '15.000')
        assert.equal(consumo.saldo_valor, '90.00')
        assert.deepEqual(await partidas('inventario', consumo.id), [
            [CUENTAS_GT.MATERIALES_INSTALACION, '30.00', '0.00', null],
            [CUENTAS_GT.INVENTARIOS, '0.00', '30.00', null],
        ])
        const cuadre = await cuadreInventario(e.B)
        assert.equal(cuadre.libro, '90.00')
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'inventario.movimiento_registrado')
            .whereRaw(`payload->>'movimiento_id' = ?`, [String(consumo.id)])
            .first()
        assert.equal(eventos.payload.costo_total, '-30.00')
        assert.equal(eventos.payload.tipo, 'consumo')

        // anular la segunda compra saca sus 10 al mismo costo (Q70): quedan 5 por Q20
        await new AnularCompra().execute({ compra_id: segunda.id, motivo: 'factura equivocada' }, e.ctx)
        const reverso = await db
            .from('inventario.movimientos')
            .where({ origen_tipo: 'compra', origen_id: segunda.id, tipo: 'reverso_compra' })
            .first()
        assert.equal(reverso.cantidad, '-10.000')
        assert.equal(reverso.costo_total, '-70.00')
        assert.equal(Number(reverso.reverso_de), Number(entrada.id))
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['5.000', '20.00'])
        await afirmarCuadre(assert, e.B)

        // la primera ya no se puede anular: sus 10 no están (409 existencia_insuficiente, nada cambia)
        const antes = await contarMovimientos(e.B)
        const sinExistencia = await errorDe(
            new AnularCompra().execute({ compra_id: primera.id, motivo: 'otra' }, e.ctx),
        )
        assert.equal(sinExistencia.codigo, 'existencia_insuficiente')
        assert.deepEqual(await contarMovimientos(e.B), antes)
        const anulada = await db.from('ledger.compras_anulaciones').where('compra_id', primera.id).first()
        assert.isNull(anulada)
        await afirmarCuadre(assert, e.B)
    })

    test('7. salida mayor que la existencia: 409 existencia_insuficiente, sin asiento ni movimiento', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const conector = await productoEn(e.B, e.ctx, { nombre: 'Conector RJ45', unidad: 'unidad' })
        const bodega = await bodegaEn(e.B, e.ctx)
        await new CargarSaldoInicial().execute(
            { producto_id: conector.id, bodega_id: bodega.id, cantidad: '3', costo_unitario: '1.50' },
            e.ctx,
        )
        const antes = await contarMovimientos(e.B)
        for (const accion of [
            () =>
                new ConsumirInventario().execute(
                    { producto_id: conector.id, bodega_id: bodega.id, cantidad: '4' },
                    e.ctx,
                ),
            () =>
                new DarDeBajaInventario().execute(
                    {
                        producto_id: conector.id,
                        bodega_id: bodega.id,
                        cantidad: '3.5',
                        causa: 'danado',
                        motivo: 'golpe',
                    },
                    e.ctx,
                ),
            () =>
                new AjustarInventario().execute(
                    { producto_id: conector.id, bodega_id: bodega.id, cantidad: '-4', motivo: 'conteo' },
                    e.ctx,
                ),
        ]) {
            const error = await errorDe(accion())
            assert.equal(error.status, 409)
            assert.equal(error.codigo, 'existencia_insuficiente')
        }
        const otra = await bodegaEn(e.B, e.ctx)
        const traslado = await errorDe(
            new TrasladarInventario().execute(
                {
                    producto_id: conector.id,
                    bodega_origen_id: bodega.id,
                    bodega_destino_id: otra.id,
                    cantidad: '5',
                },
                e.ctx,
            ),
        )
        assert.equal(traslado.codigo, 'existencia_insuficiente')
        assert.deepEqual(await contarMovimientos(e.B), antes)
        const fallidas = await db
            .from('audit.acciones')
            .where({ accion: 'inventario.consumir', resultado: 'error', empresa_id: e.B })
            .count('* as n')
            .first()
        assert.isAtLeast(Number(fallidas.n), 1)
        await afirmarCuadre(assert, e.B)
    })

    test('8. traslado entre empresas imposible (404); serie repetida no aplica aún: producto de serie 422 requiere_unidades', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const producto = await productoEn(e.B, e.ctx)
        const bodegaB = await bodegaEn(e.B, e.ctx)
        const bodegaC = await bodegaEn(e.C, e.ctx)
        await new CargarSaldoInicial().execute(
            { producto_id: producto.id, bodega_id: bodegaB.id, cantidad: '10', costo_total: '25.00' },
            e.ctx,
        )
        const otraEmpresa = await errorDe(
            new TrasladarInventario().execute(
                {
                    producto_id: producto.id,
                    bodega_origen_id: bodegaB.id,
                    bodega_destino_id: bodegaC.id,
                    cantidad: '1',
                },
                e.ctx,
            ),
        )
        assert.equal(otraEmpresa.status, 404)
        // ni consumir de la bodega de otra empresa
        const consumo = await errorDe(
            new ConsumirInventario().execute(
                { producto_id: producto.id, bodega_id: bodegaC.id, cantidad: '1' },
                e.ctx,
            ),
        )
        assert.equal(consumo.status, 404)
        // ni comprar para una bodega de otra empresa
        const compra = await errorDe(
            comprarInventario(e.B, e.ctx, {
                producto_id: producto.id,
                bodega_id: bodegaC.id,
                cantidad: 1,
                total: '11.20',
            }),
        )
        assert.equal(compra.status, 404)

        const onu = await productoEn(e.B, e.ctx, { nombre: 'ONU', tipo: 'equipo', seguimiento: 'serie' })
        assert.equal(onu.clase_activo, 'equipo_red')
        const serie = await errorDe(
            new CargarSaldoInicial().execute(
                { producto_id: onu.id, bodega_id: bodegaB.id, cantidad: '1', costo_total: '300.00' },
                e.ctx,
            ),
        )
        assert.equal(serie.status, 422)
        assert.include(serie.reglas, 'requiere_unidades')
        await afirmarCuadre(assert, e.B)
        await afirmarCuadre(assert, e.C)
    })

    test('9. movimiento en un periodo bloqueado: el bloqueo de siempre, sin movimiento ni asiento', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const producto = await productoEn(e.B, e.ctx)
        const bodega = await bodegaEn(e.B, e.ctx)
        const otra = await bodegaEn(e.B, e.ctx)
        await new CargarSaldoInicial().execute(
            {
                producto_id: producto.id,
                bodega_id: bodega.id,
                cantidad: '10',
                costo_total: '60.00',
                fecha: haceMeses(1, 5),
            },
            e.ctx,
        )
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'global', hasta: hoyGuatemala(), motivo: 'prueba de bloqueo' },
            e.ctx,
        )
        const antes = await contarMovimientos(e.B)
        const consumo = await errorDe(
            new ConsumirInventario().execute(
                { producto_id: producto.id, bodega_id: bodega.id, cantidad: '1' },
                e.ctx,
            ),
        )
        assert.equal(consumo.status, 422)
        assert.equal(consumo.codigo, 'periodo_bloqueado')
        const inicial = await errorDe(
            new CargarSaldoInicial().execute(
                {
                    producto_id: producto.id,
                    bodega_id: otra.id,
                    cantidad: '1',
                    costo_total: '6.00',
                    fecha: haceMeses(1, 5),
                },
                e.ctx,
            ),
        )
        assert.equal(inicial.codigo, 'periodo_bloqueado')
        assert.deepEqual(await contarMovimientos(e.B), antes)
        await afirmarCuadre(assert, e.B)
    })

    test('productos: SKU único sin mayúsculas, version, seguimiento fijo con movimientos, desactivar sin existencias', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sku = unico('router')
        const producto = await productoEn(e.B, e.ctx, {
            sku,
            cuenta_consumo: CUENTAS.GASTO_OTROS,
            existencia_minima: '5',
        })
        assert.equal(producto.cuenta_consumo, CUENTAS.GASTO_OTROS)
        assert.equal(producto.existencia_minima, '5.000')
        assert.equal(producto.existencia, '0.000')
        const repetido = await errorDe(productoEn(e.B, e.ctx, { sku: sku.toUpperCase() }))
        assert.equal(repetido.codigo, 'sku_duplicado')
        await productoEn(e.C, e.ctx, { sku }) // otra empresa, otro catálogo
        const cuentaMala = await errorDe(productoEn(e.B, e.ctx, { cuenta_costo: CUENTAS_GT.INVENTARIOS }))
        assert.include(cuentaMala.reglas, 'cuenta_producto')
        const claseSinSerie = await errorDe(productoEn(e.B, e.ctx, { clase_activo: 'computacion' }))
        assert.include(claseSinSerie.reglas, 'no_aplica')

        const editado = await new EditarProducto().execute(
            {
                id: producto.id,
                version: producto.version,
                nombre: 'Cable UTP exterior',
                cuenta_consumo: null,
            },
            e.ctx,
        )
        assert.equal(editado.version, producto.version + 1)
        assert.isNull(editado.cuenta_consumo)
        const viejo = await errorDe(
            new EditarProducto().execute({ id: producto.id, version: producto.version, nombre: 'X' }, e.ctx),
        )
        assert.equal(viejo.codigo, 'conflicto_version')
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'producto', entidad_id: producto.id })
            .select('campo')
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['nombre', 'cuenta_consumo'],
        )

        const bodega = await bodegaEn(e.B, e.ctx)
        await new CargarSaldoInicial().execute(
            { producto_id: producto.id, bodega_id: bodega.id, cantidad: '6', costo_total: '30.00' },
            e.ctx,
        )
        const seguimiento = await errorDe(
            new EditarProducto().execute(
                { id: producto.id, version: editado.version, seguimiento: 'serie' },
                e.ctx,
            ),
        )
        assert.equal(seguimiento.codigo, 'producto_con_movimientos')
        const conExistencias = await errorDe(
            new DesactivarProducto().execute({ id: producto.id, version: editado.version }, e.ctx),
        )
        assert.equal(conExistencias.codigo, 'producto_con_existencias')
        const bodegaConExistencias = await errorDe(
            new DesactivarBodega().execute({ id: bodega.id, version: bodega.version }, e.ctx),
        )
        assert.equal(bodegaConExistencias.codigo, 'bodega_con_existencias')

        // cruzar el mínimo (5) hacia abajo avisa una vez; seguir bajando no
        const baja = await new DarDeBajaInventario().execute(
            {
                producto_id: producto.id,
                bodega_id: bodega.id,
                cantidad: '2',
                causa: 'obsoleto',
                motivo: 'modelo viejo',
            },
            e.ctx,
        )
        assert.equal(baja.causa, 'obsoleto')
        assert.deepEqual(await partidas('inventario', baja.id), [
            [CUENTAS_GT.MERMAS_INVENTARIO, '10.00', '0.00', null],
            [CUENTAS_GT.INVENTARIOS, '0.00', '10.00', null],
        ])
        await new ConsumirInventario().execute(
            { producto_id: producto.id, bodega_id: bodega.id, cantidad: '4' },
            e.ctx,
        )
        const avisos = await db
            .from('audit.outbox')
            .where('evento', 'inventario.existencia_minima')
            .whereRaw(`payload->>'producto_id' = ?`, [String(producto.id)])
            .select('payload')
        assert.lengthOf(avisos, 1)
        assert.deepEqual(avisos[0].payload, {
            empresa_id: e.B,
            producto_id: producto.id,
            bodega_id: null,
            cantidad: '4.000',
            minimo: '5.000',
        })
        // la última salida vacía la bodega con todo su valor (sin residuo)
        assert.deepEqual(await saldoInventario(producto.id, bodega.id), ['0.000', '0.00'])
        const desactivado = await new DesactivarProducto().execute(
            { id: producto.id, version: editado.version },
            e.ctx,
        )
        assert.isFalse(desactivado.activo)
        const inactivo = await errorDe(
            comprarInventario(e.B, e.ctx, {
                producto_id: producto.id,
                bodega_id: bodega.id,
                cantidad: 1,
                total: '5.60',
            }),
        )
        assert.include(inactivo.reglas, 'producto_inactivo')
        const bodegaInactiva = await new DesactivarBodega().execute(
            { id: bodega.id, version: bodega.version },
            e.ctx,
        )
        assert.isFalse(bodegaInactiva.activo)
        await afirmarCuadre(assert, e.B)
    })

    test('saldo inicial una vez (1.1.14 / 2.9.01); ajustes faltante y sobrante; traslado sin asiento al mismo costo', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const producto = await productoEn(e.B, e.ctx)
        const central = await bodegaEn(e.B, e.ctx)
        const tecnico = await new CrearBodega().execute(
            { empresa_id: e.B, nombre: unico('Técnico'), tipo: 'tecnico', usuario_id: e.usuarioId },
            e.ctx,
        )
        const otraDelMismo = await errorDe(
            new CrearBodega().execute(
                { empresa_id: e.B, nombre: unico('Técnico'), tipo: 'tecnico', usuario_id: e.usuarioId },
                e.ctx,
            ),
        )
        assert.equal(otraDelMismo.codigo, 'bodega_tecnico_duplicada')

        const inicial = await new CargarSaldoInicial().execute(
            { producto_id: producto.id, bodega_id: central.id, cantidad: '3', costo_total: '10.00' },
            e.ctx,
        )
        assert.deepEqual(await partidas('inventario', inicial.id), [
            [CUENTAS_GT.INVENTARIOS, '10.00', '0.00', null],
            [CUENTAS.SALDOS_APERTURA, '0.00', '10.00', null],
        ])
        assert.equal(inicial.costo_unitario, '3.333333')
        const dosVeces = await errorDe(
            new CargarSaldoInicial().execute(
                { producto_id: producto.id, bodega_id: central.id, cantidad: '1', costo_total: '1.00' },
                e.ctx,
            ),
        )
        assert.equal(dosVeces.codigo, 'saldo_inicial_registrado')

        // traslado de 1 de 3 (Q10): sale Q3.33 y entra Q3.33; sin asiento
        const traslado = await new TrasladarInventario().execute(
            {
                producto_id: producto.id,
                bodega_origen_id: central.id,
                bodega_destino_id: tecnico.id,
                cantidad: '1',
            },
            e.ctx,
        )
        assert.equal(traslado.salida.costo_total, '-3.33')
        assert.equal(traslado.entrada.costo_total, '3.33')
        assert.equal(traslado.salida.traslado_id, traslado.traslado_id)
        assert.isNull(traslado.salida.asiento_id)
        assert.deepEqual(await saldoInventario(producto.id, central.id), ['2.000', '6.67'])
        const despues = await errorDe(
            new CargarSaldoInicial().execute(
                { producto_id: producto.id, bodega_id: tecnico.id, cantidad: '1', costo_total: '1.00' },
                e.ctx,
            ),
        )
        assert.equal(despues.codigo, 'saldo_inicial_con_movimientos')

        // faltante de 0.5 en el técnico: 5.6.02 / 1.1.14 al promedio (Q3.33 → Q1.67)
        const faltante = await new AjustarInventario().execute(
            {
                producto_id: producto.id,
                bodega_id: tecnico.id,
                cantidad: '-0.5',
                motivo: 'conteo de vehículo',
            },
            e.ctx,
        )
        assert.equal(faltante.costo_total, '-1.67')
        assert.deepEqual(await partidas('inventario', faltante.id), [
            [CUENTAS_GT.MERMAS_INVENTARIO, '1.67', '0.00', null],
            [CUENTAS_GT.INVENTARIOS, '0.00', '1.67', null],
        ])
        // sobrante de 2 en la central al promedio (6.67 / 2): 1.1.14 / 4.2.04
        const sobrante = await new AjustarInventario().execute(
            { producto_id: producto.id, bodega_id: central.id, cantidad: '2', motivo: 'apareció en bodega' },
            e.ctx,
        )
        assert.equal(sobrante.costo_total, '6.67')
        assert.deepEqual(await partidas('inventario', sobrante.id), [
            [CUENTAS_GT.INVENTARIOS, '6.67', '0.00', null],
            [CUENTAS_GT.SOBRANTES_INVENTARIO, '0.00', '6.67', null],
        ])
        const sinMotivo = await errorDe(
            new AjustarInventario().execute(
                { producto_id: producto.id, bodega_id: central.id, cantidad: '1', motivo: ' ' },
                e.ctx,
            ),
        )
        assert.equal(sinMotivo.status, 422)
        // un producto sin ningún costo necesita costo_unitario para un sobrante
        const nuevo = await productoEn(e.B, e.ctx)
        const sinCosto = await errorDe(
            new AjustarInventario().execute(
                { producto_id: nuevo.id, bodega_id: central.id, cantidad: '1', motivo: 'apareció' },
                e.ctx,
            ),
        )
        assert.include(sinCosto.reglas, 'costo_requerido')
        await afirmarCuadre(assert, e.B)
    })

    test('10. compras sin producto, líneas mal formadas, sin crédito fiscal y NCRE de devolución', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const producto = await productoEn(e.B, e.ctx)
        const bodega = await bodegaEn(e.B, e.ctx)
        const proveedor = await proveedorEn(e.B, e.ctx)
        const base = {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT' as const,
            fecha_documento: haceMeses(0),
            condicion: 'credito' as const,
        }
        const servicio = await errorDe(
            new RegistrarCompra().execute(
                {
                    ...base,
                    numero: unico('F'),
                    lineas: [
                        {
                            descripcion: 'x',
                            tipo: 'servicio',
                            total: '11.20',
                            producto_id: producto.id,
                            bodega_id: bodega.id,
                        },
                    ],
                },
                e.ctx,
            ),
        )
        assert.include(servicio.reglas, 'linea_inventario')
        const sinBodega = await errorDe(
            new RegistrarCompra().execute(
                {
                    ...base,
                    numero: unico('F'),
                    lineas: [{ descripcion: 'x', tipo: 'bien', total: '11.20', producto_id: producto.id }],
                },
                e.ctx,
            ),
        )
        assert.include(sinBodega.reglas, 'linea_inventario')
        const cuenta = await errorDe(
            new RegistrarCompra().execute(
                {
                    ...base,
                    numero: unico('F'),
                    lineas: [
                        { descripcion: 'x', tipo: 'bien', total: '11.20', cuenta: CUENTAS_GT.INVENTARIOS },
                    ],
                },
                e.ctx,
            ),
        )
        assert.include(cuenta.reglas, 'cuenta_inventario')
        // sin producto, todo igual que antes: gasto 5.2.99 y nada en el kardex
        const normal = await new RegistrarCompra().execute(
            {
                ...base,
                numero: unico('F'),
                lineas: [{ descripcion: 'Papelería', tipo: 'bien', total: '11.20' }],
            },
            e.ctx,
        )
        assert.isNull(normal.lineas[0]!.producto_id)
        const partidasNormal = await partidas('compra', normal.id)
        assert.equal(partidasNormal[0]![0], CUENTAS.GASTO_OTROS)
        // sin crédito fiscal (RECIBO de no residente no aplica; FACT con credito_fiscal false): costo con IVA
        const sinCredito = await new RegistrarCompra().execute(
            {
                ...base,
                numero: unico('F'),
                credito_fiscal: false,
                lineas: [
                    {
                        descripcion: 'Grapas',
                        tipo: 'bien',
                        total: '22.40',
                        cantidad: 4,
                        producto_id: producto.id,
                        bodega_id: bodega.id,
                    },
                ],
            },
            e.ctx,
        )
        const partidasSinCredito = await partidas('compra', sinCredito.id)
        assert.deepEqual(partidasSinCredito[0]!.slice(0, 3), [CUENTAS_GT.INVENTARIOS, '22.40', '0.00'])
        assert.deepEqual(await saldoInventario(producto.id, bodega.id), ['4.000', '22.40'])
        // fase B: la NCRE con producto devuelve al proveedor (sin crédito fiscal: Q5.60 la grapa con IVA)
        await new RegistrarCompra().execute(
            {
                ...base,
                tipo_documento: 'NCRE',
                numero: unico('NC'),
                compra_referencia_id: sinCredito.id,
                lineas: [
                    {
                        descripcion: 'x',
                        tipo: 'bien',
                        total: '5.60',
                        producto_id: producto.id,
                        bodega_id: bodega.id,
                    },
                ],
            },
            e.ctx,
        )
        assert.deepEqual(await contarMovimientos(e.B), { kardex: 2, asientos: 0 })
        assert.deepEqual(await saldoInventario(producto.id, bodega.id), ['3.000', '16.80'])
        await afirmarCuadre(assert, e.B)
    })

    test('rutas: existencias, kardex, tope por técnico y permisos de los roles base', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const creado = await estado(
            client
                .post('/api/v1/productos')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('p'))
                .json({
                    sku: unico('UTP'),
                    nombre: 'Cable UTP',
                    tipo: 'material',
                    seguimiento: 'cantidad',
                    unidad: 'metro',
                }),
            201,
        )
        const producto = creado.body()
        const centralRespuesta = await estado(
            client
                .post('/api/v1/bodegas')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ nombre: unico('Central'), tipo: 'bodega' }),
            201,
        )
        const central = centralRespuesta.body()
        await estado(
            client.post('/api/v1/inventario/saldos-iniciales').bearerToken(e.token).headers(cabecera).json({
                producto_id: producto.id,
                bodega_id: central.id,
                cantidad: '100',
                costo_unitario: '2.5',
            }),
            201,
        )

        // técnico con su rol limitado a una zona: opera su bodega y la central (sin zona), no la de otro técnico
        const zona = await crearZonaFila()
        const tecnico = await usuarioConRoles([])
        const otro = await usuarioConRoles([])
        const rol = await db.from('core.roles').where('nombre', 'tecnico').select('id').firstOrFail()
        for (const u of [tecnico, otro]) {
            await db
                .table('core.usuarios_roles')
                .insert({ usuario_id: u.usuario.id, role_id: rol.id, alcance_tipo: 'zona', alcance_id: zona })
        }
        const suyaRespuesta = await estado(
            client
                .post('/api/v1/bodegas')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ nombre: unico('Vehículo'), tipo: 'tecnico', usuario_id: tecnico.usuario.id }),
            201,
        )
        const suya = suyaRespuesta.body()
        const ajenaRespuesta = await estado(
            client
                .post('/api/v1/bodegas')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ nombre: unico('Vehículo'), tipo: 'tecnico', usuario_id: otro.usuario.id }),
            201,
        )
        const ajena = ajenaRespuesta.body()
        const traslado = await estado(
            client
                .post('/api/v1/inventario/traslados')
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('t'))
                .json({
                    producto_id: producto.id,
                    bodega_origen_id: central.id,
                    bodega_destino_id: suya.id,
                    cantidad: '30',
                }),
            201,
        )
        assert.equal(traslado.body().entrada.costo_total, '75.00')
        await estado(
            client
                .post('/api/v1/inventario/consumos')
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ producto_id: producto.id, bodega_id: suya.id, cantidad: '12.5' }),
            201,
        )
        // la del otro técnico: ni moverla ni verla
        await estado(
            client.post('/api/v1/inventario/traslados').bearerToken(tecnico.token).headers(cabecera).json({
                producto_id: producto.id,
                bodega_origen_id: ajena.id,
                bodega_destino_id: suya.id,
                cantidad: '1',
            }),
            403,
        )
        const bodegas = await estado(
            client.get('/api/v1/bodegas').bearerToken(tecnico.token).headers(cabecera),
            200,
        )
        const ids = bodegas.body().data.map((b: { id: number }) => b.id)
        assert.includeMembers(ids, [central.id, suya.id])
        assert.notInclude(ids, ajena.id)
        // el técnico no ajusta ni da de baja
        await estado(
            client
                .post('/api/v1/inventario/ajustes')
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ producto_id: producto.id, bodega_id: suya.id, cantidad: '-1', motivo: 'conteo' }),
            403,
        )

        const existencias = await estado(
            client
                .get('/api/v1/inventario/existencias')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ producto_id: producto.id }),
            200,
        )
        const filas = existencias.body().data as Array<{
            bodega_id: number
            cantidad: string
            valor: string
            costo_promedio: string
        }>
        assert.deepEqual(
            filas.map((f) => [f.bodega_id, f.cantidad, f.valor, f.costo_promedio]),
            [
                [central.id, '70.000', '175.00', '2.500000'],
                [suya.id, '17.500', '43.75', '2.500000'],
            ],
        )
        const kardex = await estado(
            client
                .get('/api/v1/inventario/movimientos')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ producto_id: producto.id }),
            200,
        )
        const movimientos = kardex.body().data as Array<{
            tipo: string
            saldo_cantidad: string
            saldo_valor: string
        }>
        assert.deepEqual(
            movimientos.map((m) => [m.tipo, m.saldo_cantidad, m.saldo_valor]),
            [
                ['saldo_inicial', '100.000', '250.00'],
                ['traslado', '70.000', '175.00'],
                ['traslado', '100.000', '250.00'],
                ['consumo', '87.500', '218.75'],
            ],
        )
        const soloTecnico = await estado(
            client
                .get('/api/v1/inventario/movimientos')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ producto_id: producto.id, bodega_id: suya.id }),
            200,
        )
        assert.deepEqual(
            soloTecnico.body().data.map((m: { saldo_cantidad: string }) => m.saldo_cantidad),
            ['30.000', '17.500'],
        )
        const lista = await estado(
            client.get('/api/v1/productos').bearerToken(e.token).headers(cabecera).qs({ q: producto.sku }),
            200,
        )
        assert.equal(lista.body().data[0].existencia, '87.500')
        assert.equal(lista.body().data[0].valor, '218.75')

        // roles base: lectura y cajero ven; contabilidad ajusta y crea productos (decisión del líder, fase B)
        const lectura = await usuarioConRoles(['lectura'])
        await estado(
            client.get('/api/v1/inventario/existencias').bearerToken(lectura.token).headers(cabecera),
            200,
        )
        const contador = await usuarioConRoles(['contabilidad'])
        await estado(
            client
                .post('/api/v1/inventario/ajustes')
                .bearerToken(contador.token)
                .headers(cabecera)
                .json({ producto_id: producto.id, bodega_id: suya.id, cantidad: '-0.5', motivo: 'conteo' }),
            201,
        )
        await estado(
            client
                .post('/api/v1/productos')
                .bearerToken(contador.token)
                .headers(cabecera)
                .json({ sku: unico('X'), nombre: 'Otro', tipo: 'otro', seguimiento: 'cantidad' }),
            201,
        )
        await afirmarCuadre(assert, e.B)
    })
})
