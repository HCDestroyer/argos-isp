import { DateTime } from 'luxon'
import { D, type Dec } from '#ledger/dinero'

/**
 * Periodos de facturación. Todas las fechas son días calendario `YYYY-MM-DD` (sin zona); se
 * calculan en UTC para no depender del TZ del proceso.
 *
 * - `dia_fijo`: los periodos empiezan el `dia` (1–28) de cada mes.
 * - `aniversario`: empiezan el día de instalación de cada mes (29, 30 y 31 se facturan el 28).
 * - El primer periodo empieza en la fecha de instalación y termina al iniciar el siguiente ciclo.
 *   Con `prorrateo` se cobra la fracción de días; sin prorrateo, el precio completo.
 * - Cada periodo se identifica por su fecha de inicio: `clave_unica = servicio_id-YYYY-MM-DD`.
 */

export interface ConfigCiclo {
    ciclo: 'dia_fijo' | 'aniversario'
    dia: number | null
    prorrateo: boolean
}

export interface PeriodoFacturable {
    /** primer día del periodo (YYYY-MM-DD); es el `periodo` de la factura */
    periodo: string
    /** primer día del periodo siguiente (exclusivo) */
    fin: string
    /** días cubiertos por este periodo */
    dias: number
    /** días del ciclo completo que lo contiene (base del prorrateo) */
    dias_ciclo: number
    /** fracción a cobrar: dias / dias_ciclo con prorrateo, 1 sin él */
    factor: string
}

function aFecha(valor: string): DateTime {
    return DateTime.fromISO(valor, { zone: 'utc' })
}

function texto(fecha: DateTime): string {
    return fecha.toISODate()!
}

/** Día en que empiezan los periodos del servicio. */
export function diaDelCiclo(config: ConfigCiclo, inicioServicio: string): number {
    if (config.ciclo === 'dia_fijo' && config.dia) return config.dia
    return Math.min(aFecha(inicioServicio).day, 28)
}

/** Inicio del ciclo que contiene `fecha`. */
export function inicioCicloQueContiene(fecha: string, dia: number): string {
    const f = aFecha(fecha)
    const enMes = f.set({ day: dia })
    return texto(f.day >= dia ? enMes : enMes.minus({ months: 1 }))
}

/** Inicio del ciclo siguiente al que empieza en `inicio`. */
export function siguienteInicio(inicio: string, dia: number): string {
    return texto(aFecha(inicio).plus({ months: 1 }).set({ day: dia }))
}

export function diasEntre(desde: string, hasta: string): number {
    return Math.round(aFecha(hasta).diff(aFecha(desde), 'days').days)
}

export function sumarDias(fecha: string, dias: number): string {
    return texto(aFecha(fecha).plus({ days: dias }))
}

/**
 * Todos los periodos del servicio que empiezan en `hasta` o antes, desde su instalación.
 * El que llama descarta los que ya tienen factura (`clave_unica`).
 */
export function periodosHasta(
    config: ConfigCiclo,
    inicioServicio: string,
    hasta: string,
): PeriodoFacturable[] {
    if (inicioServicio > hasta) return []
    const dia = diaDelCiclo(config, inicioServicio)
    const ciclo0 = inicioCicloQueContiene(inicioServicio, dia)
    const fin0 = siguienteInicio(ciclo0, dia)
    const diasCiclo0 = diasEntre(ciclo0, fin0)
    const dias0 = diasEntre(inicioServicio, fin0)
    const factor0: Dec = config.prorrateo ? new D(dias0).div(diasCiclo0) : new D(1)

    const periodos: PeriodoFacturable[] = [
        {
            periodo: inicioServicio,
            fin: fin0,
            dias: dias0,
            dias_ciclo: diasCiclo0,
            factor: factor0.toString(),
        },
    ]
    let inicio = fin0
    while (inicio <= hasta) {
        const fin = siguienteInicio(inicio, dia)
        const dias = diasEntre(inicio, fin)
        periodos.push({ periodo: inicio, fin, dias, dias_ciclo: dias, factor: '1' })
        inicio = fin
    }
    return periodos
}

/**
 * Periodos completos del ciclo **anteriores al primer periodo del servicio** (emisión manual de
 * facturas pasadas, decisión del PM del 21 nov): hasta `maximo` ciclos hacia atrás desde el ciclo que
 * contiene `inicioServicio`, ascendentes, sin prorrateo (factor 1). Los días entre el inicio de ese
 * ciclo y `inicioServicio` (primer periodo a mitad de ciclo con `dia_fijo`) no son de ningún periodo
 * anterior: el primero del servicio empieza en su instalación, como siempre. El cron nunca los usa.
 */
export function periodosAntesDelInicio(
    config: ConfigCiclo,
    inicioServicio: string,
    maximo: number,
): PeriodoFacturable[] {
    const dia = diaDelCiclo(config, inicioServicio)
    const salida: PeriodoFacturable[] = []
    let fin = inicioCicloQueContiene(inicioServicio, dia)
    for (let i = 0; i < maximo; i += 1) {
        const inicio = texto(aFecha(fin).minus({ months: 1 }).set({ day: dia }))
        const dias = diasEntre(inicio, fin)
        salida.unshift({ periodo: inicio, fin, dias, dias_ciclo: dias, factor: '1' })
        fin = inicio
    }
    return salida
}

/**
 * Tramo entre el inicio del ciclo y la instalación (primer periodo a mitad de ciclo, p. ej. `dia_fijo`
 * día 1 e instalación el 16): `[desde, fin)` con `fin` = el primer día facturable del servicio. Ningún
 * periodo lo cubre; a mano se puede incluir en la primera factura o cobrar como cargo único (decisión
 * del PM del 21 nov). null si el servicio empieza justo en un inicio de ciclo.
 */
export function tramoAntesDelPrimerPeriodo(
    config: ConfigCiclo,
    inicioServicio: string,
): { desde: string; fin: string; dias: number; dias_ciclo: number } | null {
    const dia = diaDelCiclo(config, inicioServicio)
    const desde = inicioCicloQueContiene(inicioServicio, dia)
    if (desde === inicioServicio) return null
    return {
        desde,
        fin: inicioServicio,
        dias: diasEntre(desde, inicioServicio),
        dias_ciclo: diasEntre(desde, siguienteInicio(desde, dia)),
    }
}

/** Clave del cargo único del tramo inicial: `cargo-…` (no ocupa periodo) y fija (nunca dos). */
export function claveTramoInicial(servicioId: number, desde: string): string {
    return `cargo-tramo-${servicioId}-${desde}`
}

/** Clave única de la factura de un periodo. */
export function claveFactura(servicioId: number, periodo: string): string {
    return `${servicioId}-${periodo}`
}

/**
 * Primer periodo que se factura a un servicio que **recibe plantilla hoy** sin haberla tenido
 * (`plantillas.asignar_sin_plantilla`): el primer inicio de ciclo **mayor o igual** a `hoy` (día de
 * Guatemala; decisión del líder, 18 nov). Asignada el mismo día en que empieza un ciclo, ese ciclo se
 * factura completo (no es hacia atrás y no se regala un mes); un día después, el ciclo siguiente.
 * Nunca un periodo anterior ni el tramo ya corrido prorrateado. Si el primer día facturable del
 * servicio (`inicioServicio`) todavía no llegó, no hay nada atrás: se factura desde él, como siempre.
 */
export function primerPeriodoTrasAsignacion(
    config: ConfigCiclo,
    inicioServicio: string,
    hoy: string,
): string {
    if (inicioServicio > hoy) return inicioServicio
    const dia = diaDelCiclo(config, inicioServicio)
    const actual = inicioCicloQueContiene(hoy, dia)
    return actual === hoy ? hoy : siguienteInicio(actual, dia)
}

/** Los periodos que empiezan en `facturarDesde` o después (sin límite: todos). */
export function periodosDesde<P extends { periodo: string }>(
    periodos: P[],
    facturarDesde: string | null,
): P[] {
    return facturarDesde ? periodos.filter((p) => p.periodo >= facturarDesde) : periodos
}
