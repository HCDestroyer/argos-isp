/*
|--------------------------------------------------------------------------
| Rutas de proveedores, compras, pagos a proveedores, activos y diferidos
| (A3, localización fiscal §3.4 y §10.10, fase 5)
|--------------------------------------------------------------------------
|
| Las monta `start/routes/ledger.ts`.
|
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirAcceso, exigirEmpresaPeticion } from '#billing/empresa'
import { resolverEmpresaActiva } from '#core/empresas'
import { exportar, TIPOS_CONTENIDO } from '#billing/reportes/exportar'
import type { Reporte } from '#billing/reportes/definicion'
import * as v from '#ledger/validators_compras'
import { Compra, CuadreCompras, Proveedor, ReporteLibroCompras } from '#ledger/esquemas_compras'
import { empresaDeProveedor, listarProveedores, verProveedor } from '#ledger/proveedores'
import { empresaDeCompra, listarCompras, verCompra } from '#ledger/compras'
import { dimensionesDeEgreso } from '#ledger/egresos'
import { cuadreCompras, libroCompras } from '#fiscal/libros'
import CrearProveedor from '#ledger/actions/crear_proveedor'
import EditarProveedor from '#ledger/actions/editar_proveedor'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import RegistrarCompraDesdeEgreso from '#ledger/actions/registrar_compra_desde_egreso'
import AnularCompra from '#ledger/actions/anular_compra'

/** JSON, o descarga CSV/XLSX con nombre `<reporte>-<fecha>.<ext>` (como `/reportes/*`). */
export function responderReporte(ctx: HttpContext, reporte: Reporte, formato?: 'json' | 'csv' | 'xlsx') {
    if (!formato || formato === 'json') return Promise.resolve(reporte)
    const nombre = `${reporte.reporte}-${new Date().toISOString().slice(0, 10)}.${formato}`
    ctx.response.header('Content-Type', TIPOS_CONTENIDO[formato])
    ctx.response.header('Content-Disposition', `attachment; filename="${nombre}"`)
    ctx.response.header('Cache-Control', 'private, no-store')
    ctx.response.send(exportar(reporte, formato))
    return Promise.resolve(undefined)
}

export const DESCRIPCION_EXPORTACION =
    ' Con `formato=csv` o `formato=xlsx` responde el archivo con la fila de totales al final.'

/** Empresa de un libro legal: la pedida (dentro del alcance) o la activa. */
export async function empresaDelLibro(ctx: HttpContext, empresaId?: number): Promise<number> {
    if (empresaId) {
        exigirEmpresaPeticion(ctx.empresa, empresaId)
        return empresaId
    }
    return resolverEmpresaActiva(ctx.contextoAccion())
}

const proveedores: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/proveedores',
        operacion: 'proveedoresListar',
        resumen: 'Proveedores de la empresa con el saldo de su auxiliar (2.1.03)',
        etiqueta: 'compras',
        permiso: 'proveedores.ver',
        query: v.listarProveedoresValidator,
        respuesta: { status: 200, descripcion: 'Página de proveedores', esquema: pagina(Proveedor) },
        handler: (ctx, { query }) => listarProveedores(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/proveedores/:id',
        operacion: 'proveedoresVer',
        resumen: 'Ver proveedor',
        etiqueta: 'compras',
        permiso: 'proveedores.ver',
        respuesta: { status: 200, descripcion: 'Proveedor', esquema: Proveedor },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeProveedor(id))
            return verProveedor(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/proveedores',
        operacion: 'proveedoresCrear',
        resumen: 'Dar de alta un proveedor (NIT validado como en el núcleo)',
        etiqueta: 'compras',
        permiso: 'proveedores.editar',
        cuerpo: v.crearProveedorValidator,
        idempotente: true,
        descripcion:
            'NIT con dígito verificador, CUI o id_extranjero (no residentes). 409 proveedor_duplicado si la empresa ya tiene uno activo con ese documento.',
        respuesta: { status: 201, descripcion: 'Proveedor creado', esquema: Proveedor },
        handler: (ctx, { cuerpo }) => new CrearProveedor().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/proveedores/:id',
        operacion: 'proveedoresEditar',
        resumen: 'Editar un proveedor (con version)',
        etiqueta: 'compras',
        permiso: 'proveedores.editar',
        cuerpo: v.editarProveedorValidator,
        idempotente: true,
        descripcion:
            'Con version (409 si cambió) y audit.cambios. El documento y el país no se editan (422 campo_solo_lectura).',
        respuesta: { status: 200, descripcion: 'Proveedor', esquema: Proveedor },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeProveedor(id))
            return new EditarProveedor().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
]

const compras: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/compras',
        operacion: 'comprasListar',
        resumen: 'Compras (documentos de proveedores) con sus líneas y retenciones',
        etiqueta: 'compras',
        permiso: 'compras.ver',
        query: v.listarComprasValidator,
        respuesta: { status: 200, descripcion: 'Página de compras', esquema: pagina(Compra) },
        handler: (ctx, { query }) => listarCompras(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/compras/:id',
        operacion: 'comprasVer',
        resumen: 'Ver compra',
        etiqueta: 'compras',
        permiso: 'compras.ver',
        respuesta: { status: 200, descripcion: 'Compra', esquema: Compra },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeCompra(id))
            return verCompra(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/compras',
        operacion: 'comprasRegistrar',
        resumen:
            'Registrar una compra al contado o al crédito (Gasto/Activo + IVA crédito / Caja|Banco|Proveedores)',
        etiqueta: 'compras',
        permiso: 'compras.registrar',
        cuerpo: v.registrarCompraValidator,
        idempotente: true,
        descripcion:
            'Solo inserción. Al contado crea el egreso que la paga (un solo asiento, el de la compra). Al crédito queda en 2.1.03 con el auxiliar del proveedor. FPEQ, FCAP y RECIBO sin crédito fiscal; crédito fuera de la ventana: 422 credito_fiscal_extemporaneo. 409 compra_duplicada. Retenciones sugeridas si no se indican. Emite compra.registrada.',
        respuesta: { status: 201, descripcion: 'Compra registrada', esquema: Compra },
        handler: async (ctx, { cuerpo }) => {
            exigirAcceso(ctx, await empresaDeProveedor(cuerpo.proveedor_id))
            return new RegistrarCompra().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/compras/desde-egreso/:egresoId',
        operacion: 'comprasDesdeEgreso',
        resumen:
            'Registrar como compra un egreso que tenía factura (reclasificación, sin duplicar el asiento)',
        etiqueta: 'compras',
        permiso: 'compras.registrar',
        cuerpo: v.compraDesdeEgresoValidator,
        idempotente: true,
        descripcion:
            'El asiento del egreso no se toca: la compra lleva una reclasificación (IVA crédito / gasto del egreso). El neto (total − retenciones) debe ser el monto del egreso (422 compra_distinta_del_egreso). Fuera de la ventana del crédito entra sin crédito. 409 egreso_con_compra, egreso_de_compra, egreso_anulado. Emite compra.registrada.',
        respuesta: { status: 201, descripcion: 'Compra registrada', esquema: Compra },
        handler: async (ctx, { cuerpo, params }) => {
            const egresoId = Number(params.egresoId)
            exigirAcceso(ctx, await dimensionesDeEgreso(egresoId))
            return new RegistrarCompraDesdeEgreso().execute(
                { ...cuerpo, egreso_id: egresoId },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/compras/:id/anular',
        operacion: 'comprasAnular',
        resumen: 'Anular una compra (asiento de reverso)',
        etiqueta: 'compras',
        permiso: 'compras.anular',
        cuerpo: v.anularCompraValidator,
        idempotente: true,
        descripcion:
            'Reverso con fecha de hoy y las etiquetas de impuesto en signo contrario (el libro de compras resta la anulación en su mes). Al contado anula también su egreso. 409 compra_anulada, compra_con_notas, compra_con_pagos, compra_con_constancia, activo_con_cuotas, diferido_con_cuotas. Emite compra.anulada.',
        respuesta: { status: 200, descripcion: 'Compra anulada', esquema: Compra },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeCompra(id))
            return new AnularCompra().execute({ compra_id: id, motivo: cuerpo.motivo }, ctx.contextoAccion())
        },
    }),
]

const libros: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/libros/compras',
        operacion: 'librosCompras',
        resumen: 'Libro de compras y servicios recibidos (vista previa, sin folio)',
        etiqueta: 'libros',
        permiso: 'libros.ver',
        query: v.libroComprasValidator,
        descripcion:
            'Por mes del IVA: las compras con su periodo_iva en el rango y las anulaciones cuyo reverso cae en él (en negativo). El total de iva_credito cuadra con el movimiento de 1.1.04 de los asientos de compras del rango (GET /libros/compras/cuadre). La emisión con folio llega con los bloqueos.' +
            DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Libro', esquema: ReporteLibroCompras },
        handler: async (ctx, { query }) =>
            responderReporte(
                ctx,
                await libroCompras(await empresaDelLibro(ctx, query.empresa_id), query),
                query.formato,
            ),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libros/compras/cuadre',
        operacion: 'librosComprasCuadre',
        resumen: 'Cuadre del libro de compras con 1.1.04 IVA crédito fiscal, por mes',
        etiqueta: 'libros',
        permiso: 'libros.ver',
        query: v.cuadreComprasValidator,
        respuesta: { status: 200, descripcion: 'Cuadre por mes', esquema: lista(CuadreCompras) },
        handler: async (ctx, { query }) => cuadreCompras(await empresaDelLibro(ctx, query.empresa_id), query),
    }),
]

export default [...proveedores, ...compras, ...libros]
