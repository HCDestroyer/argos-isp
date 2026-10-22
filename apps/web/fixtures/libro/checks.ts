import type { Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'

/**
 * Lista de verificación de cierre (A3, fase 6 PR B, contrato fiscal §10.5) y la última corrida de
 * facturar y vencer por empresa (`GET /facturas/corridas`), como la API:
 *
 * - `ledger.cierres_checks` es de solo inserción: el vigente de cada clave es su última fila.
 * - `verificar` calcula cada check y solo agrega fila si cambió esperado, obtenido o resultado (así una
 *   supervisión sigue vigente mientras la anomalía sea la misma).
 * - `verificar` pide `cierres.verificar`; `revisar` (`cierres.revisar_check`) agrega una fila a mano (`automatico: false`): `supervisado` (con nota) deja pasar el
 *   cierre; `anomalia` retira la supervisión. 409 `check_desactualizado`, 422 `check_en_orden`,
 *   409 `check_sin_cambio`.
 * - Cerrar un mes y el bloqueo duro verifican y exigen los checks (422 `checks_pendientes`); si fallan,
 *   la verificación tampoco queda (la transacción se deshace).
 *
 * Semilla: julio de ArgosNet verificado el 14/10 con un turno de caja abierto (anomalía sin supervisar),
 * fondos en tránsito descuadrados pero supervisados con nota, y la depreciación sin verificar todavía.
 * Los demás meses cuadran: lo que cambia el cálculo va en `bd.calculosChecks`.
 */

export type CheckCierre = Schema<'CheckCierre'>
type TipoCheck = CheckCierre['tipo']
type Calculo = Pick<CheckCierre, 'esperado' | 'obtenido' | 'resultado' | 'detalle'>

/** Un cálculo que no cuadra (o que cuadra con otros valores) para una empresa, tipo, periodo y clave. */
export interface CalculoCheck extends Calculo {
    empresa_id: number
    tipo: TipoCheck
    /** Primer día del mes (o del año). */
    periodo: string
    clave: string
}

interface DefinicionCheck {
    clave: string
    tipo: TipoCheck
    titulo: string
    aviso?: boolean
    /** Lo que da el cálculo cuando todo cuadra. */
    cuadra: [esperado: string, obtenido: string]
}

/** El catálogo de `apps/api/app/ledger/checks.ts`, en su orden. */
const CATALOGO: readonly DefinicionCheck[] = [
    { clave: 'cxc_antiguedad', tipo: 'mensual', titulo: 'Antigüedad de cartera = saldo de 1.1.03', cuadra: ['45210.50', '45210.50'] },
    { clave: 'cxc_auxiliar', tipo: 'mensual', titulo: 'Auxiliar de clientes = 1.1.03 y 2.1.01 (sin partidas sin cliente)', cuadra: ['0', '0'] },
    { clave: 'cxp_antiguedad', tipo: 'mensual', titulo: 'Antigüedad de proveedores = saldo de 2.1.03', cuadra: ['12850.00', '12850.00'] },
    { clave: 'apertura_cero', tipo: 'mensual', titulo: '2.9.01 Saldos de apertura en cero', cuadra: ['0.00', '0.00'] },
    { clave: 'iva_por_certificar', tipo: 'mensual', titulo: '2.1.11 = IVA de los avisos sin DTE certificado', cuadra: ['0.00', '0.00'] },
    { clave: 'turnos_cerrados', tipo: 'mensual', titulo: 'Ningún turno de caja abierto del periodo', cuadra: ['0', '0'] },
    { clave: 'fondos_transito', tipo: 'mensual', titulo: '1.1.11 = depósitos y traslados sin conciliar', cuadra: ['0.00', '0.00'] },
    { clave: 'cobros_por_liquidar', tipo: 'mensual', titulo: 'Cobros por liquidar al día y cuadrados', cuadra: ['0', '0'] },
    { clave: 'extractos_conciliados', tipo: 'mensual', titulo: 'Líneas de extracto del periodo conciliadas', cuadra: ['0', '0'] },
    { clave: 'dte_pendientes', tipo: 'mensual', titulo: 'Ningún DTE pendiente, enviando o en contingencia del periodo', cuadra: ['0', '0'] },
    { clave: 'por_certificar', tipo: 'mensual', titulo: 'Facturas por certificar del periodo (aviso)', aviso: true, cuadra: ['0', '0'] },
    { clave: 'compras_sin_periodo', tipo: 'mensual', titulo: 'Compras sin periodo del IVA', cuadra: ['0', '0'] },
    { clave: 'secuencias_sin_huecos', tipo: 'mensual', titulo: 'Numeración de los diarios sin huecos en el año', cuadra: ['0', '0'] },
    { clave: 'hash_verificado', tipo: 'mensual', titulo: 'Cadena de hash verificada hasta el fin del periodo', cuadra: ['verificada', 'verificada'] },
    { clave: 'depreciacion_al_dia', tipo: 'mensual', titulo: 'Cuotas de activos y diferidos del periodo contabilizadas', cuadra: ['0', '0'] },
    { clave: 'incobrables', tipo: 'anual', titulo: 'Estimación de incobrables (1.1.12) dentro del tope', cuadra: ['<= 2260.53', '1800.00'] },
]

function definicion(clave: string): DefinicionCheck | undefined {
    return CATALOGO.find(d => d.clave === clave)
}

function delTipo(tipo: TipoCheck): readonly DefinicionCheck[] {
    return CATALOGO.filter(d => d.tipo === tipo)
}

/** Lo que el cálculo de la API da hoy para esa clave: lo que diga `bd.calculosChecks`, o que cuadra. */
function calcular(empresaId: number, tipo: TipoCheck, periodo: string, def: DefinicionCheck, calculos: readonly CalculoCheck[]): Calculo {
    const propio = calculos.find(c => c.empresa_id === empresaId && c.tipo === tipo && c.periodo === periodo && c.clave === def.clave)
    if (propio) {
        return { esperado: propio.esperado, obtenido: propio.obtenido, resultado: def.aviso ? 'ok' : propio.resultado, detalle: propio.detalle }
    }
    return { esperado: def.cuadra[0], obtenido: def.cuadra[1], resultado: 'ok', detalle: null }
}

const JULIO = '2026-07-01'

export const calculosChecks: CalculoCheck[] = [
    { empresa_id: 1, tipo: 'mensual', periodo: JULIO, clave: 'turnos_cerrados', esperado: '0', obtenido: '1', resultado: 'anomalia', detalle: { turnos: [7] } },
    { empresa_id: 1, tipo: 'mensual', periodo: JULIO, clave: 'fondos_transito', esperado: '3500.00', obtenido: '4250.00', resultado: 'anomalia', detalle: { depositos: 2, traslados: 1 } },
    { empresa_id: 1, tipo: 'mensual', periodo: JULIO, clave: 'por_certificar', esperado: '0', obtenido: '2', resultado: 'ok', detalle: null },
]

function filaCheck(id: number, def: DefinicionCheck, calculo: Calculo, datos: Partial<CheckCierre> & Pick<CheckCierre, 'created_at'>): CheckCierre {
    return {
        id,
        empresa_id: 1,
        tipo: def.tipo,
        periodo: JULIO,
        clave: def.clave,
        titulo: def.titulo,
        aviso: def.aviso === true,
        automatico: true,
        esperado: calculo.esperado,
        obtenido: calculo.obtenido,
        resultado: calculo.resultado,
        estado: calculo.resultado === 'ok' ? 'revisado' : 'anomalia',
        nota: null,
        detalle: calculo.detalle,
        revisado_por: null,
        revisado_por_nombre: null,
        ...datos,
    }
}

function semillaJulio(): CheckCierre[] {
    const verificados = delTipo('mensual').filter(d => d.clave !== 'depreciacion_al_dia')
    const filas = verificados.map((def, i) => filaCheck(i + 1, def, calcular(1, 'mensual', JULIO, def, calculosChecks), { created_at: '2026-10-14T16:00:00.000Z' }))
    const fondos = filas.find(f => f.clave === 'fondos_transito')
    if (fondos) {
        filas.push({
            ...fondos,
            id: filas.length + 1,
            automatico: false,
            estado: 'supervisado',
            nota: 'Depósito del 31/07 acreditado por el banco el 03/08; la diferencia queda en tránsito',
            revisado_por: 1,
            revisado_por_nombre: 'Ana Administradora',
            created_at: '2026-10-14T17:30:00.000Z',
        })
    }
    return filas
}

export const checksCierre: CheckCierre[] = semillaJulio()

/** `AAAA-MM` (mensual, impuestos) o `AAAA` (anual) → primer día; `null` si no tiene ese formato. */
function periodoDeRuta(tipo: TipoCheck, texto: string): string | null {
    if (tipo === 'anual') {
        return /^\d{4}$/.test(texto) ? `${texto}-01-01` : null
    }
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(texto) ? `${texto}-01` : null
}

function textoPeriodo(tipo: TipoCheck, periodo: string): string {
    return tipo === 'anual' ? periodo.slice(0, 4) : periodo.slice(0, 7)
}

function esTipo(texto: string | undefined): texto is TipoCheck {
    return texto === 'mensual' || texto === 'impuestos' || texto === 'anual'
}

/** Última fila de cada clave del catálogo, en su orden. */
function vigentes(filas: readonly CheckCierre[], empresaId: number, tipo: TipoCheck, periodo: string): CheckCierre[] {
    return delTipo(tipo).flatMap((def) => {
        const ultima = filas.filter(f => f.empresa_id === empresaId && f.tipo === tipo && f.periodo === periodo && f.clave === def.clave).sort((a, b) => b.id - a.id)[0]
        return ultima ? [ultima] : []
    })
}

function pasa(check: Pick<CheckCierre, 'estado'>): boolean {
    return check.estado === 'revisado' || check.estado === 'supervisado'
}

/** Filas nuevas de una verificación: solo las claves cuyo cálculo cambió desde la última automática. */
function filasNuevas(filas: readonly CheckCierre[], empresaId: number, tipo: TipoCheck, periodo: string): CheckCierre[] {
    const nuevas: CheckCierre[] = []
    let id = siguienteId([...filas])
    for (const def of delTipo(tipo)) {
        const calculo = calcular(empresaId, tipo, periodo, def, bd.calculosChecks)
        const previa = filas
            .filter(f => f.empresa_id === empresaId && f.tipo === tipo && f.periodo === periodo && f.clave === def.clave && f.automatico)
            .sort((a, b) => b.id - a.id)[0]
        if (previa && previa.esperado === calculo.esperado && previa.obtenido === calculo.obtenido && previa.resultado === calculo.resultado) {
            continue
        }
        nuevas.push({
            ...filaCheck(id, def, calculo, { created_at: ahora() }),
            empresa_id: empresaId,
            periodo,
        })
        id += 1
    }
    return nuevas
}

/** Como `exigirChecks`: un `errors[]` por clave sin verificar o que no pasa. */
function pendientes(filas: readonly CheckCierre[], empresaId: number, tipo: TipoCheck, periodo: string): NonNullable<Schema<'Problem'>['errors']> {
    const actuales = vigentes(filas, empresaId, tipo, periodo)
    return delTipo(tipo).flatMap((def) => {
        const v = actuales.find(c => c.clave === def.clave)
        if (!v) {
            return [{ field: def.clave, message: `${def.titulo}: sin verificar`, rule: 'checks_pendientes' }]
        }
        return pasa(v) ? [] : [{ field: def.clave, message: `${def.titulo}: esperado ${v.esperado}, obtenido ${v.obtenido}`, rule: 'checks_pendientes' }]
    })
}

/**
 * Lo que hacen `cerrarPeriodo` y el bloqueo duro: verificar y exigir los checks de cada `[tipo, periodo]`.
 * Devuelve el 422 `checks_pendientes` del primero que no pasa (nada queda guardado), o `null` y deja
 * guardadas las verificaciones.
 */
export function verificarYExigir(solicitud: SolicitudFixture, empresaId: number, cierres: readonly [TipoCheck, string][]): RespuestaFixture | null {
    const guardadas: CheckCierre[] = []
    for (const [tipo, periodo] of cierres) {
        const antes = [...bd.checksCierre, ...guardadas]
        const filas = [...antes, ...filasNuevas(antes, empresaId, tipo, periodo)]
        const errores = pendientes(filas, empresaId, tipo, periodo)
        if (errores.length) {
            return problemaTipado(
                422,
                'checks_pendientes',
                'Checks de cierre pendientes',
                `Hay ${errores.length} checks del cierre ${tipo} ${textoPeriodo(tipo, periodo)} en anomalía o sin verificar: ${errores.map(e => e.field).join(', ')}. Corrige la causa o supervísalos con una nota`,
                errores,
            )
        }
        guardadas.push(...filas.slice(antes.length))
    }
    bd.checksCierre.push(...guardadas)
    for (const [tipo, periodo] of cierres) {
        registrarAccion(solicitud, 'cierres.verificar', { tipo: 'cierre_checks', id: 0 }, { empresa_id: empresaId, tipo, periodo: textoPeriodo(tipo, periodo), anomalias: [] })
    }
    return null
}

function empresaDeConsulta(solicitud: SolicitudFixture): number {
    const consulta = Number(solicitud.query.get('empresa_id'))
    return Number.isInteger(consulta) && consulta > 0 ? consulta : (empresaActivaDe(solicitud) ?? 1)
}

function empresaDelCuerpo(solicitud: SolicitudFixture): number {
    const cuerpo = cuerpoObjeto(solicitud)
    return typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1)
}

/** `:tipo` y `:periodo` de la ruta: 404 con un tipo desconocido, 422 con un periodo mal escrito. */
function cierreDeRuta(solicitud: SolicitudFixture): { tipo: TipoCheck, periodo: string } | RespuestaFixture {
    const tipo = solicitud.params.tipo
    if (!esTipo(tipo)) {
        return noEncontrado(`el tipo de cierre ${tipo ?? ''}`)
    }
    const periodo = periodoDeRuta(tipo, solicitud.params.periodo ?? '')
    if (!periodo) {
        return datosInvalidos([{ field: 'periodo', message: tipo === 'anual' ? 'El periodo anual es AAAA' : 'El periodo es AAAA-MM', rule: 'periodo' }])
    }
    return { tipo, periodo }
}

export const rutasChecksCierre: RutasFixture = {
    'GET /api/v1/libro/cierres/:tipo/:periodo/checks': conPermiso('libro.ver', (solicitud) => {
        const cierre = cierreDeRuta(solicitud)
        if ('status' in cierre) {
            return cierre
        }
        const { tipo, periodo } = cierre
        const empresaId = empresaDeConsulta(solicitud)
        const checks = vigentes(bd.checksCierre, empresaId, tipo, periodo)
        const sinVerificar = delTipo(tipo).filter(d => !checks.some(c => c.clave === d.clave)).map(d => ({ clave: d.clave, titulo: d.titulo }))
        const cuerpo: Schema<'ChecksCierre'> = {
            empresa_id: empresaId,
            tipo,
            periodo: textoPeriodo(tipo, periodo),
            checks,
            sin_verificar: sinVerificar,
            pasan: sinVerificar.length === 0 && checks.every(pasa),
        }
        if (solicitud.query.get('historial') === 'true') {
            cuerpo.historial = bd.checksCierre.filter(f => f.empresa_id === empresaId && f.tipo === tipo && f.periodo === periodo).sort((a, b) => b.id - a.id)
        }
        return { status: 200, cuerpo }
    }),

    'POST /api/v1/libro/cierres/:tipo/:periodo/verificar': conPermiso('cierres.verificar', conIdempotencia((solicitud) => {
        const cierre = cierreDeRuta(solicitud)
        if ('status' in cierre) {
            return cierre
        }
        const { tipo, periodo } = cierre
        const empresaId = empresaDelCuerpo(solicitud)
        bd.checksCierre.push(...filasNuevas(bd.checksCierre, empresaId, tipo, periodo))
        const checks = vigentes(bd.checksCierre, empresaId, tipo, periodo)
        const anomalias = checks.filter(c => !pasa(c)).map(c => c.clave)
        registrarAccion(solicitud, 'cierres.verificar', { tipo: 'cierre_checks', id: 0 }, { empresa_id: empresaId, tipo, periodo: textoPeriodo(tipo, periodo), anomalias })
        const cuerpo: Schema<'VerificacionCierre'> = { empresa_id: empresaId, tipo, periodo: textoPeriodo(tipo, periodo), checks, anomalias }
        return { status: 200, cuerpo }
    })),

    'POST /api/v1/libro/cierres/checks/:id/revisar': conPermiso('cierres.revisar_check', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const estado = cuerpo.estado
        const nota = typeof cuerpo.nota === 'string' ? cuerpo.nota.trim() : ''
        const errores = [
            ...(estado === 'supervisado' || estado === 'anomalia' ? [] : [{ field: 'estado', message: 'Debe ser supervisado o anomalia', rule: 'enum' }]),
            ...(nota.length >= 3 && nota.length <= 500 ? [] : [{ field: 'nota', message: 'La nota es obligatoria (mínimo 3 caracteres)', rule: 'minLength' }]),
        ]
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const check = bd.checksCierre.find(c => c.id === idDe(solicitud))
        if (!check) {
            return noEncontrado(`el check ${solicitud.params.id ?? ''}`)
        }
        const ultimo = Math.max(...bd.checksCierre.filter(c => c.empresa_id === check.empresa_id && c.tipo === check.tipo && c.periodo === check.periodo && c.clave === check.clave).map(c => c.id))
        if (ultimo !== check.id) {
            return problemaTipado(409, 'check_desactualizado', 'Check desactualizado', `El check ${check.clave} se volvió a verificar: revisa la fila vigente (${ultimo})`)
        }
        if (check.resultado === 'ok') {
            return problemaTipado(422, 'check_en_orden', 'Check en orden', `El check ${check.clave} está en orden`, [{ field: 'estado', message: 'Solo un check en anomalía se supervisa', rule: 'check_en_orden' }])
        }
        if (check.estado === estado) {
            return problemaTipado(409, 'check_sin_cambio', 'Sin cambio', `El check ${check.clave} ya está ${estado}`)
        }
        const quien = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const fila: CheckCierre = {
            ...check,
            id: siguienteId(bd.checksCierre),
            automatico: false,
            estado: estado === 'supervisado' ? 'supervisado' : 'anomalia',
            nota,
            revisado_por: quien?.id ?? null,
            revisado_por_nombre: quien?.nombre ?? null,
            created_at: ahora(),
        }
        bd.checksCierre.push(fila)
        registrarAccion(solicitud, 'cierres.revisar_check', { tipo: 'cierre_check', id: fila.id }, { check_id: check.id, estado, nota })
        return { status: 201, cuerpo: fila }
    })),
}

/** Como `definicion`, para quien arma un `errors[]` con el título de una clave. */
export function tituloCheck(clave: string): string {
    return definicion(clave)?.titulo ?? clave
}

/*
 * Última corrida de facturar y vencer por empresa (`GET /facturas/corridas`, pedido de A4): como la API,
 * sale de la fila de la corrida en `audit.acciones` (su `entrada`: parámetros, resultado y bloqueos).
 * Cuenta para una empresa si recorrió todas (`parametros.empresas` null) o si la incluyó. `resultado`,
 * `bloqueos[]` y `bloqueados` son solo de la empresa: los contadores salen de `resultado.por_empresa`
 * (fase 6 PR C). Una corrida anterior sin `por_empresa` solo da resultado si fue de esa sola empresa;
 * si recorrió varias, `resultado` es null.
 */
export const PROCESOS_CORRIDA = ['facturas.generar', 'facturas.vencer_pendientes'] as const
export type ProcesoCorrida = (typeof PROCESOS_CORRIDA)[number]
type BloqueoCorrida = Schema<'ResultadoVencimiento'>['bloqueos'][number]

/** Contadores de una empresa en la corrida (`ContadoresPorEmpresa.json` de la API). */
export type ContadoresCorrida = Record<string, number>

export interface EntradaCorrida {
    parametros: { hasta: string, servicio_id: number | null, empresas: number[] | null }
    /** Totales de la corrida y, desde la fase 6 PR C, `por_empresa` (clave = id de la empresa). */
    resultado: Record<string, unknown> & { por_empresa?: Record<string, ContadoresCorrida> }
    bloqueos: BloqueoCorrida[]
}

/** La fila que deja `RegistrarCorrida` (sin entidad). */
export function registrarCorrida(solicitud: SolicitudFixture, proceso: ProcesoCorrida, entrada: EntradaCorrida): void {
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    const id = siguienteId(bd.acciones)
    bd.acciones.push({
        id,
        actor_tipo: 'usuario',
        actor_id: usuario?.id ?? null,
        actor_nombre: usuario?.nombre ?? null,
        canal: solicitud.headers.get('X-Canal') ?? 'api',
        accion: proceso,
        entidad_tipo: null,
        entidad_id: null,
        entrada,
        resultado: 'ok',
        error: null,
        request_id: `req-fixture-${id}`,
        empresa_id: null,
        empresa_nombre: null,
        created_at: ahora(),
    })
}

function esEntradaCorrida(entrada: unknown): entrada is EntradaCorrida {
    return typeof entrada === 'object' && entrada !== null && 'parametros' in entrada && 'bloqueos' in entrada
}

/** Como `resultadoDeEmpresa` de la API: los contadores de la empresa, o null si no se pueden separar. */
function resultadoDeEmpresa(proceso: ProcesoCorrida, entrada: EntradaCorrida, empresaId: number, bloqueos: BloqueoCorrida[], bloqueados: number): Record<string, unknown> | null {
    const porEmpresa = entrada.resultado.por_empresa
    if (porEmpresa) {
        const ceros = proceso === 'facturas.generar' ? { generadas: 0, omitidas: 0, bonificadas: 0, errores: 0 } : { vencidas: 0, moras: 0, errores: 0 }
        return { ...ceros, ...(porEmpresa[String(empresaId)] ?? {}), bloqueados, bloqueos }
    }
    const empresas = entrada.parametros.empresas
    if (Array.isArray(empresas) && empresas.length === 1 && empresas[0] === empresaId) {
        const contadores = Object.fromEntries(Object.entries(entrada.resultado).filter(([clave]) => !['facturas', 'bonificaciones'].includes(clave)))
        return { ...contadores, bloqueados, bloqueos }
    }
    return null
}

function corridaDe(empresaId: number, proceso: ProcesoCorrida): Schema<'CorridasFacturacion'>['procesos'][number] {
    const fila = bd.acciones
        .filter(a => a.accion === proceso && a.resultado === 'ok' && esEntradaCorrida(a.entrada))
        .filter((a) => {
            const empresas = esEntradaCorrida(a.entrada) ? a.entrada.parametros.empresas : null
            return empresas === null || empresas.includes(empresaId)
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)[0]
    const entrada = fila && esEntradaCorrida(fila.entrada) ? fila.entrada : null
    const bloqueos = (entrada?.bloqueos ?? []).filter(b => b.empresa_id === empresaId)
    const bloqueados = bloqueos.reduce((s, b) => s + b.documentos, 0)
    return {
        proceso,
        corrida_en: fila?.created_at ?? null,
        actor_tipo: fila?.actor_tipo ?? null,
        canal: fila?.canal ?? null,
        hasta: entrada?.parametros.hasta ?? null,
        bloqueados,
        bloqueos,
        resultado: entrada ? resultadoDeEmpresa(proceso, entrada, empresaId, bloqueos, bloqueados) : null,
    }
}

/** Antes que `GET /facturas/:id`. */
export const rutasCorridasFacturacion: RutasFixture = {
    'GET /api/v1/facturas/corridas': conPermiso('facturas.ver', (solicitud) => {
        const empresas = deLaEmpresa(bd.empresas.map(e => ({ empresa_id: e.id })), solicitud).map(e => e.empresa_id)
        const cuerpo: Schema<'CorridasFacturacion'>[] = empresas.map(empresaId => ({ empresa_id: empresaId, procesos: PROCESOS_CORRIDA.map(p => corridaDe(empresaId, p)) }))
        return { status: 200, cuerpo }
    }),
}

/** La corrida automática de la madrugada del 15/10 (cron, todas las empresas): lo detenido por los bloqueos de la semilla. */
export const accionesCorridas: Schema<'AccionAuditoria'>[] = [
    {
        id: 9001,
        actor_tipo: 'sistema',
        actor_id: null,
        actor_nombre: null,
        canal: 'cron',
        accion: 'facturas.generar',
        entidad_tipo: null,
        entidad_id: null,
        entrada: {
            parametros: { hasta: '2026-10-15', servicio_id: null, empresas: null },
            resultado: {
                generadas: 4,
                omitidas: 9,
                facturas: [],
                bonificadas: 0,
                bonificaciones: [],
                errores: 0,
                bloqueados: 3,
                por_empresa: {
                    1: { generadas: 3, omitidas: 6, bonificadas: 0, errores: 0, bloqueados: 3 },
                    2: { generadas: 1, omitidas: 3, bonificadas: 0, errores: 0, bloqueados: 0 },
                },
            },
            bloqueos: [{ empresa_id: 1, tipo: 'ventas', hasta: '2026-09-30', fecha: '2026-09-01', documentos: 3, ejemplos: [2, 4, 6] }],
        } satisfies EntradaCorrida,
        resultado: 'ok',
        error: null,
        request_id: 'req-cron-9001',
        empresa_id: null,
        empresa_nombre: null,
        created_at: '2026-10-15T06:05:00.000Z',
    },
    {
        id: 9002,
        actor_tipo: 'sistema',
        actor_id: null,
        actor_nombre: null,
        canal: 'cron',
        accion: 'facturas.vencer_pendientes',
        entidad_tipo: null,
        entidad_id: null,
        entrada: {
            parametros: { hasta: '2026-10-15', servicio_id: null, empresas: null },
            resultado: {
                vencidas: 6,
                moras: 2,
                errores: 0,
                bloqueados: 2,
                por_empresa: {
                    1: { vencidas: 4, moras: 2, errores: 0, bloqueados: 2 },
                    2: { vencidas: 2, moras: 0, errores: 0, bloqueados: 0 },
                },
            },
            bloqueos: [{ empresa_id: 1, tipo: 'global', hasta: '2026-08-31', fecha: '2026-08-25', documentos: 2, ejemplos: [3, 5] }],
        } satisfies EntradaCorrida,
        resultado: 'ok',
        error: null,
        request_id: 'req-cron-9002',
        empresa_id: null,
        empresa_nombre: null,
        created_at: '2026-10-15T06:10:00.000Z',
    },
]
