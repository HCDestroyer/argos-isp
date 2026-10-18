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
import {
    Deposito,
    LiquidacionCobro,
    ProveedorCobro,
    ResumenCobrosPorLiquidar,
    ResumenFondosEnTransito,
    Traslado,
} from '#ledger/esquemas_bancos'
import { existeCaja } from '#ledger/cajas'
import { listarDepositos, listarTraslados, resumenFondosEnTransito } from '#ledger/transitos'
import DepositarCaja from '#ledger/actions/depositar_caja'
import TrasladarFondos from '#ledger/actions/trasladar_fondos'
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

const transitos: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/cajas/:id/depositar',
        operacion: 'cajasDepositar',
        resumen: 'Depositar al banco efectivo del turno abierto (1.1.11 Fondos en tránsito / Caja)',
        etiqueta: 'cajas',
        permiso: 'cajas.depositar',
        cuerpo: v.depositarCajaValidator,
        idempotente: true,
        descripcion:
            'Baja el esperado del turno como un egreso; no puede superar el efectivo del turno (422 deposito_excede_efectivo). Llega al banco al conciliar su línea del extracto (Banco / 1.1.11). 409 sin_turno_abierto, 409 deposito_duplicado (boleta repetida en la cuenta). Emite caja.depositada.',
        respuesta: { status: 201, descripcion: 'Depósito registrado', esquema: Deposito },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await existeCaja(id))
            return new DepositarCaja().execute({ ...cuerpo, caja_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/trasladar',
        operacion: 'bancosTrasladar',
        resumen: 'Trasladar fondos entre cuentas propias de la empresa (1.1.11 / Banco A)',
        etiqueta: 'bancos',
        permiso: 'bancos.trasladar',
        cuerpo: v.trasladarValidator,
        idempotente: true,
        descripcion:
            'La llegada a la cuenta de destino (Banco B / 1.1.11) la registra la conciliación de su línea del extracto. Las dos cuentas son de la misma empresa (422 cuenta_de_otra_empresa). 409 traslado_duplicado.',
        respuesta: { status: 201, descripcion: 'Traslado registrado', esquema: Traslado },
        handler: (ctx, { cuerpo }) => new TrasladarFondos().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/depositos',
        operacion: 'bancosDepositos',
        resumen: 'Depósitos de caja (en tránsito o acreditados)',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        query: v.listarTransitosValidator,
        respuesta: { status: 200, descripcion: 'Página de depósitos', esquema: pagina(Deposito) },
        handler: (ctx, { query }) => listarDepositos(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/traslados',
        operacion: 'bancosTraslados',
        resumen: 'Traslados entre cuentas propias (en tránsito o acreditados)',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        query: v.listarTransitosValidator,
        respuesta: { status: 200, descripcion: 'Página de traslados', esquema: pagina(Traslado) },
        handler: (ctx, { query }) => listarTraslados(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/fondos-en-transito',
        operacion: 'bancosFondosEnTransito',
        resumen: 'Check fondos_transito: 1.1.11 = depósitos y traslados sin acreditar, por empresa',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        query: v.empresasBancosValidator,
        respuesta: {
            status: 200,
            descripcion: 'Resumen por empresa',
            esquema: lista(ResumenFondosEnTransito),
        },
        handler: (ctx, { query }) => resumenFondosEnTransito(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
]

export default [...cobros, ...transitos]
