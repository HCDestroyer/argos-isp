import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { aTexto, dec } from '#ledger/dinero'
import { ZONA_NEGOCIO, hoyGuatemala } from '#ledger/fechas'

/**
 * Resúmenes del dashboard (`GET /dashboard/resumen`): vistas materializadas de
 * `billing.resumen_*` que se refrescan **por evento** (nunca por intervalo ni TTL).
 *
 * `ConsumidorResumenes` (grupo `billing`, `node ace billing:worker`) refresca solo las vistas
 * que el evento puede cambiar. Refrescar recalcula desde las tablas fuente: repetir un evento
 * (entrega al menos una vez) deja el mismo resultado, así que es idempotente por construcción.
 * No es lógica de negocio (no decide nada ni cambia datos de negocio): es la invalidación de un
 * dato derivado, como las cachés de RADIUS; por eso no pasa por una acción ni deja auditoría.
 */

export const VISTAS_RESUMEN = [
    'resumen_mensual',
    'resumen_cobros_diarios',
    'resumen_servicios',
    'resumen_cartera',
    'resumen_promesas',
] as const
export type VistaResumen = (typeof VISTAS_RESUMEN)[number]

/** Qué vistas cambia cada evento. */
export function vistasDeEvento(evento: string): VistaResumen[] {
    if (evento.startsWith('factura.')) return ['resumen_mensual', 'resumen_cartera']
    if (evento.startsWith('pago.')) return ['resumen_mensual', 'resumen_cobros_diarios', 'resumen_cartera']
    if (evento === 'servicio.estado_cambiado' || evento === 'servicio.creado') return ['resumen_servicios']
    if (evento.startsWith('promesa.')) return ['resumen_promesas']
    return []
}

/** Refresca las vistas (CONCURRENTLY, vía la función SECURITY DEFINER) y anota el evento. */
export async function refrescarResumenes(
    vistas: readonly VistaResumen[] = VISTAS_RESUMEN,
    eventoId: number | null = null,
): Promise<void> {
    for (const vista of new Set(vistas)) {
        await db.rawQuery('SELECT billing.refrescar_resumen(?)', [vista])
        await db.rawQuery(
            `INSERT INTO billing.resumenes_refrescos (vista, refrescado_en, ultimo_evento_id, refrescos)
             VALUES (?, now(), ?, 1)
             ON CONFLICT (vista) DO UPDATE SET
                 refrescado_en = now(),
                 ultimo_evento_id = greatest(billing.resumenes_refrescos.ultimo_evento_id, excluded.ultimo_evento_id),
                 refrescos = billing.resumenes_refrescos.refrescos + 1`,
            [vista, eventoId],
        )
    }
}

export class ConsumidorResumenes implements ConsumidorEventos {
    readonly nombre = 'billing.resumenes'

    acepta(evento: string): boolean {
        return vistasDeEvento(evento).length > 0
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        const id = typeof evento.id === 'number' ? evento.id : Number.parseInt(String(evento.id), 10)
        await refrescarResumenes(vistasDeEvento(evento.evento), Number.isFinite(id) ? id : null)
    }
}

/*
|--------------------------------------------------------------------------
| Lectura del dashboard
|--------------------------------------------------------------------------
*/

export interface SerieMensual {
    periodo: string
    facturado: string
    cobrado: string
    facturas: number
    pagos: number
}

export interface ResumenDashboard {
    servicios: { activos: number; limitados: number; suspendidos: number; retirados: number }
    clientes: { activos: number; limitados: number; cortados: number }
    mes: { periodo: string; facturado: string; cobrado: string; cobranza_pct: number }
    cartera_vencida: { monto: string; facturas: number; clientes: number; pendiente_total: string }
    hoy: { fecha: string; cobrado: string; pagos: number }
    promesas_activas: { cantidad: number; monto: string }
    series: SerieMensual[]
    actualizado_en: Record<VistaResumen, string | null>
}

/**
 * Lee solo las vistas materializadas (nada en vivo): lo que muestran es lo del último evento.
 * Multiempresa: las vistas van por empresa; se suman las de `empresas` (null = todas, el
 * consolidado). Un cliente con servicios en dos empresas cuenta en cada una.
 */
export async function resumenDashboard(
    ahora: Date = new Date(),
    empresas: number[] | null = null,
): Promise<ResumenDashboard> {
    const deEmpresas = <Q extends { whereIn: (c: string, v: number[]) => Q }>(q: Q) =>
        empresas === null ? q : q.whereIn('empresa_id', empresas)
    const hoy = hoyGuatemala(ahora)
    const inicioMes = DateTime.fromISO(hoy, { zone: ZONA_NEGOCIO }).startOf('month')
    const meses = Array.from({ length: 12 }, (_, i) => inicioMes.minus({ months: 11 - i }).toISODate()!)

    const servicios = (await deEmpresas(db.from('billing.resumen_servicios'))
        .groupBy('estado')
        .select(
            'estado',
            db.raw('sum(servicios)::int as servicios'),
            db.raw('sum(clientes)::int as clientes'),
        )) as Array<{
        estado: string
        servicios: number
        clientes: number
    }>
    const porEstado = (estado: string) => servicios.find((s) => s.estado === estado)
    const mensual = (await deEmpresas(db.from('billing.resumen_mensual'))
        .whereIn('mes', meses)
        .groupBy('mes')
        .select(
            db.raw(`to_char(mes, 'YYYY-MM-DD') as mes`),
            db.raw('sum(facturas)::int as facturas'),
            db.raw('sum(facturado)::text as facturado'),
            db.raw('sum(pagos)::int as pagos'),
            db.raw('sum(cobrado)::text as cobrado'),
        )) as Array<{ mes: string; facturas: number; facturado: string; pagos: number; cobrado: string }>
    const series = meses.map((mes) => {
        const fila = mensual.find((m) => m.mes === mes)
        return {
            periodo: mes.slice(0, 7),
            facturado: aTexto(fila?.facturado ?? '0'),
            cobrado: aTexto(fila?.cobrado ?? '0'),
            facturas: fila?.facturas ?? 0,
            pagos: fila?.pagos ?? 0,
        }
    })
    const actual = series.at(-1)!
    const cartera = (await deEmpresas(db.from('billing.resumen_cartera'))
        .select(
            db.raw('coalesce(sum(vencida), 0)::text as vencida'),
            db.raw('coalesce(sum(facturas_vencidas), 0)::int as facturas_vencidas'),
            db.raw('coalesce(sum(clientes_morosos), 0)::int as clientes_morosos'),
            db.raw('coalesce(sum(pendiente), 0)::text as pendiente'),
        )
        .first()) as {
        vencida: string
        facturas_vencidas: number
        clientes_morosos: number
        pendiente: string
    } | null
    const diario = (await deEmpresas(db.from('billing.resumen_cobros_diarios'))
        .where('dia', hoy)
        .select(
            db.raw('coalesce(sum(pagos), 0)::int as pagos'),
            db.raw('coalesce(sum(cobrado), 0)::text as cobrado'),
        )
        .first()) as { pagos: number; cobrado: string } | null
    const promesa = (await deEmpresas(db.from('billing.resumen_promesas'))
        .where('estado', 'activa')
        .select(
            db.raw('coalesce(sum(promesas), 0)::int as promesas'),
            db.raw('coalesce(sum(monto), 0)::text as monto'),
        )
        .first()) as { promesas: number; monto: string } | null
    const refrescos = (await db
        .from('billing.resumenes_refrescos')
        .select('vista', 'refrescado_en')) as Array<{
        vista: VistaResumen
        refrescado_en: Date
    }>

    const cobrado = dec(actual.cobrado)
    const facturado = dec(actual.facturado)
    return {
        servicios: {
            activos: porEstado('activo')?.servicios ?? 0,
            limitados: porEstado('limitado')?.servicios ?? 0,
            suspendidos: porEstado('suspendido')?.servicios ?? 0,
            retirados: porEstado('retirado')?.servicios ?? 0,
        },
        clientes: {
            activos: porEstado('activo')?.clientes ?? 0,
            limitados: porEstado('limitado')?.clientes ?? 0,
            cortados: porEstado('suspendido')?.clientes ?? 0,
        },
        mes: {
            periodo: actual.periodo,
            facturado: actual.facturado,
            cobrado: actual.cobrado,
            cobranza_pct: facturado.isZero()
                ? 0
                : cobrado.times(100).div(facturado).toDecimalPlaces(2).toNumber(),
        },
        cartera_vencida: {
            monto: aTexto(cartera?.vencida ?? '0'),
            facturas: cartera?.facturas_vencidas ?? 0,
            clientes: cartera?.clientes_morosos ?? 0,
            pendiente_total: aTexto(cartera?.pendiente ?? '0'),
        },
        hoy: { fecha: hoy, cobrado: aTexto(diario?.cobrado ?? '0'), pagos: diario?.pagos ?? 0 },
        promesas_activas: { cantidad: promesa?.promesas ?? 0, monto: aTexto(promesa?.monto ?? '0') },
        series,
        actualizado_en: Object.fromEntries(
            VISTAS_RESUMEN.map((v) => {
                const fila = refrescos.find((r) => r.vista === v)
                return [v, fila ? new Date(fila.refrescado_en).toISOString() : null]
            }),
        ) as Record<VistaResumen, string | null>,
    }
}
