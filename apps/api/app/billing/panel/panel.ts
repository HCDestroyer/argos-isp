import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import { Problema } from '#shared/errores'
import { CERO, aTexto, dec, redondear } from '#ledger/dinero'
import { ZONA_NEGOCIO, hoyGuatemala } from '#ledger/fechas'
import type { Bloque } from '#fiscal/bloques'
import { bloquesDelTablero } from '#fiscal/tablero'
import { configuracionFel } from '#fiscal/fel/configuracion'
import { avisoPcActivo } from '#billing/actions/configurar_panel_financiero'
import {
    bajasPorMes,
    efectivoDisponible,
    efectivoVacio,
    ingresoRecurrente,
    ingresoVacio,
    promedio,
    type BajasMes,
    type EfectivoDisponible,
    type IngresoRecurrente,
} from '#billing/panel/indicadores'

/**
 * Panel financiero (`GET /panel-financiero`) y sus alertas (`GET /panel-financiero/alertas`),
 * `contratos/reportes.md` §2 y §3. Solo lectura.
 *
 * - Una sección por empresa pedida (la activa, las del alcance o, con `empresas=todas` y alcance
 *   global, todas) y `total` solo en el consolidado (`empresas=todas`).
 * - Cada cifra es un bloque (`#fiscal/bloques`): si no se pudo calcular trae su error RFC 9457 y
 *   nunca ceros en su lugar. Una sección para la que el usuario no tiene permiso **no aparece**
 *   (efectivo exige `libro.ver`; en las alertas, el libro exige `libro.ver` y lo fiscal `fiscal.ver`).
 */

export const SECCIONES_PANEL = ['ingresos', 'bajas', 'efectivo'] as const
export type SeccionPanel = (typeof SECCIONES_PANEL)[number]

export interface EmpresaPanel {
    empresa_id: number
    empresa: string
    ingresos?: Bloque
    bajas?: Bloque
    efectivo?: Bloque
}

export interface PanelFinanciero {
    hoy: string
    mes: string
    generado_en: string
    empresas: EmpresaPanel[]
    total: Omit<EmpresaPanel, 'empresa_id' | 'empresa'> | null
}

function ok<T extends object>(datos: T): Bloque {
    return { estado: 'ok', motivo: null, error: null, datos: datos as Record<string, unknown> }
}

function fallo(error: unknown, seccion: string): Bloque {
    if (error instanceof Problema) {
        return { estado: 'error', motivo: null, error: error.toJSON(), datos: null }
    }
    logger.error({ err: error, seccion }, 'panel financiero')
    return {
        estado: 'error',
        motivo: null,
        error: new Problema(
            500,
            'error_interno',
            'Error interno',
            `La sección ${seccion} no se pudo calcular; las demás sí`,
        ).toJSON(),
        datos: null,
    }
}

async function nombresEmpresas(empresas: number[] | null): Promise<Array<{ id: number; nombre: string }>> {
    const filas = (await db
        .from('core.empresas')
        .where('activa', true)
        .if(empresas !== null, (q) => q.whereIn('id', empresas!))
        .orderBy('id', 'asc')
        .select('id', 'nombre_comercial')) as Array<{ id: number; nombre_comercial: string }>
    return filas.map((f) => ({ id: Number(f.id), nombre: f.nombre_comercial }))
}

/** `YYYY-MM` válido y no futuro; por defecto el mes en curso de Guatemala. */
export function mesPedido(mes: string | undefined, ahora: Date = new Date()): string {
    const actual = hoyGuatemala(ahora).slice(0, 7)
    if (!mes) return actual
    return mes > actual ? actual : mes
}

export async function panelFinanciero(opciones: {
    empresas: number[] | null
    consolidado: boolean
    secciones: ReadonlySet<SeccionPanel>
    mes?: string
    ahora?: Date
}): Promise<PanelFinanciero> {
    const ahora = opciones.ahora ?? new Date()
    const mes = mesPedido(opciones.mes, ahora)
    const empresas = await nombresEmpresas(opciones.empresas)
    const ids = empresas.map((e) => e.id)
    const s = opciones.secciones

    const calcular = async <T>(seccion: SeccionPanel, fn: () => Promise<Map<number, T>>) => {
        if (!s.has(seccion)) return null
        try {
            return { ok: true as const, datos: await fn() }
        } catch (error) {
            return { ok: false as const, error: fallo(error, seccion) }
        }
    }
    const ingresos = await calcular<IngresoRecurrente>('ingresos', () => ingresoRecurrente(ids))
    const bajas = await calcular<BajasMes[]>('bajas', () => bajasPorMes(ids, [mes], ahora))
    const efectivo = await calcular<EfectivoDisponible>('efectivo', () => efectivoDisponible(ids, ahora))

    const secciones: EmpresaPanel[] = empresas.map((e) => {
        const fila: EmpresaPanel = { empresa_id: e.id, empresa: e.nombre }
        if (ingresos) {
            fila.ingresos = ingresos.ok ? ok(ingresos.datos.get(e.id) ?? ingresoVacio()) : ingresos.error
        }
        if (bajas) {
            fila.bajas = bajas.ok ? ok(bajas.datos.get(e.id)?.[0] ?? bajasVacias(mes)) : bajas.error
        }
        if (efectivo) {
            fila.efectivo = efectivo.ok ? ok(efectivo.datos.get(e.id) ?? efectivoVacio()) : efectivo.error
        }
        return fila
    })

    return {
        hoy: hoyGuatemala(ahora),
        mes,
        generado_en: ahora.toISOString(),
        empresas: secciones,
        total: opciones.consolidado ? totalConsolidado(secciones, mes) : null,
    }
}

function bajasVacias(mes: string): BajasMes {
    return {
        mes,
        dias_baja: 60,
        bajas: 0,
        retiros: 0,
        suspendidos: 0,
        altas: 0,
        vigentes: 0,
        base: 0,
        tasa: null,
    }
}

/** Suma de las secciones; si alguna empresa falló, el total de esa sección es un error (sin cifras). */
function totalConsolidado(empresas: EmpresaPanel[], mes: string): PanelFinanciero['total'] {
    const total: NonNullable<PanelFinanciero['total']> = {}
    const errorDe = (seccion: SeccionPanel) =>
        empresas.find((e) => e[seccion] && e[seccion]!.estado === 'error')?.[seccion] ?? null
    const presentes = (seccion: SeccionPanel) => empresas.some((e) => e[seccion] !== undefined)

    if (presentes('ingresos')) {
        total.ingresos =
            errorDe('ingresos') ??
            ok(
                (() => {
                    const lista = empresas.map((e) => e.ingresos!.datos as unknown as IngresoRecurrente)
                    const suma = (k: keyof IngresoRecurrente) =>
                        aTexto(lista.reduce((acc, i) => acc.plus(dec(String(i[k] ?? '0'))), CERO))
                    const servicios = lista.reduce((n, i) => n + i.servicios, 0)
                    const mrr = dec(suma('mrr'))
                    return {
                        servicios,
                        planes: suma('planes'),
                        descuentos: suma('descuentos'),
                        cargos_recurrentes: suma('cargos_recurrentes'),
                        adicionales: suma('adicionales'),
                        mrr: aTexto(mrr),
                        arpu: promedio(mrr, servicios),
                    } satisfies IngresoRecurrente
                })(),
            )
    }
    if (presentes('bajas')) {
        total.bajas =
            errorDe('bajas') ??
            ok(
                (() => {
                    const lista = empresas.map((e) => e.bajas!.datos as unknown as BajasMes)
                    const n = (k: 'bajas' | 'retiros' | 'suspendidos' | 'altas' | 'vigentes' | 'base') =>
                        lista.reduce((acc, b) => acc + b[k], 0)
                    const base = n('base')
                    const dias = [...new Set(lista.map((b) => b.dias_baja))]
                    return {
                        mes,
                        // con días distintos por empresa no hay un único valor: null
                        dias_baja: dias.length === 1 ? dias[0]! : null,
                        bajas: n('bajas'),
                        retiros: n('retiros'),
                        suspendidos: n('suspendidos'),
                        altas: n('altas'),
                        vigentes: n('vigentes'),
                        base,
                        tasa:
                            base > 0
                                ? aTexto(
                                      redondear(
                                          dec(String(n('bajas')))
                                              .times(100)
                                              .dividedBy(base),
                                      ),
                                  )
                                : null,
                    }
                })(),
            )
    }
    if (presentes('efectivo')) {
        total.efectivo =
            errorDe('efectivo') ??
            ok(
                (() => {
                    const lista = empresas.map((e) => e.efectivo!.datos as unknown as EfectivoDisponible)
                    const suma = (k: 'cajas' | 'bancos' | 'total') =>
                        aTexto(lista.reduce((acc, x) => acc.plus(dec(x[k])), CERO))
                    return { cajas: suma('cajas'), bancos: suma('bancos'), total: suma('total'), cuentas: [] }
                })(),
            )
    }
    return total
}

/*
|--------------------------------------------------------------------------
| Alertas
|--------------------------------------------------------------------------
*/

export const TIPOS_ALERTA = [
    'integridad_libro',
    'cierres_pendientes',
    'contingencia_fel',
    'fel_desactivada',
    'vencimientos_fiscales',
    'limite_pequeno_contribuyente',
] as const
export type TipoAlerta = (typeof TIPOS_ALERTA)[number]

/** De qué permiso depende cada grupo de alertas. */
export const PERMISO_ALERTA: Record<TipoAlerta, 'libro.ver' | 'fiscal.ver'> = {
    integridad_libro: 'libro.ver',
    cierres_pendientes: 'libro.ver',
    contingencia_fel: 'fiscal.ver',
    fel_desactivada: 'fiscal.ver',
    vencimientos_fiscales: 'fiscal.ver',
    limite_pequeno_contribuyente: 'fiscal.ver',
}

export interface Alerta {
    tipo: TipoAlerta
    nivel: 'aviso' | 'critico'
    titulo: string
    detalle: string
    datos: Record<string, unknown>
}

export interface EmpresaAlertas {
    empresa_id: number
    empresa: string
    alertas: Alerta[]
    /** revisiones que no se pudieron hacer (su alerta no se sabe: nunca se da por buena) */
    errores: Array<{ tipo: TipoAlerta; error: ReturnType<Problema['toJSON']> }>
    /**
     * avisos que la empresa apagó en sus ajustes: no dan alerta ni error, salvo
     * `limite_pequeno_contribuyente` al 100 % (decisión 12), que llega igual en `alertas`
     */
    apagadas: TipoAlerta[]
}

export interface AlertasPanel {
    hoy: string
    generado_en: string
    /** tipos que se revisaron (los que el usuario puede ver) */
    revisados: TipoAlerta[]
    empresas: EmpresaAlertas[]
}

/** Meses ya terminados con asientos que no están cerrados (hasta 24, el más antiguo primero). */
async function mesesSinCerrar(empresaId: number, hoy: string): Promise<string[]> {
    const { rows } = (await db.rawQuery(
        `SELECT m.mes FROM (
             SELECT DISTINCT date_trunc('month', a.fecha)::date AS mes
               FROM ledger.asientos a
              WHERE a.empresa_id = ? AND a.fecha < date_trunc('month', ?::date)
         ) m
          WHERE NOT ledger.periodo_cerrado(m.mes, ?)
          ORDER BY m.mes
          LIMIT 24`,
        [empresaId, hoy, empresaId],
    )) as { rows: Array<{ mes: Date | string }> }
    return rows.map((r) =>
        r.mes instanceof Date
            ? DateTime.fromJSDate(r.mes, { zone: 'utc' }).toFormat('yyyy-MM')
            : String(r.mes).slice(0, 7),
    )
}

async function rupturaLibro(empresaId: number) {
    const { rows } = (await db.rawQuery(
        `SELECT payload, created_at FROM audit.outbox
          WHERE evento = 'libro.integridad_rota' AND (payload->>'empresa_id')::bigint = ?
          ORDER BY id DESC LIMIT 1`,
        [empresaId],
    )) as { rows: Array<{ payload: Record<string, unknown>; created_at: Date }> }
    return rows[0] ?? null
}

export async function alertasPanel(opciones: {
    empresas: number[] | null
    permisos: ReadonlySet<'libro.ver' | 'fiscal.ver'>
    ahora?: Date
}): Promise<AlertasPanel> {
    const ahora = opciones.ahora ?? new Date()
    const hoy = hoyGuatemala(ahora)
    const revisados = TIPOS_ALERTA.filter((t) => opciones.permisos.has(PERMISO_ALERTA[t]))
    const empresas = await nombresEmpresas(opciones.empresas)
    const salida: EmpresaAlertas[] = []

    for (const e of empresas) {
        const fila: EmpresaAlertas = {
            empresa_id: e.id,
            empresa: e.nombre,
            alertas: [],
            errores: [],
            apagadas: [],
        }
        // decisión 12: la empresa puede apagar el aviso de pequeño contribuyente (Configuración › Fiscal)
        if (
            revisados.includes('limite_pequeno_contribuyente') &&
            !(await avisoPcActivo(db.connection(), e.id))
        ) {
            fila.apagadas.push('limite_pequeno_contribuyente')
        }
        const revisar = async (tipos: TipoAlerta[], fn: () => Promise<void>) => {
            const propios = tipos.filter((t) => revisados.includes(t) && !fila.apagadas.includes(t))
            if (propios.length === 0) return
            try {
                await fn()
            } catch (error) {
                const b = fallo(error, propios.join(','))
                for (const tipo of propios) fila.errores.push({ tipo, error: b.error! })
            }
        }

        await revisar(['integridad_libro'], async () => {
            const r = await rupturaLibro(e.id)
            if (!r) return
            fila.alertas.push({
                tipo: 'integridad_libro',
                nivel: 'critico',
                titulo: 'El libro no pasa la verificación de integridad',
                detalle: `La cadena de sellos se rompió en el sello ${String(r.payload.sello)}: un asiento cambió fuera del sistema. Revíselo con su contador antes de cerrar el mes.`,
                datos: { ...r.payload, detectado_en: new Date(r.created_at).toISOString() },
            })
        })

        await revisar(['cierres_pendientes'], async () => {
            const meses = await mesesSinCerrar(e.id, hoy)
            if (meses.length === 0) return
            fila.alertas.push({
                tipo: 'cierres_pendientes',
                nivel: meses.length > 1 ? 'critico' : 'aviso',
                titulo: meses.length === 1 ? 'Hay un mes sin cerrar' : `Hay ${meses.length} meses sin cerrar`,
                detalle: `Meses con movimientos que no se han cerrado: ${meses.join(', ')}.`,
                datos: { meses, cantidad: meses.length },
            })
        })

        await revisar(['contingencia_fel'], async () => {
            const config = await configuracionFel(e.id)
            if (!config.contingencia_activa) return
            fila.alertas.push({
                tipo: 'contingencia_fel',
                nivel: 'critico',
                titulo: 'Facturación electrónica en contingencia',
                detalle: `Las facturas se emiten sin certificar desde ${
                    config.contingencia_desde
                        ? DateTime.fromJSDate(new Date(config.contingencia_desde))
                              .setZone(ZONA_NEGOCIO)
                              .toFormat('dd/MM/yyyy HH:mm')
                        : 'hace un momento'
                }${config.contingencia_motivo ? ` (${config.contingencia_motivo})` : ''}.`,
                datos: {
                    desde: config.contingencia_desde
                        ? new Date(config.contingencia_desde).toISOString()
                        : null,
                    motivo: config.contingencia_motivo,
                },
            })
        })

        await revisar(
            ['fel_desactivada', 'vencimientos_fiscales', 'limite_pequeno_contribuyente'],
            async () => {
                const propios = revisados.filter((t) => !fila.apagadas.includes(t))
                // decisión 12: con el aviso apagado el límite se revisa igual, solo para el 100 %
                const pcApagado = fila.apagadas.includes('limite_pequeno_contribuyente')
                const revisarPc = revisados.includes('limite_pequeno_contribuyente')
                const nombres = [
                    ...(propios.includes('fel_desactivada') ? (['fel'] as const) : []),
                    ...(propios.includes('vencimientos_fiscales') ? (['vencimientos'] as const) : []),
                    ...(revisarPc ? (['pequeno_contribuyente'] as const) : []),
                ]
                const bloques = await bloquesDelTablero(e.id, nombres, db.connection(), hoy)
                const conError = (tipo: TipoAlerta, b: Bloque | undefined) => {
                    if (b?.estado === 'error') fila.errores.push({ tipo, error: b.error! })
                    return b?.estado === 'ok' ? (b.datos as Record<string, unknown>) : null
                }
                const fel = conError('fel_desactivada', bloques.fel)
                if (fel && typeof fel.alerta === 'string') {
                    fila.alertas.push({
                        tipo: 'fel_desactivada',
                        nivel: 'critico',
                        titulo: 'La FEL está desactivada',
                        detalle: fel.alerta,
                        datos: { modo: fel.modo, obligacion_legal: fel.obligacion_legal },
                    })
                }
                const venc = conError('vencimientos_fiscales', bloques.vencimientos)
                if (venc && Array.isArray(venc.obligaciones)) {
                    const proximas = (venc.obligaciones as Array<Record<string, unknown>>).filter(
                        (o) => Number(o.dias_restantes) <= 7,
                    )
                    if (proximas.length > 0) {
                        const vencidas = proximas.filter((o) => o.vencida === true).length
                        fila.alertas.push({
                            tipo: 'vencimientos_fiscales',
                            nivel: vencidas > 0 ? 'critico' : 'aviso',
                            titulo:
                                vencidas > 0
                                    ? `${vencidas} obligación(es) fiscal(es) vencida(s)`
                                    : `${proximas.length} obligación(es) fiscal(es) vence(n) en 7 días o menos`,
                            detalle: proximas
                                .map((o) => `${String(o.nombre)} vence el ${String(o.vence_en)}`)
                                .join('; '),
                            datos: { obligaciones: proximas, vencidas },
                        })
                    }
                }
                // apagado: un error del bloque no se reporta (la empresa silenció el aviso); el cron
                // fiscal emite igual `fiscal.limite_pc` al 100 %
                const pc = pcApagado
                    ? bloques.pequeno_contribuyente?.estado === 'ok'
                        ? (bloques.pequeno_contribuyente.datos as Record<string, unknown>)
                        : null
                    : conError('limite_pequeno_contribuyente', bloques.pequeno_contribuyente)
                const llegoAlLimite = pc
                    ? pc.supera_limite === true || dec(String(pc.acumulado)).gte(dec(String(pc.limite)))
                    : false
                if (pc && (llegoAlLimite || (!pcApagado && pc.umbral_alcanzado !== null))) {
                    const supera = pc.supera_limite === true
                    const umbrales = (pc.umbrales as string[]) ?? []
                    // el primer umbral (80 % de fábrica) avisa; los siguientes (95 %, 100 %) son críticos
                    const menor = umbrales.map((u) => dec(u)).reduce((a, b) => (b.lt(a) ? b : a), dec('100'))
                    const alcanzado = dec(String(pc.umbral_alcanzado ?? '0'))
                    fila.alertas.push({
                        tipo: 'limite_pequeno_contribuyente',
                        nivel: llegoAlLimite || alcanzado.gt(menor) ? 'critico' : 'aviso',
                        titulo: supera
                            ? 'Superó el límite anual del pequeño contribuyente'
                            : `Lleva el ${String(pc.porcentaje)} % del límite anual del pequeño contribuyente`,
                        detalle: supera
                            ? String(pc.mensaje ?? '')
                            : `Facturado en ${String(pc.anio)}: Q${String(pc.acumulado)} de Q${String(pc.limite)}. Quedan Q${String(pc.disponible)}.`,
                        datos: { ...pc, aviso_apagado: pcApagado },
                    })
                }
            },
        )
        salida.push(fila)
    }
    return { hoy, generado_en: ahora.toISOString(), revisados, empresas: salida }
}
