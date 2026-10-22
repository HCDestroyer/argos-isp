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
import {
    Compra,
    Constancia,
    CuadreCompras,
    EstadoCuentaProveedor,
    PagoProveedor,
    Proveedor,
    ReporteCuentasPorPagar,
    ReporteLibroCompras,
} from '#ledger/esquemas_compras'
import {
    cuentasPorPagar,
    empresaDePagoProveedor,
    estadoCuentaProveedor,
    listarPagosProveedores,
    verPagoProveedor,
} from '#ledger/pagos_proveedores'
import { existeCaja } from '#ledger/cajas'
import RegistrarPagoProveedor from '#ledger/actions/registrar_pago_proveedor'
import AnularPagoProveedor from '#ledger/actions/anular_pago_proveedor'
import { listarConstancias } from '#ledger/constancias'
import RegistrarConstanciaEmitida from '#ledger/actions/registrar_constancia_emitida'
import { empresaDeProveedor, listarProveedores, verProveedor } from '#ledger/proveedores'
import { empresaDeCompra, listarCompras, verCompra } from '#ledger/compras'
import { dimensionesDeEgreso } from '#ledger/egresos'
import { cuadreCompras, libroCompras, mesesDelRango } from '#fiscal/libros'
import { libroComprasLegal } from '#fiscal/libros_legales'
import { responderLibro } from '#fiscal/libros_http'
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

const constancias: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/constancias',
        operacion: 'constanciasListar',
        resumen: 'Constancias de retención recibidas de clientes y emitidas a proveedores',
        etiqueta: 'compras',
        permiso: 'compras.ver',
        query: v.listarConstanciasValidator,
        respuesta: { status: 200, descripcion: 'Página de constancias', esquema: pagina(Constancia) },
        handler: (ctx, { query }) => listarConstancias(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/compras/:id/constancias',
        operacion: 'comprasRegistrarConstancia',
        resumen: 'Registrar la constancia de retención emitida al proveedor por una retención de la compra',
        etiqueta: 'compras',
        permiso: 'compras.registrar',
        cuerpo: v.constanciaEmitidaValidator,
        idempotente: true,
        descripcion:
            'No mueve el libro (la retención ya está en 2.1.04 o 2.1.05). Monto = el de la retención de la compra. 409 constancia_registrada, constancia_duplicada, compra_anulada.',
        respuesta: { status: 201, descripcion: 'Constancia registrada', esquema: Constancia },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeCompra(id))
            return new RegistrarConstanciaEmitida().execute(
                { ...cuerpo, compra_id: id },
                ctx.contextoAccion(),
            )
        },
    }),
]

const pagosProveedores: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/pagos-proveedores',
        operacion: 'pagosProveedoresListar',
        resumen: 'Pagos a proveedores con sus aplicaciones a compras',
        etiqueta: 'compras',
        permiso: 'compras.ver',
        query: v.listarPagosProveedoresValidator,
        respuesta: { status: 200, descripcion: 'Página de pagos', esquema: pagina(PagoProveedor) },
        handler: (ctx, { query }) =>
            listarPagosProveedores(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/pagos-proveedores/:id',
        operacion: 'pagosProveedoresVer',
        resumen: 'Ver pago a proveedor',
        etiqueta: 'compras',
        permiso: 'compras.ver',
        respuesta: { status: 200, descripcion: 'Pago', esquema: PagoProveedor },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDePagoProveedor(id))
            return verPagoProveedor(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/pagos-proveedores',
        operacion: 'pagosProveedoresRegistrar',
        resumen: 'Pagar compras al crédito de un proveedor (Proveedores / Caja | Banco)',
        etiqueta: 'compras',
        permiso: 'compras.pagar',
        cuerpo: v.registrarPagoProveedorValidator,
        idempotente: true,
        descripcion:
            'Aplica a las compras pedidas y luego a la más antigua por vencimiento. No pasa del saldo pendiente (422 pago_excede_saldo). En efectivo sale del turno abierto de la caja (baja su esperado). La cuenta es de la empresa del proveedor (422 cuenta_de_otra_empresa).',
        respuesta: { status: 201, descripcion: 'Pago registrado', esquema: PagoProveedor },
        handler: async (ctx, { cuerpo }) => {
            exigirAcceso(ctx, await empresaDeProveedor(cuerpo.proveedor_id))
            if (cuerpo.metodo === 'caja' && cuerpo.caja_id) {
                exigirAcceso(ctx, await existeCaja(cuerpo.caja_id))
            }
            return new RegistrarPagoProveedor().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/pagos-proveedores/:id/anular',
        operacion: 'pagosProveedoresAnular',
        resumen: 'Anular un pago a proveedor (asiento de reverso)',
        etiqueta: 'compras',
        permiso: 'compras.pagar',
        cuerpo: v.anularPagoProveedorValidator,
        idempotente: true,
        descripcion: 'Reverso con fecha de hoy; sus compras vuelven a quedar con saldo. 409 pago_anulado.',
        respuesta: { status: 200, descripcion: 'Pago anulado', esquema: PagoProveedor },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDePagoProveedor(id))
            return new AnularPagoProveedor().execute(
                { pago_id: id, motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/proveedores/:id/estado-cuenta',
        operacion: 'proveedoresEstadoCuenta',
        resumen: 'Auxiliar del proveedor en 2.1.03: compras, NCRE, pagos, saldo y documentos pendientes',
        etiqueta: 'compras',
        permiso: 'proveedores.ver',
        query: v.estadoCuentaProveedorValidator,
        respuesta: { status: 200, descripcion: 'Estado de cuenta', esquema: EstadoCuentaProveedor },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeProveedor(id))
            return estadoCuentaProveedor(id, query)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/cuentas-por-pagar',
        operacion: 'reportesCuentasPorPagar',
        resumen: 'Antigüedad de proveedores (por vencer, 1-30, 31-60, 61-90, +90 días)',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.cuentasPorPagarValidator,
        descripcion:
            'Saldo pendiente de cada compra al crédito por días desde su vencimiento al corte, por proveedor. El total cuadra con 2.1.03 (check cxp_antiguedad).' +
            DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteCuentasPorPagar },
        handler: async (ctx, { query }) => {
            const empresas = empresasDeLaLista(ctx.empresa, query.empresas)
            const consolidado = query.empresas === 'todas' || empresas === null || empresas.length > 1
            return responderReporte(ctx, await cuentasPorPagar(query, empresas, consolidado), query.formato)
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
            'Por mes del IVA: las compras con su periodo_iva en el rango y las anulaciones cuyo reverso cae en él (en negativo). El total de iva_credito cuadra con el movimiento de 1.1.04 de los asientos de compras del rango (GET /libros/compras/cuadre). La emisión con folio es POST /libros/compras/emitir; formato=pdf da la vista previa en PDF con la marca de agua «Borrador sin folio».' +
            DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Libro', esquema: ReporteLibroCompras },
        handler: async (ctx, { query }) => {
            const empresaId = await empresaDelLibro(ctx, query.empresa_id)
            if (query.formato === 'pdf') {
                // libro legal con la marca de agua «Borrador sin folio» (fase 6 PR D)
                return responderLibro(ctx, await libroComprasLegal(empresaId, mesesDelRango(query)), 'pdf')
            }
            return responderReporte(ctx, await libroCompras(empresaId, query), query.formato)
        },
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

export default [...proveedores, ...compras, ...constancias, ...pagosProveedores, ...libros]
