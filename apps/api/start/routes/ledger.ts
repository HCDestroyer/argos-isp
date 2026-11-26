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
    ResumenTurnoCaja,
    AjustesCajas,
    CustodiaEfectivo,
    EntregaCaja,
    EstadoCajaChica,
    GastoCajaChica,
    ReposicionCaja,
    ConteoCaja,
    CategoriaEgreso,
    CierrePeriodo,
    Cuenta,
    Egreso,
    Mayor,
    BalanceSaldos,
    EstadoResultados,
    InicioContabilidad,
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
import { inicioContabilidad } from '#ledger/inicio_contabilidad'
import { permisosDeUsuario } from '#core/acl'
import { alcancesDelToken } from '#middleware/autorizar_middleware'
import CrearCaja from '#ledger/actions/crear_caja'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import EntregarCaja from '#ledger/actions/entregar_caja'
import RecibirEntrega from '#ledger/actions/recibir_entrega'
import RechazarEntrega from '#ledger/actions/rechazar_entrega'
import ConfigurarCajas from '#ledger/actions/configurar_cajas'
import RegistrarGastoCajaChica from '#ledger/actions/registrar_gasto_caja_chica'
import ReponerCajaChica from '#ledger/actions/reponer_caja_chica'
import ContarCaja from '#ledger/actions/contar_caja'
import AdjuntarComprobanteEgreso from '#ledger/actions/adjuntar_comprobante_egreso'
import { estadoCajaChica, listarConteos, listarReposiciones } from '#ledger/caja_chica'
import { exigirComprobanteDeEgreso } from '#ledger/comprobantes_egreso'
import {
    TAMANO_MAXIMO_COMPROBANTE,
    extensionComprobante,
    leerArchivoComprobante,
    type TipoComprobante,
} from '#billing/comprobantes_archivos'
import { ArchivoComprobante } from '#billing/esquemas'
import { readFile } from 'node:fs/promises'
import { ajustesCajas, listarEntregas, resumenCustodia } from '#ledger/custodia'
import { alcanceDePermiso } from '#core/acl'
import { NoAutenticado, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { EmpresaRequerida } from '#shared/empresa_activa'
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import { autorizarLecturaDeCaja } from '#ledger/lectura_caja'
import { SinTurnoAbierto, resumenTurnoAbierto } from '#ledger/resumen_turno'
import bancos from '#start/routes/bancos'
import compras from '#start/routes/compras'
import activos from '#start/routes/activos'
import cierres from '#start/routes/cierres'
import ejercicios from '#start/routes/ejercicios'
import apertura from '#start/routes/apertura'
import libros from '#start/routes/libros'

const DESCRIPCION_ARCHIVO =
    'Foto (JPG, PNG o WebP) o PDF del comprobante, hasta 5 MB; el tipo se decide por el contenido'

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
                { caja_id: id, fondo_inicial: cuerpo.fondo_inicial ?? null },
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
            'esperado = el de `GET /cajas/turno-actual/resumen` (fondo + cobros en efectivo − egresos, depósitos y pagos a proveedores en efectivo del turno); diferencia = contado − esperado. Con diferencia ≠ 0 el motivo es obligatorio (422) y queda un asiento cierre_caja (faltante o sobrante). `contado` o `denominaciones` (Q200 … 1¢; con los dos deben coincidir: 422 rule `denominaciones`). `fondo_siguiente` (≤ contado; sin él y con `entregado_a`, el fondo fijo de la caja) y `entregado_a` (obligatorio si queda resto): el resto se entrega a esa persona (B1: documento EntregaCaja, evento caja.entregada) y tiene asiento cuando dice «Recibí» (1.1.15 / Caja); tu propio usuario = «Lo deposito yo», recibido en el acto. Emite caja.cerrada. 409 si no hay turno abierto.',
        respuesta: { status: 200, descripcion: 'Turno cerrado', esquema: CajaTurno },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await existeCaja(id))
            return new CerrarCaja().execute(
                {
                    caja_id: id,
                    contado: cuerpo.contado,
                    motivo: cuerpo.motivo,
                    denominaciones: cuerpo.denominaciones,
                    fondo_siguiente: cuerpo.fondo_siguiente,
                    entregado_a: cuerpo.entregado_a,
                },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/cajas/turno-actual/resumen',
        operacion: 'cajasTurnoActualResumen',
        resumen:
            'Resumen del turno abierto: fondo, cobros por método, retiros e ingresos y lo que debe haber',
        etiqueta: 'cajas',
        permiso: 'cajas.ver',
        query: v.resumenTurnoValidator,
        descripcion:
            'Con `caja_id`, el turno abierto de esa caja (alcance por caja: 403). Sin ella, el de la caja del usuario: la del turno que abrió él o la caja que tiene asignada con turno abierto, en la empresa activa. 404 `sin_turno_abierto` si no hay. `esperado` = fondo_inicial + cobros en efectivo (monto − retenido) − egresos en efectivo − depósitos al banco − pagos a proveedores en efectivo del turno: la misma regla del cierre (`POST /cajas/:id/cerrar`). `otros_medios`: cobros por otros medios que registró quien abrió el turno mientras estuvo abierto (no entran a la caja).',
        respuesta: { status: 200, descripcion: 'Resumen del turno', esquema: ResumenTurnoCaja },
        handler: async (ctx, { query }) => {
            let cajaId = query.caja_id ?? null
            if (cajaId !== null) exigirAcceso(ctx, await existeCaja(cajaId))
            else {
                cajaId = await cajaDelCajero(
                    ctx.auth.user?.id ?? null,
                    ctx.alcance,
                    undefined,
                    ctx.empresa?.activa ?? null,
                )
                if (cajaId === null) {
                    throw new SinTurnoAbierto(null)
                }
            }
            return resumenTurnoAbierto(cajaId)
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
    ...custodiaRutas(),
    ...cajaChicaRutas(),
]

/** Archivo `archivo` de un multipart (uno, hasta 5 MB); null si no vino (la acción responde 422). */
async function archivoSubido(
    ctx: HttpContext,
): Promise<{ contenido: Uint8Array; nombre: string | null } | null> {
    const archivos = ctx.request.files('archivo')
    if (archivos.length > 1) {
        throw new ValidacionFallida([{ field: 'archivo', message: 'Adjunta un solo archivo', rule: 'uno' }])
    }
    const archivo = archivos[0]
    if (!archivo?.tmpPath) return null
    if (archivo.size > TAMANO_MAXIMO_COMPROBANTE) {
        throw new ValidacionFallida([{ field: 'archivo', message: 'El máximo es 5 MB', rule: 'tamano' }])
    }
    return { contenido: await readFile(archivo.tmpPath), nombre: archivo.clientName }
}

/** B9 del plan de contabilidad (§5.7): caja chica (gasto, reposición y conteo). */
function cajaChicaRutas(): Ruta[] {
    return [
        definirRuta({
            metodo: 'get',
            ruta: '/cajas/:id/caja-chica',
            operacion: 'cajasCajaChica',
            resumen: 'Estado de una caja chica: efectivo + comprobantes sin reponer = fondo fijo',
            etiqueta: 'cajas',
            permiso: 'cajas.ver',
            descripcion:
                'Fondo fijo, efectivo (saldo de su cuenta en el libro), gastos sin reponer (y cuántos sin archivo), diferencias de conteo, si cuadra, lo que se repone (por_reponer) y el % del fondo (bajo 30 el panel avisa). 422 no_es_caja_chica con una caja de cobros. Alcance por caja.',
            respuesta: { status: 200, descripcion: 'Caja chica', esquema: EstadoCajaChica },
            handler: async (ctx, { params }) => {
                const id = Number(params.id)
                exigirAcceso(ctx, await existeCaja(id))
                return estadoCajaChica(id)
            },
        }),
        definirRuta({
            metodo: 'post',
            ruta: '/cajas/:id/gastos',
            operacion: 'cajasRegistrarGasto',
            resumen: 'Registrar un gasto de la caja chica con su comprobante (Gasto / Caja chica)',
            etiqueta: 'cajas',
            permiso: 'caja_chica.registrar_gasto',
            cuerpo: v.gastoCajaChicaValidator,
            multipart: { archivos: { archivo: DESCRIPCION_ARCHIVO } },
            idempotente: true,
            descripcion:
                'Comprobante obligatorio (`archivo`; 422 archivo required, tipo o tamano). Sin tope por gasto: hasta el efectivo de la caja (422 efectivo_insuficiente). Quien no tiene egresos.registrar_sin_limite solo registra en la caja chica de la que es encargado (403 caja_ajena). Con `con_factura`, `pasar_a_compras` = true: sigue POST /compras/desde-egreso/:egreso_id para el IVA. 422 no_es_caja_chica. Emite caja_chica.gasto_registrado.',
            respuesta: { status: 201, descripcion: 'Gasto registrado', esquema: GastoCajaChica },
            handler: async (ctx, { cuerpo, params }) => {
                const id = Number(params.id)
                exigirAcceso(ctx, await existeCaja(id))
                return new RegistrarGastoCajaChica().execute(
                    { ...cuerpo, caja_id: id, archivo: await archivoSubido(ctx) },
                    ctx.contextoAccion(),
                )
            },
        }),
        definirRuta({
            metodo: 'post',
            ruta: '/cajas/:id/reponer',
            operacion: 'cajasReponer',
            resumen: 'Reponer la caja chica por lo gastado, desde tu custodia o desde el banco',
            etiqueta: 'cajas',
            permiso: 'caja_chica.reponer',
            cuerpo: v.reponerCajaChicaValidator,
            idempotente: true,
            descripcion:
                'Monto = fondo fijo − efectivo (lo gastado y los faltantes de conteo); nunca desde una caja de cobros. Sella los gastos y conteos pendientes (ya no se anulan). 422 gastos_sin_comprobante (con los egresos), nada_que_reponer, monto_distinto, custodia_insuficiente, cuenta_de_otra_empresa. Asiento reposicion_caja (Caja chica / 1.1.15 o Banco). Emite caja_chica.repuesta.',
            respuesta: { status: 201, descripcion: 'Reposición registrada', esquema: ReposicionCaja },
            handler: async (ctx, { cuerpo, params }) => {
                const id = Number(params.id)
                exigirAcceso(ctx, await existeCaja(id))
                return new ReponerCajaChica().execute({ ...cuerpo, caja_id: id }, ctx.contextoAccion())
            },
        }),
        definirRuta({
            metodo: 'post',
            ruta: '/cajas/:id/contar',
            operacion: 'cajasContar',
            resumen: 'Conteo sorpresa de la caja chica',
            etiqueta: 'cajas',
            permiso: 'caja_chica.contar',
            cuerpo: v.contarCajaValidator,
            idempotente: true,
            descripcion:
                'Esperado = efectivo en el libro. Con diferencia, motivo obligatorio (422) y asiento conteo_caja a cargo del encargado (Faltantes de caja / Caja chica o Caja chica / Sobrantes de caja); la siguiente reposición la repone. Emite caja.contada.',
            respuesta: { status: 201, descripcion: 'Conteo registrado', esquema: ConteoCaja },
            handler: async (ctx, { cuerpo, params }) => {
                const id = Number(params.id)
                exigirAcceso(ctx, await existeCaja(id))
                return new ContarCaja().execute({ ...cuerpo, caja_id: id }, ctx.contextoAccion())
            },
        }),
        definirRuta({
            metodo: 'get',
            ruta: '/cajas/:id/reposiciones',
            operacion: 'cajasReposiciones',
            resumen: 'Reposiciones de una caja chica (la más reciente primero)',
            etiqueta: 'cajas',
            permiso: 'cajas.ver',
            query: v.listarTurnosValidator,
            respuesta: {
                status: 200,
                descripcion: 'Página de reposiciones',
                esquema: pagina(ReposicionCaja),
            },
            handler: async (ctx, { params, query }) => {
                const id = Number(params.id)
                exigirAcceso(ctx, await existeCaja(id))
                return listarReposiciones(id, query)
            },
        }),
        definirRuta({
            metodo: 'get',
            ruta: '/cajas/:id/conteos',
            operacion: 'cajasConteos',
            resumen: 'Conteos de una caja chica (el más reciente primero)',
            etiqueta: 'cajas',
            permiso: 'cajas.ver',
            query: v.listarTurnosValidator,
            respuesta: { status: 200, descripcion: 'Página de conteos', esquema: pagina(ConteoCaja) },
            handler: async (ctx, { params, query }) => {
                const id = Number(params.id)
                exigirAcceso(ctx, await existeCaja(id))
                return listarConteos(id, query)
            },
        }),
    ]
}

/** Empresa de una lectura por empresa: `empresa_id` o la activa (422 empresa_requerida). */
function empresaDeLectura(ctx: HttpContext, empresaId: number | undefined): number {
    const id = empresaId ?? ctx.empresa?.activa ?? null
    if (id === null) throw new EmpresaRequerida()
    exigirEmpresaPeticion(ctx.empresa, id)
    return id
}

/** null si el usuario ve la custodia de todos (`cajas.ver_custodia`); si no, su id. */
async function soloLoPropio(ctx: HttpContext): Promise<number | null> {
    const usuario = ctx.auth.user
    if (!usuario) throw new NoAutenticado()
    const todo = await alcanceDePermiso(usuario.id, 'cajas.ver_custodia', alcancesDelToken(ctx))
    return todo ? null : usuario.id
}

/** B1 del plan de contabilidad (§5.7): ajustes, custodia y entregas. */
function custodiaRutas(): Ruta[] {
    return [
        definirRuta({
            metodo: 'get',
            ruta: '/cajas/ajustes',
            operacion: 'cajasAjustes',
            resumen: 'Ajustes de cajas y custodia de la empresa',
            etiqueta: 'cajas',
            permiso: 'cajas.ver',
            query: v.custodiaValidator,
            descripcion:
                'Fondo de cambio de las cajas de cobros, plazo (días hábiles) y tope de custodia por persona y «lo deposito yo». Sin configurar, los de fábrica (Q200, 1 día hábil, Q5,000, sí) con version 0.',
            respuesta: { status: 200, descripcion: 'Ajustes', esquema: AjustesCajas },
            handler: (ctx, { query }) => ajustesCajas(empresaDeLectura(ctx, query.empresa_id)),
        }),
        definirRuta({
            metodo: 'put',
            ruta: '/cajas/ajustes',
            operacion: 'cajasConfigurar',
            resumen: 'Configurar fondo de cambio, plazo y tope de custodia y «lo deposito yo»',
            etiqueta: 'cajas',
            permiso: 'cajas.configurar',
            cuerpo: v.configurarCajasValidator,
            idempotente: true,
            descripcion:
                'Solo cambia lo que se envía. `version` de GET /cajas/ajustes (409 conflicto_version). Emite cajas.ajustes_cambiados.',
            respuesta: { status: 200, descripcion: 'Ajustes', esquema: AjustesCajas },
            handler: (ctx, { cuerpo }) => new ConfigurarCajas().execute(cuerpo, ctx.contextoAccion()),
        }),
        definirRuta({
            metodo: 'get',
            ruta: '/cajas/custodia',
            operacion: 'cajasCustodia',
            resumen: 'Efectivo en custodia por persona (entre la caja de cobros y el banco)',
            etiqueta: 'cajas',
            permiso: 'cajas.ver',
            query: v.custodiaValidator,
            descripcion:
                'Por persona: lo recibido con «Recibí» menos lo depositado, desde cuándo (lo más viejo sin depositar), su vencimiento en días hábiles y si pasa el plazo o el tope (avisan, no bloquean), más sus entregas por recibir. Con cajas.ver_custodia, todas las personas de la empresa; sin él, solo la tuya.',
            respuesta: { status: 200, descripcion: 'Custodia', esquema: CustodiaEfectivo },
            handler: async (ctx, { query }) =>
                resumenCustodia(empresaDeLectura(ctx, query.empresa_id), await soloLoPropio(ctx)),
        }),
        definirRuta({
            metodo: 'get',
            ruta: '/cajas/entregas',
            operacion: 'cajasEntregas',
            resumen: 'Entregas de efectivo de las cajas de cobros',
            etiqueta: 'cajas',
            permiso: 'cajas.ver',
            query: v.listarEntregasValidator,
            descripcion:
                'Filtros estado (por_recibir, recibida, rechazada), caja_id y recibe_id. Con cajas.ver_custodia, todas las de sus empresas; sin él, las que entregaste o te toca recibir.',
            respuesta: { status: 200, descripcion: 'Página de entregas', esquema: pagina(EntregaCaja) },
            handler: async (ctx, { query }) =>
                listarEntregas(
                    query,
                    empresasDeLaLista(ctx.empresa, query.empresas),
                    await soloLoPropio(ctx),
                ),
        }),
        definirRuta({
            metodo: 'post',
            ruta: '/cajas/turnos/:id/entregar',
            operacion: 'cajasEntregar',
            resumen: 'Entregar otra vez el efectivo de un turno cerrado',
            etiqueta: 'cajas',
            permiso: 'cajas.entregar',
            cuerpo: v.entregarCajaValidator,
            idempotente: true,
            descripcion:
                'Para un turno cuya entrega se rechazó («No lo recibí»). El monto es lo que no quedó de fondo al cerrar (422 turno_sin_entrega); 409 entrega_vigente; quien recibe necesita cajas.recibir_entrega (422 receptor_sin_permiso); tu propio usuario = «Lo deposito yo» (422 autoentrega_apagada si la empresa lo apagó). Emite caja.entregada.',
            respuesta: { status: 201, descripcion: 'Entrega registrada', esquema: EntregaCaja },
            handler: async (ctx, { cuerpo, params }) => {
                const turnoId = Number(params.id)
                const turno = await db
                    .from('ledger.cajas_turnos')
                    .where('id', turnoId)
                    .select('caja_id')
                    .first()
                if (!turno) throw new NoEncontrado(`El turno ${turnoId} no existe`)
                exigirAcceso(ctx, await existeCaja(Number(turno.caja_id)))
                return new EntregarCaja().execute(
                    { turno_id: turnoId, entregado_a: cuerpo.entregado_a, origen: 'reentrega' },
                    ctx.contextoAccion(),
                )
            },
        }),
        definirRuta({
            metodo: 'post',
            ruta: '/cajas/entregas/:id/recibir',
            operacion: 'cajasRecibirEntrega',
            resumen: '«Recibí»: el efectivo pasa a tu custodia',
            etiqueta: 'cajas',
            permiso: 'cajas.recibir_entrega',
            cuerpo: v.recibirEntregaValidator,
            idempotente: true,
            descripcion:
                'Solo la persona a quien va la entrega (403 entrega_de_otra_persona). Asiento entrega_caja: 1.1.15 Efectivo en custodia (contado) / Caja (entregado); la diferencia queda a cargo de quien entregó (Faltantes o Sobrantes de caja) y exige motivo (422). 409 entrega_resuelta. Emite caja.entrega_recibida (sobre_tope avisa, no bloquea).',
            respuesta: { status: 200, descripcion: 'Entrega recibida', esquema: EntregaCaja },
            handler: (ctx, { cuerpo, params }) =>
                new RecibirEntrega().execute(
                    { entrega_id: Number(params.id), contado: cuerpo.contado, motivo: cuerpo.motivo },
                    ctx.contextoAccion(),
                ),
        }),
        definirRuta({
            metodo: 'post',
            ruta: '/cajas/entregas/:id/rechazar',
            operacion: 'cajasRechazarEntrega',
            resumen: '«No lo recibí»: el efectivo sigue a nombre del cajero',
            etiqueta: 'cajas',
            permiso: 'cajas.rechazar_entrega',
            cuerpo: v.rechazarEntregaValidator,
            idempotente: true,
            descripcion:
                'Solo la persona a quien va la entrega (403 entrega_de_otra_persona), con motivo. Sin asiento; el turno se puede entregar otra vez (POST /cajas/turnos/:id/entregar). 409 entrega_resuelta. Emite caja.entrega_rechazada.',
            respuesta: { status: 200, descripcion: 'Entrega rechazada', esquema: EntregaCaja },
            handler: (ctx, { cuerpo, params }) =>
                new RechazarEntrega().execute(
                    { entrega_id: Number(params.id), motivo: cuerpo.motivo },
                    ctx.contextoAccion(),
                ),
        }),
    ]
}

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
        ruta: '/contabilidad/inicio',
        operacion: 'contabilidadInicio',
        resumen: 'Inicio de contabilidad: qué toca hoy, pasos del mes e indicadores',
        etiqueta: 'libro',
        permiso: 'contabilidad.ver_inicio',
        query: v.inicioContabilidadValidator,
        descripcion:
            'De la empresa activa (con `empresas=todas` y alcance global, todas sumadas). `tareas`: lo que espera por alguien, solo lo que el rol puede atender (cada una pide el permiso de su acción) y solo con pendientes. `pasos`: 7 pasos del mes calculados con datos (nunca casillas a mano). `indicadores`: Te deben (reportes.ver), Debes a proveedores (compras.ver), Dinero disponible (libro.ver) e Impuestos del mes (declaraciones.ver), con las mismas consultas de la cartera por antigüedad, las cuentas por pagar, el efectivo del panel y el borrador de la declaración. Sin datos que lo respondan, `sin_datos`; sin permiso, `sin_permiso`; si una consulta falla, `error` con su problema y sin cifras: nunca ceros inventados.',
        respuesta: { status: 200, descripcion: 'Inicio de contabilidad', esquema: InicioContabilidad },
        handler: async (ctx, { query }) => {
            const permisos = new Set(
                await permisosDeUsuario(ctx.auth.getUserOrFail().id, alcancesDelToken(ctx)),
            )
            return inicioContabilidad({
                empresas: empresasDeLaLista(ctx.empresa, query.empresas),
                consolidado: query.empresas === 'todas',
                permisos,
                alcance: ctx.alcance,
                periodo: query.periodo,
            })
        },
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
        ruta: '/egresos/:id/comprobante',
        operacion: 'egresosAdjuntarComprobante',
        resumen: 'Adjuntar el comprobante (foto o PDF) de un egreso que no lo tiene',
        etiqueta: 'egresos',
        permiso: 'egresos.adjuntar_comprobante',
        cuerpo: v.sinCampos,
        multipart: { archivos: { archivo: DESCRIPCION_ARCHIVO } },
        idempotente: true,
        descripcion:
            'B9: una vez por egreso (409 comprobante_existente). Lo necesitan las compras al contado pagadas con la caja chica antes de reponerla. 422 archivo (required, tipo o tamano). Emite egreso.comprobante_adjuntado.',
        respuesta: { status: 200, descripcion: 'Egreso con su comprobante', esquema: Egreso },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await dimensionesDeEgreso(id))
            return new AdjuntarComprobanteEgreso().execute(
                { egreso_id: id, archivo: await archivoSubido(ctx) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/egresos/:id/comprobante',
        operacion: 'egresosComprobante',
        resumen: 'Archivo del comprobante de un egreso',
        etiqueta: 'egresos',
        permiso: 'egresos.ver',
        descripcion:
            'Responde el archivo con su Content-Type e `inline`. 404 si el egreso no tiene comprobante.',
        respuesta: { status: 200, descripcion: 'Archivo', esquema: ArchivoComprobante },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await dimensionesDeEgreso(id))
            const archivo = await exigirComprobanteDeEgreso(id)
            const contenido = await leerArchivoComprobante(archivo.archivo)
            const tipo = archivo.tipo as TipoComprobante
            ctx.response.header('Content-Type', tipo)
            ctx.response.header(
                'Content-Disposition',
                `inline; filename="egreso-${id}.${extensionComprobante(tipo)}"`,
            )
            ctx.response.header('Cache-Control', 'private, no-store')
            ctx.response.header('X-Content-Type-Options', 'nosniff')
            ctx.response.send(contenido)
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

export default [
    ...cajas,
    ...libro,
    ...egresos,
    ...periodos,
    ...cierres,
    ...ejercicios,
    ...apertura,
    ...bancos,
    ...compras,
    ...libros,
    ...activos,
]
