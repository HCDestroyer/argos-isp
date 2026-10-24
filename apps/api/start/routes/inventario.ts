/*
|--------------------------------------------------------------------------
| Rutas del inventario interno (A3, `contratos/inventario.md` §6, fase A)
|--------------------------------------------------------------------------
|
| Productos, bodegas, existencias, kardex y operaciones (consumo, traslado, ajuste, baja y saldo
| inicial). Los handlers solo validan, revisan el acceso (empresa, alcance y tope por técnico de
| cada bodega) y llaman a la acción.
|
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirAcceso } from '#billing/empresa'
import * as v from '#inventario/validators'
import { Bodega, Existencia, MovimientoInventario, Producto, TrasladoInventario } from '#inventario/esquemas'
import { empresaDeProducto, listarProductos, verProducto } from '#inventario/productos'
import { exigirOperarBodega, listarBodegas, verBodega, type AccesoBodegas } from '#inventario/bodegas'
import { listarExistencias, listarKardex } from '#inventario/kardex'
import CrearProducto from '#inventario/actions/crear_producto'
import EditarProducto from '#inventario/actions/editar_producto'
import DesactivarProducto from '#inventario/actions/desactivar_producto'
import CrearBodega from '#inventario/actions/crear_bodega'
import EditarBodega from '#inventario/actions/editar_bodega'
import DesactivarBodega from '#inventario/actions/desactivar_bodega'
import ConsumirInventario from '#inventario/actions/consumir_inventario'
import TrasladarInventario from '#inventario/actions/trasladar_inventario'
import AjustarInventario from '#inventario/actions/ajustar_inventario'
import DarDeBajaInventario from '#inventario/actions/dar_de_baja_inventario'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'

function acceso(ctx: HttpContext): AccesoBodegas {
    return { alcance: ctx.alcance, usuarioId: ctx.auth.user?.id ?? null }
}

/** La bodega existe (404), es de una empresa del usuario (403) y la puede mover (403). */
async function exigirBodega(ctx: HttpContext, bodegaId: number, destino = false): Promise<void> {
    const bodega = await verBodega(bodegaId)
    exigirAcceso(ctx, { empresa_id: bodega.empresa_id })
    // el destino de un traslado puede ser la bodega de otro técnico (se le entrega); solo el alcance
    exigirOperarBodega(acceso(ctx), destino ? { ...bodega, tipo: 'bodega' } : bodega)
}

const DESCRIPCION_COSTO =
    'Sale al costo promedio de la bodega (la salida que la vacía lleva todo su valor). Fecha de hoy; respeta los bloqueos del libro (422 periodo_cerrado o periodo_bloqueado, 409 bloqueo_duro). 409 existencia_insuficiente sin escribir nada. Productos con seguimiento serie: 422 requiere_unidades (fase B). Emite inventario.movimiento_registrado e inventario.existencia_minima al cruzar el mínimo.'

const productos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/productos',
        operacion: 'productosListar',
        resumen: 'Productos del inventario con su existencia y valor totales',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        query: v.listarProductosValidator,
        respuesta: { status: 200, descripcion: 'Página de productos', esquema: pagina(Producto) },
        handler: (ctx, { query }) => listarProductos(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/productos/:id',
        operacion: 'productosVer',
        resumen: 'Ver producto',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        respuesta: { status: 200, descripcion: 'Producto', esquema: Producto },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeProducto(id))
            return verProducto(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/productos',
        operacion: 'productosCrear',
        resumen: 'Crear un producto (SKU único por empresa)',
        etiqueta: 'inventario',
        permiso: 'productos.crear',
        cuerpo: v.crearProductoValidator,
        idempotente: true,
        descripcion:
            '409 sku_duplicado. clase_activo solo con seguimiento serie (por defecto equipo_red). cuenta_costo y cuenta_consumo: cuentas de gasto (por defecto 5.6.01 y 5.2.07).',
        respuesta: { status: 201, descripcion: 'Producto creado', esquema: Producto },
        handler: (ctx, { cuerpo }) => new CrearProducto().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/productos/:id/editar',
        operacion: 'productosEditar',
        resumen: 'Editar un producto (con version)',
        etiqueta: 'inventario',
        permiso: 'productos.editar',
        cuerpo: v.editarProductoValidator,
        idempotente: true,
        versionada: true,
        descripcion:
            'Con version (409 si cambió) y audit.cambios. El seguimiento no cambia si hay movimientos (409 producto_con_movimientos). null limpia los opcionales.',
        respuesta: { status: 200, descripcion: 'Producto', esquema: Producto },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeProducto(id))
            return new EditarProducto().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/productos/:id/desactivar',
        operacion: 'productosDesactivar',
        resumen: 'Desactivar un producto sin existencias',
        etiqueta: 'inventario',
        permiso: 'productos.desactivar',
        cuerpo: v.desactivarValidator,
        idempotente: true,
        versionada: true,
        descripcion: '409 producto_con_existencias, producto_inactivo. El kardex queda.',
        respuesta: { status: 200, descripcion: 'Producto', esquema: Producto },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeProducto(id))
            return new DesactivarProducto().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
]

const bodegas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/bodegas',
        operacion: 'bodegasListar',
        resumen: 'Bodegas y bodegas de técnico',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        query: v.listarBodegasValidator,
        descripcion:
            'Una bodega de técnico solo la ve su usuario o quien tenga el permiso sin alcance; una con zona o router, quien tenga ese alcance.',
        respuesta: { status: 200, descripcion: 'Página de bodegas', esquema: pagina(Bodega) },
        handler: (ctx, { query }) =>
            listarBodegas(query, empresasDeLaLista(ctx.empresa, query.empresas), acceso(ctx)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bodegas/:id',
        operacion: 'bodegasVer',
        resumen: 'Ver bodega',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        respuesta: { status: 200, descripcion: 'Bodega', esquema: Bodega },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirBodega(ctx, id)
            return verBodega(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bodegas',
        operacion: 'bodegasCrear',
        resumen: 'Crear una bodega o la bodega de un técnico',
        etiqueta: 'inventario',
        permiso: 'bodegas.crear',
        cuerpo: v.crearBodegaValidator,
        idempotente: true,
        descripcion:
            'tipo tecnico lleva usuario_id (una activa por usuario y empresa: 409 bodega_tecnico_duplicada). Nombre único por empresa (409 bodega_duplicada).',
        respuesta: { status: 201, descripcion: 'Bodega creada', esquema: Bodega },
        handler: (ctx, { cuerpo }) => new CrearBodega().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bodegas/:id/editar',
        operacion: 'bodegasEditar',
        resumen: 'Editar una bodega (con version)',
        etiqueta: 'inventario',
        permiso: 'bodegas.editar',
        cuerpo: v.editarBodegaValidator,
        idempotente: true,
        versionada: true,
        descripcion:
            'Nombre, técnico, zona y router. Cambiar el técnico de una bodega con existencias: 409 bodega_con_existencias.',
        respuesta: { status: 200, descripcion: 'Bodega', esquema: Bodega },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirBodega(ctx, id)
            return new EditarBodega().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bodegas/:id/desactivar',
        operacion: 'bodegasDesactivar',
        resumen: 'Desactivar una bodega sin existencias',
        etiqueta: 'inventario',
        permiso: 'bodegas.desactivar',
        cuerpo: v.desactivarValidator,
        idempotente: true,
        versionada: true,
        descripcion: '409 bodega_con_existencias, bodega_inactiva.',
        respuesta: { status: 200, descripcion: 'Bodega', esquema: Bodega },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirBodega(ctx, id)
            return new DesactivarBodega().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
]

const lecturas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/existencias',
        operacion: 'inventarioExistencias',
        resumen: 'Existencias: cantidad, valor y costo promedio por producto × bodega',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        query: v.existenciasValidator,
        respuesta: { status: 200, descripcion: 'Página de existencias', esquema: pagina(Existencia) },
        handler: (ctx, { query }) =>
            listarExistencias(query, empresasDeLaLista(ctx.empresa, query.empresas), acceso(ctx)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/movimientos',
        operacion: 'inventarioKardex',
        resumen: 'Kardex: movimientos en orden de registro con el saldo corrido por producto',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        query: v.kardexValidator,
        descripcion:
            'El saldo corrido es por producto (y por bodega si se filtra por bodega_id), calculado sobre toda la historia antes de filtrar por fecha o tipo.',
        respuesta: { status: 200, descripcion: 'Página del kardex', esquema: pagina(MovimientoInventario) },
        handler: (ctx, { query }) =>
            listarKardex(query, empresasDeLaLista(ctx.empresa, query.empresas), acceso(ctx)),
    }),
]

const operaciones: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/consumos',
        operacion: 'inventarioConsumir',
        resumen: 'Consumo de materiales (cuenta_consumo, por defecto 5.2.07 / 1.1.14)',
        etiqueta: 'inventario',
        permiso: 'inventario.consumir',
        cuerpo: v.consumoValidator,
        idempotente: true,
        descripcion: `servicio_id opcional (misma empresa). ${DESCRIPCION_COSTO}`,
        respuesta: { status: 201, descripcion: 'Movimiento', esquema: MovimientoInventario },
        handler: async (ctx, { cuerpo }) => {
            await exigirBodega(ctx, cuerpo.bodega_id)
            return new ConsumirInventario().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/traslados',
        operacion: 'inventarioTrasladar',
        resumen: 'Traslado entre bodegas o técnicos de la misma empresa (sin asiento)',
        etiqueta: 'inventario',
        permiso: 'inventario.trasladar',
        cuerpo: v.trasladoValidator,
        idempotente: true,
        descripcion:
            'Dos movimientos con el mismo traslado_id al mismo costo. Una bodega de otra empresa: 404. 409 existencia_insuficiente. Fecha de hoy.',
        respuesta: { status: 201, descripcion: 'Traslado', esquema: TrasladoInventario },
        handler: async (ctx, { cuerpo }) => {
            await exigirBodega(ctx, cuerpo.bodega_origen_id)
            await exigirBodega(ctx, cuerpo.bodega_destino_id, true)
            return new TrasladarInventario().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/ajustes',
        operacion: 'inventarioAjustar',
        resumen: 'Ajuste manual con motivo (faltante 5.6.02 / 1.1.14; sobrante 1.1.14 / 4.2.04)',
        etiqueta: 'inventario',
        permiso: 'inventario.ajustar',
        cuerpo: v.ajusteValidator,
        idempotente: true,
        descripcion: `cantidad con signo. El sobrante entra al último costo promedio o al costo_unitario dado (422 costo_requerido si no hay ninguno). ${DESCRIPCION_COSTO}`,
        respuesta: { status: 201, descripcion: 'Movimiento', esquema: MovimientoInventario },
        handler: async (ctx, { cuerpo }) => {
            await exigirBodega(ctx, cuerpo.bodega_id)
            return new AjustarInventario().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/bajas',
        operacion: 'inventarioDarDeBaja',
        resumen: 'Baja de existencias dañadas, robadas u obsoletas (5.6.02 / 1.1.14)',
        etiqueta: 'inventario',
        permiso: 'inventario.dar_de_baja',
        cuerpo: v.bajaValidator,
        idempotente: true,
        descripcion: DESCRIPCION_COSTO,
        respuesta: { status: 201, descripcion: 'Movimiento', esquema: MovimientoInventario },
        handler: async (ctx, { cuerpo }) => {
            await exigirBodega(ctx, cuerpo.bodega_id)
            return new DarDeBajaInventario().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/saldos-iniciales',
        operacion: 'inventarioSaldoInicial',
        resumen: 'Saldo inicial de un producto en una bodega (1.1.14 / 2.9.01)',
        etiqueta: 'inventario',
        permiso: 'inventario.cargar_saldo_inicial',
        cuerpo: v.saldoInicialValidator,
        idempotente: true,
        descripcion:
            'Una vez por producto y bodega y antes de cualquier otro movimiento (409 saldo_inicial_registrado, saldo_inicial_con_movimientos). costo_total o costo_unitario. fecha (por defecto hoy) respeta los bloqueos del libro.',
        respuesta: { status: 201, descripcion: 'Movimiento', esquema: MovimientoInventario },
        handler: async (ctx, { cuerpo }) => {
            await exigirBodega(ctx, cuerpo.bodega_id)
            return new CargarSaldoInicial().execute(cuerpo, ctx.contextoAccion())
        },
    }),
]

export default [...productos, ...bodegas, ...lecturas, ...operaciones]
