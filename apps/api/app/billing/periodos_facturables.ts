import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { simularEnTransaccion } from '#shared/domain_action'
import type { ContextoAccion } from '#shared/contexto'
import { ReglaNegocio } from '#shared/errores'
import { aTexto } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { configuracionDeServicio, leerServicio, type ServicioFacturable } from '#billing/configuracion'
import type { ConfiguracionFacturacion } from '#billing/excepciones'
import { facturarDesdeDe } from '#billing/asignacion_plantilla'
import { saldoAnticipos } from '#billing/cobros'
import { claveFactura, periodosHasta, sumarDias, type PeriodoFacturable } from '#billing/periodos'
import EmitirFactura from '#billing/actions/emitir_factura'

/**
 * Periodos de un servicio para la emisión manual (`facturas.emitir_periodos`, pedido del PM del 19
 * nov: «no puedo agregar facturas siguientes (pago por adelantado) ni agregar facturas a un
 * servicio»). Lo comparten la vista previa (`GET /servicios/:id/periodos-facturables`) y la acción
 * (`POST /servicios/:id/facturas-periodo`), así las dos ven los mismos periodos.
 *
 * - Los periodos salen de `periodosHasta` (los mismos del cron): del primer día facturable del
 *   servicio en adelante, con el prorrateo del primer periodo.
 * - **Pasados y el actual** (empiezan hoy o antes): `pendiente` si el cron lo emitiría,
 *   `antes_de_facturar_desde` si el servicio recibió plantilla después (nada hacia atrás para el
 *   cron; a mano, solo con `facturas.emitir_periodo_anterior` y motivo).
 * - **Futuros** (empiezan después de hoy, pago adelantado): hasta `MAXIMO_PERIODOS_FUTUROS`.
 * - Un periodo con factura (o bonificación) en su `clave_unica = servicio_id-periodo` está ocupado:
 *   `emitida` o `bonificada`, nunca se vuelve a emitir.
 */

/** Periodos futuros (pago adelantado) que se pueden emitir o ver a la vez. */
export const MAXIMO_PERIODOS_FUTUROS = 12

export const ESTADOS_PERIODO = [
    'emitida',
    'bonificada',
    'pendiente',
    'futuro',
    'antes_de_facturar_desde',
] as const
export type EstadoPeriodo = (typeof ESTADOS_PERIODO)[number]

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

export interface PeriodosDelServicio {
    servicio: ServicioFacturable
    config: ConfiguracionFacturacion | null
    hoy: string
    facturar_desde: string | null
    /** por qué no se le pueden emitir periodos (null = sí se puede) */
    no_emitible: MotivoNoEmitible | null
    /** todos los periodos hasta el último futuro permitido, ascendentes */
    periodos: PeriodoDelServicio[]
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
 * Los periodos del servicio con su estado, hasta el `MAXIMO_PERIODOS_FUTUROS`-ésimo futuro. Sin
 * plantilla, retirado o pendiente de instalación: `no_emitible` y ningún periodo.
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
    if (noEmitible || !config) return { ...base, periodos: [] }

    let futuros = 0
    const calculados = periodosHasta(config, servicio.inicio, horizonte(hoy)).filter((p) => {
        if (p.periodo <= hoy) return true
        futuros += 1
        return futuros <= MAXIMO_PERIODOS_FUTUROS
    })
    const ocupados = await ocupacionDe(
        cliente,
        servicio.id,
        calculados.map((p) => p.periodo),
    )
    const periodos = calculados.map((p): PeriodoDelServicio => {
        const ocupacion = ocupados.get(p.periodo) ?? null
        let estado: EstadoPeriodo
        if (ocupacion) estado = ocupacion.factura_id ? 'emitida' : 'bonificada'
        else if (p.periodo > hoy) estado = 'futuro'
        else if (facturarDesde && p.periodo < facturarDesde) estado = 'antes_de_facturar_desde'
        else estado = 'pendiente'
        return {
            ...p,
            estado,
            vence_en: ocupacion?.vence_en ?? sumarDias(p.periodo, config.dias_gracia),
            ocupacion,
        }
    })
    return { ...base, periodos }
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
    /** saldo a favor (Anticipos) del cliente en la empresa del servicio, antes de emitir */
    saldo_a_favor: string
    periodos: PeriodoVistaPrevia[]
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
    const libres = elegidos.filter((p) => !p.ocupacion)
    if (libres.length > 0) {
        await simularEnTransaccion(ctx, async (t) => {
            for (const p of libres) {
                try {
                    const r = await new EmitirFactura().execute(
                        {
                            servicio_id: servicio.id,
                            periodo: soloPeriodo(p),
                            manual: { motivo: null, antes_de_facturar_desde: true },
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
