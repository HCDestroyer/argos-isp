/**
 * Rutas de la fase 4 · bancos (A3, §10.3): depósito de caja, traslados, fondos en tránsito,
 * extractos, conciliación, reglas y el reporte de conciliación. Mismos errores que la API real
 * (`extracto_descuadrado`, `extracto_no_encadena`, `extracto_duplicado`, `conciliacion_descuadrada`,
 * `linea_conciliada`, `movimiento_conciliado`, `deposito_excede_efectivo`…).
 */
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import type { LineaGuardada, MovimientoBancoFixture } from '../cobros/datos'
import { huellaDe } from '../cobros/datos'
import { conflicto, cuentasBancoFixture, hoy, invalido, regla422, resolverCuenta, siguienteMovimientoBanco } from '../cobros/rutas'
import { esperadoDelTurno } from '../cajas/rutas'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, numeroQuery, paginar, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'

type Errores = NonNullable<Problem['errors']>
type Conciliacion = Schema<'Conciliacion'>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const MONTO_SIGNO = /^-?\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

function usuarioDe(solicitud: SolicitudFixture): number | null {
    return solicitud.token ? usuariosPorToken[solicitud.token]?.id ?? null : null
}

function fechaDe(cuerpo: Record<string, unknown>): { ok: true, fecha: string } | { ok: false, respuesta: RespuestaFixture } {
    const fecha = typeof cuerpo.fecha === 'string' && cuerpo.fecha ? cuerpo.fecha : hoy()
    if (!FECHA.test(fecha) || fecha > hoy()) {
        return { ok: false, respuesta: invalido([{ field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' }]) }
    }
    return { ok: true, fecha }
}

/* Depósitos y traslados. */

/** Como `DepositarCaja` (A3): turno abierto, no más que su efectivo, boleta única por cuenta. */
function depositar(solicitud: SolicitudFixture): RespuestaFixture {
    const caja = bd.cajas.find(c => c.id === idDe(solicitud))
    if (!caja) {
        return noEncontrado('la caja')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (typeof cuerpo.monto !== 'string' || !MONTO.test(cuerpo.monto) || new Decimal(cuerpo.monto).lte(0)) {
        return invalido([{ field: 'monto', message: 'Monto con hasta 2 decimales, como string', rule: 'regex' }])
    }
    const boleta = typeof cuerpo.boleta === 'string' ? cuerpo.boleta.trim() : ''
    if (!boleta) {
        return invalido([{ field: 'boleta', message: 'El campo boleta es obligatorio', rule: 'required' }])
    }
    const fecha = fechaDe(cuerpo)
    if (!fecha.ok) {
        return fecha.respuesta
    }
    const banco = resolverCuenta(cuerpo, 'cuenta_bancaria_id', true)
    if (!banco.ok || !banco.cuenta) {
        return banco.ok ? invalido([]) : banco.respuesta
    }
    const turno = bd.turnos.find(t => t.id === caja.turno_abierto_id)
    if (!turno) {
        return conflicto('sin_turno_abierto', 'Sin turno abierto', `La caja ${caja.id} no tiene un turno abierto`)
    }
    const efectivo = esperadoDelTurno(turno)
    const monto = new Decimal(cuerpo.monto)
    if (monto.gt(efectivo)) {
        return regla422('deposito_excede_efectivo', 'Depósito mayor que el efectivo', `El turno ${turno.id} tiene Q${efectivo.toFixed(2)} en efectivo; no se pueden depositar Q${monto.toFixed(2)}`, [{ field: 'monto', message: `Efectivo del turno: Q${efectivo.toFixed(2)}`, rule: 'deposito_excede_efectivo' }])
    }
    const cuenta = banco.cuenta
    if (bd.depositos.some(d => d.cuenta_id === cuenta.cuenta_id && d.boleta === boleta)) {
        return conflicto('deposito_duplicado', 'Depósito duplicado', `La boleta ${boleta} ya está registrada en ${cuenta.codigo}`)
    }
    const deposito: Schema<'Deposito'> = {
        id: siguienteId(bd.depositos),
        empresa_id: caja.empresa_id ?? 1,
        caja_id: caja.id,
        caja_nombre: caja.nombre,
        turno_id: turno.id,
        cuenta_id: cuenta.cuenta_id,
        cuenta_codigo: cuenta.codigo,
        cuenta_nombre: cuenta.nombre,
        cuenta_bancaria_id: cuenta.cuenta_bancaria_id,
        banco_id: cuenta.banco_id,
        monto: monto.toFixed(2),
        boleta,
        fecha: fecha.fecha,
        estado: 'en_transito',
        acreditado_en: null,
        registrado_por: usuarioDe(solicitud),
        created_at: ahora(),
    }
    bd.depositos.push(deposito)
    registrarAccion(solicitud, 'cajas.depositar', { tipo: 'caja', id: caja.id }, cuerpo)
    return { status: 201, cuerpo: deposito }
}

/** Como `TrasladarFondos` (A3): dos cuentas distintas de la misma empresa. */
function trasladar(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    if (typeof cuerpo.monto !== 'string' || !MONTO.test(cuerpo.monto) || new Decimal(cuerpo.monto).lte(0)) {
        return invalido([{ field: 'monto', message: 'Monto con hasta 2 decimales, como string', rule: 'regex' }])
    }
    const referencia = typeof cuerpo.referencia === 'string' ? cuerpo.referencia.trim() : ''
    if (!referencia) {
        return invalido([{ field: 'referencia', message: 'El campo referencia es obligatorio', rule: 'required' }])
    }
    const fecha = fechaDe(cuerpo)
    if (!fecha.ok) {
        return fecha.respuesta
    }
    const objeto = (valor: unknown) => (typeof valor === 'object' && valor !== null ? valor as Record<string, unknown> : {})
    const origen = resolverCuenta(objeto(cuerpo.origen), 'origen.cuenta_id', true)
    if (!origen.ok || !origen.cuenta) {
        return origen.ok ? invalido([]) : origen.respuesta
    }
    const destino = resolverCuenta(objeto(cuerpo.destino), 'destino.cuenta_id', true)
    if (!destino.ok || !destino.cuenta) {
        return destino.ok ? invalido([]) : destino.respuesta
    }
    if (origen.cuenta.cuenta_id === destino.cuenta.cuenta_id) {
        return invalido([{ field: 'destino.cuenta_id', message: 'El destino debe ser otra cuenta', rule: 'distinta' }])
    }
    if (origen.cuenta.empresa_id !== destino.cuenta.empresa_id) {
        return regla422('cuenta_de_otra_empresa', 'Empresa distinta', 'Solo se traslada entre cuentas de la misma empresa', [{ field: 'destino.cuenta_id', message: 'La cuenta es de otra empresa', rule: 'cuenta_de_otra_empresa' }])
    }
    if (bd.traslados.some(t => t.cuenta_origen_id === origen.cuenta?.cuenta_id && t.referencia === referencia)) {
        return conflicto('traslado_duplicado', 'Traslado duplicado', `La referencia ${referencia} ya se usó en ${origen.cuenta.codigo}`)
    }
    const traslado: Schema<'Traslado'> = {
        id: siguienteId(bd.traslados),
        empresa_id: origen.cuenta.empresa_id,
        cuenta_origen_id: origen.cuenta.cuenta_id,
        cuenta_origen_codigo: origen.cuenta.codigo,
        cuenta_destino_id: destino.cuenta.cuenta_id,
        cuenta_destino_codigo: destino.cuenta.codigo,
        monto: new Decimal(cuerpo.monto).toFixed(2),
        fecha: fecha.fecha,
        referencia,
        estado: 'en_transito',
        acreditado_en: null,
        registrado_por: usuarioDe(solicitud),
        created_at: ahora(),
    }
    bd.traslados.push(traslado)
    // La salida del origen es un movimiento del libro en esa cuenta.
    bd.movimientosBanco.push({ movimiento_id: siguienteMovimientoBanco(), asiento_id: 0, origen_tipo: 'traslado', origen_id: traslado.id, fecha: traslado.fecha, descripcion: `Traslado ${traslado.id} (${referencia}) a ${destino.cuenta.codigo}`, monto: `-${traslado.monto}`, cuenta_id: origen.cuenta.cuenta_id, empresa_id: traslado.empresa_id })
    registrarAccion(solicitud, 'bancos.trasladar', { tipo: 'traslado', id: traslado.id }, cuerpo)
    return { status: 201, cuerpo: traslado }
}

function porEstado<T extends { estado: string, id: number }>(filas: T[], solicitud: SolicitudFixture): RespuestaFixture {
    const estado = solicitud.query.get('estado')
    if (estado && estado !== 'en_transito' && estado !== 'acreditado') {
        return invalido([{ field: 'estado', message: 'Estado inválido', rule: 'enum' }])
    }
    const lista = filas.filter(f => !estado || f.estado === estado).sort((a, b) => b.id - a.id)
    return { status: 200, cuerpo: paginar(lista, solicitud) }
}

function fondosEnTransito(solicitud: SolicitudFixture): Schema<'ResumenFondosEnTransito'>[] {
    const depositos = deLaEmpresa(bd.depositos, solicitud).filter(d => d.estado === 'en_transito')
    const traslados = deLaEmpresa(bd.traslados, solicitud).filter(t => t.estado === 'en_transito')
    const empresas = [...new Set([...depositos, ...traslados].map(f => f.empresa_id))].sort()
    return empresas.map((empresaId) => {
        const deps = depositos.filter(d => d.empresa_id === empresaId)
        const tras = traslados.filter(t => t.empresa_id === empresaId)
        const pendiente = [...deps, ...tras].reduce((s, f) => s.plus(f.monto), new Decimal(0)).toFixed(2)
        return { empresa_id: empresaId, saldo_libro: pendiente, pendiente, diferencia: '0.00', cuadra: true, depositos: deps.length, traslados: tras.length }
    })
}

/* Extractos y conciliación. */

function vigentes(): Conciliacion[] {
    return bd.conciliaciones.filter(c => !c.anulada)
}

function lineaConEstado(linea: LineaGuardada): Schema<'LineaExtracto'> {
    const conciliacion = vigentes().find(c => c.linea_id === linea.id)
    return { ...linea, conciliada: Boolean(conciliacion), conciliacion_id: conciliacion?.id ?? null, movimientos: conciliacion?.movimientos ?? [] }
}

function extractoConAvance(extracto: Schema<'Extracto'>): Schema<'Extracto'> {
    const lineas = bd.lineasExtracto.filter(l => l.extracto_id === extracto.id)
    return { ...extracto, lineas: lineas.length, conciliadas: lineas.filter(l => vigentes().some(c => c.linea_id === l.id)).length }
}

function conciliado(movimientoId: number): boolean {
    return vigentes().some(c => c.movimientos.some(m => m.movimiento_id === movimientoId))
}

function sinConciliar(cuentaId: number, hasta?: string | null): MovimientoBancoFixture[] {
    return bd.movimientosBanco.filter(m => m.cuenta_id === cuentaId && !conciliado(m.movimiento_id) && (!hasta || m.fecha <= hasta))
}

function aMovimientoSinConciliar(m: MovimientoBancoFixture): Schema<'MovimientoSinConciliar'> {
    return { movimiento_id: m.movimiento_id, asiento_id: m.asiento_id, origen_tipo: m.origen_tipo, origen_id: m.origen_id, fecha: m.fecha, descripcion: m.descripcion, monto: m.monto }
}

/** Como `ImportarExtracto` (A3): fechas en el rango, Σ = final − inicial, encadenado y sin duplicados. */
function importar(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores: Errores = []
    for (const campo of ['desde', 'hasta'] as const) {
        if (typeof cuerpo[campo] !== 'string' || !FECHA.test(String(cuerpo[campo]))) {
            errores.push({ field: campo, message: 'Fecha inválida', rule: 'date' })
        }
    }
    for (const campo of ['saldo_inicial', 'saldo_final'] as const) {
        if (typeof cuerpo[campo] !== 'string' || !MONTO_SIGNO.test(String(cuerpo[campo]))) {
            errores.push({ field: campo, message: 'Monto con signo y hasta 2 decimales', rule: 'regex' })
        }
    }
    const lineas = Array.isArray(cuerpo.lineas) ? cuerpo.lineas.map(l => (typeof l === 'object' && l !== null ? l as Record<string, unknown> : {})) : []
    if (!lineas.length) {
        errores.push({ field: 'lineas', message: 'El extracto necesita al menos una línea', rule: 'minLength' })
    }
    const desde = String(cuerpo.desde)
    const hasta = String(cuerpo.hasta)
    lineas.forEach((linea, indice) => {
        if (typeof linea.fecha !== 'string' || !FECHA.test(linea.fecha)) {
            errores.push({ field: `lineas.${indice}.fecha`, message: 'Fecha inválida', rule: 'date' })
        }
        else if (linea.fecha < desde || linea.fecha > hasta) {
            errores.push({ field: `lineas.${indice}.fecha`, message: `La fecha ${linea.fecha} está fuera del extracto (${desde} a ${hasta})`, rule: 'fuera_del_extracto' })
        }
        if (typeof linea.monto !== 'string' || !MONTO_SIGNO.test(linea.monto)) {
            errores.push({ field: `lineas.${indice}.monto`, message: 'Monto con signo y hasta 2 decimales', rule: 'regex' })
        }
        if (typeof linea.descripcion !== 'string' || !linea.descripcion.trim()) {
            errores.push({ field: `lineas.${indice}.descripcion`, message: 'El campo descripcion es obligatorio', rule: 'required' })
        }
    })
    if (errores.length) {
        return invalido(errores)
    }
    const banco = resolverCuenta(cuerpo, 'cuenta_id', true)
    if (!banco.ok || !banco.cuenta) {
        return banco.ok ? invalido([]) : banco.respuesta
    }
    const cuenta = banco.cuenta
    const suma = lineas.reduce((s, l) => s.plus(String(l.monto)), new Decimal(0))
    const inicial = new Decimal(String(cuerpo.saldo_inicial))
    const final = new Decimal(String(cuerpo.saldo_final))
    if (!suma.equals(final.minus(inicial))) {
        return regla422('extracto_descuadrado', 'Extracto descuadrado', `Σ líneas (Q${suma.toFixed(2)}) ≠ saldo final − saldo inicial (Q${final.minus(inicial).toFixed(2)})`, [{ field: 'saldo_final', message: `Σ líneas = Q${suma.toFixed(2)}`, rule: 'extracto_descuadrado' }])
    }
    const anterior = bd.extractos.filter(e => e.cuenta_id === cuenta.cuenta_id).sort((a, b) => b.id - a.id)[0]
    const motivo = typeof cuerpo.motivo_no_encadena === 'string' ? cuerpo.motivo_no_encadena.trim() : ''
    if (anterior && !new Decimal(anterior.saldo_final).equals(inicial) && motivo.length < 3) {
        return regla422('extracto_no_encadena', 'El extracto no encadena', `El saldo inicial (Q${inicial.toFixed(2)}) no es el final del extracto ${anterior.id} (Q${new Decimal(anterior.saldo_final).toFixed(2)}); indica motivo_no_encadena para forzarlo`, [{ field: 'saldo_inicial', message: `Se esperaba Q${new Decimal(anterior.saldo_final).toFixed(2)}`, rule: 'extracto_no_encadena' }])
    }
    const veces = new Map<string, number>()
    const nuevas = lineas.map((l) => {
        const base = { fecha: String(l.fecha), monto: new Decimal(String(l.monto)).toFixed(2), referencia: typeof l.referencia === 'string' && l.referencia.trim() ? l.referencia.trim() : null, descripcion: String(l.descripcion).trim() }
        const clave = huellaDe(base, 0)
        const vez = (veces.get(clave) ?? 0) + 1
        veces.set(clave, vez)
        return { ...base, saldo: typeof l.saldo === 'string' ? l.saldo : null, huella: huellaDe(base, vez) }
    })
    const repetidas: Errores = []
    nuevas.forEach((linea, indice) => {
        const ya = bd.lineasExtracto.find(l => l.cuenta_id === cuenta.cuenta_id && l.huella === linea.huella)
        if (ya) {
            repetidas.push({ field: `lineas.${indice}`, message: `Ya importada (línea ${ya.orden} del extracto ${ya.extracto_id})`, rule: 'extracto_duplicado' })
        }
    })
    if (repetidas.length) {
        return conflicto('extracto_duplicado', 'Líneas ya importadas', `${repetidas.length} línea(s) ya están importadas en ${cuenta.codigo}`, repetidas)
    }
    const id = siguienteId(bd.extractos)
    const extracto: Schema<'Extracto'> = {
        id,
        empresa_id: cuenta.empresa_id,
        cuenta_id: cuenta.cuenta_id,
        cuenta_codigo: cuenta.codigo,
        cuenta_nombre: cuenta.nombre,
        cuenta_bancaria_id: cuenta.cuenta_bancaria_id,
        desde,
        hasta,
        saldo_inicial: inicial.toFixed(2),
        saldo_final: final.toFixed(2),
        archivo: typeof cuerpo.archivo === 'string' ? cuerpo.archivo : null,
        sha256: typeof cuerpo.sha256 === 'string' ? cuerpo.sha256 : null,
        motivo_no_encadena: motivo || null,
        lineas: nuevas.length,
        conciliadas: 0,
        importado_por: usuarioDe(solicitud),
        created_at: ahora(),
    }
    bd.extractos.push(extracto)
    const primera = siguienteId(bd.lineasExtracto)
    nuevas.forEach((linea, indice) => {
        bd.lineasExtracto.push({ id: primera + indice, extracto_id: id, empresa_id: cuenta.empresa_id, cuenta_id: cuenta.cuenta_id, orden: indice + 1, ...linea })
    })
    registrarAccion(solicitud, 'bancos.importar_extracto', { tipo: 'extracto', id }, { ...cuerpo, lineas: nuevas.length })
    return { status: 201, cuerpo: extracto }
}

function nuevaConciliacion(linea: LineaGuardada, movimientos: MovimientoBancoFixture[], reglaId: number | null, solicitud: SolicitudFixture): Conciliacion {
    const id = siguienteId(bd.conciliaciones)
    const conciliacion: Conciliacion = {
        id,
        grupo: crypto.randomUUID(),
        empresa_id: linea.empresa_id,
        cuenta_id: linea.cuenta_id,
        linea_id: linea.id,
        monto: movimientos.reduce((s, m) => s.plus(m.monto), new Decimal(0)).toFixed(2),
        regla_id: reglaId,
        creado_por: usuarioDe(solicitud),
        created_at: ahora(),
        anulada: false,
        motivo_anulacion: null,
        movimientos: movimientos.map(m => ({ conciliacion_id: id, movimiento_id: m.movimiento_id, asiento_id: m.asiento_id, origen_tipo: m.origen_tipo, origen_id: m.origen_id, fecha: m.fecha, descripcion: m.descripcion, monto: m.monto })),
    }
    bd.conciliaciones.push(conciliacion)
    return conciliacion
}

/** Asiento nuevo de una línea sin documento (origen `banco`), como `RegistrarDesdeExtracto`. */
function registrarLinea(linea: LineaGuardada, cuentaCodigo: string | null, descripcion: string | null, reglaId: number | null, solicitud: SolicitudFixture): RespuestaFixture | Conciliacion {
    const abono = new Decimal(linea.monto).gt(0)
    if (abono && !cuentaCodigo) {
        return invalido([{ field: 'cuenta', message: 'Un abono del banco necesita su contrapartida (interés, otro ingreso…)', rule: 'required' }])
    }
    const codigo = cuentaCodigo ?? '5.3.07'
    if (!bd.cuentas.some(c => c.codigo === codigo && c.imputable)) {
        return invalido([{ field: 'cuenta', message: `La cuenta ${codigo} no existe o no es imputable`, rule: 'exists' }])
    }
    const movimiento: MovimientoBancoFixture = { movimiento_id: siguienteMovimientoBanco(), asiento_id: siguienteId(bd.asientos), origen_tipo: 'banco', origen_id: linea.id, fecha: linea.fecha, descripcion: descripcion?.trim() || linea.descripcion, monto: linea.monto, cuenta_id: linea.cuenta_id, empresa_id: linea.empresa_id }
    bd.movimientosBanco.push(movimiento)
    return nuevaConciliacion(linea, [movimiento], reglaId, solicitud)
}

/** Llegada de un depósito o traslado al banco (asiento nuevo `Banco / 1.1.11`). */
function llegada(tipo: 'deposito' | 'traslado', documento: Schema<'Deposito'> | Schema<'Traslado'>, linea: LineaGuardada): MovimientoBancoFixture {
    const movimiento: MovimientoBancoFixture = {
        movimiento_id: siguienteMovimientoBanco(),
        asiento_id: siguienteId(bd.asientos),
        origen_tipo: tipo,
        origen_id: documento.id,
        fecha: linea.fecha,
        descripcion: `Llegada al banco del ${tipo === 'deposito' ? 'depósito' : 'traslado'} ${documento.id} (línea ${linea.orden} del extracto)`,
        monto: documento.monto,
        cuenta_id: linea.cuenta_id,
        empresa_id: linea.empresa_id,
    }
    bd.movimientosBanco.push(movimiento)
    Object.assign(documento, { estado: 'acreditado', acreditado_en: ahora() })
    return movimiento
}

function conciliar(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const linea = bd.lineasExtracto.find(l => l.id === cuerpo.linea_id)
    if (!linea) {
        return invalido([{ field: 'linea_id', message: `La línea ${String(cuerpo.linea_id)} no existe`, rule: 'exists' }])
    }
    if (vigentes().some(c => c.linea_id === linea.id)) {
        return conflicto('linea_conciliada', 'Línea conciliada', `La línea ${linea.id} ya está conciliada`)
    }
    const lista = (valor: unknown): number[] => (Array.isArray(valor) ? valor.filter((v): v is number => typeof v === 'number') : [])
    const idsMov = lista(cuerpo.movimientos)
    const idsDep = lista(cuerpo.depositos)
    const idsTra = lista(cuerpo.traslados)
    if (!idsMov.length && !idsDep.length && !idsTra.length) {
        return invalido([{ field: 'movimientos', message: 'Indica movimientos, depósitos o traslados', rule: 'required' }])
    }
    const movimientos: MovimientoBancoFixture[] = []
    for (const [indice, id] of idsMov.entries()) {
        const movimiento = bd.movimientosBanco.find(m => m.movimiento_id === id && m.cuenta_id === linea.cuenta_id)
        if (!movimiento) {
            return invalido([{ field: `movimientos.${indice}`, message: `El movimiento ${id} no es de la cuenta del extracto`, rule: 'exists' }])
        }
        if (conciliado(id)) {
            return conflicto('movimiento_conciliado', 'Movimiento conciliado', 'Un movimiento se concilia una sola vez', [{ field: `movimientos.${indice}`, message: `El movimiento ${id} ya está conciliado`, rule: 'movimiento_conciliado' }])
        }
        movimientos.push(movimiento)
    }
    const depositos = idsDep.map(id => bd.depositos.find(d => d.id === id && d.cuenta_id === linea.cuenta_id && d.estado === 'en_transito'))
    const traslados = idsTra.map(id => bd.traslados.find(t => t.id === id && t.cuenta_destino_id === linea.cuenta_id && t.estado === 'en_transito'))
    const faltaDep = depositos.findIndex(d => !d)
    if (faltaDep >= 0) {
        return invalido([{ field: `depositos.${faltaDep}`, message: `El depósito ${idsDep[faltaDep]} no está en tránsito hacia esta cuenta`, rule: 'exists' }])
    }
    const faltaTra = traslados.findIndex(t => !t)
    if (faltaTra >= 0) {
        return invalido([{ field: `traslados.${faltaTra}`, message: `El traslado ${idsTra[faltaTra]} no está en tránsito hacia esta cuenta`, rule: 'exists' }])
    }
    const suma = [...movimientos.map(m => m.monto), ...depositos.map(d => d?.monto ?? '0'), ...traslados.map(t => t?.monto ?? '0')].reduce((s, m) => s.plus(m), new Decimal(0))
    if (!suma.equals(linea.monto)) {
        return regla422('conciliacion_descuadrada', 'Conciliación descuadrada', `La línea es de Q${new Decimal(linea.monto).toFixed(2)} y lo elegido suma Q${suma.toFixed(2)}`, [{ field: 'linea_id', message: `Diferencia Q${new Decimal(linea.monto).minus(suma).toFixed(2)}`, rule: 'conciliacion_descuadrada' }])
    }
    const llegadas = [
        ...depositos.map(d => llegada('deposito', d as Schema<'Deposito'>, linea)),
        ...traslados.map(t => llegada('traslado', t as Schema<'Traslado'>, linea)),
    ]
    const conciliacion = nuevaConciliacion(linea, [...movimientos, ...llegadas], null, solicitud)
    registrarAccion(solicitud, 'bancos.conciliar', { tipo: 'conciliacion', id: conciliacion.id }, cuerpo)
    return { status: 201, cuerpo: conciliacion }
}

function coincide(regla: Schema<'ReglaConciliacion'>, linea: LineaGuardada): boolean {
    if (!regla.activa || (regla.cuenta_id !== null && regla.cuenta_id !== linea.cuenta_id)) {
        return false
    }
    const monto = new Decimal(linea.monto)
    if ((regla.monto_min !== null && monto.lt(regla.monto_min)) || (regla.monto_max !== null && monto.gt(regla.monto_max))) {
        return false
    }
    if (regla.tipo_condicion === 'contiene') {
        return linea.descripcion.toLowerCase().includes(regla.patron.toLowerCase())
    }
    try {
        return new RegExp(regla.patron).test(linea.descripcion)
    }
    catch {
        return false
    }
}

function aplicarReglas(solicitud: SolicitudFixture): RespuestaFixture {
    const extracto = bd.extractos.find(e => e.id === idDe(solicitud))
    if (!extracto) {
        return noEncontrado('el extracto')
    }
    const reglas = bd.reglasConciliacion.filter(r => r.empresa_id === extracto.empresa_id).sort((a, b) => a.prioridad - b.prioridad || a.id - b.id)
    const resultado: Schema<'ResultadoAplicarReglas'> = { extracto_id: extracto.id, conciliadas: [], sin_pago: [], sin_regla: [] }
    for (const linea of bd.lineasExtracto.filter(l => l.extracto_id === extracto.id && !vigentes().some(c => c.linea_id === l.id))) {
        const regla = reglas.find(r => coincide(r, linea))
        if (!regla) {
            resultado.sin_regla.push(linea.id)
            continue
        }
        if (regla.accion === 'contrapartida') {
            const hecho = registrarLinea(linea, regla.contrapartida, null, regla.id, solicitud)
            if ('linea_id' in hecho) {
                resultado.conciliadas.push({ linea_id: linea.id, regla_id: regla.id, accion: 'contrapartida', conciliacion_id: hecho.id })
            }
            continue
        }
        const candidatos = sinConciliar(linea.cuenta_id).filter(m => m.origen_tipo === 'pago' && new Decimal(m.monto).equals(linea.monto) && linea.referencia && m.descripcion.includes(linea.referencia))
        const [unico] = candidatos
        if (candidatos.length !== 1 || !unico) {
            resultado.sin_pago.push(linea.id)
            continue
        }
        const conciliacion = nuevaConciliacion(linea, [unico], regla.id, solicitud)
        resultado.conciliadas.push({ linea_id: linea.id, regla_id: regla.id, accion: 'cliente', conciliacion_id: conciliacion.id })
    }
    registrarAccion(solicitud, 'bancos.aplicar_reglas', { tipo: 'extracto', id: extracto.id }, {})
    return { status: 200, cuerpo: resultado }
}

/* Reglas. */

function validarRegla(cuerpo: Record<string, unknown>): Errores {
    const errores: Errores = []
    const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
    if (nombre.length < 2 || nombre.length > 80) {
        errores.push({ field: 'nombre', message: 'El campo nombre debe tener al menos 2 caracteres', rule: 'minLength' })
    }
    if (cuerpo.tipo_condicion !== 'contiene' && cuerpo.tipo_condicion !== 'regex') {
        errores.push({ field: 'tipo_condicion', message: 'Condición inválida', rule: 'enum' })
    }
    const patron = typeof cuerpo.patron === 'string' ? cuerpo.patron.trim() : ''
    if (!patron) {
        errores.push({ field: 'patron', message: 'El campo patron es obligatorio', rule: 'required' })
    }
    if (cuerpo.tipo_condicion === 'regex' && patron) {
        try {
            new RegExp(patron)
        }
        catch {
            errores.push({ field: 'patron', message: 'La expresión regular no es válida', rule: 'regex' })
        }
    }
    if (cuerpo.accion !== 'contrapartida' && cuerpo.accion !== 'cliente') {
        errores.push({ field: 'accion', message: 'Acción inválida', rule: 'enum' })
    }
    if (cuerpo.accion === 'contrapartida') {
        const codigo = typeof cuerpo.contrapartida === 'string' ? cuerpo.contrapartida.trim() : ''
        if (!bd.cuentas.some(c => c.codigo === codigo && c.imputable)) {
            errores.push({ field: 'contrapartida', message: codigo ? `La cuenta ${codigo} no existe o no es imputable` : 'La acción contrapartida necesita su cuenta', rule: codigo ? 'exists' : 'required' })
        }
    }
    return errores
}

function datosRegla(cuerpo: Record<string, unknown>): Pick<Schema<'ReglaConciliacion'>, 'nombre' | 'cuenta_id' | 'tipo_condicion' | 'patron' | 'monto_min' | 'monto_max' | 'accion' | 'contrapartida' | 'contrapartida_cuenta_id' | 'prioridad' | 'activa'> {
    const contrapartida = cuerpo.accion === 'contrapartida' && typeof cuerpo.contrapartida === 'string' ? cuerpo.contrapartida.trim() : null
    return {
        nombre: String(cuerpo.nombre).trim(),
        cuenta_id: typeof cuerpo.cuenta_id === 'number' ? cuerpo.cuenta_id : null,
        tipo_condicion: cuerpo.tipo_condicion === 'regex' ? 'regex' : 'contiene',
        patron: String(cuerpo.patron).trim(),
        monto_min: typeof cuerpo.monto_min === 'string' ? cuerpo.monto_min : null,
        monto_max: typeof cuerpo.monto_max === 'string' ? cuerpo.monto_max : null,
        accion: cuerpo.accion === 'cliente' ? 'cliente' : 'contrapartida',
        contrapartida,
        contrapartida_cuenta_id: contrapartida ? bd.cuentas.find(c => c.codigo === contrapartida)?.id ?? null : null,
        prioridad: typeof cuerpo.prioridad === 'number' ? cuerpo.prioridad : 100,
        activa: cuerpo.activa !== false,
    }
}

/* Reporte. */

function reporte(solicitud: SolicitudFixture): RespuestaFixture {
    const cuentaId = numeroQuery(solicitud, 'cuenta_id')
    const fecha = solicitud.query.get('fecha') || hoy()
    if (!FECHA.test(fecha)) {
        return invalido([{ field: 'fecha', message: 'Fecha inválida', rule: 'date' }])
    }
    const empresas = deLaEmpresa(cuentasBancoFixture(), solicitud).map(c => c.empresa_id)
    const cuentas = cuentasBancoFixture()
        .filter(c => empresas.includes(c.empresa_id))
        .filter(c => cuentaId === undefined || c.cuenta_id === cuentaId)
        .filter(c => cuentaId !== undefined || bd.extractos.some(e => e.cuenta_id === c.cuenta_id) || bd.movimientosBanco.some(m => m.cuenta_id === c.cuenta_id))
    const filas: Schema<'ResumenConciliacionBancaria'>[] = cuentas.map((cuenta) => {
        const extractosCuenta = bd.extractos.filter(e => e.cuenta_id === cuenta.cuenta_id).sort((a, b) => a.desde.localeCompare(b.desde))
        const primero = extractosCuenta[0]
        const movimientos = bd.movimientosBanco.filter(m => m.cuenta_id === cuenta.cuenta_id && m.fecha <= fecha)
        const saldoLibro = movimientos.reduce((s, m) => s.plus(m.monto), new Decimal(0))
        const lineas = bd.lineasExtracto.filter(l => l.cuenta_id === cuenta.cuenta_id && l.fecha <= fecha)
        const contadas = vigentes().filter(c => c.cuenta_id === cuenta.cuenta_id && c.movimientos.every(m => m.fecha <= fecha))
        const lineaContada = (id: number) => contadas.some(c => c.linea_id === id && (lineas.find(l => l.id === id)?.fecha ?? '9999') <= fecha)
        const movimientoContado = (id: number) => contadas.some(c => c.movimientos.some(m => m.movimiento_id === id) && (bd.lineasExtracto.find(l => l.id === c.linea_id)?.fecha ?? '9999') <= fecha)
        const desde = primero?.desde ?? null
        const apertura = desde ? movimientos.filter(m => m.fecha < desde).reduce((s, m) => s.plus(m.monto), new Decimal(0)) : new Decimal(0)
        const libroTransito = movimientos.filter(m => (!desde || m.fecha >= desde) && !movimientoContado(m.movimiento_id))
        const extractoTransito = lineas.filter(l => !lineaContada(l.id))
        const saldoExtracto = primero ? lineas.reduce((s, l) => s.plus(l.monto), new Decimal(primero.saldo_inicial)) : null
        const totalLibro = libroTransito.reduce((s, m) => s.plus(m.monto), new Decimal(0))
        const totalExtracto = extractoTransito.reduce((s, l) => s.plus(l.monto), new Decimal(0))
        const diferencia = saldoExtracto ? saldoExtracto.minus(saldoLibro.minus(totalLibro).plus(totalExtracto)) : new Decimal(0)
        return {
            empresa_id: cuenta.empresa_id,
            cuenta_id: cuenta.cuenta_id,
            cuenta_codigo: cuenta.codigo,
            cuenta_nombre: cuenta.nombre,
            fecha,
            saldo_libro: saldoLibro.toFixed(2),
            saldo_extracto: saldoExtracto?.toFixed(2) ?? null,
            desde,
            diferencia_apertura: primero ? new Decimal(primero.saldo_inicial).minus(apertura).toFixed(2) : '0.00',
            libro_en_transito: libroTransito.map(m => ({ id: m.movimiento_id, fecha: m.fecha, descripcion: m.descripcion, monto: m.monto })),
            total_libro_en_transito: totalLibro.toFixed(2),
            extracto_en_transito: extractoTransito.map(l => ({ id: l.id, fecha: l.fecha, descripcion: l.descripcion, monto: l.monto })),
            total_extracto_en_transito: totalExtracto.toFixed(2),
            diferencia: diferencia.toFixed(2),
            cuadra: diferencia.isZero(),
        }
    })
    return { status: 200, cuerpo: filas }
}

export const rutasConciliacion: RutasFixture = {
    'POST /api/v1/cajas/:id/depositar': conPermiso('cajas.depositar', conIdempotencia(depositar)),
    'GET /api/v1/bancos/depositos': conPermiso('bancos.ver', solicitud => porEstado(deLaEmpresa(bd.depositos, solicitud), solicitud)),
    'GET /api/v1/bancos/traslados': conPermiso('bancos.ver', solicitud => porEstado(deLaEmpresa(bd.traslados, solicitud), solicitud)),
    'GET /api/v1/bancos/fondos-en-transito': conPermiso('bancos.ver', solicitud => ({ status: 200, cuerpo: fondosEnTransito(solicitud) })),
    'POST /api/v1/bancos/trasladar': conPermiso('bancos.trasladar', conIdempotencia(trasladar)),

    'GET /api/v1/bancos/extractos': conPermiso('bancos.ver', (solicitud) => {
        const cuenta = numeroQuery(solicitud, 'cuenta_id')
        const filas = deLaEmpresa(bd.extractos, solicitud).filter(e => cuenta === undefined || e.cuenta_id === cuenta).sort((a, b) => b.id - a.id).map(extractoConAvance)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
    'POST /api/v1/bancos/extractos': conPermiso('bancos.importar_extracto', conIdempotencia(importar)),
    'GET /api/v1/bancos/extractos/:id': conPermiso('bancos.ver', (solicitud) => {
        const extracto = bd.extractos.find(e => e.id === idDe(solicitud))
        return extracto ? { status: 200, cuerpo: extractoConAvance(extracto) } : noEncontrado('el extracto')
    }),
    'GET /api/v1/bancos/extractos/:id/lineas': conPermiso('bancos.ver', (solicitud) => {
        const extracto = bd.extractos.find(e => e.id === idDe(solicitud))
        if (!extracto) {
            return noEncontrado('el extracto')
        }
        return { status: 200, cuerpo: bd.lineasExtracto.filter(l => l.extracto_id === extracto.id).sort((a, b) => a.orden - b.orden).map(lineaConEstado) }
    }),
    'POST /api/v1/bancos/extractos/:id/aplicar-reglas': conPermiso('bancos.conciliar', conIdempotencia(aplicarReglas)),
    'POST /api/v1/bancos/extractos/lineas/:id/registrar': conPermiso('bancos.conciliar', conIdempotencia((solicitud) => {
        const linea = bd.lineasExtracto.find(l => l.id === idDe(solicitud))
        if (!linea) {
            return noEncontrado('la línea del extracto')
        }
        if (vigentes().some(c => c.linea_id === linea.id)) {
            return conflicto('linea_conciliada', 'Línea conciliada', `La línea ${linea.id} ya está conciliada`)
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const cuenta = typeof cuerpo.cuenta === 'string' && cuerpo.cuenta.trim() ? cuerpo.cuenta.trim() : null
        const descripcion = typeof cuerpo.descripcion === 'string' ? cuerpo.descripcion : null
        const hecho = registrarLinea(linea, cuenta, descripcion, null, solicitud)
        if (!('linea_id' in hecho)) {
            return hecho
        }
        registrarAccion(solicitud, 'bancos.registrar_desde_extracto', { tipo: 'conciliacion', id: hecho.id }, cuerpo)
        return { status: 201, cuerpo: hecho }
    })),
    'GET /api/v1/bancos/movimientos-sin-conciliar': conPermiso('bancos.ver', (solicitud) => {
        const cuenta = numeroQuery(solicitud, 'cuenta_id')
        if (cuenta === undefined) {
            return invalido([{ field: 'cuenta_id', message: 'El campo cuenta_id es obligatorio', rule: 'required' }])
        }
        return { status: 200, cuerpo: sinConciliar(cuenta, solicitud.query.get('hasta')).map(aMovimientoSinConciliar) }
    }),
    'POST /api/v1/bancos/conciliaciones': conPermiso('bancos.conciliar', conIdempotencia(conciliar)),
    'POST /api/v1/bancos/conciliaciones/:id/anular': conPermiso('bancos.conciliar', conIdempotencia((solicitud) => {
        const conciliacion = bd.conciliaciones.find(c => c.id === idDe(solicitud))
        if (!conciliacion) {
            return noEncontrado('la conciliación')
        }
        const motivo = String(cuerpoObjeto(solicitud).motivo ?? '').trim()
        if (motivo.length < 3) {
            return invalido([{ field: 'motivo', message: 'El motivo lleva al menos 3 caracteres', rule: 'minLength' }])
        }
        if (conciliacion.anulada) {
            return conflicto('conciliacion_anulada', 'Conciliación anulada', `La conciliación ${conciliacion.id} ya está anulada`)
        }
        Object.assign(conciliacion, { anulada: true, motivo_anulacion: motivo })
        registrarAccion(solicitud, 'bancos.anular_conciliacion', { tipo: 'conciliacion', id: conciliacion.id }, { motivo })
        return { status: 200, cuerpo: conciliacion }
    })),

    'GET /api/v1/bancos/reglas': conPermiso('bancos.ver', solicitud => ({ status: 200, cuerpo: deLaEmpresa(bd.reglasConciliacion, solicitud) })),
    'POST /api/v1/bancos/reglas': conPermiso('bancos.conciliar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = validarRegla(cuerpo)
        if (errores.length) {
            return invalido(errores)
        }
        const momento = ahora()
        const regla: Schema<'ReglaConciliacion'> = { id: siguienteId(bd.reglasConciliacion), empresa_id: typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1), ...datosRegla(cuerpo), version: 1, created_at: momento, updated_at: momento }
        bd.reglasConciliacion.push(regla)
        registrarAccion(solicitud, 'bancos.crear_regla', { tipo: 'regla_conciliacion', id: regla.id }, cuerpo)
        return { status: 201, cuerpo: regla }
    })),
    'PUT /api/v1/bancos/reglas/:id': conPermiso('bancos.conciliar', conIdempotencia((solicitud) => {
        const regla = bd.reglasConciliacion.find(r => r.id === idDe(solicitud))
        if (!regla) {
            return noEncontrado('la regla')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== regla.version) {
            return versionCambiada()
        }
        const errores = validarRegla(cuerpo)
        if (errores.length) {
            return invalido(errores)
        }
        Object.assign(regla, datosRegla(cuerpo), { version: regla.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'bancos.editar_regla', { tipo: 'regla_conciliacion', id: regla.id }, cuerpo)
        return { status: 200, cuerpo: regla }
    })),

    'GET /api/v1/reportes/conciliacion-bancaria': conPermiso('reportes.ver', reporte),
}
