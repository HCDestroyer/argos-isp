import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { simularEnTransaccion } from '#shared/domain_action'
import type { ContextoAccion } from '#shared/contexto'
import { ReglaNegocio } from '#shared/errores'
import { aTexto, dec, redondear } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { configuracionDeServicio, leerServicio, type ServicioFacturable } from '#billing/configuracion'
import type { ConfiguracionFacturacion } from '#billing/excepciones'
import { facturarDesdeDe } from '#billing/asignacion_plantilla'
import { saldoAnticipos } from '#billing/cobros'
import {
    claveFactura,
    claveTramoInicial,
    tramoAntesDelPrimerPeriodo,
    periodosAntesDelInicio,
    periodosHasta,
    sumarDias,
    type PeriodoFacturable,
} from '#billing/periodos'
import EmitirFactura, { type EntradaEmitirFactura } from '#billing/actions/emitir_factura'

/**
 * Periodos de un servicio para la emisión manual (`facturas.emitir_periodos`, pedido del PM del 19
 * nov: «no puedo agregar facturas siguientes (pago por adelantado) ni agregar facturas a un
 * servicio»). Lo comparten la vista previa (`GET /servicios/:id/periodos-facturables`) y la acción
 * (`POST /servicios/:id/facturas-periodo`), así las dos ven los mismos periodos.
 *
 * - Los periodos salen de `periodosHasta` (los mismos del cron): del primer día facturable del
 *   servicio en adelante. **Sin prorrateo a mano** (pedido del PM, 21 nov: «si un servicio vale 200,
 *   la factura es de 200»): todo periodo no emitido se calcula con factor 1, aunque la plantilla
 *   prorratee; el cron sigue respetando el «Prorrateo» de la plantilla. Lo emitido se muestra tal cual.
 * - **Antes del inicio del servicio** (`antes_del_inicio`, decisión del PM del 21 nov): hasta
 *   `MAXIMO_PERIODOS_ANTERIORES` periodos completos del ciclo anteriores al primero del servicio
 *   (`periodosAntesDelInicio`). Mismo permiso y motivo que `antes_de_facturar_desde`.
 * - **Vencimiento a mano** (`vencimientoDe`): `max(periodo + dias_gracia, hoy + dias_gracia)` para
 *   todo periodo emitido a mano (pendiente, anterior al cobro o al inicio): emitirlo no corta al
 *   cliente de inmediato. Un futuro conserva su fecha normal. El cron no cambia.
 * - **Pasados y el actual** (empiezan hoy o antes): `pendiente` si el cron lo emitiría,
 *   `antes_de_facturar_desde` si el servicio recibió plantilla después (nada hacia atrás para el
 *   cron; a mano, solo con `facturas.emitir_periodo_anterior` y motivo).
 * - **Futuros** (empiezan después de hoy, pago adelantado): hasta `MAXIMO_PERIODOS_FUTUROS`.
 * - Un periodo con factura (o bonificación) en su `clave_unica = servicio_id-periodo` está ocupado:
 *   `emitida` o `bonificada`, nunca se vuelve a emitir.
 */

/** Periodos futuros (pago adelantado) que se pueden emitir o ver a la vez. */
export const MAXIMO_PERIODOS_FUTUROS = 12

/** Periodos completos anteriores al primero del servicio que se pueden emitir a mano (24 meses). */
export const MAXIMO_PERIODOS_ANTERIORES = 24

export const ESTADOS_PERIODO = [
    'emitida',
    'bonificada',
    'pendiente',
    'futuro',
    'antes_de_facturar_desde',
    'antes_del_inicio',
] as const
export type EstadoPeriodo = (typeof ESTADOS_PERIODO)[number]

/**
 * Periodos «pasados a mano»: excepciones a lo que factura el cron. Piden
 * `facturas.emitir_periodo_anterior` y motivo.
 */
export function esPeriodoAnterior(estado: EstadoPeriodo): boolean {
    return estado === 'antes_de_facturar_desde' || estado === 'antes_del_inicio'
}

/**
 * Vencimiento de un periodo que se emite **a mano** hoy: `max(periodo + dias_gracia, hoy +
 * dias_gracia)` (decisiones del PM del 21 nov: lo pasado a mano —anterior al inicio, al cobro o un
 * pendiente que el cron no emitió— da al cliente su plazo de gracia completo desde que se le factura;
 * si no paga, se corta como siempre). Un futuro conserva su fecha normal (ya es posterior). El cron no
 * usa esta función: sus facturas vencen en `periodo + dias_gracia`.
 */
export function vencimientoDe(periodo: string, hoy: string, diasGracia: number): string {
    const normal = sumarDias(periodo, diasGracia)
    const desdeHoy = sumarDias(hoy, diasGracia)
    return desdeHoy > normal ? desdeHoy : normal
}

export const MOTIVOS_NO_EMITIBLE = [
    'servicio_retirado',
    'servicio_pendiente_instalacion',
    'sin_plantilla',
] as const
export type MotivoNoEmitible = (typeof MOTIVOS_NO_EMITIBLE)[number]

const DETALLE_NO_EMITIBLE: Record<MotivoNoEmitible, string> = {
    servicio_retirado: 'El servicio está retirado: no se le emiten facturas de periodo',
    servicio_pendiente_instalacion:
        'El servicio está pendiente de instalación: sus periodos se facturan desde que se activa',
    sin_plantilla: 'El servicio no tiene plantilla de facturación',
}

export interface Ocupacion {
    factura_id: number | null
    bonificacion_id: number | null
    factura_estado: string | null
    total: string
    pagado: string
    vence_en: string | null
}

export interface PeriodoDelServicio extends PeriodoFacturable {
    estado: EstadoPeriodo
    /** vencimiento: el de la factura emitida, o `periodo + dias_gracia` */
    vence_en: string
    ocupacion: Ocupacion | null
}

/** Cómo se cobró ya el tramo inicial (factura vigente, no anulada). */
export interface TramoCobrado {
    modo: 'primera_factura' | 'cargo_unico'
    factura_id: number
}

/** Tramo entre el inicio del ciclo y la instalación (`tramoAntesDelPrimerPeriodo`). */
export interface TramoInicial {
    desde: string
    /** primer día facturable del servicio (exclusivo) */
    fin: string
    dias: number
    dias_ciclo: number
    /** el primer periodo del servicio (el que lo incluiría) */
    primer_periodo: string
    cobrado: TramoCobrado | null
}

export interface PeriodosDelServicio {
    servicio: ServicioFacturable
    config: ConfiguracionFacturacion | null
    hoy: string
    facturar_desde: string | null
    /** por qué no se le pueden emitir periodos (null = sí se puede) */
    no_emitible: MotivoNoEmitible | null
    /** los anteriores al inicio y todos hasta el último futuro permitido, ascendentes */
    periodos: PeriodoDelServicio[]
    /** tramo entre el inicio del ciclo y la instalación, si lo hay */
    tramo_inicial: TramoInicial | null
}

export function motivoNoEmitible(
    servicio: ServicioFacturable,
    config: ConfiguracionFacturacion | null,
): MotivoNoEmitible | null {
    if (servicio.estado === 'retirado') return 'servicio_retirado'
    if (servicio.estado === 'pendiente_instalacion') return 'servicio_pendiente_instalacion'
    if (!config) return 'sin_plantilla'
    return null
}

/** 422 con la regla de por qué el servicio no admite emitir periodos. */
export function exigirEmitible(p: PeriodosDelServicio): ConfiguracionFacturacion {
    if (p.no_emitible || !p.config) {
        const regla = p.no_emitible ?? 'sin_plantilla'
        throw new ReglaNegocio(DETALLE_NO_EMITIBLE[regla], regla, [
            { field: 'servicio_id', message: DETALLE_NO_EMITIBLE[regla], rule: regla },
        ])
    }
    return p.config
}

/** Fecha lejana para pedir a `periodosHasta` más periodos de los que se cortan (ciclos mensuales). */
function horizonte(hoy: string): string {
    return sumarDias(hoy, 31 * (MAXIMO_PERIODOS_FUTUROS + 2))
}

/**
 * Los periodos del servicio con su estado: los `MAXIMO_PERIODOS_ANTERIORES` anteriores a su inicio y
 * los suyos hasta el `MAXIMO_PERIODOS_FUTUROS`-ésimo futuro. Sin plantilla, retirado o pendiente de
 * instalación: `no_emitible` y ningún periodo. Lo no emitido va sin prorrateo (factor 1).
 */
export async function periodosDelServicio(
    cliente: QueryClientContract,
    servicioId: number,
    hoy: string = hoyGuatemala(),
): Promise<PeriodosDelServicio> {
    const servicio = await leerServicio(cliente, servicioId)
    const config = await configuracionDeServicio(cliente, servicio)
    const noEmitible = motivoNoEmitible(servicio, config)
    const facturarDesde = await facturarDesdeDe(cliente, servicioId)
    const base = { servicio, config, hoy, facturar_desde: facturarDesde, no_emitible: noEmitible }
    if (noEmitible || !config) return { ...base, periodos: [], tramo_inicial: null }

    let futuros = 0
    const delServicio = periodosHasta(config, servicio.inicio, horizonte(hoy)).filter((p) => {
        if (p.periodo <= hoy) return true
        futuros += 1
        return futuros <= MAXIMO_PERIODOS_FUTUROS
    })
    const anteriores = periodosAntesDelInicio(config, servicio.inicio, MAXIMO_PERIODOS_ANTERIORES)
    const inicioServicio = delServicio[0]?.periodo ?? servicio.inicio
    const calculados = [...anteriores, ...delServicio]
    const ocupados = await ocupacionDe(
        cliente,
        servicio.id,
        calculados.map((p) => p.periodo),
    )
    const periodos = calculados.map((p): PeriodoDelServicio => {
        const ocupacion = ocupados.get(p.periodo) ?? null
        let estado: EstadoPeriodo
        if (ocupacion) estado = ocupacion.factura_id ? 'emitida' : 'bonificada'
        else if (p.periodo < inicioServicio) estado = 'antes_del_inicio'
        else if (p.periodo > hoy) estado = 'futuro'
        else if (facturarDesde && p.periodo < facturarDesde) estado = 'antes_de_facturar_desde'
        else estado = 'pendiente'
        return {
            ...p,
            // a mano nunca se prorratea; lo emitido queda como se emitió
            factor: ocupacion ? p.factor : '1',
            estado,
            vence_en: ocupacion?.vence_en ?? vencimientoDe(p.periodo, hoy, config.dias_gracia),
            ocupacion,
        }
    })
    return { ...base, periodos, tramo_inicial: await tramoDe(cliente, servicio, config) }
}

/** El tramo inicial del servicio y, si ya se cobró, cómo (primera factura o cargo único). */
async function tramoDe(
    cliente: QueryClientContract,
    servicio: ServicioFacturable,
    config: ConfiguracionFacturacion,
): Promise<TramoInicial | null> {
    const tramo = tramoAntesDelPrimerPeriodo(config, servicio.inicio)
    if (!tramo) return null
    const fila = (await cliente
        .from('billing.facturas')
        .where('servicio_id', servicio.id)
        .whereNot('estado', 'anulada')
        .where((q) =>
            q
                .where('clave_unica', claveTramoInicial(servicio.id, tramo.desde))
                .orWhere((r) =>
                    r
                        .whereRaw(`split_part(clave_unica, '#', 1) = ?`, [
                            claveFactura(servicio.id, servicio.inicio),
                        ])
                        .whereRaw(
                            `jsonb_typeof(reglas_snapshot->'emision_manual'->'tramo_inicial') = 'object'`,
                        ),
                ),
        )
        .orderBy('id', 'desc')
        .select('id', 'clave_unica')
        .first()) as { id: number; clave_unica: string } | null
    return {
        ...tramo,
        primer_periodo: servicio.inicio,
        cobrado: fila
            ? {
                  modo: fila.clave_unica.startsWith('cargo-') ? 'cargo_unico' : 'primera_factura',
                  factura_id: Number(fila.id),
              }
            : null,
    }
}

/**
 * Factura (o bonificación) que ocupa la clave de cada periodo. Si la factura se sustituyó
 * (`<clave>#s<n>`), la vigente: la más reciente que no esté anulada (o la original si todas lo están).
 */
async function ocupacionDe(
    cliente: QueryClientContract,
    servicioId: number,
    periodos: string[],
): Promise<Map<string, Ocupacion>> {
    const salida = new Map<string, Ocupacion>()
    if (periodos.length === 0) return salida
    const facturas = (await cliente
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .where('tipo', 'servicio')
        .whereRaw(`split_part(clave_unica, '#', 1) = ANY(?)`, [
            periodos.map((p) => claveFactura(servicioId, p)),
        ])
        .orderBy('id', 'asc')
        .select(
            'id',
            'estado',
            'total',
            'pagado',
            cliente.raw(`split_part(clave_unica, '#', 1) as clave`),
            cliente.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
        )) as Array<{
        id: number
        estado: string
        total: string
        pagado: string
        clave: string
        vence_en: string
    }>
    for (const f of facturas) {
        const periodo = f.clave.slice(String(servicioId).length + 1)
        const previa = salida.get(periodo)
        // la última no anulada gana; una anulada solo si no hay otra
        if (previa && f.estado === 'anulada' && previa.factura_estado !== 'anulada') continue
        salida.set(periodo, {
            factura_id: Number(f.id),
            bonificacion_id: null,
            factura_estado: f.estado,
            total: aTexto(f.total),
            pagado: aTexto(f.pagado),
            vence_en: f.vence_en,
        })
    }
    const bonificaciones = (await cliente
        .from('billing.bonificaciones')
        .whereIn(
            'clave_unica',
            periodos.map((p) => claveFactura(servicioId, p)),
        )
        .select('id', 'clave_unica')) as Array<{ id: number; clave_unica: string }>
    for (const b of bonificaciones) {
        const periodo = b.clave_unica.slice(String(servicioId).length + 1)
        if (salida.has(periodo)) continue
        salida.set(periodo, {
            factura_id: null,
            bonificacion_id: Number(b.id),
            factura_estado: null,
            total: '0.00',
            pagado: '0.00',
            vence_en: null,
        })
    }
    return salida
}

// ---------------------------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------------------------

export interface PeriodoVistaPrevia {
    periodo: string
    /** último día del periodo */
    hasta: string
    dias: number
    dias_ciclo: number
    factor: string
    prorrateado: boolean
    estado: EstadoPeriodo
    vence_en: string
    /** total de la factura: la emitida, o la que se emitiría hoy (null si no se pudo calcular) */
    monto: string | null
    /** parte que cubriría (o ya cubre) el saldo a favor o los pagos */
    pagado: string | null
    factura_id: number | null
    factura_estado: string | null
    bonificacion_id: number | null
    /** el periodo quedaría en cero y se registraría como bonificación (nunca una factura de Q0) */
    sera_bonificacion: boolean
    /** por qué no se pudo calcular el monto (p. ej. un bloqueo del libro) */
    error: string | null
}

/** El tramo inicial en la vista previa: qué se puede hacer con él y cuánto sugiere el cargo único. */
export interface TramoInicialVista {
    desde: string
    /** último día del tramo (el anterior a la instalación) */
    hasta: string
    dias: number
    dias_ciclo: number
    primer_periodo: string
    /** el primer periodo aún no tiene factura: se puede incluir el tramo en ella */
    primer_periodo_libre: boolean
    /** sugerencia editable del cargo único: precio efectivo × dias / dias_ciclo */
    monto_proporcional: string
    /** vencimiento del cargo único (hoy + dias_gracia) */
    vence_cargo: string
    /** ya cobrado: cómo, y su factura */
    cobrado_como: TramoCobrado['modo'] | null
    factura_id: number | null
}

/** Sugerencia del cargo único del tramo: el precio efectivo del servicio proporcional a sus días. */
export function montoProporcionalTramo(
    precio: string,
    tramo: Pick<TramoInicial, 'dias' | 'dias_ciclo'>,
): string {
    return aTexto(redondear(dec(precio).times(tramo.dias).div(tramo.dias_ciclo)))
}

export interface VistaPreviaPeriodos {
    servicio_id: number
    cliente_id: number
    empresa_id: number
    estado_servicio: string
    emitible: boolean
    motivo: MotivoNoEmitible | null
    hoy: string
    facturar_desde: string | null
    maximo_futuros: number
    maximo_anteriores: number
    /** saldo a favor (Anticipos) del cliente en la empresa del servicio, antes de emitir */
    saldo_a_favor: string
    periodos: PeriodoVistaPrevia[]
    tramo_inicial: TramoInicialVista | null
}

/**
 * `GET /servicios/:id/periodos-facturables`: los periodos con su estado y su monto. El monto de lo
 * no emitido sale de emitir de verdad (`EmitirFactura`) todos los periodos no ocupados, en orden, en
 * una transacción que se revierte (`simularEnTransaccion`): mismo precio efectivo, prorrateo,
 * conceptos recurrentes, adicionales y descuentos de lealtad que tendría la factura, y el saldo a
 * favor aplicado de la más antigua a la más nueva. Nada queda escrito.
 *
 * `hasta`: solo los periodos que empiezan ese día o antes; 422 `maximo_periodos_futuros` si pide más
 * allá del último futuro permitido.
 */
export async function vistaPreviaPeriodos(
    cliente: QueryClientContract,
    servicioId: number,
    ctx: ContextoAccion,
    opciones: { hasta?: string; hoy?: string } = {},
): Promise<VistaPreviaPeriodos> {
    const datos = await periodosDelServicio(cliente, servicioId, opciones.hoy)
    const { servicio } = datos
    if (opciones.hasta) exigirDentroDelMaximo(datos, opciones.hasta, 'hasta')
    const elegidos = opciones.hasta
        ? datos.periodos.filter((p) => p.periodo <= opciones.hasta!)
        : datos.periodos
    const saldo = await saldoAnticipos(cliente, servicio.cliente_id, servicio.empresa_id)

    const calculados = new Map<
        string,
        { monto: string | null; pagado: string | null; bonificacion: boolean; error: string | null }
    >()
    // los anteriores al inicio, al final: el saldo a favor se muestra primero sobre los del servicio
    const libres = [
        ...elegidos.filter((p) => !p.ocupacion && p.estado !== 'antes_del_inicio'),
        ...elegidos.filter((p) => !p.ocupacion && p.estado === 'antes_del_inicio'),
    ]
    if (libres.length > 0) {
        await simularEnTransaccion(ctx, async (t) => {
            for (const p of libres) {
                try {
                    const r = await new EmitirFactura().execute(
                        {
                            servicio_id: servicio.id,
                            periodo: soloPeriodo(p),
                            manual: manualDe(p, null),
                        },
                        ctx,
                        { trx: t.trx },
                    )
                    if (r.factura_id && r.creada) {
                        const f = (await t.trx
                            .from('billing.facturas')
                            .where('id', r.factura_id)
                            .select('total', 'pagado')
                            .firstOrFail()) as { total: string; pagado: string }
                        calculados.set(p.periodo, {
                            monto: aTexto(f.total),
                            pagado: aTexto(f.pagado),
                            bonificacion: false,
                            error: null,
                        })
                    } else if (r.bonificacion_id) {
                        calculados.set(p.periodo, {
                            monto: '0.00',
                            pagado: '0.00',
                            bonificacion: true,
                            error: null,
                        })
                    } else {
                        calculados.set(p.periodo, {
                            monto: null,
                            pagado: null,
                            bonificacion: false,
                            error: r.motivo,
                        })
                    }
                } catch (error) {
                    calculados.set(p.periodo, {
                        monto: null,
                        pagado: null,
                        bonificacion: false,
                        error: error instanceof Error ? error.message : String(error),
                    })
                }
            }
        })
    }
    // lo ya emitido (monto y pagado) se leyó antes de la simulación: tal como está hoy
    return {
        servicio_id: servicio.id,
        cliente_id: servicio.cliente_id,
        empresa_id: servicio.empresa_id,
        estado_servicio: servicio.estado,
        emitible: datos.no_emitible === null,
        motivo: datos.no_emitible,
        hoy: datos.hoy,
        facturar_desde: datos.facturar_desde,
        maximo_futuros: MAXIMO_PERIODOS_FUTUROS,
        maximo_anteriores: MAXIMO_PERIODOS_ANTERIORES,
        saldo_a_favor: aTexto(saldo),
        periodos: elegidos.map((p) => {
            const calc = calculados.get(p.periodo)
            return {
                periodo: p.periodo,
                hasta: sumarDias(p.fin, -1),
                dias: p.dias,
                dias_ciclo: p.dias_ciclo,
                factor: p.factor,
                prorrateado: p.factor !== '1',
                estado: p.estado,
                vence_en: p.vence_en,
                monto: p.ocupacion ? p.ocupacion.total : (calc?.monto ?? null),
                pagado: p.ocupacion ? p.ocupacion.pagado : (calc?.pagado ?? null),
                factura_id: p.ocupacion?.factura_id ?? null,
                factura_estado: p.ocupacion?.factura_estado ?? null,
                bonificacion_id: p.ocupacion?.bonificacion_id ?? null,
                sera_bonificacion: calc?.bonificacion ?? false,
                error: calc?.error ?? null,
            }
        }),
        tramo_inicial: datos.tramo_inicial && datos.config ? tramoVista(datos, datos.tramo_inicial) : null,
    }
}

function tramoVista(datos: PeriodosDelServicio, tramo: TramoInicial): TramoInicialVista {
    const primero = datos.periodos.find((p) => p.periodo === tramo.primer_periodo)
    return {
        desde: tramo.desde,
        hasta: sumarDias(tramo.fin, -1),
        dias: tramo.dias,
        dias_ciclo: tramo.dias_ciclo,
        primer_periodo: tramo.primer_periodo,
        primer_periodo_libre: Boolean(primero && !primero.ocupacion),
        monto_proporcional: montoProporcionalTramo(datos.servicio.precio, tramo),
        vence_cargo: sumarDias(datos.hoy, datos.config!.dias_gracia),
        cobrado_como: tramo.cobrado?.modo ?? null,
        factura_id: tramo.cobrado?.factura_id ?? null,
    }
}

/**
 * La emisión manual de un periodo para `EmitirFactura`: permite lo anterior (quien llama ya validó
 * permiso y motivo), fija el vencimiento de la vista previa (`vencimientoDe`) y nunca prorratea
 * (el factor ya viene en 1). `monto`: el total editado a mano, si lo hay.
 */
export function manualDe(
    p: PeriodoDelServicio,
    motivo: string | null,
    monto: string | null = null,
    tramoDesde: string | null = null,
): NonNullable<EntradaEmitirFactura['manual']> {
    return {
        motivo,
        antes_de_facturar_desde: p.estado === 'antes_de_facturar_desde',
        antes_del_inicio: p.estado === 'antes_del_inicio',
        vence_en: p.vence_en,
        monto,
        tramo_desde: tramoDesde,
    }
}

/** El periodo tal como lo recibe `EmitirFactura` (sin estado ni ocupación). */
export function soloPeriodo(p: PeriodoFacturable): PeriodoFacturable {
    return { periodo: p.periodo, fin: p.fin, dias: p.dias, dias_ciclo: p.dias_ciclo, factor: p.factor }
}

/** 422 `maximo_periodos_futuros` si `fecha` va más allá del último periodo futuro permitido. */
export function exigirDentroDelMaximo(datos: PeriodosDelServicio, fecha: string, campo: string): void {
    const ultimo = datos.periodos.at(-1)
    if (!ultimo || fecha < ultimo.fin) return
    const mensaje = `Se pueden emitir hasta ${MAXIMO_PERIODOS_FUTUROS} periodos futuros: el último empieza el ${ultimo.periodo}`
    throw new ReglaNegocio(mensaje, 'maximo_periodos_futuros', [
        { field: campo, message: mensaje, rule: 'maximo_periodos_futuros' },
    ])
}
