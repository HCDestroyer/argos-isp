import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Alcance } from '#core/acl'
import type { Permiso } from '#core/permisos'
import { ValidacionFallida } from '#shared/errores'
import type { Reporte } from '#billing/reportes/definicion'
import {
    altasBajas,
    bonificacionesPorMotivo,
    carteraVencida,
    cierresCaja,
    cobranzaDiaria,
    egresosPorCategoria,
    facturadoVsCobrado,
    ingresos,
    ivaDelPeriodo,
    promesas,
    type EmpresasReporte,
} from '#billing/reportes/reportes'
import { cuentasPorPagar } from '#ledger/pagos_proveedores'
import { reporteBajas, reporteIndicadores } from '#billing/panel/reportes_panel'
import * as v from '#billing/validators'
import * as vc from '#ledger/validators_compras'
import * as vp from '#billing/panel/validators'

/**
 * Catálogo de reportes (`contratos/reportes.md` §4): lo que el panel lista en «Reportes», lo que se
 * marca como favorito, lo que se guarda como vista y lo que se programa por correo. Cada reporte
 * tiene la forma común (`Reporte`), así que todos se exportan a CSV, Excel y PDF.
 *
 * - `compartible`: reporte contable que se puede enviar a correos externos (decisión 6 del PM): sin
 *   datos personales de clientes. `datosPersonales(filtros)` dice si unos filtros concretos lo
 *   vuelven personal (un cliente, o la cartera agrupada por cliente); entonces no se comparte.
 * - `alcanceTotal`: el reporte suma toda la empresa (panel financiero); quien lo pide debe tener el
 *   permiso sin alcance por router, zona o caja.
 */

export interface ContextoGeneracion {
    /** alcance del permiso del reporte de quien lo recibe (router, zona o caja) */
    alcance?: Alcance
    op: EmpresasReporte
    /** otros permisos de quien lo recibe (p. ej. `libro.ver` para el efectivo) */
    permisos: ReadonlySet<string>
    ahora?: Date
}

export interface DefinicionReporte {
    codigo: string
    titulo: string
    descripcion: string
    /** ruta GET de la API (bajo /api/v1) */
    ruta: string
    permiso: Permiso
    compartible: boolean
    alcanceTotal?: boolean
    datosPersonales?: (filtros: Record<string, unknown>) => string | null
    validar: (filtros: Record<string, unknown>) => Promise<Record<string, unknown>>
    generar: (filtros: Record<string, unknown>, ctx: ContextoGeneracion) => Promise<Reporte>
}

/** Filtros guardados (vista o envío): sin `formato` ni `empresas`, que deciden la petición o el envío. */
function limpiar(filtros: Record<string, unknown>): Record<string, unknown> {
    const resto = { ...filtros }
    delete resto.formato
    delete resto.empresas
    return resto
}

function validador(compilado: { validate: (datos: unknown) => Promise<unknown> }) {
    return async (filtros: Record<string, unknown>) => {
        try {
            return limpiar((await compilado.validate(limpiar(filtros))) as Record<string, unknown>)
        } catch (error) {
            const mensajes = (error as { messages?: Array<{ field: string; message: string; rule: string }> })
                .messages
            if (!mensajes) throw error
            throw new ValidacionFallida(
                mensajes.map((m) => ({ field: `filtros.${m.field}`, message: m.message, rule: m.rule })),
            )
        }
    }
}

const porCliente = (filtros: Record<string, unknown>) =>
    filtros.cliente_id !== undefined && filtros.cliente_id !== null ? 'filtra un cliente (cliente_id)' : null

type Generador = (f: never, a: Alcance | undefined, op: EmpresasReporte) => Promise<Reporte>
const conAlcance = (fn: Generador) => (filtros: Record<string, unknown>, ctx: ContextoGeneracion) =>
    fn(filtros as never, ctx.alcance, ctx.op)

export const CATALOGO_REPORTES: readonly DefinicionReporte[] = [
    {
        codigo: 'indicadores-financieros',
        titulo: 'Indicadores financieros',
        descripcion:
            'Ingreso mensual recurrente (MRR), ingreso promedio por servicio (ARPU), bajas del mes (churn) y efectivo disponible, por empresa',
        ruta: '/reportes/indicadores-financieros',
        permiso: 'panel_financiero.ver',
        compartible: true,
        alcanceTotal: true,
        validar: validador(vp.reporteIndicadoresValidator),
        generar: (f, ctx) =>
            reporteIndicadores(
                f as { mes?: string },
                ctx.op,
                { incluirEfectivo: ctx.permisos.has('libro.ver') },
                ctx.ahora,
            ),
    },
    {
        codigo: 'bajas',
        titulo: 'Bajas de servicios (churn)',
        descripcion:
            'Bajas por mes (retiros y suspensiones largas), servicios al inicio del mes y tasa de bajas',
        ruta: '/reportes/bajas',
        permiso: 'panel_financiero.ver',
        compartible: true,
        alcanceTotal: true,
        validar: validador(vp.reporteBajasValidator),
        generar: (f, ctx) => reporteBajas(f as { desde?: string; hasta?: string }, ctx.op, ctx.ahora),
    },
    {
        codigo: 'cartera-vencida',
        titulo: 'Cartera vencida por antigüedad',
        descripcion:
            'Saldo pendiente por días de atraso (0-30, 31-60, 61-90, +90), por cliente, zona, router o plan',
        ruta: '/reportes/cartera-vencida',
        permiso: 'reportes.ver',
        compartible: true,
        // agrupada por cliente (la de fábrica) lleva nombres de clientes
        datosPersonales: (f) =>
            porCliente(f) ??
            (f.agrupar === undefined || f.agrupar === 'cliente'
                ? 'agrupa por cliente (agrupar=cliente)'
                : null),
        validar: validador(v.reporteCarteraValidator),
        generar: conAlcance(carteraVencida as Generador),
    },
    {
        codigo: 'ingresos',
        titulo: 'Ingresos por periodo y método',
        descripcion: 'Pagos vigentes por mes (o día) y método de pago',
        ruta: '/reportes/ingresos',
        permiso: 'reportes.ver',
        compartible: true,
        datosPersonales: porCliente,
        validar: validador(v.reporteIngresosValidator),
        generar: conAlcance(ingresos as Generador),
    },
    {
        codigo: 'facturado-vs-cobrado',
        titulo: 'Facturado vs cobrado',
        descripcion: 'Facturado, cobrado y pendiente por mes de la factura',
        ruta: '/reportes/facturado-vs-cobrado',
        permiso: 'reportes.ver',
        compartible: true,
        datosPersonales: porCliente,
        validar: validador(v.reporteFacturadoValidator),
        generar: conAlcance(facturadoVsCobrado as Generador),
    },
    {
        codigo: 'cobranza-diaria',
        titulo: 'Cobranza diaria',
        descripcion: 'Cobros por día, método y caja',
        ruta: '/reportes/cobranza-diaria',
        permiso: 'reportes.ver',
        compartible: true,
        validar: validador(v.reporteCobranzaValidator),
        generar: conAlcance(cobranzaDiaria as Generador),
    },
    {
        codigo: 'cierres-caja',
        titulo: 'Cierres de caja',
        descripcion: 'Esperado, contado y diferencia de cada turno cerrado',
        ruta: '/reportes/cierres-caja',
        permiso: 'reportes.ver',
        compartible: true,
        validar: validador(v.reporteCobranzaValidator),
        generar: conAlcance(cierresCaja as Generador),
    },
    {
        codigo: 'iva',
        titulo: 'IVA del periodo',
        descripcion: 'IVA facturado, anulado y neto por mes, cuadrado con el libro',
        ruta: '/reportes/iva',
        permiso: 'reportes.ver',
        compartible: true,
        validar: validador(v.reporteIvaValidator),
        generar: (f, ctx) => ivaDelPeriodo(f as { desde?: string; hasta?: string }, ctx.op),
    },
    {
        codigo: 'promesas',
        titulo: 'Promesas de pago',
        descripcion: 'Creadas, cumplidas, incumplidas y tasa de cumplimiento por mes y canal',
        ruta: '/reportes/promesas',
        permiso: 'reportes.ver',
        compartible: true,
        datosPersonales: porCliente,
        validar: validador(v.reportePromesasValidator),
        generar: conAlcance(promesas as Generador),
    },
    {
        codigo: 'altas-bajas',
        titulo: 'Altas, bajas y suspensiones',
        descripcion: 'Altas, retiros, suspensiones y reactivaciones por mes',
        ruta: '/reportes/altas-bajas',
        permiso: 'reportes.ver',
        compartible: true,
        validar: validador(v.reporteAltasValidator),
        generar: conAlcance(altasBajas as Generador),
    },
    {
        codigo: 'egresos',
        titulo: 'Egresos por categoría',
        descripcion: 'Egresos vigentes por mes contable y categoría',
        ruta: '/reportes/egresos',
        permiso: 'reportes.ver',
        compartible: true,
        validar: validador(v.reporteEgresosValidator),
        generar: conAlcance(egresosPorCategoria as Generador),
    },
    {
        codigo: 'bonificaciones',
        titulo: 'Bonificaciones',
        descripcion: 'Bonificaciones (meses gratis, descuentos del 100 %) por motivo, origen y mes',
        ruta: '/reportes/bonificaciones',
        permiso: 'reportes.ver',
        compartible: true,
        datosPersonales: porCliente,
        validar: validador(v.reporteBonificacionesValidator),
        generar: conAlcance(bonificacionesPorMotivo as Generador),
    },
    {
        codigo: 'cuentas-por-pagar',
        titulo: 'Cuentas por pagar (antigüedad de proveedores)',
        descripcion: 'Saldo pendiente de cada compra al crédito por días desde su vencimiento, por proveedor',
        ruta: '/reportes/cuentas-por-pagar',
        permiso: 'reportes.ver',
        compartible: true,
        validar: validador(vc.cuentasPorPagarValidator),
        generar: (f, ctx) =>
            cuentasPorPagar(
                f as { corte?: string; proveedor_id?: number },
                ctx.op.empresas,
                ctx.op.consolidado,
            ),
    },
]

export function definicionReporte(codigo: string): DefinicionReporte | null {
    return CATALOGO_REPORTES.find((r) => r.codigo === codigo) ?? null
}

/** 422 en `campo` si el reporte no existe en el catálogo. */
export function exigirDefinicion(codigo: string, campo = 'reporte'): DefinicionReporte {
    const def = definicionReporte(codigo)
    if (!def) {
        throw new ValidacionFallida([
            { field: campo, message: `El reporte ${codigo} no está en el catálogo`, rule: 'reporte' },
        ])
    }
    return def
}

/** Por qué no se puede enviar este reporte con estos filtros a un correo externo (null = sí se puede). */
export function motivoNoCompartible(def: DefinicionReporte, filtros: Record<string, unknown>): string | null {
    if (!def.compartible) return 'no es un reporte contable compartible'
    return def.datosPersonales?.(filtros) ?? null
}

/*
|--------------------------------------------------------------------------
| Lectura del catálogo con favoritos y vistas del usuario
|--------------------------------------------------------------------------
*/

export interface VistaReporte {
    id: number
    reporte: string
    nombre: string
    filtros: Record<string, unknown>
    columnas: string[] | null
    version: number
    created_at: string
    updated_at: string
}

export interface ReporteCatalogo {
    codigo: string
    titulo: string
    descripcion: string
    ruta: string
    permiso: string
    compartible: boolean
    formatos: Array<'json' | 'csv' | 'xlsx' | 'pdf'>
    favorito: boolean
    vistas: VistaReporte[]
}

export function serializarVista(f: Record<string, unknown>): VistaReporte {
    return {
        id: Number(f.id),
        reporte: String(f.reporte),
        nombre: String(f.nombre),
        filtros: (f.filtros as Record<string, unknown>) ?? {},
        columnas: (f.columnas as string[] | null) ?? null,
        version: Number(f.version),
        created_at: new Date(f.created_at as string).toISOString(),
        updated_at: new Date(f.updated_at as string).toISOString(),
    }
}

export async function vistasDeUsuario(
    usuarioId: number,
    c: QueryClientContract = db.connection(),
): Promise<VistaReporte[]> {
    const filas = (await c
        .from('billing.reportes_vistas')
        .where('usuario_id', usuarioId)
        .orderBy([
            { column: 'reporte', order: 'asc' },
            { column: 'nombre', order: 'asc' },
        ])
        .select('*')) as Array<Record<string, unknown>>
    return filas.map(serializarVista)
}

/** Catálogo que el usuario puede ver (por sus permisos), con sus favoritos primero y sus vistas. */
export async function catalogoDeUsuario(
    usuarioId: number,
    permisos: ReadonlySet<string>,
): Promise<ReporteCatalogo[]> {
    const favoritos = new Set(
        (
            (await db
                .from('billing.reportes_favoritos')
                .where('usuario_id', usuarioId)
                .select('reporte')) as Array<{
                reporte: string
            }>
        ).map((f) => f.reporte),
    )
    const vistas = await vistasDeUsuario(usuarioId)
    const lista = CATALOGO_REPORTES.filter((r) => permisos.has(r.permiso)).map((r) => ({
        codigo: r.codigo,
        titulo: r.titulo,
        descripcion: r.descripcion,
        ruta: r.ruta,
        permiso: r.permiso,
        compartible: r.compartible,
        formatos: ['json', 'csv', 'xlsx', 'pdf'] as Array<'json' | 'csv' | 'xlsx' | 'pdf'>,
        favorito: favoritos.has(r.codigo),
        vistas: vistas.filter((x) => x.reporte === r.codigo),
    }))
    return [...lista.filter((r) => r.favorito), ...lista.filter((r) => !r.favorito)]
}
