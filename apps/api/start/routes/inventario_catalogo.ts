/*
|--------------------------------------------------------------------------
| Catálogo del inventario, fase D (A3, `contratos/inventario.md` D.2 y D.4)
|--------------------------------------------------------------------------
|
| Tipos de producto editables (por empresa o globales). Los handlers validan, revisan el acceso y
| llaman a la acción.
|
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirAcceso } from '#billing/empresa'
import * as v from '#inventario/validators'
import { TipoProducto } from '#inventario/esquemas'
import { listarTiposProducto, verTipoProducto } from '#inventario/tipos_producto'
import CrearTipoProducto from '#inventario/actions/crear_tipo_producto'
import EditarTipoProducto from '#inventario/actions/editar_tipo_producto'
import DesactivarTipoProducto from '#inventario/actions/desactivar_tipo_producto'

const rutas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/tipos-producto',
        operacion: 'inventarioTiposProducto',
        resumen: 'Tipos de producto: los globales y los de la empresa',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        query: v.listarTiposProductoValidator,
        respuesta: { status: 200, descripcion: 'Página de tipos', esquema: pagina(TipoProducto) },
        handler: (ctx, { query }) =>
            listarTiposProducto(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/tipos-producto',
        operacion: 'inventarioCrearTipoProducto',
        resumen: 'Crear un tipo de producto (de la empresa o global)',
        etiqueta: 'inventario',
        permiso: 'tipos_producto.crear',
        cuerpo: v.crearTipoProductoValidator,
        idempotente: true,
        descripcion:
            'Código único entre los de la empresa y los globales (409 tipo_duplicado). global: true solo con alcance global de empresas (403). modalidad_defecto va con seguimiento_defecto: comodato solo serie, consumible_gasto solo cantidad (422 modalidad_defecto).',
        respuesta: { status: 201, descripcion: 'Tipo de producto', esquema: TipoProducto },
        handler: (ctx, { cuerpo }) =>
            new CrearTipoProducto().execute(
                { ...cuerpo, alcance_global: ctx.empresa?.alcanceGlobal ?? false },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/tipos-producto/:id/editar',
        operacion: 'inventarioEditarTipoProducto',
        resumen: 'Editar un tipo de producto (nombre, seguimiento y modalidad por defecto)',
        etiqueta: 'inventario',
        permiso: 'tipos_producto.editar',
        cuerpo: v.editarTipoProductoValidator,
        idempotente: true,
        versionada: true,
        descripcion: 'El código no cambia. Solo afecta a los productos nuevos. Con audit.cambios.',
        respuesta: { status: 200, descripcion: 'Tipo de producto', esquema: TipoProducto },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            const tipo = await verTipoProducto(id)
            if (tipo.empresa_id !== null) exigirAcceso(ctx, { empresa_id: tipo.empresa_id })
            return new EditarTipoProducto().execute(
                { ...cuerpo, id, alcance_global: ctx.empresa?.alcanceGlobal ?? false },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/tipos-producto/:id/desactivar',
        operacion: 'inventarioDesactivarTipoProducto',
        resumen: 'Desactivar un tipo de producto (los productos que ya lo usan siguen igual)',
        etiqueta: 'inventario',
        permiso: 'tipos_producto.desactivar',
        cuerpo: v.desactivarTipoProductoValidator,
        idempotente: true,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Tipo de producto', esquema: TipoProducto },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            const tipo = await verTipoProducto(id)
            if (tipo.empresa_id !== null) exigirAcceso(ctx, { empresa_id: tipo.empresa_id })
            return new DesactivarTipoProducto().execute(
                { ...cuerpo, id, alcance_global: ctx.empresa?.alcanceGlobal ?? false },
                ctx.contextoAccion(),
            )
        },
    }),
]

export default rutas
