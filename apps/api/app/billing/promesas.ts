import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { filtrarPorAlcance, type Alcance, type FiltrosDimension } from '#core/acl'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { ZONA_NEGOCIO, hoyGuatemala } from '#ledger/fechas'
import type { ServicioFacturable } from '#billing/configuracion'
import type { ConfiguracionFacturacion } from '#billing/excepciones'
import { diasEntre, periodosHasta } from '#billing/periodos'
import { ESTADOS_PENDIENTES } from '#billing/facturas'
import type { CanalPromesa, ReglasPromesa } from '#billing/reglas_promesa'

/**
 * Promesas de pago: datos para evaluar las reglas, la evaluación (pura), el cumplimiento y la
 * lectura (lista y detalle). Las acciones viven en `actions/*_promesa*.ts`.
 */

export const ESTADOS_PROMESA = [
    'activa',
    'cumplida',
    'incumplida',
    'cancelada',
    'pendiente_aprobacion',
    'rechazada',
] as const
export type EstadoPromesa = (typeof ESTADOS_PROMESA)[number]

/**
 * Cómo se cumple una promesa (decisión del PM, 29 oct: una promesa cubre todo lo vencido):
 *
 * - `facturas`: las creadas por `crearPromesaPago` desde el cambio. Argos calcula el monto (el
 *   total vencido del servicio al crearla, mora incluida) y guarda las facturas que cubre en
 *   `billing.promesas_facturas`. Se cumple solo cuando **todas** esas facturas quedan saldadas;
 *   una factura que vence después no entra en la promesa.
 * - `monto` (legado): las que estaban abiertas al migrar y las importadas. Se cumple cuando lo
 *   pagado a las facturas del servicio desde la promesa llega a su `monto`, o no queda deuda vencida.
 */
export const REGLAS_CUMPLIMIENTO = ['monto', 'facturas'] as const
export type ReglaCumplimiento = (typeof REGLAS_CUMPLIMIENTO)[number]

/** Una factura vencida que cubre (o cubriría) la promesa, con su saldo al crearla. */
export interface FacturaCubierta {
    factura_id: number
    tipo: string
    periodo: string
    vence_en: string
    /** saldo de la factura al crear la promesa (string decimal) */
    monto: string
}

/** Lo que cubriría una promesa creada ahora: las facturas vencidas con saldo y su total. */
export interface Cobertura {
    monto: Dec
    facturas: FacturaCubierta[]
}

/** Estados que ocupan el cupo del periodo (las rechazadas y canceladas no cuentan). */
const ESTADOS_EN_CUPO: readonly EstadoPromesa[] = ['activa', 'cumplida', 'incumplida', 'pendiente_aprobacion']

/*
|--------------------------------------------------------------------------
| Evaluación de reglas
|--------------------------------------------------------------------------
*/

/**
 * Nombre de cada regla tal como aparece en `resultado_evaluacion.regla`, en el orden en que se
 * evalúan. Contrato: `.claude/integration/contratos/promesas.md` (una regla nueva va al final).
 */
export const NOMBRES_REGLA = [
    'habilitadas',
    'canal_permitido',
    'sin_deuda',
    'plazo_max_dias',
    'no_exceder_siguiente_facturacion',
    'deuda_maxima',
    'abono_inicial_pct',
    'antiguedad_minima_dias',
    'cumplimiento_minimo_pct',
    'bloqueo_tras_incumplida_dias',
    'max_por_periodo',
    'requiere_aprobacion',
] as const
export type NombreRegla = (typeof NOMBRES_REGLA)[number]

export interface ReglaEvaluada {
    regla: NombreRegla
    ok: boolean
    /** valor medido (días, monto, cantidad, %) */
    valor: string | number | null
    /** límite aplicado (null = sin límite) */
    limite: string | number | boolean | null
    /** `general` o el canal cuyo límite reemplazó al general */
    origen: 'general' | CanalPromesa
    detalle: string
    /** false: la regla no se exige con esta configuración (solo en la evaluación completa) */
    aplica?: boolean
}

export type ResultadoPromesa = 'aprobada' | 'rechazada' | 'pendiente_aprobacion'

export interface ResultadoEvaluacion {
    resultado: ResultadoPromesa
    /** primera regla que falló (rechazada) o `requiere_aprobacion`; null si se aprobó */
    regla: NombreRegla | null
    motivo: string
    canal: CanalPromesa
    evaluada_en: string
    /** todas las reglas revisadas, en orden; la evaluación se detiene en la primera que falla */
    reglas: ReglaEvaluada[]
    deuda: { pendiente: string; vencida: string; pagado_pendientes: string; facturas_vencidas: number }
    historial: { ventana: number; resueltas: number; cumplidas: number; cumplimiento_pct: number | null }
    siguiente_facturacion: string | null
}

/** Lo que la evaluación necesita saber del servicio (lo arma `datosEvaluacion`). */
export interface DatosEvaluacion {
    canal: CanalPromesa
    ahora: Date
    vence_en: Date
    reglas: ReglasPromesa
    /** deuda del servicio: pendiente total, vencida y lo ya pagado de las pendientes */
    deuda: { pendiente: Dec; vencida: Dec; total_pendientes: Dec; pagado_pendientes: Dec; vencidas: number }
    /** lo que cubriría la promesa: las facturas vencidas con saldo (su total = `deuda.vencida`) */
    cobertura: Cobertura
    /** inicio del servicio (YYYY-MM-DD) */
    inicio: string
    /** inicio del periodo actual y de la siguiente facturación (YYYY-MM-DD) */
    periodo_actual: string | null
    siguiente_facturacion: string | null
    /** promesas del servicio creadas en el periodo actual que ocupan cupo */
    en_periodo: number
    /** últimas promesas resueltas (cumplida/incumplida), la más reciente primero */
    resueltas: EstadoPromesa[]
    /** cuándo venció la última promesa incumplida */
    ultima_incumplida: Date | null
}

const PLURAL = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Cumplimiento (%) de las últimas `ventana` promesas resueltas; null sin historial. */
export function cumplimiento(resueltas: EstadoPromesa[], ventana: number) {
    const ultimas = resueltas.slice(0, ventana)
    const cumplidas = ultimas.filter((e) => e === 'cumplida').length
    return {
        ventana,
        resueltas: ultimas.length,
        cumplidas,
        cumplimiento_pct: ultimas.length === 0 ? null : Math.floor((cumplidas * 100) / ultimas.length),
    }
}

/**
 * Evalúa las reglas de promesa en orden y se detiene en la primera que falla. Pura: no lee la
 * base de datos (la prueban las pruebas unitarias y el simulador de la semana 2).
 *
 * Límites por canal: `canales.<canal>.plazo_max_dias`, `max_por_periodo` y `deuda_maxima`, si no
 * son null, **reemplazan** al general. `permitido: false` rechaza y `requiere_aprobacion: true`
 * deja la promesa `pendiente_aprobacion` cuando todo lo demás pasa.
 */
export function evaluarReglas(
    datos: DatosEvaluacion,
    opciones: { completo?: boolean } = {},
): ResultadoEvaluacion {
    const { reglas, canal } = datos
    const completo = opciones.completo ?? false
    let primera: ReglaEvaluada | null = null
    const limitesCanal = reglas.canales[canal]
    const historial = cumplimiento(datos.resueltas, reglas.historial_ventana)
    const evaluadas: ReglaEvaluada[] = []
    const base = {
        canal,
        evaluada_en: datos.ahora.toISOString(),
        deuda: {
            pendiente: aTexto(datos.deuda.pendiente),
            vencida: aTexto(datos.deuda.vencida),
            pagado_pendientes: aTexto(datos.deuda.pagado_pendientes),
            facturas_vencidas: datos.deuda.vencidas,
        },
        historial,
        siguiente_facturacion: datos.siguiente_facturacion,
    }
    const fin = (resultado: ResultadoPromesa, regla: NombreRegla | null, motivo: string) => ({
        ...base,
        resultado,
        regla,
        motivo,
        reglas: evaluadas,
    })
    /**
     * Registra la regla; devuelve true si falló y hay que detenerse. En la evaluación completa
     * (simulador) no se detiene: anota la primera que falló y sigue con las demás.
     */
    const revisar = (r: ReglaEvaluada) => {
        evaluadas.push(completo ? { ...r, aplica: true } : r)
        if (r.ok) return false
        if (!completo) return true
        primera ??= r
        return false
    }
    /** Simulador: la regla no se exige con esta configuración. */
    const omitir = (regla: NombreRegla, detalle: string, limite: ReglaEvaluada['limite'] = null) => {
        if (completo) {
            evaluadas.push({
                regla,
                ok: true,
                valor: null,
                limite,
                origen: 'general',
                detalle,
                aplica: false,
            })
        }
    }

    if (
        revisar({
            regla: 'habilitadas',
            ok: reglas.habilitadas,
            valor: null,
            limite: reglas.habilitadas,
            origen: 'general',
            detalle: reglas.habilitadas
                ? 'La plantilla admite promesas'
                : 'La plantilla del servicio no admite promesas de pago',
        })
    ) {
        return fin('rechazada', 'habilitadas', evaluadas.at(-1)!.detalle)
    }

    if (
        revisar({
            regla: 'canal_permitido',
            ok: limitesCanal.permitido,
            valor: canal,
            limite: limitesCanal.permitido,
            origen: canal,
            detalle: limitesCanal.permitido
                ? `El canal ${canal} puede crear promesas`
                : `El canal ${canal} no puede crear promesas`,
        })
    ) {
        return fin('rechazada', 'canal_permitido', evaluadas.at(-1)!.detalle)
    }

    // la promesa cubre lo vencido: sin facturas vencidas no hay nada que prometer (ni corte que evitar)
    const conDeuda = datos.cobertura.monto.gt(0)
    if (
        revisar({
            regla: 'sin_deuda',
            ok: conDeuda,
            valor: aTexto(datos.cobertura.monto),
            limite: null,
            origen: 'general',
            detalle: conDeuda
                ? `La promesa cubre Q${aTexto(datos.cobertura.monto)} vencidos en ${PLURAL(datos.cobertura.facturas.length, 'factura', 'facturas')}`
                : 'El servicio no tiene facturas vencidas: no hace falta promesa',
        })
    ) {
        return fin('rechazada', 'sin_deuda', evaluadas.at(-1)!.detalle)
    }

    const hoy = hoyGuatemala(datos.ahora)
    const diaVence = hoyGuatemala(datos.vence_en)
    const plazo = diasEntre(hoy, diaVence)
    const plazoMax = limitesCanal.plazo_max_dias ?? reglas.plazo_max_dias
    const origenPlazo = limitesCanal.plazo_max_dias !== null ? canal : 'general'
    if (
        revisar({
            regla: 'plazo_max_dias',
            ok: plazo <= plazoMax,
            valor: plazo,
            limite: plazoMax,
            origen: origenPlazo,
            detalle:
                plazo <= plazoMax
                    ? `Vence en ${PLURAL(plazo, 'día', 'días')} (máximo ${plazoMax})`
                    : `Vence en ${PLURAL(plazo, 'día', 'días')}; el máximo${origenPlazo === 'general' ? '' : ` del canal ${canal}`} es ${PLURAL(plazoMax, 'día', 'días')}`,
        })
    ) {
        return fin('rechazada', 'plazo_max_dias', evaluadas.at(-1)!.detalle)
    }

    if (reglas.no_exceder_siguiente_facturacion && datos.siguiente_facturacion) {
        const ok = diaVence < datos.siguiente_facturacion
        if (
            revisar({
                regla: 'no_exceder_siguiente_facturacion',
                ok,
                valor: diaVence,
                limite: datos.siguiente_facturacion,
                origen: 'general',
                detalle: ok
                    ? `Vence (${diaVence}) antes de la siguiente facturación (${datos.siguiente_facturacion})`
                    : `Vence el ${diaVence}; debe vencer antes de la siguiente facturación (${datos.siguiente_facturacion})`,
            })
        ) {
            return fin('rechazada', 'no_exceder_siguiente_facturacion', evaluadas.at(-1)!.detalle)
        }
    } else {
        omitir(
            'no_exceder_siguiente_facturacion',
            'La plantilla no limita la promesa a la siguiente facturación',
            false,
        )
    }

    const deudaMaxima = limitesCanal.deuda_maxima ?? reglas.deuda_maxima
    if (deudaMaxima !== null) {
        const ok = datos.deuda.vencida.lte(dec(deudaMaxima))
        const origen = limitesCanal.deuda_maxima !== null ? canal : 'general'
        if (
            revisar({
                regla: 'deuda_maxima',
                ok,
                valor: aTexto(datos.deuda.vencida),
                limite: aTexto(deudaMaxima),
                origen,
                detalle: ok
                    ? `Deuda vencida Q${aTexto(datos.deuda.vencida)} (máximo Q${aTexto(deudaMaxima)})`
                    : `La deuda vencida es Q${aTexto(datos.deuda.vencida)}; el máximo${origen === 'general' ? '' : ` del canal ${canal}`} para prometer es Q${aTexto(deudaMaxima)}`,
            })
        ) {
            return fin('rechazada', 'deuda_maxima', evaluadas.at(-1)!.detalle)
        }
    } else {
        omitir('deuda_maxima', 'Sin deuda máxima para prometer')
    }

    if (reglas.abono_inicial_pct > 0) {
        const requerido = datos.deuda.total_pendientes.times(reglas.abono_inicial_pct).div(100)
        const ok = datos.deuda.pagado_pendientes.gte(requerido)
        if (
            revisar({
                regla: 'abono_inicial_pct',
                ok,
                valor: aTexto(datos.deuda.pagado_pendientes),
                limite: aTexto(requerido),
                origen: 'general',
                detalle: ok
                    ? `Abonó Q${aTexto(datos.deuda.pagado_pendientes)} (${reglas.abono_inicial_pct}% = Q${aTexto(requerido)})`
                    : `Debe abonar el ${reglas.abono_inicial_pct}% de la deuda (Q${aTexto(requerido)}) antes de prometer; lleva Q${aTexto(datos.deuda.pagado_pendientes)}`,
            })
        ) {
            return fin('rechazada', 'abono_inicial_pct', evaluadas.at(-1)!.detalle)
        }
    } else {
        omitir('abono_inicial_pct', 'No se exige abono inicial', 0)
    }

    if (reglas.antiguedad_minima_dias > 0) {
        const antiguedad = Math.max(diasEntre(datos.inicio, hoy), 0)
        const ok = antiguedad >= reglas.antiguedad_minima_dias
        if (
            revisar({
                regla: 'antiguedad_minima_dias',
                ok,
                valor: antiguedad,
                limite: reglas.antiguedad_minima_dias,
                origen: 'general',
                detalle: ok
                    ? `Antigüedad ${PLURAL(antiguedad, 'día', 'días')} (mínimo ${reglas.antiguedad_minima_dias})`
                    : `El servicio tiene ${PLURAL(antiguedad, 'día', 'días')}; se exigen ${reglas.antiguedad_minima_dias} para prometer`,
            })
        ) {
            return fin('rechazada', 'antiguedad_minima_dias', evaluadas.at(-1)!.detalle)
        }
    } else {
        omitir('antiguedad_minima_dias', 'No se exige antigüedad mínima', 0)
    }

    if (reglas.cumplimiento_minimo_pct !== null && historial.cumplimiento_pct !== null) {
        const ok = historial.cumplimiento_pct >= reglas.cumplimiento_minimo_pct
        if (
            revisar({
                regla: 'cumplimiento_minimo_pct',
                ok,
                valor: historial.cumplimiento_pct,
                limite: reglas.cumplimiento_minimo_pct,
                origen: 'general',
                detalle: ok
                    ? `Cumplió ${historial.cumplidas} de ${historial.resueltas} promesas (${historial.cumplimiento_pct}%)`
                    : `Cumplió ${historial.cumplidas} de sus últimas ${historial.resueltas} promesas (${historial.cumplimiento_pct}%); se exige ${reglas.cumplimiento_minimo_pct}%`,
            })
        ) {
            return fin('rechazada', 'cumplimiento_minimo_pct', evaluadas.at(-1)!.detalle)
        }
    } else {
        omitir(
            'cumplimiento_minimo_pct',
            reglas.cumplimiento_minimo_pct === null
                ? 'No se exige cumplimiento mínimo'
                : 'Sin promesas resueltas: el cumplimiento mínimo no se aplica todavía',
            reglas.cumplimiento_minimo_pct,
        )
    }

    if (reglas.bloqueo_tras_incumplida_dias > 0 && datos.ultima_incumplida) {
        const desde = diasEntre(hoyGuatemala(datos.ultima_incumplida), hoy)
        const ok = desde >= reglas.bloqueo_tras_incumplida_dias
        const libre = DateTime.fromJSDate(datos.ultima_incumplida)
            .setZone(ZONA_NEGOCIO)
            .plus({ days: reglas.bloqueo_tras_incumplida_dias })
            .toISODate()
        if (
            revisar({
                regla: 'bloqueo_tras_incumplida_dias',
                ok,
                valor: desde,
                limite: reglas.bloqueo_tras_incumplida_dias,
                origen: 'general',
                detalle: ok
                    ? `Última promesa incumplida hace ${PLURAL(desde, 'día', 'días')}`
                    : `Incumplió una promesa hace ${PLURAL(desde, 'día', 'días')}; puede volver a prometer desde el ${libre}`,
            })
        ) {
            return fin('rechazada', 'bloqueo_tras_incumplida_dias', evaluadas.at(-1)!.detalle)
        }
    } else {
        omitir(
            'bloqueo_tras_incumplida_dias',
            reglas.bloqueo_tras_incumplida_dias > 0
                ? 'No tiene promesas incumplidas'
                : 'Sin bloqueo tras una promesa incumplida',
            reglas.bloqueo_tras_incumplida_dias,
        )
    }

    const buenHistorial =
        historial.cumplimiento_pct !== null && historial.cumplimiento_pct >= reglas.buen_historial_pct
    const maximo =
        limitesCanal.max_por_periodo ??
        (buenHistorial ? reglas.max_por_periodo_buen_historial : reglas.max_por_periodo)
    const origenMaximo = limitesCanal.max_por_periodo !== null ? canal : 'general'
    const okCupo = datos.en_periodo < maximo
    if (
        revisar({
            regla: 'max_por_periodo',
            ok: okCupo,
            valor: datos.en_periodo,
            limite: maximo,
            origen: origenMaximo,
            detalle:
                (okCupo
                    ? `Lleva ${PLURAL(datos.en_periodo, 'promesa', 'promesas')} en el periodo (máximo ${maximo})`
                    : `Ya tiene ${PLURAL(datos.en_periodo, 'promesa', 'promesas')} en el periodo que empezó el ${datos.periodo_actual}; el máximo${origenMaximo === 'general' ? '' : ` del canal ${canal}`} es ${maximo}`) +
                (origenMaximo === 'general' && buenHistorial ? ' (por buen historial)' : ''),
        })
    ) {
        return fin('rechazada', 'max_por_periodo', evaluadas.at(-1)!.detalle)
    }

    const falla = primera as ReglaEvaluada | null
    if (falla) return fin('rechazada', falla.regla, falla.detalle)

    if (limitesCanal.requiere_aprobacion) {
        revisar({
            regla: 'requiere_aprobacion',
            ok: true,
            valor: canal,
            limite: true,
            origen: canal,
            detalle: `Las promesas del canal ${canal} requieren aprobación de un supervisor`,
        })
        return fin('pendiente_aprobacion', 'requiere_aprobacion', evaluadas.at(-1)!.detalle)
    }
    return fin('aprobada', null, 'Cumple todas las reglas de promesa de la plantilla')
}

/*
|--------------------------------------------------------------------------
| Datos de la base para evaluar
|--------------------------------------------------------------------------
*/

/** Deuda del servicio (facturas de servicio y mora pendientes). */
export async function deudaDeServicio(cliente: QueryClientContract, servicioId: number) {
    const filas = (await cliente
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .whereIn('estado', ['emitida', 'parcial', 'vencida'])
        .select('estado', 'tipo', 'total', 'pagado')) as Array<{
        estado: string
        tipo: string
        total: string
        pagado: string
    }>
    let pendiente = CERO
    let vencida = CERO
    let total = CERO
    let pagado = CERO
    let vencidas = 0
    for (const f of filas) {
        const saldo = dec(f.total).minus(f.pagado)
        pendiente = pendiente.plus(saldo)
        total = total.plus(f.total)
        pagado = pagado.plus(f.pagado)
        if (f.estado === 'vencida') {
            vencida = vencida.plus(saldo)
            if (f.tipo === 'servicio') vencidas += 1
        }
    }
    return { pendiente, vencida, total_pendientes: total, pagado_pendientes: pagado, vencidas }
}

/**
 * Facturas vencidas con saldo del servicio, la más antigua primero (mora y cargos incluidos):
 * lo que cubre una promesa creada ahora.
 */
export async function coberturaDeServicio(
    cliente: QueryClientContract,
    servicioId: number,
): Promise<Cobertura> {
    const filas = (await cliente
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .where('estado', 'vencida')
        .whereRaw('total > pagado')
        .orderBy('vence_en', 'asc')
        .orderBy('id', 'asc')
        .select(
            'id',
            'tipo',
            cliente.raw(`to_char(periodo, 'YYYY-MM-DD') as periodo`),
            cliente.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
            cliente.raw('(total - pagado)::text as saldo'),
        )) as Array<{ id: number; tipo: string; periodo: string; vence_en: string; saldo: string }>
    let monto = CERO
    const facturas = filas.map((f) => {
        monto = monto.plus(f.saldo)
        return {
            factura_id: Number(f.id),
            tipo: f.tipo,
            periodo: f.periodo,
            vence_en: f.vence_en,
            monto: aTexto(f.saldo),
        }
    })
    return { monto, facturas }
}

export async function datosEvaluacion(
    cliente: QueryClientContract,
    servicio: ServicioFacturable,
    config: ConfiguracionFacturacion,
    entrada: { canal: CanalPromesa; vence_en: Date; ahora: Date },
): Promise<DatosEvaluacion> {
    const hoy = hoyGuatemala(entrada.ahora)
    const periodos = periodosHasta(config, servicio.inicio, hoy)
    const actual = periodos.at(-1) ?? null
    const siguiente = actual ? actual.fin : servicio.inicio

    let enPeriodo = 0
    if (actual) {
        const desde = DateTime.fromISO(actual.periodo, { zone: ZONA_NEGOCIO }).toJSDate()
        const fila = (await cliente
            .from('billing.promesas')
            .where('servicio_id', servicio.id)
            .whereIn('estado', ESTADOS_EN_CUPO as EstadoPromesa[])
            .where('created_at', '>=', desde)
            .count('* as n')
            .first()) as { n: string | number }
        enPeriodo = Number(fila.n)
    }
    const resueltas = (await cliente
        .from('billing.promesas')
        .where('servicio_id', servicio.id)
        .whereIn('estado', ['cumplida', 'incumplida'])
        .orderBy('vence_en', 'desc')
        .orderBy('id', 'desc')
        .limit(50)
        .select('estado')) as Array<{ estado: EstadoPromesa }>
    const incumplida = (await cliente
        .from('billing.promesas')
        .where('servicio_id', servicio.id)
        .where('estado', 'incumplida')
        .orderBy('vence_en', 'desc')
        .select('vence_en')
        .first()) as { vence_en: Date } | null

    return {
        canal: entrada.canal,
        ahora: entrada.ahora,
        vence_en: entrada.vence_en,
        reglas: config.reglas_promesa,
        deuda: await deudaDeServicio(cliente, servicio.id),
        cobertura: await coberturaDeServicio(cliente, servicio.id),
        inicio: servicio.inicio,
        periodo_actual: actual?.periodo ?? null,
        siguiente_facturacion: siguiente,
        en_periodo: enPeriodo,
        resueltas: resueltas.map((r) => r.estado),
        ultima_incumplida: incumplida ? new Date(incumplida.vence_en) : null,
    }
}

/*
|--------------------------------------------------------------------------
| Cumplimiento
|--------------------------------------------------------------------------
*/

export interface AvancePromesa {
    /** lo pagado (pagos vigentes) desde la promesa: a las facturas del servicio o, con la regla `facturas`, a las cubiertas */
    pagado: Dec
    /** deuda vencida del servicio al revisar */
    vencida: Dec
    /** regla `facturas`: saldo que les queda a las facturas cubiertas (null con la regla `monto`) */
    saldo_cubierto: Dec | null
    cumplida: boolean
}

/**
 * Avance de una promesa según su `regla_cumplimiento`:
 *
 * - `facturas`: se cumple cuando ninguna de sus facturas cubiertas sigue pendiente (pagada, o
 *   acreditada/anulada/castigada: ya no se cobra). Una factura vencida después de crearla no cuenta.
 * - `monto` (legado): se cumple si lo pagado a las facturas del servicio desde la promesa llega a
 *   su monto, o si el servicio ya no tiene deuda vencida.
 */
export async function avanceDePromesa(
    cliente: QueryClientContract,
    promesa: {
        id: number
        servicio_id: number
        created_at: Date
        monto: string
        regla_cumplimiento: ReglaCumplimiento
    },
): Promise<AvancePromesa> {
    const pagos = cliente
        .from('billing.pagos_aplicaciones as a')
        .join('billing.pagos as p', 'p.id', 'a.pago_id')
        .join('billing.facturas as f', 'f.id', 'a.factura_id')
        .where('p.estado', 'registrado')
        .where('a.created_at', '>=', promesa.created_at)
        // un pago histórico importado después lleva la fecha del origen: si fue antes de la
        // promesa (importada con su `creada_en`), no la cumple aunque su aplicación sea de hoy
        .where((q) => q.where('p.historico', false).orWhere('p.created_at', '>=', promesa.created_at))
        .select(cliente.raw('coalesce(sum(a.monto), 0)::text as pagado'))
    const { vencida } = await deudaDeServicio(cliente, promesa.servicio_id)

    if (promesa.regla_cumplimiento === 'facturas') {
        const fila = (await pagos
            .whereIn(
                'a.factura_id',
                cliente
                    .from('billing.promesas_facturas')
                    .where('promesa_id', promesa.id)
                    .select('factura_id'),
            )
            .first()) as { pagado: string }
        const saldo = (await cliente
            .from('billing.promesas_facturas as pf')
            .join('billing.facturas as f', 'f.id', 'pf.factura_id')
            .where('pf.promesa_id', promesa.id)
            .whereIn('f.estado', [...ESTADOS_PENDIENTES])
            .select(
                cliente.raw('count(*)::int as pendientes'),
                cliente.raw('coalesce(sum(f.total - f.pagado), 0)::text as saldo'),
            )
            .first()) as { pendientes: number; saldo: string }
        return {
            pagado: dec(fila.pagado),
            vencida,
            saldo_cubierto: dec(saldo.saldo),
            cumplida: Number(saldo.pendientes) === 0,
        }
    }

    const fila = (await pagos.where('f.servicio_id', promesa.servicio_id).first()) as { pagado: string }
    const pagado = dec(fila.pagado)
    return {
        pagado,
        vencida,
        saldo_cubierto: null,
        cumplida: pagado.gte(dec(promesa.monto)) || vencida.lte(0),
    }
}

/*
|--------------------------------------------------------------------------
| Lectura
|--------------------------------------------------------------------------
*/

export interface PromesaVista {
    id: number
    /** la empresa del servicio */
    empresa_id: number
    servicio_id: number
    cliente_id: number
    cliente_nombre: string
    vence_en: Date
    /** con la regla `facturas`: lo calcula Argos (total vencido al crearla); nadie lo escribe */
    monto: string
    /** `facturas` (nuevas) o `monto` (legado: abiertas al migrar e importadas) */
    regla_cumplimiento: ReglaCumplimiento
    /** facturas que cubre (vacío con la regla `monto`) */
    facturas: FacturaPromesa[]
    estado: EstadoPromesa
    canal: CanalPromesa
    aprobada_por: number | null
    resultado_evaluacion: unknown
    version: number
    created_at: Date
    updated_at: Date
}

/** Factura cubierta por una promesa guardada, con su saldo y estado actuales. */
export interface FacturaPromesa extends FacturaCubierta {
    /** saldo hoy (0.00 si ya no está pendiente) */
    saldo: string
    estado: string
}

const COLUMNAS = [
    'p.id',
    'p.empresa_id',
    'p.servicio_id',
    'p.cliente_id',
    db.raw('(select cl.nombre from core.clientes cl where cl.id = p.cliente_id) as cliente_nombre'),
    'p.vence_en',
    'p.monto',
    'p.regla_cumplimiento',
    db.raw(`coalesce((
        select json_agg(json_build_object(
            'factura_id', f.id,
            'tipo', f.tipo,
            'periodo', to_char(f.periodo, 'YYYY-MM-DD'),
            'vence_en', to_char(f.vence_en, 'YYYY-MM-DD'),
            'monto', pf.monto::text,
            'saldo', (case when f.estado in ('emitida', 'parcial', 'vencida') then f.total - f.pagado else 0 end)::numeric(14, 2)::text,
            'estado', f.estado
        ) order by f.vence_en, f.id)
        from billing.promesas_facturas pf
        join billing.facturas f on f.id = pf.factura_id
        where pf.promesa_id = p.id
    ), '[]'::json) as facturas`),
    'p.estado',
    'p.canal',
    'p.aprobada_por',
    'p.resultado_evaluacion',
    'p.version',
    'p.created_at',
    'p.updated_at',
]

export async function verPromesa(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PromesaVista> {
    const fila = (await cliente
        .from('billing.promesas as p')
        .where('p.id', id)
        .select(...COLUMNAS)
        .first()) as PromesaVista | null
    if (!fila) throw new NoEncontrado(`La promesa ${id} no existe`)
    return fila
}

export interface FiltrosPromesas extends OpcionesPaginacion {
    servicio_id?: number
    cliente_id?: number
    estado?: EstadoPromesa
}

/** Alcance de una promesa: zona del cliente y router del servicio. */
const dimensionesPromesa: FiltrosDimension = {
    zona: (q, ids) => q.whereIn('c.zona_id', ids),
    router: (q, ids) => q.whereIn('s.router_id', ids),
}

export async function listarPromesas(
    filtros: FiltrosPromesas,
    alcance?: Alcance,
    empresas: number[] | null = null,
) {
    const consulta = db
        .from('billing.promesas as p')
        .join('core.clientes as c', 'c.id', 'p.cliente_id')
        .join('core.servicios as s', 's.id', 'p.servicio_id')
        .select(...COLUMNAS)
        .if(filtros.servicio_id, (q) => q.where('p.servicio_id', filtros.servicio_id!))
        .if(filtros.cliente_id, (q) => q.where('p.cliente_id', filtros.cliente_id!))
        .if(filtros.estado, (q) => q.where('p.estado', filtros.estado!))
    filtrarPorAlcance(consulta, alcance, dimensionesPromesa)
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('p.empresa_id', ids))
    return paginar<PromesaVista>(consulta, filtros, { columna: 'p.id' })
}

/** Dimensiones de alcance de un servicio (para crear promesas) o de una promesa. */
export async function dimensionesDeServicio(servicioId: number) {
    const fila = (await db
        .from('core.servicios as s')
        .join('core.clientes as c', 'c.id', 's.cliente_id')
        .where('s.id', servicioId)
        .select('c.zona_id', 's.router_id', 's.empresa_id')
        .first()) as { zona_id: number | null; router_id: number | null; empresa_id: number } | null
    if (!fila) throw new NoEncontrado(`El servicio ${servicioId} no existe`)
    return { zona: [fila.zona_id], router: [fila.router_id], empresa_id: Number(fila.empresa_id) }
}

export async function dimensionesDePromesa(id: number) {
    const fila = await db.from('billing.promesas').where('id', id).select('servicio_id', 'empresa_id').first()
    if (!fila) throw new NoEncontrado(`La promesa ${id} no existe`)
    return {
        ...(await dimensionesDeServicio(fila.servicio_id as number)),
        empresa_id: Number(fila.empresa_id),
    }
}
