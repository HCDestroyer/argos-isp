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
import { resolverEmpresaActiva } from '#core/empresas'
import { usuarioDelActor } from '#shared/contexto'
import {
    AjustesConciliacion,
    DiferenciaConciliacion,
    LineaPorIdentificar,
    MotivoDiferencia,
    ResultadoAceptarSugerencias,
    SugerenciasExtracto,
    CastigoCartera,
    Conciliacion,
    Deposito,
    DiferenciaCerrada,
    ProvisionCartera,
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
import { autorizarLecturaDeCaja } from '#ledger/lectura_caja'
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
import ReatribuirLlegada from '#ledger/actions/reatribuir_llegada'
import RegistrarDesdeExtracto from '#ledger/actions/registrar_desde_extracto'
import CrearReglaConciliacion from '#ledger/actions/crear_regla_conciliacion'
import EditarReglaConciliacion from '#ledger/actions/editar_regla_conciliacion'
import AplicarReglasConciliacion from '#ledger/actions/aplicar_reglas_conciliacion'
import DepositarCaja from '#ledger/actions/depositar_caja'
import { listarCastigos, listarProvisiones } from '#ledger/cartera'
import ProvisionarCartera from '#ledger/actions/provisionar_cartera'
import CastigarCartera from '#ledger/actions/castigar_cartera'
import CerrarDiferenciaPago from '#billing/actions/cerrar_diferencia_pago'
import { dimensionesDePago } from '#billing/pagos'
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
import {
    empresaDeDiferencia,
    leerAjustesConciliacion,
    listarDiferencias,
    motivosEfectivos,
    verDiferencia,
} from '#ledger/diferencias_conciliacion'
import { sugerenciasDeExtracto } from '#ledger/sugerencias_conciliacion'
import ConfigurarDiferencias from '#ledger/actions/configurar_diferencias'
import CrearMotivoDiferencia from '#ledger/actions/crear_motivo_diferencia'
import EditarMotivoDiferencia from '#ledger/actions/editar_motivo_diferencia'
import PedirAprobacionDiferencia from '#ledger/actions/pedir_aprobacion_diferencia'
import AprobarDiferencia from '#ledger/actions/aprobar_diferencia'
import RechazarDiferencia from '#ledger/actions/rechazar_diferencia'
import AceptarSugerencias from '#ledger/actions/aceptar_sugerencias'
import MarcarPorIdentificar from '#ledger/actions/marcar_por_identificar'

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
        descripcion:
            'Permiso bancos.ver o cajas.ver. Con bancos.ver, todos los de las empresas (filtros caja_id y turno_id opcionales). Con solo cajas.ver (el cajero), caja_id o turno_id es obligatorio y la caja debe estar en su alcance (403); sin ellos 422. Sin ninguno de los dos permisos, 403.',
        etiqueta: 'bancos',
        permiso: null,
        query: v.listarDepositosValidator,
        respuesta: { status: 200, descripcion: 'Página de depósitos', esquema: pagina(Deposito) },
        handler: async (ctx, { query }) => {
            const lectura = await autorizarLecturaDeCaja(ctx, 'bancos.ver', query)
            return listarDepositos(
                { ...query, caja_id: lectura.caja_id },
                empresasDeLaLista(ctx.empresa, query.empresas),
            )
        },
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
            'Nunca reescribe un asiento: liga la línea con lo que ya está en el libro. Un depósito o traslado en tránsito llega con un asiento nuevo Banco / 1.1.11. Σ = monto de la línea (422 conciliacion_descuadrada), salvo que diferencias[] explique lo que falta o sobra con sus motivos: asiento nuevo de origen diferencia_conciliacion (de menos: cuenta del motivo / Banco; de más: Banco / cuenta). 422 motivo_no_aplica si un motivo no aplica o pasa de su límite; 422 diferencia_requiere_aprobacion si pasa del tope de quien concilia (por línea o por día) o el motivo siempre pide aprobación (se pide con POST /bancos/diferencias). 409 linea_conciliada, diferencia_pendiente o movimiento_conciliado. Emite banco.conciliado.',
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
        resumen:
            'Deshacer una conciliación (fila de anulación; revierte la llegada y la diferencia que creó)',
        descripcion:
            'Solo inserción. Lo que la conciliación creó se revierte: la llegada de un depósito o traslado (vuelve a fondos en tránsito, fila en transitos_reatribuciones) y el asiento de su diferencia (libera el tope del día). Lo que ya estaba en el libro queda disponible para conciliar. 409 conciliacion_anulada.',
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
        ruta: '/bancos/llegadas/reatribuir',
        operacion: 'bancosReatribuirLlegada',
        resumen: 'Corregir la llegada al banco atribuida al depósito o traslado equivocado',
        etiqueta: 'bancos',
        permiso: 'bancos.reatribuir_llegada',
        cuerpo: v.reatribuirLlegadaValidator,
        idempotente: true,
        descripcion:
            'Solo inserción: deshace la conciliación de la línea, revierte el asiento de llegada (el documento original vuelve a 1.1.11) y registra la llegada del documento correcto con la misma línea. 404 sin llegada vigente; 422 conciliacion_descuadrada si el monto no coincide.',
        respuesta: { status: 201, descripcion: 'Conciliación nueva', esquema: Conciliacion },
        handler: (ctx, { cuerpo }) => new ReatribuirLlegada().execute(cuerpo, ctx.contextoAccion()),
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

const diferencias: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/ajustes-conciliacion',
        operacion: 'bancosAjustesConciliacion',
        resumen: 'Tope de diferencias al conciliar de la empresa activa y quién aprueba',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        descripcion:
            'Sin guardar nunca: los de fábrica (Q 10.00 por línea y Q 50.00 por día) y version 0. aprobadores: usuarios activos con bancos.aprobar_diferencia y acceso a la empresa.',
        respuesta: { status: 200, descripcion: 'Ajustes', esquema: AjustesConciliacion },
        handler: async (ctx) => leerAjustesConciliacion(await resolverEmpresaActiva(ctx.contextoAccion())),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/bancos/ajustes-conciliacion',
        operacion: 'bancosConfigurarDiferencias',
        resumen: 'Cambiar el tope de diferencias al conciliar de la empresa activa',
        etiqueta: 'bancos',
        permiso: 'bancos.configurar_diferencias',
        cuerpo: v.configurarDiferenciasValidator,
        idempotente: true,
        versionada: true,
        descripcion:
            'Tope por línea y por día de quien concilia (Q 0.00 = toda diferencia que cuente contra el tope pide aprobación); el de línea no pasa del del día. Solo cambia lo que viene; 409 conflicto_version. Emite banco.diferencias_config_cambiada.',
        respuesta: { status: 200, descripcion: 'Ajustes', esquema: AjustesConciliacion },
        handler: (ctx, { cuerpo }) => new ConfigurarDiferencias().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/motivos-diferencia',
        operacion: 'bancosMotivosDiferencia',
        resumen: 'Motivos de diferencia que valen en la empresa activa (propios y de fábrica)',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        respuesta: { status: 200, descripcion: 'Motivos', esquema: lista(MotivoDiferencia) },
        handler: async (ctx) => motivosEfectivos(await resolverEmpresaActiva(ctx.contextoAccion())),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/motivos-diferencia',
        operacion: 'bancosCrearMotivoDiferencia',
        resumen: 'Crear un motivo de diferencia de la empresa activa',
        etiqueta: 'bancos',
        permiso: 'bancos.configurar_diferencias',
        cuerpo: v.crearMotivoDiferenciaValidator,
        idempotente: true,
        descripcion:
            'La cuenta debe ser imputable, sin auxiliar y nunca caja, banco ni puente (422 contrapartida); sin cuenta, siempre pide aprobación. Emite banco.diferencias_config_cambiada.',
        respuesta: { status: 201, descripcion: 'Motivo', esquema: MotivoDiferencia },
        handler: (ctx, { cuerpo }) => new CrearMotivoDiferencia().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/bancos/motivos-diferencia/:id',
        operacion: 'bancosEditarMotivoDiferencia',
        resumen: 'Editar un motivo de diferencia (con version)',
        etiqueta: 'bancos',
        permiso: 'bancos.configurar_diferencias',
        cuerpo: v.editarMotivoDiferenciaValidator,
        idempotente: true,
        versionada: true,
        descripcion:
            'Un motivo de fábrica no cambia: la empresa activa recibe su copia (mismo codigo, id nuevo) que lo reemplaza solo en ella. Los motivos no se borran: se apagan (activo false); uno fijo no se apaga. 409 conflicto_version. Emite banco.diferencias_config_cambiada.',
        respuesta: {
            status: 200,
            descripcion: 'Motivo (la copia de la empresa si era de fábrica)',
            esquema: MotivoDiferencia,
        },
        handler: (ctx, { cuerpo, params }) =>
            new EditarMotivoDiferencia().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/diferencias',
        operacion: 'bancosPedirAprobacionDiferencia',
        resumen: 'Pedir aprobación de una diferencia al conciliar que pasa del tope',
        etiqueta: 'bancos',
        permiso: 'bancos.conciliar',
        cuerpo: v.pedirAprobacionDiferenciaValidator,
        idempotente: true,
        descripcion:
            'Mismo cuerpo que POST /bancos/conciliaciones más la explicación. No toca el libro: la diferencia queda esperando a otro usuario con bancos.aprobar_diferencia y la línea queda apartada (409 diferencia_pendiente al conciliarla) sin bloquear el resto. 422 aprobacion_innecesaria si está dentro del tope. Emite banco.diferencia_pendiente.',
        respuesta: { status: 201, descripcion: 'Diferencia pendiente', esquema: DiferenciaConciliacion },
        handler: async (ctx, { cuerpo }) => {
            exigirAcceso(ctx, await empresaDe('extractos_lineas', cuerpo.linea_id))
            return new PedirAprobacionDiferencia().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/diferencias',
        operacion: 'bancosDiferencias',
        resumen: 'Diferencias al conciliar (aplicadas, pendientes, aprobadas, rechazadas o anuladas)',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        query: v.listarDiferenciasValidator,
        respuesta: {
            status: 200,
            descripcion: 'Página de diferencias',
            esquema: pagina(DiferenciaConciliacion),
        },
        handler: (ctx, { query }) => listarDiferencias(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/diferencias-pendientes',
        operacion: 'bancosDiferenciasPendientes',
        resumen: 'Diferencias al conciliar que esperan aprobación',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        query: v.diferenciasPendientesValidator,
        respuesta: {
            status: 200,
            descripcion: 'Página de diferencias',
            esquema: pagina(DiferenciaConciliacion),
        },
        handler: (ctx, { query }) =>
            listarDiferencias(
                { ...query, estado: 'pendiente' },
                empresasDeLaLista(ctx.empresa, query.empresas),
            ),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/diferencias/:id',
        operacion: 'bancosVerDiferencia',
        resumen: 'Ver una diferencia al conciliar',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        respuesta: { status: 200, descripcion: 'Diferencia', esquema: DiferenciaConciliacion },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeDiferencia(id))
            return verDiferencia(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/diferencias/:id/aprobar',
        operacion: 'bancosAprobarDiferencia',
        resumen: 'Aprobar una diferencia al conciliar (concilia la línea con su asiento)',
        etiqueta: 'bancos',
        permiso: 'bancos.aprobar_diferencia',
        idempotente: true,
        descripcion:
            'Quien la pidió no puede aprobarla (403 autoaprobacion). Concilia la línea con lo emparejado y la diferencia tal como se pidió (asiento diferencia_conciliacion). 409 diferencia_decidida; si la línea o lo emparejado ya se conciliaron por otro camino, responde ese error y sigue pendiente. Emite banco.diferencia_aprobada y banco.conciliado.',
        respuesta: { status: 200, descripcion: 'Diferencia aprobada', esquema: DiferenciaConciliacion },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeDiferencia(id))
            return new AprobarDiferencia().execute({ diferencia_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/diferencias/:id/rechazar',
        operacion: 'bancosRechazarDiferencia',
        resumen: 'Rechazar una diferencia al conciliar (no entra al libro)',
        etiqueta: 'bancos',
        permiso: 'bancos.aprobar_diferencia',
        cuerpo: v.rechazarDiferenciaValidator,
        idempotente: true,
        descripcion:
            'Motivo obligatorio. La línea queda libre. 409 diferencia_decidida. Emite banco.diferencia_rechazada.',
        respuesta: { status: 200, descripcion: 'Diferencia rechazada', esquema: DiferenciaConciliacion },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeDiferencia(id))
            return new RechazarDiferencia().execute(
                { diferencia_id: id, motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/extractos/:id/sugerencias',
        operacion: 'bancosSugerenciasExtracto',
        resumen:
            'Parejas sugeridas por línea sin conciliar: seguras, para decidir, con diferencia, regla o sin pareja',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        descripcion:
            'Solo lectura. segura = un solo candidato con el mismo monto y la misma referencia; para_decidir = mismo monto sin confirmar; con_diferencia = monto cercano, con los motivos que aplican (y por qué no los demás); regla = la reconoce una regla de contrapartida; por_identificar = marcada con nota; esperando_aprobacion = tiene una diferencia pendiente. tope: lo que le queda hoy a quien pregunta.',
        respuesta: { status: 200, descripcion: 'Sugerencias', esquema: SugerenciasExtracto },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDe('extractos', id))
            return sugerenciasDeExtracto(id, usuarioDelActor(ctx.contextoAccion().actor))
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/extractos/:id/aceptar-seguras',
        operacion: 'bancosAceptarSugerencias',
        resumen: 'Conciliar juntas las parejas seguras del extracto',
        etiqueta: 'bancos',
        permiso: 'bancos.conciliar',
        cuerpo: v.aceptarSugerenciasValidator,
        idempotente: true,
        descripcion:
            'Recalcula las sugerencias y concilia cada línea segura (con lineas[], solo esas; las demás vuelven en omitidas con su nivel). Repetirla no duplica. Emite banco.conciliado por línea.',
        respuesta: { status: 200, descripcion: 'Resultado', esquema: ResultadoAceptarSugerencias },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDe('extractos', id))
            return new AceptarSugerencias().execute(
                { extracto_id: id, lineas: cuerpo.lineas },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/extractos/lineas/:id/por-identificar',
        operacion: 'bancosMarcarPorIdentificar',
        resumen: '«No sé todavía»: dejar la línea por identificar con una nota',
        etiqueta: 'bancos',
        permiso: 'bancos.conciliar',
        cuerpo: v.marcarPorIdentificarValidator,
        idempotente: true,
        descripcion:
            'No toca el libro y no cuenta como anomalía en la revisión extractos_conciliados del cierre (va en su detalle). Marcarla otra vez cambia la nota. 409 linea_conciliada.',
        respuesta: { status: 201, descripcion: 'Marca', esquema: LineaPorIdentificar },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDe('extractos_lineas', id))
            return new MarcarPorIdentificar().execute(
                { linea_id: id, nota: cuerpo.nota },
                ctx.contextoAccion(),
            )
        },
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

const cartera: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/pagos/:id/cerrar-diferencia',
        operacion: 'pagosCerrarDiferencia',
        resumen: 'Cerrar el saldo pequeño que dejó un pago (hasta diferencia_cobro_tope)',
        etiqueta: 'pagos',
        permiso: 'pagos.cerrar_diferencia',
        cuerpo: v.cerrarDiferenciaValidator,
        idempotente: true,
        descripcion:
            'El saldo de cada factura del pago se cierra como gasto: asiento diferencia_cobro 5.3.05 Diferencias de cobro / CxC, sin tocar IVA ni DTE (el DTE va por el total). pagado no cambia (solo dinero cobrado); la factura queda pagada porque pagado + diferencias vigentes = total. Emite pago.diferencia_cerrada y re-evalúa los servicios. Anular el pago revierte la diferencia. 422 diferencia_sobre_tope; 409 sin_diferencia, pago_anulado o anulacion_en_proceso.',
        respuesta: { status: 201, descripcion: 'Diferencia cerrada', esquema: DiferenciaCerrada },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await dimensionesDePago(id))
            return new CerrarDiferenciaPago().execute(
                { pago_id: id, motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/cartera/provisionar',
        operacion: 'carteraProvisionar',
        resumen: 'Estimación para cuentas incobrables hasta el tope legal (5.3.02 / 1.1.12)',
        etiqueta: 'cartera',
        permiso: 'cartera.provisionar',
        cuerpo: v.provisionarCarteraValidator,
        idempotente: true,
        descripcion:
            'Tope = Σ saldos deudores al corte × reserva_incobrables_max (3 %); se registra solo lo que falta para llegar al tope (monto 0 sin asiento si ya está).',
        respuesta: { status: 201, descripcion: 'Estimación', esquema: ProvisionCartera },
        handler: (ctx, { cuerpo }) => new ProvisionarCartera().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/cartera/provisiones',
        operacion: 'carteraProvisiones',
        resumen: 'Estimaciones para cuentas incobrables registradas',
        etiqueta: 'cartera',
        permiso: 'reportes.ver',
        query: v.listarCarteraValidator,
        respuesta: { status: 200, descripcion: 'Página', esquema: pagina(ProvisionCartera) },
        handler: (ctx, { query }) => listarProvisiones(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/cartera/castigos',
        operacion: 'carteraCastigar',
        resumen: 'Castigar facturas incobrables de un cliente (2.1.11 + 1.1.12 o 5.3.02 / CxC)',
        etiqueta: 'cartera',
        permiso: 'cartera.castigar',
        cuerpo: v.castigarCarteraValidator,
        idempotente: true,
        descripcion:
            'Motivo y evidencia de la gestión de cobro obligatorios (422 castigo_sin_evidencia). El IVA de los avisos sin DTE sale de 2.1.11; el resto contra la estimación disponible y luego 5.3.02. La factura queda cubierta y no se certifica. Emite cartera.castigada.',
        respuesta: { status: 201, descripcion: 'Castigo', esquema: CastigoCartera },
        handler: async (ctx, { cuerpo }) => {
            for (const id of cuerpo.facturas) exigirAcceso(ctx, { empresa_id: await empresaDeFactura(id) })
            return new CastigarCartera().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/cartera/castigos',
        operacion: 'carteraCastigos',
        resumen: 'Castigos de cartera',
        etiqueta: 'cartera',
        permiso: 'reportes.ver',
        query: v.listarCarteraValidator,
        respuesta: { status: 200, descripcion: 'Página', esquema: pagina(CastigoCartera) },
        handler: (ctx, { query }) => listarCastigos(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
]

async function empresaDeFactura(id: number): Promise<number> {
    const fila = await db.from('billing.facturas').where('id', id).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`La factura ${id} no existe`)
    return Number(fila.empresa_id)
}

export default [...cobros, ...transitos, ...conciliacion, ...diferencias, ...cartera]
