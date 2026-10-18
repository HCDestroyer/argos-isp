/*
|--------------------------------------------------------------------------
| Rutas de cobros y bancos (A3, localización fiscal §10.3 y §10.9, fase 4)
|--------------------------------------------------------------------------
|
| Las monta `start/routes/ledger.ts`.
|
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirAcceso } from '#billing/empresa'
import * as v from '#ledger/validators_bancos'
import { LiquidacionCobro, ProveedorCobro, ResumenCobrosPorLiquidar } from '#ledger/esquemas_bancos'
import {
    empresaDeProveedorCobro,
    listarLiquidaciones,
    listarProveedoresCobro,
    resumenCobrosPorLiquidar,
    verLiquidacion,
} from '#ledger/cobros_liquidar'
import CrearProveedorCobro from '#ledger/actions/crear_proveedor_cobro'
import EditarProveedorCobro from '#ledger/actions/editar_proveedor_cobro'
import LiquidarCobros from '#ledger/actions/liquidar_cobros'

const cobros: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/cobros/proveedores',
        operacion: 'cobrosProveedores',
        resumen: 'Proveedores de cobro (pasarelas, agentes, débito) con su cuenta puente 1.1.10.NN',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        query: v.empresasBancosValidator,
        respuesta: { status: 200, descripcion: 'Proveedores', esquema: lista(ProveedorCobro) },
        handler: (ctx, { query }) => listarProveedoresCobro(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/cobros/proveedores',
        operacion: 'cobrosCrearProveedor',
        resumen: 'Dar de alta un proveedor de cobro (crea su subcuenta 1.1.10.NN)',
        etiqueta: 'bancos',
        permiso: 'cobros.configurar',
        cuerpo: v.crearProveedorCobroValidator,
        idempotente: true,
        descripcion:
            'Desde `desde` (fecha de corte, hoy o futura) los pagos de ese proveedor van a su 1.1.10.NN por el bruto y la comisión sale de la liquidación. Los anteriores quedan contra el banco (§12.11). 409 proveedor_cobro_duplicado.',
        respuesta: { status: 201, descripcion: 'Proveedor creado', esquema: ProveedorCobro },
        handler: (ctx, { cuerpo }) => new CrearProveedorCobro().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/cobros/proveedores/:id',
        operacion: 'cobrosEditarProveedor',
        resumen: 'Editar nombre, banco de liquidación o activo de un proveedor de cobro',
        etiqueta: 'bancos',
        permiso: 'cobros.configurar',
        cuerpo: v.editarProveedorCobroValidator,
        idempotente: true,
        descripcion: 'Con version (409 si cambió). La fecha de corte no se edita (422 campo_solo_lectura).',
        respuesta: { status: 200, descripcion: 'Proveedor', esquema: ProveedorCobro },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeProveedorCobro(id))
            return new EditarProveedorCobro().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/cobros/por-liquidar',
        operacion: 'cobrosPorLiquidar',
        resumen: 'Cobros por liquidar por proveedor: puente 1.1.10.NN vs pagos pendientes y antigüedad',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        query: v.empresasBancosValidator,
        descripcion:
            'Check cobros_por_liquidar (§10.3): saldo de 1.1.10.NN = Σ pagos sin liquidar − contracargos; anomalias = pagos más antiguos que cobros_liquidar_dias.',
        respuesta: { status: 200, descripcion: 'Resumen', esquema: lista(ResumenCobrosPorLiquidar) },
        handler: (ctx, { query }) => resumenCobrosPorLiquidar(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/cobros/liquidaciones',
        operacion: 'cobrosLiquidaciones',
        resumen: 'Liquidaciones de proveedores de cobro',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        query: v.listarLiquidacionesValidator,
        respuesta: { status: 200, descripcion: 'Página de liquidaciones', esquema: pagina(LiquidacionCobro) },
        handler: (ctx, { query }) =>
            listarLiquidaciones(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/cobros/liquidaciones/:id',
        operacion: 'cobrosVerLiquidacion',
        resumen: 'Ver liquidación',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        respuesta: { status: 200, descripcion: 'Liquidación', esquema: LiquidacionCobro },
        handler: async (ctx, { params }) => {
            const liquidacion = await verLiquidacion(Number(params.id))
            exigirAcceso(ctx, { empresa_id: liquidacion.empresa_id })
            return liquidacion
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/cobros/liquidaciones',
        operacion: 'cobrosLiquidar',
        resumen: 'Registrar la liquidación de un proveedor (Banco neto + Comisión / 1.1.10.NN bruto)',
        etiqueta: 'bancos',
        permiso: 'cobros.liquidar',
        cuerpo: v.liquidarCobrosValidator,
        idempotente: true,
        descripcion:
            'bruto = Σ pagos − Σ contracargos (422 liquidacion_descuadrada); neto = bruto − comisión. Cada pago se liquida una vez (409 pago_ya_liquidado); referencia única por proveedor (409 liquidacion_duplicada). Emite cobros.liquidados.',
        respuesta: { status: 201, descripcion: 'Liquidación registrada', esquema: LiquidacionCobro },
        handler: async (ctx, { cuerpo }) => {
            exigirAcceso(ctx, await empresaDeProveedorCobro(cuerpo.proveedor_cobro_id))
            return new LiquidarCobros().execute(cuerpo, ctx.contextoAccion())
        },
    }),
]

export default [...cobros]
