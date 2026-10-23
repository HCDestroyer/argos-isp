import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { hoyGuatemala } from '~/utils/cobro'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, empresasDeLista, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { ncreSinCertificar } from '../fel/rutas'
import { calculosDinamicos, verificarYExigir } from '../libro/checks'
import { bancosLibro } from '../libro/datos'
import { calcularTotales, finDeMes, formularioDe, hashDatos, parametrosDe, rangoPeriodo, type Declaracion, type Remanentes } from './datos'
import { isrAnual, isrTrimestral, RESULTADOS, retenciones } from './renta'

/**
 * Rutas de las declaraciones (A3, fase 7 PR B y C; `start/routes/declaraciones.ts` y las acciones
 * `declaraciones.calcular`, `.revisar`, `.presentar`, `.pagar`, `.anular_pago` y `.ajustar`), con sus
 * reglas y en su orden: periodo `AAAA-MM`, `AAAA-Tn` o `AAAA` según el impuesto, versiones de solo
 * inserción (la anterior pasa a `sustituida`), sustitutiva obligatoria tras revisar, `datos_hash` contra
 * los datos de hoy (409 `declaracion_desactualizada`). La revisión según el impuesto: IVA y PC con NCRE,
 * `iva_cuadrado`, liquidación, bloqueo y la cascada de remanentes (H34); retenciones con
 * `retenciones_cuadradas` y bloqueo, sin asiento; ISR e ISO con liquidación, sin checks ni bloqueo; ISR
 * anual sin asiento. Mora y multa del pago tardío; un pago se anula (reverso) y se puede registrar otro.
 * Los asientos no se guardan: solo su número. Los libros del fixture empiezan en enero de 2025 (antes:
 * 422 `antes_de_inicio_libros`).
 */

type Errores = NonNullable<Problem['errors']>
type Impuesto = Declaracion['impuesto']
type Ajuste = Schema<'AjusteFiscal'>

const PERIODO = /^\d{4}(-(0[1-9]|1[0-2])|-T[1-4])?$/
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const IMPUESTOS: readonly Impuesto[] = ['iva_mensual', 'pc_mensual', 'isr_opcional_mensual', 'isr_trimestral', 'iso_trimestral', 'isr_anual', 'retenciones_iva', 'retenciones_isr']
const ESTADOS: readonly Declaracion['estado'][] = ['borrador', 'revisada', 'presentada', 'sustituida']
const INICIO_LIBROS = '2025-01-01'
/** `mora_tributaria` (por ciento diario) y `multa_declaracion_tardia` del paquete. */
const MORA_DIARIA = '0.05'
const MULTA = { por_dia: '50.00', maximo: '1000.00' }

const esImpuesto = (valor: unknown): valor is Impuesto => typeof valor === 'string' && (IMPUESTOS as readonly string[]).includes(valor)
const esIvaOPc = (impuesto: Impuesto): impuesto is 'iva_mensual' | 'pc_mensual' => impuesto === 'iva_mensual' || impuesto === 'pc_mensual'

/** Primer día del periodo de un filtro (`AAAA-MM`, `AAAA-Tn`, `AAAA`). */
function primerDia(periodo: string): string {
    const trimestre = /^(\d{4})-T([1-4])$/.exec(periodo)
    if (trimestre) {
        return `${trimestre[1]}-${String((Number(trimestre[2]) - 1) * 3 + 1).padStart(2, '0')}-01`
    }
    return /^\d{4}$/.test(periodo) ? `${periodo}-01-01` : `${periodo}-01`
}

function mesAnterior(desde: string): string {
    const [anio = 0, mes = 0] = desde.split('-').map(Number)
    return new Date(Date.UTC(anio, mes - 2, 1)).toISOString().slice(0, 10)
}

function mesSiguiente(desde: string): string {
    const [anio = 0, mes = 0] = desde.split('-').map(Number)
    return new Date(Date.UTC(anio, mes, 1)).toISOString().slice(0, 10)
}

function versiones(empresaId: number, impuesto: string, desde: string): Declaracion[] {
    return bd.declaraciones.filter(d => d.empresa_id === empresaId && d.impuesto === impuesto && d.periodo_desde === desde).sort((a, b) => a.version - b.version)
}

function ultima(empresaId: number, impuesto: string, desde: string): Declaracion | null {
    return versiones(empresaId, impuesto, desde).at(-1) ?? null
}

/** `remanentesAnteriores`: la última versión revisada del mes anterior. */
function remanentes(empresaId: number, impuesto: Impuesto, desde: string): Remanentes {
    const fila = versiones(empresaId, impuesto, mesAnterior(desde)).filter(d => d.revisada_en !== null).at(-1)
    return fila
        ? { credito: new Decimal(fila.totales.remanente_credito ?? '0'), retenciones: new Decimal(fila.totales.remanente_retenciones ?? '0'), id: fila.id }
        : { credito: new Decimal(0), retenciones: new Decimal(0), id: null }
}

/** Libros de ventas y compras emitidos con folio que cubren el periodo. */
function librosDelPeriodo(empresaId: number, desde: string, hasta: string): Schema<'LibroEnlazado'>[] {
    return bd.librosEmisiones
        .filter(e => e.empresa_id === empresaId && (e.libro === 'ventas' || e.libro === 'compras') && e.desde <= desde && e.hasta >= hasta)
        .map(e => ({
            emision_id: e.id,
            libro: e.libro === 'compras' ? 'compras' : 'ventas',
            desde: e.desde,
            hasta: e.hasta,
            folio_inicial: e.folio_inicial,
            folio_final: e.folio_final,
            sha256: e.sha256,
            iva: typeof e.totales.iva === 'string' ? e.totales.iva : null,
            mismo_periodo: e.desde === desde && e.hasta === hasta,
        }))
}

/** Renglones de los meses del rango (`DatosMes`). */
function datosDelRango(empresaId: number, desde: string, hasta: string) {
    return bd.datosDeclaraciones.filter(d => d.empresa_id === empresaId && `${d.periodo}-01` >= desde && `${d.periodo}-01` <= hasta)
}

/** El ejercicio del año tiene cierre vigente (`ejercicioCerrado`). */
export function ejercicioCerrado(empresaId: number, anio: number): boolean {
    const ultimo = bd.ejercicios.filter(e => e.empresa_id === empresaId && e.anio === anio).sort((a, b) => b.id - a.id)[0]
    return ultimo?.estado === 'cerrado'
}

/** Ajustes fiscales vigentes (no anulados ni anulación) de un año y trimestre (null = anuales). */
function ajustesVigentes(empresaId: number, anio: number, trimestre: number | null): Ajuste[] {
    return bd.ajustesFiscales.filter(a => a.empresa_id === empresaId && a.anio === anio && a.trimestre === trimestre && a.anula_a === null && a.anulado_por_ajuste === null)
}

type Calculado = Pick<Declaracion, 'parametros' | 'detalle' | 'totales' | 'datos_hash'>

/** `calcularDatos` con los datos de hoy del periodo, según el impuesto; un 422 si la regla no se puede aplicar. */
export function calcularDatos(empresaId: number, impuesto: Impuesto, desde: string, hasta: string): Calculado | RespuestaFixture {
    const parametros = parametrosDe(impuesto)
    if (esIvaOPc(impuesto)) {
        const renglones = bd.datosDeclaraciones.find(d => d.empresa_id === empresaId && `${d.periodo}-01` === desde)?.renglones ?? []
        const anterior = remanentes(empresaId, impuesto, desde)
        const totales = calcularTotales(impuesto, renglones, anterior)
        return {
            parametros,
            detalle: { renglones: structuredClone(renglones), libros: librosDelPeriodo(empresaId, desde, hasta), anterior_id: anterior.id },
            totales,
            datos_hash: hashDatos(renglones, totales, parametros, anterior.id),
        }
    }
    if (impuesto === 'iso_trimestral') {
        return problemaTipado(422, 'parametro_sin_confirmar', 'Parámetro sin confirmar', `El parámetro iso_base_periodo no tiene valor vigente al ${hasta}; debe confirmarlo el contador`, [{ field: 'iso_base_periodo', message: `Sin valor vigente al ${hasta}`, rule: 'parametro_sin_confirmar' }])
    }
    let renglones: Schema<'RenglonDeclaracion'>[] = []
    let resultado
    if (impuesto === 'retenciones_iva' || impuesto === 'retenciones_isr') {
        const codigo = impuesto === 'retenciones_iva' ? 'RET_IVA_EMI' : 'RET_ISR_EMI'
        renglones = datosDelRango(empresaId, desde, hasta).flatMap(d => d.emitidas ?? []).filter(r => r.tipo === codigo)
        resultado = retenciones(impuesto === 'retenciones_iva' ? 'iva' : 'isr', renglones)
    }
    else if (impuesto === 'isr_trimestral' || impuesto === 'isr_opcional_mensual') {
        renglones = datosDelRango(empresaId, desde, hasta).flatMap(d => d.renglones).filter(r => r.seccion === 'ventas')
        resultado = isrTrimestral(renglones)
    }
    else {
        const anio = Number(desde.slice(0, 4))
        const trimestrales = bd.declaraciones
            .filter(d => d.empresa_id === empresaId && d.impuesto === 'isr_trimestral' && d.periodo_desde.startsWith(`${anio}-`) && (d.estado === 'revisada' || d.estado === 'presentada'))
            .map(d => ({ declaracion_id: d.id, periodo_desde: d.periodo_desde, isr: d.totales.isr ?? '0.00' }))
        resultado = isrAnual(anio, RESULTADOS[`${empresaId}-${anio}`] ?? [], ajustesVigentes(empresaId, anio, null), trimestrales)
    }
    return {
        parametros,
        detalle: { renglones: structuredClone(renglones), libros: impuesto === 'isr_trimestral' ? librosDelPeriodo(empresaId, desde, hasta) : [], anterior_id: null, calculo: resultado.calculo, notas: resultado.notas },
        totales: resultado.totales,
        datos_hash: hashDatos(renglones, resultado.totales, parametros, null, resultado.calculo),
    }
}

export function desactualizada(d: Declaracion): boolean {
    const hoy = calcularDatos(d.empresa_id, d.impuesto, d.periodo_desde, d.periodo_hasta)
    return 'status' in hoy || hoy.datos_hash !== d.datos_hash
}

/** Obligación de IVA o de pequeño contribuyente del mes que aplica a la empresa, o `null`. */
function impuestoDelMes(empresaId: number, desde: string): 'iva_mensual' | 'pc_mensual' | null {
    const o = bd.obligacionesFiscales.find(x => x.empresa_id === empresaId && x.periodo_desde === desde && esImpuesto(x.impuesto) && esIvaOPc(x.impuesto) && x.estado !== 'no_aplica')
    return o && esIvaOPc(o.impuesto) ? o.impuesto : null
}

const resumen = (pares: [string, string][]) => pares.map(([k, v]) => `${k} ${v}`).join(' · ')

// Checks de impuestos (`CALCULOS.iva_cuadrado`, `iva_liquidado` y `retenciones_cuadradas` de `#ledger/checks`).
calculosDinamicos.iva_cuadrado = (empresaId, desde) => {
    const impuesto = impuestoDelMes(empresaId, desde)
    if (!impuesto) {
        return null
    }
    const calculado = calcularDatos(empresaId, impuesto, desde, finDeMes(desde.slice(0, 7)))
    if ('status' in calculado) {
        return null
    }
    const t = calculado.totales
    const esperado = impuesto === 'iva_mensual'
        ? resumen([['V_IVA', t.debito ?? '0.00'], ['C_IVA', t.credito ?? '0.00'], ['RET_IVA_REC', t.retenciones ?? '0.00']])
        : resumen([['ventas', t.ventas ?? '0.00'], ['RET_IVA_REC', t.retenciones ?? '0.00']])
    const borrador = ultima(empresaId, impuesto, desde)
    const alDia = borrador !== null && borrador.datos_hash === calculado.datos_hash
    return {
        esperado,
        obtenido: alDia ? esperado : `${esperado} · ${borrador ? 'borrador desactualizado' : 'sin borrador'}`,
        resultado: alDia ? 'ok' : 'anomalia',
        detalle: { impuesto, declaracion_id: borrador?.id ?? null, version: borrador?.version ?? null, borrador_al_dia: alDia, v_iva_sin_etiqueta: '0.00', libros_distintos: [] },
    }
}

calculosDinamicos.iva_liquidado = (empresaId, desde) => {
    const impuesto = impuestoDelMes(empresaId, desde)
    if (!impuesto) {
        return null
    }
    const revisada = versiones(empresaId, impuesto, desde).filter(d => d.revisada_en !== null).at(-1)
    if (!revisada) {
        return { esperado: 'liquidada', obtenido: 'sin liquidar', resultado: 'anomalia', detalle: { impuesto } }
    }
    const t = revisada.totales
    const esperado = impuesto === 'iva_mensual'
        ? resumen([['2.1.02', '0.00'], ['1.1.04', new Decimal(t.remanente_credito ?? '0').minus(t.remanente_credito_anterior ?? '0').toFixed(2)]])
        : resumen([['2.1.09', new Decimal(t.a_pagar ?? '0').negated().toFixed(2)]])
    return { esperado, obtenido: esperado, resultado: 'ok', detalle: { impuesto, declaracion_id: revisada.id, version: revisada.version } }
}

calculosDinamicos.retenciones_cuadradas = (empresaId, desde) => {
    const aplica = bd.obligacionesFiscales.some(x => x.empresa_id === empresaId && x.periodo_desde === desde && (x.impuesto === 'retenciones_iva' || x.impuesto === 'retenciones_isr') && x.estado !== 'no_aplica')
    if (!aplica) {
        return null
    }
    const emitidas = datosDelRango(empresaId, desde, desde).flatMap(d => d.emitidas ?? [])
    const suma = (codigo: string) => emitidas.filter(r => r.tipo === codigo).reduce((s, r) => s.plus(r.iva), new Decimal(0)).toFixed(2)
    const esperado = resumen([['RET_IVA_EMI', suma('RET_IVA_EMI')], ['RET_ISR_EMI', suma('RET_ISR_EMI')]])
    return { esperado, obtenido: esperado, resultado: 'ok', detalle: null }
}

function usuario(solicitud: SolicitudFixture) {
    return solicitud.token ? usuariosPorToken[solicitud.token] : undefined
}

/** `exigirAccesoEmpresa`: con una empresa activa (o sin alcance), solo las suyas. */
function declaracionDe(solicitud: SolicitudFixture): Declaracion | RespuestaFixture {
    const d = bd.declaraciones.find(x => x.id === idDe(solicitud))
    if (!d) {
        return noEncontrado('la declaración')
    }
    if (!deLaEmpresa([d], solicitud).length) {
        return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `La declaración ${d.id} es de otra empresa`)
    }
    return d
}

const conflicto = (codigo: string, titulo: string, detalle: string) => problemaTipado(409, codigo, titulo, detalle)
const regla = (codigo: string, detalle: string, errores?: Errores) => problemaTipado(422, codigo, 'Regla de negocio', detalle, errores)

function desactualizadaProblema(d: Declaracion): RespuestaFixture {
    return conflicto('declaracion_desactualizada', 'Declaración desactualizada', `Los libros o las constancias de ${d.periodo_desde.slice(0, 7)} cambiaron desde que se calculó la versión ${d.version}: calcule otra versión`)
}

/** La versión es la última del periodo (409 `declaracion_sustituida`). */
function exigirUltima(d: Declaracion): RespuestaFixture | null {
    const u = ultima(d.empresa_id, d.impuesto, d.periodo_desde)
    return u && u.id !== d.id ? conflicto('declaracion_sustituida', 'Declaración sustituida', `La versión ${d.version} fue sustituida`) : null
}

function actualizarObligacion(d: Declaracion, cambios: { estado?: 'borrador' | 'presentada' }) {
    const o = bd.obligacionesFiscales.find(x => x.id === d.obligacion_id)
    if (!o) {
        return
    }
    const nuevo = cambios.estado && o.estado !== cambios.estado ? cambios.estado : o.estado
    if (o.declaracion_id !== d.id || nuevo !== o.estado) {
        Object.assign(o, { declaracion_id: d.id, estado: nuevo, motivo_estado: nuevo === o.estado ? o.motivo_estado : null, version: o.version + 1, updated_at: ahora() })
    }
}

function vista(d: Declaracion): Schema<'DeclaracionDetalle'> {
    return { ...d, desactualizada: desactualizada(d) }
}

function dias(desde: string, hasta: string): number {
    return Math.max(0, Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000))
}

/** Datos de prueba: los libros del mes cambian después de calcular (la versión queda desactualizada); por defecto, una venta más. */
export function cambiarDatosDeclaracionFixture(empresaId: number, periodo: string, renglon: Schema<'RenglonDeclaracion'> = { seccion: 'ventas', origen: 'dte', documento: 'FACT A-1199', fecha: `${periodo}-28`, tipo: 'FACT', nit: 'CF', base: '250.00', iva: '30.00', total: '280.00', estado: 'certificado' }): void {
    const mes = bd.datosDeclaraciones.find(d => d.empresa_id === empresaId && d.periodo === periodo)
    if (mes) {
        mes.renglones.push(renglon)
    }
    else {
        bd.datosDeclaraciones.push({ empresa_id: empresaId, periodo, renglones: [renglon] })
    }
}

/** `CalcularDeclaracion`: versión nueva en borrador (la anterior pasa a sustituida). */
function calcularVersion(solicitud: SolicitudFixture, empresaId: number, impuesto: Impuesto, periodo: string, sustitutiva: boolean): Declaracion | RespuestaFixture {
    const rango = rangoPeriodo(impuesto, periodo)
    if (!rango) {
        const formato = impuesto === 'isr_anual' ? 'AAAA' : impuesto === 'isr_trimestral' || impuesto === 'iso_trimestral' ? 'AAAA-Tn (T1 a T4)' : 'AAAA-MM'
        return regla('periodo', `El periodo de ${impuesto} es ${formato}`, [{ field: 'periodo', message: `Formato ${formato}`, rule: 'periodo' }])
    }
    const { desde, hasta } = rango
    if (desde > hoyGuatemala()) {
        return datosInvalidos([{ field: 'periodo', message: 'El periodo no puede ser futuro', rule: 'futuro' }])
    }
    if (hasta < INICIO_LIBROS) {
        return regla('antes_de_inicio_libros', `El periodo ${periodo} es anterior a inicio_libros (${INICIO_LIBROS}): sus libros y declaraciones salieron del sistema anterior`, [{ field: 'periodo', message: `Desde ${INICIO_LIBROS.slice(0, 7)}`, rule: 'antes_de_inicio_libros' }])
    }
    const obligacion = bd.obligacionesFiscales.find(o => o.empresa_id === empresaId && o.impuesto === impuesto && o.periodo_desde === desde)
    if (!obligacion || obligacion.estado === 'no_aplica') {
        return regla('obligacion_no_aplica', `La empresa no tiene la obligación ${impuesto} de ${periodo}${obligacion?.motivo_estado ? ` (${obligacion.motivo_estado})` : ''}: revise el régimen y las banderas del periodo`, [{ field: 'impuesto', message: obligacion?.motivo_estado ?? 'sin obligación', rule: 'obligacion_no_aplica' }])
    }
    if (impuesto === 'isr_anual' && ejercicioCerrado(empresaId, Number(desde.slice(0, 4)))) {
        return conflicto('ejercicio_cerrado', 'Ejercicio cerrado', `El ejercicio ${desde.slice(0, 4)} está cerrado: su ISR anual ya no cambia (reábralo para recalcular)`)
    }
    const previa = ultima(empresaId, impuesto, desde)
    if (previa && (previa.estado === 'revisada' || previa.estado === 'presentada') && !sustitutiva) {
        const presentada = previa.estado === 'presentada'
        return conflicto(presentada ? 'declaracion_presentada' : 'declaracion_revisada', presentada ? 'Declaración presentada' : 'Declaración revisada', `La versión ${previa.version} de ${impuesto} ${periodo} está ${previa.estado}: para corregirla calcule una sustitutiva (sustitutiva: true)`)
    }
    const calculado = calcularDatos(empresaId, impuesto, desde, hasta)
    if ('status' in calculado) {
        return calculado
    }
    const momento = ahora()
    const quien = usuario(solicitud)
    const nueva: Declaracion = {
        id: siguienteId(bd.declaraciones),
        empresa_id: empresaId,
        impuesto,
        periodo_desde: desde,
        periodo_hasta: hasta,
        version: (previa?.version ?? 0) + 1,
        sustitutiva: previa?.revisada_en !== null && previa?.revisada_en !== undefined,
        sustituye_a: previa?.id ?? null,
        obligacion_id: obligacion.id,
        formulario: obligacion.formulario ?? formularioDe(impuesto),
        vence_en: obligacion.vence_en,
        ...calculado,
        calculada_por: quien?.id ?? null,
        calculada_por_nombre: quien?.nombre ?? null,
        calculada_en: momento,
        estado: 'borrador',
        revisada_por: null,
        revisada_por_nombre: null,
        revisada_en: null,
        asiento_id: null,
        numero_formulario: null,
        fecha_presentacion: null,
        boleta: null,
        presentada_por: null,
        presentada_por_nombre: null,
        presentada_en: null,
        pago: null,
        pagos_anulados: [],
        created_at: momento,
        updated_at: momento,
    }
    bd.declaraciones.push(nueva)
    if (previa && previa.estado !== 'sustituida') {
        Object.assign(previa, { estado: 'sustituida', updated_at: momento })
    }
    actualizarObligacion(nueva, { estado: 'borrador' })
    registrarAccion(solicitud, 'declaraciones.calcular', { tipo: 'declaracion', id: nueva.id }, { impuesto, periodo, sustitutiva })
    return nueva
}

/** `RevisarDeclaracion` sin la cascada, según el impuesto (contrato §21 PR C, «Revisión según el impuesto»). */
function revisarVersion(solicitud: SolicitudFixture, d: Declaracion, cascadaDe: number | null = null): Declaracion | RespuestaFixture {
    const sustituida = exigirUltima(d)
    if (sustituida) {
        return sustituida
    }
    if (d.estado !== 'borrador') {
        return conflicto(d.estado === 'presentada' ? 'declaracion_presentada' : 'declaracion_revisada', 'Declaración revisada', `La versión ${d.version} ya está ${d.estado}`)
    }
    const periodo = d.periodo_desde.slice(0, 7)
    if (d.periodo_hasta >= hoyGuatemala()) {
        return regla('periodo_en_curso', `El periodo de ${d.periodo_desde} a ${d.periodo_hasta} no ha terminado: se revisa y liquida después de su último día`)
    }
    if (d.impuesto === 'isr_anual' && ejercicioCerrado(d.empresa_id, Number(d.periodo_desde.slice(0, 4)))) {
        return conflicto('ejercicio_cerrado', 'Ejercicio cerrado', `El ejercicio ${d.periodo_desde.slice(0, 4)} está cerrado`)
    }
    if (desactualizada(d)) {
        return desactualizadaProblema(d)
    }
    const conVentas = esIvaOPc(d.impuesto) || d.impuesto === 'isr_trimestral' || d.impuesto === 'isr_opcional_mensual'
    const ncre = conVentas ? ncreSinCertificar(d.empresa_id, d.periodo_hasta.slice(0, 7)) : []
    if (ncre.length) {
        const respuesta = conflicto('ncre_sin_certificar', 'NCRE sin certificar', `Hay ${ncre.length} notas de crédito con su NCRE sin certificar (${ncre.slice(0, 20).map(x => `nota ${x.nota_id}: ${x.estado}`).join(', ')}): certifícalas o anula las rechazadas antes de liquidar`)
        return { ...respuesta, cuerpo: { ...(respuesta.cuerpo as Problem), errors: ncre.map(x => ({ field: 'nota_id', message: x.estado, rule: String(x.dte_id), ...x })) } }
    }
    const conBloqueo = esIvaOPc(d.impuesto) || d.impuesto === 'retenciones_iva' || d.impuesto === 'retenciones_isr'
    if (conBloqueo) {
        const clave = esIvaOPc(d.impuesto) ? 'iva_cuadrado' : 'retenciones_cuadradas'
        const cuadrado = verificarYExigir(solicitud, d.empresa_id, [['impuestos', d.periodo_desde]], [clave])
        if (cuadrado) {
            return cuadrado
        }
    }
    // Liquidación (IVA, PC, ISR e ISO): la diferencia con lo ya liquidado del periodo; retenciones e ISR anual, sin asiento.
    const conAsiento = !(d.impuesto === 'isr_anual' || d.impuesto === 'retenciones_iva' || d.impuesto === 'retenciones_isr')
    const previa = versiones(d.empresa_id, d.impuesto, d.periodo_desde).filter(x => x.id !== d.id && x.revisada_en !== null).at(-1)
    const igual = previa !== undefined && JSON.stringify(previa.totales) === JSON.stringify(d.totales)
    const momento = ahora()
    const quien = usuario(solicitud)
    Object.assign(d, {
        estado: 'revisada',
        revisada_por: quien?.id ?? null,
        revisada_por_nombre: quien?.nombre ?? null,
        revisada_en: momento,
        asiento_id: conAsiento && !igual ? 900 + d.id : null,
        updated_at: momento,
    })
    if (conBloqueo) {
        // Bloqueo `impuestos` en el último día del mes, si no estaba más adelante.
        const vigente = bd.bloqueosLibro.filter(b => b.empresa_id === d.empresa_id && b.tipo === 'impuestos').sort((a, b) => b.id - a.id)[0]?.hasta ?? null
        if (vigente === null || vigente < d.periodo_hasta) {
            bd.bloqueosLibro.push({ id: siguienteId(bd.bloqueosLibro), empresa_id: d.empresa_id, tipo: 'impuestos', hasta: d.periodo_hasta, anterior: vigente, motivo: `Liquidación de ${d.impuesto} ${periodo} (declaración ${d.id})`, creado_por: quien?.id ?? null, creado_por_nombre: quien?.nombre ?? null, created_at: momento })
        }
        verificarYExigir(solicitud, d.empresa_id, [['impuestos', d.periodo_desde]])
    }
    registrarAccion(solicitud, 'declaraciones.revisar', { tipo: 'declaracion', id: d.id }, cascadaDe ? { declaracion_id: d.id, motivo: 'cascada', cascada_de: cascadaDe } : { declaracion_id: d.id })
    return d
}

const remanentesQueDeja = (t: Record<string, string>, sufijo = '') => [t[`remanente_credito${sufijo}`] ?? '0.00', t[`remanente_retenciones${sufijo}`] ?? '0.00'] as const

/**
 * H34: si la revisión cambia el remanente que deja, rectifica en orden cada mes posterior ya revisado
 * (sustitutiva revisada); se detiene donde el remanente arrastrado no cambia. Una rectificada que
 * estaba presentada deja su obligación en borrador con `motivo_estado = 'rectificativa'`. Si un mes no
 * se puede rectificar: 409 `cascada_bloqueada` con un `errors[]` por mes.
 */
function cascadaDeRemanentes(solicitud: SolicitudFixture, origen: Declaracion): Schema<'DeclaracionRevisada'>['cascada'] | RespuestaFixture {
    const salida: Schema<'DeclaracionRevisada'>['cascada'] = []
    const impuesto: Impuesto = origen.impuesto === 'pc_mensual' ? 'pc_mensual' : 'iva_mensual'
    let actual = origen
    for (;;) {
        const desde = mesSiguiente(actual.periodo_desde)
        const periodo = desde.slice(0, 7)
        const siguiente = versiones(actual.empresa_id, impuesto, desde).filter(x => x.revisada_en !== null).at(-1)
        if (!siguiente) {
            break
        }
        const deja = remanentesQueDeja(actual.totales)
        const arrastra = remanentesQueDeja(siguiente.totales, '_anterior')
        if (deja[0] === arrastra[0] && deja[1] === arrastra[1]) {
            break
        }
        const estabaPresentada = siguiente.estado === 'presentada'
        const nueva = calcularVersion(solicitud, actual.empresa_id, impuesto, periodo, true)
        const revisada = 'status' in nueva ? nueva : revisarVersion(solicitud, nueva, origen.id)
        if ('status' in revisada) {
            const problema = revisada.cuerpo as Problem
            const causa = problema.type.split(':').pop() ?? 'error'
            return problemaTipado(
                409,
                'cascada_bloqueada',
                'Cascada de remanentes bloqueada',
                `Revisar ${origen.impuesto} ${origen.periodo_desde.slice(0, 7)} cambia el remanente que arrastra ${periodo}, ya revisado, y ese mes no se puede rectificar (${causa}: ${problema.detail ?? problema.title}). Nada se guardó`,
                [
                    ...salida.map(m => ({ field: m.periodo, message: 'rectificable', rule: 'ok' })),
                    { field: periodo, message: problema.detail ?? problema.title, rule: causa },
                ],
            )
        }
        if (estabaPresentada) {
            const o = bd.obligacionesFiscales.find(x => x.id === revisada.obligacion_id)
            if (o && o.motivo_estado !== 'rectificativa') {
                Object.assign(o, { motivo_estado: 'rectificativa', version: o.version + 1, updated_at: ahora() })
            }
        }
        salida.push({
            periodo,
            declaracion_id: revisada.id,
            version: revisada.version,
            sustituye_a: siguiente.id,
            estaba_presentada: estabaPresentada,
            remanente_credito_anterior: revisada.totales.remanente_credito_anterior ?? '0.00',
            remanente_credito: revisada.totales.remanente_credito ?? '0.00',
            a_pagar: revisada.totales.a_pagar ?? '0.00',
        })
        actual = revisada
    }
    return salida
}

export const rutasDeclaraciones: RutasFixture = {
    // Antes que `GET /declaraciones/:id`: las rutas fijas primero.
    'GET /api/v1/declaraciones/cuentas-pago': conPermiso('declaraciones.pagar', (solicitud) => {
        const empresas = empresasDeLista(solicitud)
        return { status: 200, cuerpo: bancosLibro.filter(b => empresas === null || empresas.includes(b.empresa_id ?? 1)) }
    }),

    'GET /api/v1/declaraciones/ajustes': conPermiso('declaraciones.ver', (solicitud) => {
        const anio = Number(solicitud.query.get('anio') || hoyGuatemala().slice(0, 4))
        const textoTrimestre = solicitud.query.get('trimestre')
        const trimestre = textoTrimestre ? Number(textoTrimestre) : null
        if (!Number.isInteger(anio) || anio < 2000 || anio > 2100 || (trimestre !== null && (!Number.isInteger(trimestre) || trimestre < 1 || trimestre > 4))) {
            return datosInvalidos([{ field: Number.isInteger(anio) ? 'trimestre' : 'anio', message: 'Año 2000–2100 y trimestre 1–4', rule: 'range' }])
        }
        const filas = deLaEmpresa(bd.ajustesFiscales, solicitud)
            .filter(a => a.anio === anio && (trimestre === null || a.trimestre === trimestre))
            .sort((a, b) => a.id - b.id)
        return { status: 200, cuerpo: filas }
    }),

    'GET /api/v1/declaraciones': conPermiso('declaraciones.ver', (solicitud) => {
        const errores: Errores = []
        const impuestos = solicitud.query.getAll('impuesto').filter(Boolean)
        const estados = solicitud.query.getAll('estado').filter(Boolean)
        for (const i of impuestos) {
            if (!esImpuesto(i)) {
                errores.push({ field: 'impuesto', message: `Valor no permitido: ${i}`, rule: 'enum' })
            }
        }
        for (const e of estados) {
            if (!(ESTADOS as readonly string[]).includes(e)) {
                errores.push({ field: 'estado', message: `Valor no permitido: ${e}`, rule: 'enum' })
            }
        }
        const periodo = solicitud.query.get('periodo') || null
        if (periodo !== null && !PERIODO.test(periodo)) {
            errores.push({ field: 'periodo', message: 'El periodo es AAAA-MM, AAAA-Tn o AAAA', rule: 'regex' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const filas = deLaEmpresa(bd.declaraciones, solicitud)
            .filter(d => (!impuestos.length || impuestos.includes(d.impuesto))
                && (!estados.length || estados.includes(d.estado))
                && (periodo === null || d.periodo_desde === primerDia(periodo)))
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/declaraciones/:id': conPermiso('declaraciones.ver', (solicitud) => {
        const d = declaracionDe(solicitud)
        return 'status' in d ? d : { status: 200, cuerpo: vista(d) }
    }),

    'POST /api/v1/declaraciones/calcular': conPermiso('declaraciones.calcular', conIdempotencia((solicitud): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        if (!esImpuesto(cuerpo.impuesto)) {
            errores.push({ field: 'impuesto', message: `Una de: ${IMPUESTOS.join(', ')}`, rule: 'enum' })
        }
        const periodo = typeof cuerpo.periodo === 'string' && PERIODO.test(cuerpo.periodo) ? cuerpo.periodo : null
        if (periodo === null) {
            errores.push({ field: 'periodo', message: 'El periodo es AAAA-MM, AAAA-Tn o AAAA', rule: 'regex' })
        }
        if (errores.length || periodo === null || !esImpuesto(cuerpo.impuesto)) {
            return datosInvalidos(errores)
        }
        const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : empresaActivaDe(solicitud)
        if (empresaId === null) {
            return problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'Elige la empresa con la que trabajas (cabecera X-Empresa-Id) o indica empresa_id')
        }
        const nueva = calcularVersion(solicitud, empresaId, cuerpo.impuesto, periodo, cuerpo.sustitutiva === true)
        return 'status' in nueva ? nueva : { status: 201, cuerpo: nueva }
    })),

    'POST /api/v1/declaraciones/:id/revisar': conPermiso('declaraciones.revisar', conIdempotencia((solicitud): RespuestaFixture => {
        const d = declaracionDe(solicitud)
        if ('status' in d) {
            return d
        }
        // Todo o nada, como la transacción de la API: si la cascada se bloquea, nada queda guardado.
        const antes = structuredClone({ declaraciones: bd.declaraciones, obligaciones: bd.obligacionesFiscales, bloqueos: bd.bloqueosLibro, checks: bd.checksCierre, acciones: bd.acciones })
        const revisada = revisarVersion(solicitud, d)
        if ('status' in revisada) {
            return revisada
        }
        const cascada = cascadaDeRemanentes(solicitud, revisada)
        if (!Array.isArray(cascada)) {
            Object.assign(bd, { declaraciones: antes.declaraciones, obligacionesFiscales: antes.obligaciones, bloqueosLibro: antes.bloqueos, checksCierre: antes.checks, acciones: antes.acciones })
            return cascada
        }
        const cuerpo: Schema<'DeclaracionRevisada'> = { ...revisada, cascada }
        return { status: 200, cuerpo }
    })),

    'POST /api/v1/declaraciones/:id/marcar-presentada': conPermiso('declaraciones.presentar', conIdempotencia((solicitud): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        const numero = typeof cuerpo.numero_formulario === 'string' ? cuerpo.numero_formulario.trim() : ''
        if (numero.length < 3 || numero.length > 60) {
            errores.push({ field: 'numero_formulario', message: 'Número del formulario presentado', rule: 'required' })
        }
        const fecha = typeof cuerpo.fecha_presentacion === 'string' && FECHA.test(cuerpo.fecha_presentacion) ? cuerpo.fecha_presentacion : null
        if (fecha === null) {
            errores.push({ field: 'fecha_presentacion', message: 'Fecha YYYY-MM-DD', rule: 'date' })
        }
        else if (fecha > hoyGuatemala()) {
            errores.push({ field: 'fecha_presentacion', message: 'No puede ser futura', rule: 'futuro' })
        }
        const boleta = typeof cuerpo.boleta === 'string' ? cuerpo.boleta.trim() : ''
        if (boleta.length > 60) {
            errores.push({ field: 'boleta', message: 'Hasta 60 caracteres', rule: 'maxLength' })
        }
        if (errores.length || fecha === null) {
            return datosInvalidos(errores)
        }
        const d = declaracionDe(solicitud)
        if ('status' in d) {
            return d
        }
        const sustituida = exigirUltima(d)
        if (sustituida) {
            return sustituida
        }
        if (d.estado !== 'revisada') {
            return d.estado === 'presentada'
                ? conflicto('declaracion_presentada', 'Declaración no presentable', `La declaración ${d.id} ya está presentada`)
                : conflicto('declaracion_no_revisada', 'Declaración no presentable', `La declaración ${d.id} está en ${d.estado}: revísela (genera la liquidación) antes de marcarla presentada`)
        }
        if (desactualizada(d)) {
            return desactualizadaProblema(d)
        }
        const momento = ahora()
        Object.assign(d, { estado: 'presentada', numero_formulario: numero, fecha_presentacion: fecha, boleta: boleta || null, presentada_por: usuario(solicitud)?.id ?? null, presentada_por_nombre: usuario(solicitud)?.nombre ?? null, presentada_en: momento, updated_at: momento })
        actualizarObligacion(d, { estado: 'presentada' })
        registrarAccion(solicitud, 'declaraciones.presentar', { tipo: 'declaracion', id: d.id }, cuerpo)
        return { status: 200, cuerpo: d }
    })),

    'POST /api/v1/declaraciones/:id/registrar-pago': conPermiso('declaraciones.pagar', conIdempotencia((solicitud): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        const metodo = cuerpo.metodo === 'caja' || cuerpo.metodo === 'banco' || cuerpo.metodo === 'cuenta_bancaria' ? cuerpo.metodo : null
        if (metodo === null) {
            errores.push({ field: 'metodo', message: 'Una de: caja, banco, cuenta_bancaria', rule: 'enum' })
        }
        const hoy = hoyGuatemala()
        const fecha = typeof cuerpo.fecha === 'string' && cuerpo.fecha ? cuerpo.fecha : hoy
        if (!FECHA.test(fecha)) {
            errores.push({ field: 'fecha', message: 'Fecha YYYY-MM-DD', rule: 'date' })
        }
        else if (fecha > hoy) {
            errores.push({ field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' })
        }
        if (errores.length || metodo === null) {
            return datosInvalidos(errores)
        }
        const d = declaracionDe(solicitud)
        if ('status' in d) {
            return d
        }
        const sustituida = exigirUltima(d)
        if (sustituida) {
            return sustituida
        }
        if (d.estado !== 'revisada' && d.estado !== 'presentada') {
            return conflicto('declaracion_no_revisada', 'Declaración no revisada', `La declaración ${d.id} está en ${d.estado}: se paga después de revisarla`)
        }
        if (d.pago) {
            return conflicto('declaracion_pagada', 'Declaración pagada', `La declaración ${d.id} ya tiene su pago (${d.pago.id})`)
        }
        // Lo pagado por versiones del periodo, sin los pagos anulados.
        const pagado = versiones(d.empresa_id, d.impuesto, d.periodo_desde).reduce((s, x) => s.plus(x.pago?.impuesto ?? '0'), new Decimal(0))
        const monto = new Decimal(d.totales.a_pagar ?? '0').minus(pagado)
        if (monto.lte(0)) {
            return regla('sin_monto_a_pagar', `No hay impuesto por pagar en ${d.impuesto} ${d.periodo_desde.slice(0, 7)} (a pagar ${d.totales.a_pagar ?? '0.00'}, ya pagado ${pagado.toFixed(2)})`)
        }
        // Origen (`resolverOrigenEgreso`): caja activa, banco del libro (sin id: el principal) o cuenta bancaria; de la misma empresa.
        const campo = metodo === 'caja' ? 'caja_id' : metodo === 'banco' ? 'banco_id' : 'cuenta_bancaria_id'
        const origen = metodo === 'caja'
            ? bd.cajas.find(c => c.id === cuerpo.caja_id && c.activa)
            : metodo === 'banco'
                ? bancosLibro.find(b => b.id === (cuerpo.banco_id ?? 1))
                : bd.cuentasBancarias.find(c => c.id === cuerpo.cuenta_bancaria_id)
        if (!origen) {
            return datosInvalidos([{ field: campo, message: metodo === 'caja' ? `La caja ${String(cuerpo.caja_id ?? '')} no existe o está inactiva` : 'No existe', rule: metodo }])
        }
        if ((origen.empresa_id ?? 1) !== d.empresa_id) {
            return datosInvalidos([{ field: campo, message: `El pago sale de la empresa ${origen.empresa_id ?? 1} y la declaración es de la empresa ${d.empresa_id}`, rule: 'cuenta_de_otra_empresa' }])
        }
        const atraso = dias(d.vence_en, fecha)
        const mora = monto.times(MORA_DIARIA).dividedBy(100).times(atraso).toDecimalPlaces(2)
        let multa = new Decimal(0)
        if (d.fecha_presentacion && d.fecha_presentacion > d.vence_en) {
            const bruto = new Decimal(MULTA.por_dia).times(dias(d.vence_en, d.fecha_presentacion))
            multa = Decimal.min(bruto, MULTA.maximo).toDecimalPlaces(2)
        }
        const momento = ahora()
        d.pago = {
            id: bd.declaraciones.reduce((m, x) => Math.max(m, x.pago?.id ?? 0, ...(x.pagos_anulados ?? []).map(p => p.id)), 0) + 1,
            fecha,
            impuesto: monto.toFixed(2),
            mora: mora.toFixed(2),
            multa: multa.toFixed(2),
            total: monto.plus(mora).plus(multa).toFixed(2),
            dias_atraso: atraso,
            boleta: typeof cuerpo.boleta === 'string' && cuerpo.boleta.trim() ? cuerpo.boleta.trim() : null,
            asiento_id: 950 + d.id * 10 + (d.pagos_anulados?.length ?? 0),
            registrado_por: usuario(solicitud)?.id ?? null,
            created_at: momento,
        }
        d.updated_at = momento
        registrarAccion(solicitud, 'declaraciones.pagar', { tipo: 'declaracion', id: d.id }, cuerpo)
        return { status: 201, cuerpo: d }
    })),

    'POST /api/v1/declaraciones/:id/anular-pago': conPermiso('declaraciones.anular_pago', conIdempotencia((solicitud): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : ''
        const errores: Errores = []
        if (motivo.length < 3 || motivo.length > 500) {
            errores.push({ field: 'motivo', message: 'Motivo de 3 a 500 caracteres', rule: 'minLength' })
        }
        const hoy = hoyGuatemala()
        const fecha = typeof cuerpo.fecha === 'string' && cuerpo.fecha ? cuerpo.fecha : hoy
        if (!FECHA.test(fecha)) {
            errores.push({ field: 'fecha', message: 'Fecha YYYY-MM-DD', rule: 'date' })
        }
        else if (fecha > hoy) {
            errores.push({ field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const d = declaracionDe(solicitud)
        if ('status' in d) {
            return d
        }
        const pago = d.pago
        if (!pago) {
            return conflicto('declaracion_sin_pago', 'Declaración sin pago', `La declaración ${d.id} no tiene un pago vigente que anular`)
        }
        if (fecha < pago.fecha) {
            return datosInvalidos([{ field: 'fecha', message: `No puede ser anterior al pago (${pago.fecha})`, rule: 'anterior_al_pago' }])
        }
        const quien = usuario(solicitud)
        const momento = ahora()
        const anulados = d.pagos_anulados ?? []
        const anulacion = {
            id: bd.declaraciones.reduce((m, x) => Math.max(m, ...(x.pagos_anulados ?? []).map(p => p.anulacion.id)), 0) + 1,
            motivo,
            asiento_id: pago.asiento_id + 1000,
            anulado_por: quien?.id ?? null,
            anulado_por_nombre: quien?.nombre ?? null,
            created_at: momento,
        }
        Object.assign(d, { pago: null, pagos_anulados: [...anulados, { ...pago, anulacion }], updated_at: momento })
        registrarAccion(solicitud, 'declaraciones.anular_pago', { tipo: 'declaracion', id: d.id }, { motivo, fecha })
        return { status: 200, cuerpo: d }
    })),

    'POST /api/v1/declaraciones/ajustes': conPermiso('declaraciones.ajustar', conIdempotencia((solicitud): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const concepto = typeof cuerpo.concepto === 'string' ? cuerpo.concepto.trim() : ''
        const errores: Errores = []
        if (concepto.length < 3 || concepto.length > 300) {
            errores.push({ field: 'concepto', message: 'Concepto de 3 a 300 caracteres', rule: 'minLength' })
        }
        const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : empresaActivaDe(solicitud)
        if (empresaId === null) {
            return problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'Elige la empresa con la que trabajas (cabecera X-Empresa-Id) o indica empresa_id')
        }
        const quien = usuario(solicitud)
        let fila: Ajuste
        if (typeof cuerpo.anula_a === 'number') {
            const original = bd.ajustesFiscales.find(a => a.id === cuerpo.anula_a && a.empresa_id === empresaId)
            if (errores.length) {
                return datosInvalidos(errores)
            }
            if (!original || original.anula_a !== null) {
                return datosInvalidos([{ field: 'anula_a', message: 'No existe ese ajuste de la empresa', rule: 'exists' }])
            }
            if (original.anulado_por_ajuste !== null) {
                return conflicto('ajuste_anulado', 'Ajuste anulado', `El ajuste ${original.id} ya está anulado por el ${original.anulado_por_ajuste}`)
            }
            if (original.trimestre === null && ejercicioCerrado(empresaId, original.anio)) {
                return conflicto('ejercicio_cerrado', 'Ejercicio cerrado', `El ejercicio ${original.anio} está cerrado: sus ajustes anuales ya no cambian`)
            }
            fila = { ...original, id: siguienteId(bd.ajustesFiscales), concepto, anula_a: original.id, anulado_por_ajuste: null, registrado_por: quien?.id ?? null, created_at: ahora() }
            original.anulado_por_ajuste = fila.id
        }
        else {
            const anio = cuerpo.anio
            const trimestre = cuerpo.trimestre ?? null
            if (typeof anio !== 'number' || anio < 2000 || anio > 2100) {
                errores.push({ field: 'anio', message: 'El año es obligatorio (2000–2100)', rule: 'required' })
            }
            if (trimestre !== null && (typeof trimestre !== 'number' || trimestre < 1 || trimestre > 4)) {
                errores.push({ field: 'trimestre', message: 'Trimestre 1 a 4', rule: 'range' })
            }
            if (cuerpo.efecto !== 'suma' && cuerpo.efecto !== 'resta') {
                errores.push({ field: 'efecto', message: 'suma o resta', rule: 'enum' })
            }
            const monto = typeof cuerpo.monto === 'string' && MONTO.test(cuerpo.monto) && new Decimal(cuerpo.monto).gt(0) ? new Decimal(cuerpo.monto).toFixed(2) : null
            if (monto === null) {
                errores.push({ field: 'monto', message: 'Monto mayor que cero con hasta 2 decimales', rule: 'monto' })
            }
            if (errores.length || typeof anio !== 'number' || monto === null || (cuerpo.efecto !== 'suma' && cuerpo.efecto !== 'resta')) {
                return datosInvalidos(errores)
            }
            if (trimestre === null && ejercicioCerrado(empresaId, anio)) {
                return conflicto('ejercicio_cerrado', 'Ejercicio cerrado', `El ejercicio ${anio} está cerrado: sus ajustes anuales ya no cambian`)
            }
            fila = { id: siguienteId(bd.ajustesFiscales), empresa_id: empresaId, anio, trimestre: typeof trimestre === 'number' ? trimestre : null, efecto: cuerpo.efecto, concepto, monto, anula_a: null, anulado_por_ajuste: null, registrado_por: quien?.id ?? null, created_at: ahora() }
        }
        bd.ajustesFiscales.push(fila)
        registrarAccion(solicitud, 'declaraciones.ajustar', { tipo: 'ajuste_fiscal', id: fila.id }, cuerpo)
        return { status: 201, cuerpo: fila }
    })),
}
