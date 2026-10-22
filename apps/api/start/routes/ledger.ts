/*
|--------------------------------------------------------------------------
| Rutas del libro contable y cajas (A3)
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, objeto, pagina } from '#shared/openapi/esquemas'
import * as v from '#ledger/validators'
import {
    Asiento,
    BancoLibro,
    Caja,
    Diario,
    CajaTurno,
    CategoriaEgreso,
    CierrePeriodo,
    Cuenta,
    Egreso,
    Mayor,
    BalanceSaldos,
    EstadoResultados,
    IntegridadLibro,
} from '#ledger/esquemas'
import { integridadLibro } from '#ledger/sellos'
import { listarCierres } from '#ledger/cierres'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import ReabrirPeriodo from '#ledger/actions/reabrir_periodo'
import { dimensionesDeEgreso, listarCategoriasEgreso, listarEgresos, verEgreso } from '#ledger/egresos'
import { cajaPrincipalId } from '#billing/pagos'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import AnularEgreso from '#ledger/actions/anular_egreso'
import { libroDiario, libroMayor, listarCuentas, verAsiento } from '#ledger/consultas'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { listarBancosLibro } from '#ledger/bancos'
import { listarDiarios, verDiario } from '#ledger/diarios'
import { cajaDelCajero, existeCaja, listarCajas, listarTurnos } from '#ledger/cajas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirAcceso, exigirEmpresaPeticion } from '#billing/empresa'
import { balanceSaldos, estadoResultados } from '#ledger/estados_financieros'
import CrearCaja from '#ledger/actions/crear_caja'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import { autorizarLecturaDeCaja } from '#ledger/lectura_caja'
import bancos from '#start/routes/bancos'
import compras from '#start/routes/compras'
import activos from '#start/routes/activos'
import cierres from '#start/routes/cierres'

const cajas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/cajas',
        operacion: 'cajasListar',
        resumen: 'Listar cajas con su turno abierto',
        etiqueta: 'cajas',
        permiso: 'cajas.ver',
        query: v.listarCajasValidator,
        descripcion:
            'Cajas de la empresa activa (o de todas las del alcance; `empresas=todas` = consolidado con alcance global). Cada caja es de una empresa (`empresa_id`).',
        respuesta: { status: 200, descripcion: 'Cajas', esquema: lista(Caja) },
        handler: (ctx, { query }) => listarCajas(ctx.alcance, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/cajas',
        operacion: 'cajasCrear',
        resumen: 'Crear caja de una empresa (crea su subcuenta de Cajas en el libro)',
        etiqueta: 'cajas',
        permiso: 'cajas.crear',
        cuerpo: v.crearCajaValidator,
        idempotente: true,
        descripcion:
            'La caja es de `empresa_id` o de la empresa activa (422 empresa_requerida, 403 empresa_no_permitida). Crea la subcuenta 1.1.01.NN marcada con esa empresa. 409 caja_duplicada si la empresa ya tiene una caja con ese nombre.',
        respuesta: { status: 201, descripcion: 'Caja creada', esquema: Caja },
        handler: (ctx, { cuerpo }) => new CrearCaja().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/cajas/:id/abrir',
        operacion: 'cajasAbrir',
        resumen: 'Abrir turno de caja',
        etiqueta: 'cajas',
        permiso: 'cajas.abrir',
        cuerpo: v.abrirCajaValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Turno abierto', esquema: CajaTurno },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await existeCaja(id))
            return new AbrirCaja().execute(
                { caja_id: id, fondo_inicial: cuerpo.fondo_inicial },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/cajas/:id/cerrar',
        operacion: 'cajasCerrar',
        resumen: 'Cerrar turno de caja (esperado vs contado)',
        etiqueta: 'cajas',
        permiso: 'cajas.cerrar',
        cuerpo: v.cerrarCajaValidator,
        idempotente: true,
        descripcion:
            'esperado = fondo_inicial + pagos vigentes del turno; diferencia = contado − esperado. Con diferencia ≠ 0 el motivo es obligatorio (422) y queda un asiento cierre_caja (faltante o sobrante). Emite caja.cerrada. 409 si no hay turno abierto.',
        respuesta: { status: 200, descripcion: 'Turno cerrado', esquema: CajaTurno },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await existeCaja(id))
            return new CerrarCaja().execute(
                { caja_id: id, contado: cuerpo.contado, motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/cajas/:id/turnos',
        operacion: 'cajasTurnos',
        resumen: 'Turnos de una caja',
        etiqueta: 'cajas',
        permiso: 'cajas.ver',
        query: v.listarTurnosValidator,
        respuesta: { status: 200, descripcion: 'Página de turnos', esquema: pagina(CajaTurno) },
        handler: async (ctx, { query, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await existeCaja(id))
            return listarTurnos(id, query)
        },
    }),
]

const libro: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/libro/cuentas',
        operacion: 'libroCuentas',
        resumen: 'Plan de cuentas',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.libroEmpresasValidator,
        descripcion:
            'Catálogo común a todas las empresas; las subcuentas de una caja o cuenta bancaria (`empresa_id`) solo aparecen para su empresa.',
        respuesta: { status: 200, descripcion: 'Cuentas', esquema: lista(Cuenta) },
        handler: (ctx, { query }) => listarCuentas(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/bancos',
        operacion: 'libroBancos',
        resumen: 'Bancos del libro (origen de los egresos con metodo banco)',
        etiqueta: 'libro',
        permiso: 'egresos.ver',
        descripcion:
            'Cuentas bancarias contables de `ledger.bancos`: su `id` es el `banco_id` de POST /egresos con metodo banco (sin banco_id sale del banco principal, 1.1.02.01). No es el catálogo de bancos de Guatemala (GET /bancos) ni las cuentas que reciben depósitos (GET /cuentas-bancarias). El número va enmascarado.',
        query: v.libroEmpresasValidator,
        respuesta: { status: 200, descripcion: 'Bancos del libro', esquema: lista(BancoLibro) },
        handler: (ctx, { query }) => listarBancosLibro(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/diarios',
        operacion: 'libroDiarios',
        resumen: 'Diarios del libro y su numeración por año',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.libroEmpresasValidator,
        descripcion:
            'Diarios de la empresa activa (o empresas=todas): VEN, COB, COM, IMP, CIE, VAR, uno CAJ-n por caja y uno BAN-n por cuenta bancaria, con el último número asignado de cada año (§10.7). Solo lectura: los diarios se crean solos cuando un asiento los necesita.',
        respuesta: { status: 200, descripcion: 'Diarios', esquema: lista(Diario) },
        handler: (ctx, { query }) => listarDiarios(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/diarios/:id',
        operacion: 'libroDiarioVer',
        resumen: 'Ver un diario y su numeración',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        respuesta: { status: 200, descripcion: 'Diario', esquema: Diario },
        handler: async (ctx, { params }) => {
            const diario = await verDiario(Number(params.id))
            exigirEmpresaPeticion(ctx.empresa, diario.empresa_id)
            return diario
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/diario',
        operacion: 'libroDiario',
        resumen: 'Libro diario: asientos con sus movimientos',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.diarioValidator,
        respuesta: { status: 200, descripcion: 'Página de asientos', esquema: pagina(Asiento) },
        handler: (ctx, { query }) => libroDiario(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/asientos/:id',
        operacion: 'libroVerAsiento',
        resumen: 'Ver un asiento con sus movimientos',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        respuesta: { status: 200, descripcion: 'Asiento', esquema: Asiento },
        handler: async (ctx, { params }) => {
            const asiento = await verAsiento(Number(params.id))
            exigirEmpresaPeticion(ctx.empresa, asiento.empresa_id)
            return asiento
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/asientos/:id/revertir',
        operacion: 'libroRevertirAsiento',
        resumen: 'Revertir un asiento (asiento espejo con motivo)',
        etiqueta: 'libro',
        permiso: 'libro.revertir_asiento',
        cuerpo: v.revertirAsientoValidator,
        idempotente: true,
        descripcion:
            'Crea el asiento espejo (debe ↔ haber, mismas cuentas y clientes) con reversa_de = :id; nunca edita el original. Fecha: hoy (o la indicada), nunca anterior al original ni en un mes cerrado (un asiento de un mes cerrado se revierte con fecha de hoy). Solo asientos sin documento (cierre_caja, ajuste manual): los de factura, mora, pago, nota_credito, egreso o saldo inicial responden 422 reverso_por_documento (usar anular pago, anular factura…). 422 asiento_revertido si ya se revirtió y asiento_es_reverso si es un reverso; 422 periodo_cerrado.',
        respuesta: { status: 201, descripcion: 'Asiento de reverso', esquema: Asiento },
        handler: async (ctx, { cuerpo, params }) => {
            const reverso = await new RevertirAsiento().execute(
                { asiento_id: Number(params.id), motivo: cuerpo.motivo, fecha: cuerpo.fecha },
                ctx.contextoAccion(),
            )
            return verAsiento(reverso.id)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/mayor',
        operacion: 'libroMayor',
        resumen: 'Libro mayor de una cuenta (o auxiliar de un cliente)',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.mayorValidator,
        respuesta: { status: 200, descripcion: 'Mayor de la cuenta', esquema: Mayor },
        handler: (ctx, { query }) => libroMayor(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/balance',
        operacion: 'libroBalance',
        resumen: 'Balance de saldos por empresa (y total del grupo en el consolidado)',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.balanceValidator,
        descripcion:
            'Saldo de cada cuenta con movimiento al `hasta`, una sección por empresa (cada NIT tiene su libro) y `total` del grupo. cuadra = debe igual a haber y activo = pasivo + resultado.',
        respuesta: { status: 200, descripcion: 'Balance', esquema: BalanceSaldos },
        handler: (ctx, { query }) => balanceSaldos(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/estado-resultados',
        operacion: 'libroEstadoResultados',
        resumen: 'Estado de resultados por empresa (ingresos − gastos del rango)',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.estadoResultadosValidator,
        respuesta: { status: 200, descripcion: 'Estado de resultados', esquema: EstadoResultados },
        handler: (ctx, { query }) => estadoResultados(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/integridad',
        operacion: 'libroIntegridad',
        resumen: 'Verificar la cadena de hash del libro (una sección por empresa)',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.integridadValidator,
        descripcion:
            'Recalcula la cadena de hash de los asientos de cada empresa desde el sello 1 (contrato de localización fiscal §10.10): el encadenamiento siempre completo y el hash de los asientos con fecha en `desde`–`hasta` y número de sello en `desde_sello`–`hasta_sello` (sin rango, todos). Un sello posterior al cierre de un mes con un asiento de ese mes es una ruptura `asiento_en_mes_cerrado`. Devuelve `verificado` o la primera `ruptura`, con el primer y el último hash del rango. Es una lectura: el aviso `libro.integridad_rota` lo emiten el sellador y la verificación diaria.',
        respuesta: {
            status: 200,
            descripcion: 'Integridad por empresa',
            esquema: objeto({ data: lista(IntegridadLibro) }),
        },
        handler: (ctx, { query }) =>
            integridadLibro(
                {
                    desde: query.desde,
                    hasta: query.hasta,
                    desde_sello: query.desde_sello,
                    hasta_sello: query.hasta_sello,
                },
                empresasDeLaLista(ctx.empresa, query.empresas),
            ),
    }),
]

const egresos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/egresos/categorias',
        operacion: 'egresosCategorias',
        resumen: 'Categorías de egreso con su cuenta de gasto',
        etiqueta: 'egresos',
        permiso: 'egresos.ver',
        respuesta: { status: 200, descripcion: 'Categorías', esquema: lista(CategoriaEgreso) },
        handler: () => listarCategoriasEgreso(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/egresos',
        operacion: 'egresosListar',
        resumen: 'Listar egresos',
        etiqueta: 'egresos',
        permiso: null,
        query: v.listarEgresosValidator,
        descripcion:
            'Permiso egresos.ver o cajas.ver. Con egresos.ver, los de sus empresas y su alcance (filtros caja_id y turno_id opcionales). Con solo cajas.ver (el cajero, para el esperado provisional de /caja), caja_id o turno_id es obligatorio y la caja debe estar en su alcance (403); sin ellos 422. Sin ninguno de los dos permisos, 403.',
        respuesta: { status: 200, descripcion: 'Página de egresos', esquema: pagina(Egreso) },
        handler: async (ctx, { query }) => {
            const lectura = await autorizarLecturaDeCaja(ctx, 'egresos.ver', query)
            return listarEgresos(
                { ...query, caja_id: lectura.caja_id },
                ctx.alcance,
                empresasDeLaLista(ctx.empresa, query.empresas),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/egresos/:id',
        operacion: 'egresosVer',
        resumen: 'Ver egreso',
        etiqueta: 'egresos',
        permiso: 'egresos.ver',
        respuesta: { status: 200, descripcion: 'Egreso', esquema: Egreso },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await dimensionesDeEgreso(id))
            return verEgreso(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/egresos',
        operacion: 'egresosRegistrar',
        resumen: 'Registrar egreso (asiento Gasto / Caja o Banco)',
        etiqueta: 'egresos',
        permiso: 'egresos.registrar',
        cuerpo: v.registrarEgresoValidator,
        idempotente: true,
        descripcion:
            'La categoría decide la cuenta de gasto. Con metodo caja el efectivo sale del turno abierto de la caja (baja el esperado del cierre); sin caja_id, la caja del turno abierto del usuario o la principal. 422 con un error por campo (no_aplica si se manda el origen de otro método).',
        respuesta: { status: 201, descripcion: 'Egreso registrado', esquema: Egreso },
        handler: async (ctx, { cuerpo }) => {
            // efectivo sin caja: la del turno abierto del usuario en la empresa activa o su principal
            const activa = ctx.empresa?.activa ?? null
            const cajaId =
                cuerpo.metodo === 'caja'
                    ? (cuerpo.caja_id ??
                      (await cajaDelCajero(ctx.auth.user?.id ?? null, ctx.alcance, undefined, activa)) ??
                      (await cajaPrincipalId(undefined, activa ?? undefined)))
                    : cuerpo.caja_id
            if (cuerpo.metodo === 'caja' && cajaId) {
                const caja = await existeCaja(cajaId).catch(() => null)
                exigirAcceso(ctx, caja ?? { caja: [cajaId] })
            }
            return new RegistrarEgreso().execute({ ...cuerpo, caja_id: cajaId }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/egresos/:id/anular',
        operacion: 'egresosAnular',
        resumen: 'Anular egreso (asiento de reverso)',
        etiqueta: 'egresos',
        permiso: 'egresos.anular',
        cuerpo: v.anularEgresoValidator,
        idempotente: true,
        descripcion: 'El reverso va con fecha de hoy (periodo abierto). 409 egreso_anulado si ya lo estaba.',
        respuesta: { status: 200, descripcion: 'Egreso anulado', esquema: Egreso },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await dimensionesDeEgreso(id))
            return new AnularEgreso().execute({ egreso_id: id, motivo: cuerpo.motivo }, ctx.contextoAccion())
        },
    }),
]

const periodos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/libro/periodos',
        operacion: 'libroPeriodos',
        resumen: 'Cierres mensuales y reaperturas (el más reciente primero)',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.listarCierresValidator,
        respuesta: { status: 200, descripcion: 'Página de cierres', esquema: pagina(CierrePeriodo) },
        handler: (ctx, { query }) => listarCierres(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/periodos/cerrar',
        operacion: 'libroCerrarPeriodo',
        resumen: 'Cerrar un mes del libro',
        etiqueta: 'libro',
        permiso: 'libro.cerrar_periodo',
        cuerpo: v.cerrarPeriodoValidator,
        idempotente: true,
        descripcion:
            'Después del cierre ningún asiento puede tener fecha en el mes, ni siquiera un reverso (van con fecha de hoy, en el periodo abierto). Solo meses terminados (422 periodo_en_curso); 409 periodo_cerrado si ya lo está. Antes verifica la lista de verificación del mes (§10.5): un check en anomalía sin supervisar responde 422 checks_pendientes con un error por clave.',
        respuesta: { status: 201, descripcion: 'Mes cerrado', esquema: CierrePeriodo },
        handler: (ctx, { cuerpo }) => new CerrarPeriodo().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/periodos/reabrir',
        operacion: 'libroReabrirPeriodo',
        resumen: 'Reabrir un mes cerrado (con motivo)',
        etiqueta: 'libro',
        permiso: 'libro.reabrir_periodo',
        cuerpo: v.reabrirPeriodoValidator,
        idempotente: true,
        descripcion:
            'No borra el cierre: registra la reapertura con motivo (auditada). Se puede volver a cerrar. 409 periodo_abierto si el mes no está cerrado.',
        respuesta: { status: 200, descripcion: 'Mes reabierto', esquema: CierrePeriodo },
        handler: (ctx, { cuerpo }) => new ReabrirPeriodo().execute(cuerpo, ctx.contextoAccion()),
    }),
]

export default [...cajas, ...libro, ...egresos, ...periodos, ...cierres, ...bancos, ...compras, ...activos]
