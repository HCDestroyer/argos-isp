/*
|--------------------------------------------------------------------------
| Rutas de cobros y bancos (A3, localización fiscal §10.3 y §10.9, fase 4)
|--------------------------------------------------------------------------
|
| Las monta `start/routes/ledger.ts`.
|
*/
import db from '@adonisjs/lucid/services/db'
import { definirRuta, type Ruta } from '#shared/rutas'
import { NoEncontrado } from '#shared/errores'
import { lista, pagina } from '#shared/openapi/esquemas'
import { EmpresaRequerida, empresasDeLaLista } from '#shared/empresa_activa'
import { exigirAcceso, exigirEmpresaPeticion } from '#billing/empresa'
import * as v from '#ledger/validators_bancos'
import {
    Conciliacion,
    Deposito,
    Extracto,
    LineaExtracto,
    LiquidacionCobro,
    MovimientoSinConciliar,
    ReglaConciliacion,
    ResultadoAplicarReglas,
    ResumenConciliacionBancaria,
    ProveedorCobro,
    ResumenCobrosPorLiquidar,
    ResumenFondosEnTransito,
    Traslado,
} from '#ledger/esquemas_bancos'
import { existeCaja } from '#ledger/cajas'
import { listarDepositos, listarTraslados, resumenFondosEnTransito } from '#ledger/transitos'
import {
    empresaDe,
    lineasDeExtracto,
    listarExtractos,
    listarReglas,
    movimientosSinConciliar,
    reporteConciliacion,
    verExtracto,
} from '#ledger/conciliacion'
import ImportarExtracto from '#ledger/actions/importar_extracto'
import ConciliarLinea from '#ledger/actions/conciliar_linea'
import AnularConciliacion from '#ledger/actions/anular_conciliacion'
import RegistrarDesdeExtracto from '#ledger/actions/registrar_desde_extracto'
import CrearReglaConciliacion from '#ledger/actions/crear_regla_conciliacion'
import EditarReglaConciliacion from '#ledger/actions/editar_regla_conciliacion'
import AplicarReglasConciliacion from '#ledger/actions/aplicar_reglas_conciliacion'
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

const conciliacion: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/extractos',
        operacion: 'bancosImportarExtracto',
        resumen: 'Importar un extracto bancario (neutral al origen; solo inserción)',
        etiqueta: 'bancos',
        permiso: 'bancos.importar_extracto',
        cuerpo: v.importarExtractoValidator,
        idempotente: true,
        descripcion:
            'Líneas con signo dentro de desde..hasta; Σ líneas = saldo_final − saldo_inicial (422 extracto_descuadrado). El saldo inicial encadena con el final anterior (422 extracto_no_encadena; se fuerza con motivo_no_encadena). Una línea ya importada (huella por cuenta) responde 409 extracto_duplicado. Los adaptadores por banco (CSV, XLSX) son de A6. Emite banco.extracto_importado.',
        respuesta: { status: 201, descripcion: 'Extracto importado', esquema: Extracto },
        handler: (ctx, { cuerpo }) => new ImportarExtracto().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/extractos',
        operacion: 'bancosExtractos',
        resumen: 'Extractos importados',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        query: v.listarExtractosValidator,
        respuesta: { status: 200, descripcion: 'Página de extractos', esquema: pagina(Extracto) },
        handler: (ctx, { query }) => listarExtractos(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/extractos/:id',
        operacion: 'bancosVerExtracto',
        resumen: 'Ver extracto',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        respuesta: { status: 200, descripcion: 'Extracto', esquema: Extracto },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDe('extractos', id))
            return verExtracto(id)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/extractos/:id/lineas',
        operacion: 'bancosLineasExtracto',
        resumen: 'Líneas del extracto con su conciliación',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        respuesta: { status: 200, descripcion: 'Líneas', esquema: lista(LineaExtracto) },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDe('extractos', id))
            return lineasDeExtracto(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/extractos/:id/aplicar-reglas',
        operacion: 'bancosAplicarReglas',
        resumen: 'Aplicar las reglas de conciliación a las líneas sin conciliar del extracto',
        etiqueta: 'bancos',
        permiso: 'bancos.conciliar',
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Resultado', esquema: ResultadoAplicarReglas },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDe('extractos', id))
            return new AplicarReglasConciliacion().execute({ extracto_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/movimientos-sin-conciliar',
        operacion: 'bancosMovimientosSinConciliar',
        resumen: 'Movimientos del libro en una cuenta bancaria sin conciliación vigente',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        query: v.movimientosSinConciliarValidator,
        descripcion: 'De la empresa activa o, sin ella, de la empresa dueña de la cuenta.',
        respuesta: { status: 200, descripcion: 'Movimientos', esquema: lista(MovimientoSinConciliar) },
        handler: async (ctx, { query }) => {
            const empresaId = ctx.empresa?.activa ?? (await empresaDeCuenta(query.cuenta_id))
            exigirEmpresaPeticion(ctx.empresa, empresaId)
            return movimientosSinConciliar(empresaId, query.cuenta_id, query.hasta)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/conciliaciones',
        operacion: 'bancosConciliar',
        resumen: 'Conciliar una línea del extracto con movimientos, depósitos o traslados del libro',
        etiqueta: 'bancos',
        permiso: 'bancos.conciliar',
        cuerpo: v.conciliarValidator,
        idempotente: true,
        descripcion:
            'Nunca reescribe un asiento: liga la línea con lo que ya está en el libro. Un depósito o traslado en tránsito llega con un asiento nuevo Banco / 1.1.11. Σ = monto de la línea (422 conciliacion_descuadrada); 409 linea_conciliada o movimiento_conciliado. Emite banco.conciliado.',
        respuesta: { status: 201, descripcion: 'Conciliación', esquema: Conciliacion },
        handler: async (ctx, { cuerpo }) => {
            exigirAcceso(ctx, await empresaDe('extractos_lineas', cuerpo.linea_id))
            return new ConciliarLinea().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/conciliaciones/:id/anular',
        operacion: 'bancosAnularConciliacion',
        resumen: 'Deshacer una conciliación (fila de anulación; el libro no cambia)',
        etiqueta: 'bancos',
        permiso: 'bancos.conciliar',
        cuerpo: v.anularConciliacionValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Conciliación anulada', esquema: Conciliacion },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDe('conciliaciones', id))
            return new AnularConciliacion().execute(
                { conciliacion_id: id, motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/extractos/lineas/:id/registrar',
        operacion: 'bancosRegistrarDesdeExtracto',
        resumen: 'Registrar una partida del extracto sin documento (asiento nuevo) y conciliarla',
        etiqueta: 'bancos',
        permiso: 'bancos.conciliar',
        cuerpo: v.registrarDesdeExtractoValidator,
        idempotente: true,
        descripcion:
            'Cargo: contrapartida (por defecto 5.3.07 Gastos y comisiones bancarias) / Banco; abono: Banco / contrapartida (obligatoria). Origen banco, fecha de la línea. 409 linea_registrada.',
        respuesta: { status: 201, descripcion: 'Conciliación con el asiento nuevo', esquema: Conciliacion },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDe('extractos_lineas', id))
            return new RegistrarDesdeExtracto().execute({ ...cuerpo, linea_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/reglas',
        operacion: 'bancosReglas',
        resumen: 'Reglas de conciliación',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        query: v.empresasBancosValidator,
        respuesta: { status: 200, descripcion: 'Reglas', esquema: lista(ReglaConciliacion) },
        handler: (ctx, { query }) => listarReglas(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/reglas',
        operacion: 'bancosCrearRegla',
        resumen: 'Crear regla de conciliación',
        etiqueta: 'bancos',
        permiso: 'bancos.conciliar',
        cuerpo: v.crearReglaConciliacionValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Regla', esquema: ReglaConciliacion },
        handler: (ctx, { cuerpo }) => new CrearReglaConciliacion().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/bancos/reglas/:id',
        operacion: 'bancosEditarRegla',
        resumen: 'Editar regla de conciliación (con version)',
        etiqueta: 'bancos',
        permiso: 'bancos.conciliar',
        cuerpo: v.editarReglaConciliacionValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Regla', esquema: ReglaConciliacion },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDe('reglas_conciliacion', id))
            return new EditarReglaConciliacion().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/conciliacion-bancaria',
        operacion: 'reportesConciliacionBancaria',
        resumen: 'Resumen de conciliación por cuenta y fecha: libro, extracto y partidas en tránsito',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.reporteConciliacionValidator,
        descripcion:
            'Por cuenta con extractos: saldo del libro, saldo del extracto, partidas en tránsito de cada lado y diferencia (0 = saldo del extracto = libro ± partidas en tránsito).',
        respuesta: {
            status: 200,
            descripcion: 'Resumen por cuenta',
            esquema: lista(ResumenConciliacionBancaria),
        },
        handler: (ctx, { query }) =>
            reporteConciliacion(empresasDeLaLista(ctx.empresa, query.empresas), query),
    }),
]

/** Empresa dueña de una subcuenta bancaria (la de la cuenta propia si la subcuenta es común). */
async function empresaDeCuenta(cuentaId: number): Promise<number> {
    const fila = await db
        .from('ledger.cuentas as c')
        .leftJoin('billing.cuentas_bancarias as cb', 'cb.cuenta_id', 'c.id')
        .where('c.id', cuentaId)
        .select('c.empresa_id', 'cb.empresa_id as empresa_cuenta')
        .first()
    if (!fila) throw new NoEncontrado(`La cuenta ${cuentaId} no existe`)
    const empresaId = fila.empresa_id ?? fila.empresa_cuenta
    if (empresaId === null || empresaId === undefined) throw new EmpresaRequerida()
    return Number(empresaId)
}

export default [...cobros, ...transitos, ...conciliacion]
