import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { armarReporte, definirColumnas, type Reporte } from '#billing/reportes/definicion'
import { aTexto, dec } from '#ledger/dinero'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'

/**
 * Libros legales (contrato de localización fiscal §7): el **Libro de compras y servicios
 * recibidos** (fase 5) en vista previa (`GET /libros/compras`). La emisión con folio y los demás
 * libros (Diario, Mayor, Ventas) están en `#fiscal/libros_legales` (fase 6 PR D).
 *
 * Filas, por empresa y por mes del IVA:
 * - cada compra con `periodo_iva` en el rango, con sus valores tal como se registró (`registro`);
 *   una NCRE del proveedor resta;
 * - cada anulación cuyo reverso cae en el rango, con los valores en negativo (`anulacion`): el
 *   reverso de su asiento es de ese mes, así que el libro de cada mes cuadra con el mes de 1.1.04.
 *
 * `cuadreCompras` compara el crédito del libro (`iva_credito`) con el movimiento de `1.1.04` de
 * los asientos de compras del mismo rango: es el criterio de la fase («el libro de compras cuadra
 * con 1.1.04»). Columnas: propuesta de A3 (formato exacto de la SAT: confirmar con contador).
 */

export const COLUMNAS_LIBRO_COMPRAS = definirColumnas([
    { clave: 'compra_id', titulo: 'Compra', tipo: 'id' },
    { clave: 'movimiento', titulo: 'Movimiento', tipo: 'texto' },
    { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
    { clave: 'tipo', titulo: 'Tipo', tipo: 'texto' },
    { clave: 'serie', titulo: 'Serie', tipo: 'texto' },
    { clave: 'numero', titulo: 'Número', tipo: 'texto' },
    { clave: 'nit', titulo: 'NIT', tipo: 'texto' },
    { clave: 'proveedor', titulo: 'Proveedor', tipo: 'texto' },
    { clave: 'bienes', titulo: 'Bienes', tipo: 'dinero' },
    { clave: 'servicios', titulo: 'Servicios', tipo: 'dinero' },
    { clave: 'importaciones', titulo: 'Importaciones', tipo: 'dinero' },
    { clave: 'exento', titulo: 'Exento', tipo: 'dinero' },
    { clave: 'iva', titulo: 'IVA', tipo: 'dinero' },
    { clave: 'total', titulo: 'Total', tipo: 'dinero' },
    { clave: 'retencion_iva', titulo: 'Retención IVA', tipo: 'dinero' },
    { clave: 'retencion_isr', titulo: 'Retención ISR', tipo: 'dinero' },
    { clave: 'credito', titulo: 'Crédito fiscal', tipo: 'texto' },
    { clave: 'iva_credito', titulo: 'IVA crédito', tipo: 'dinero' },
    { clave: 'periodo_iva', titulo: 'Periodo IVA', tipo: 'texto' },
])

export interface FiltrosLibro {
    desde?: string
    hasta?: string
}

/** Meses del rango (primer día): por defecto el mes en curso. */
export function mesesDelRango(filtros: FiltrosLibro): { desde: string; hasta: string } {
    const hoy = hoyGuatemala()
    const desde = inicioDeMes(filtros.desde ?? hoy)
    const hasta = inicioDeMes(filtros.hasta ?? filtros.desde ?? hoy)
    return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde }
}

function finDeMes(periodo: string): string {
    return DateTime.fromISO(periodo, { zone: 'utc' }).endOf('month').toISODate()!
}

const COLUMNAS_DINERO = [
    'bienes',
    'servicios',
    'importaciones',
    'exento',
    'iva',
    'total',
    'retencion_iva',
    'retencion_isr',
    'iva_credito',
] as const

/** Filas del libro de compras de la empresa en el rango de meses (también para `#fiscal/libros_legales`). */
export async function filasLibroCompras(
    cliente: QueryClientContract,
    empresaId: number,
    desde: string,
    hasta: string,
): Promise<Array<Record<string, string | number | null>>> {
    const { rows } = (await cliente.rawQuery(
        `WITH base AS (
             SELECT c.*, p.nit, p.nombre AS proveedor,
                    CASE WHEN c.tipo_documento = 'NCRE' THEN -1 ELSE 1 END AS signo
               FROM ledger.compras c JOIN ledger.proveedores p ON p.id = c.proveedor_id
              WHERE c.empresa_id = ?
         ), filas AS (
             SELECT b.*, 'registro' AS movimiento, b.fecha_documento AS fecha_fila, b.signo AS factor, b.id AS orden
               FROM base b
              WHERE b.periodo_iva BETWEEN ? AND ?
             UNION ALL
             SELECT b.*, 'anulacion', coalesce(r.fecha, (x.anulado_en AT TIME ZONE 'America/Guatemala')::date),
                    -b.signo, b.id
               FROM base b JOIN ledger.compras_anulaciones x ON x.compra_id = b.id
               LEFT JOIN ledger.asientos r ON r.id = x.asiento_id
              WHERE coalesce(r.fecha, (x.anulado_en AT TIME ZONE 'America/Guatemala')::date) BETWEEN ? AND ?
         )
         SELECT id AS compra_id, movimiento, to_char(fecha_fila, 'YYYY-MM-DD') AS fecha, tipo_documento AS tipo,
                serie, numero, nit, proveedor,
                (factor * base_bienes)::text AS bienes, (factor * base_servicios)::text AS servicios,
                (factor * base_importaciones)::text AS importaciones, (factor * exento)::text AS exento,
                (factor * iva)::text AS iva, (factor * total)::text AS total,
                (factor * retencion_iva)::text AS retencion_iva, (factor * retencion_isr)::text AS retencion_isr,
                CASE WHEN credito_fiscal THEN 'sí' ELSE 'no' END AS credito,
                (CASE WHEN credito_fiscal THEN factor * iva ELSE 0 END)::text AS iva_credito,
                to_char(periodo_iva, 'YYYY-MM') AS periodo_iva
           FROM filas
          ORDER BY fecha_fila, orden, movimiento DESC`,
        [empresaId, desde, hasta, desde, finDeMes(hasta)],
    )) as { rows: Array<Record<string, string | number | null>> }
    return rows.map((fila) => ({
        ...fila,
        compra_id: Number(fila.compra_id),
        ...Object.fromEntries(COLUMNAS_DINERO.map((c) => [c, aTexto(dec(String(fila[c])))])),
    }))
}

export async function libroCompras(empresaId: number, filtros: FiltrosLibro): Promise<Reporte> {
    const { desde, hasta } = mesesDelRango(filtros)
    const filas = await filasLibroCompras(db.connection(), empresaId, desde, hasta)
    return armarReporte({
        reporte: 'libro-compras',
        titulo: 'Libro de compras y servicios recibidos (vista previa, borrador sin folio)',
        columnas: COLUMNAS_LIBRO_COMPRAS,
        filas,
        filtros: { empresa_id: empresaId, desde, hasta: finDeMes(hasta) },
    })
}

export interface CuadreCompras {
    empresa_id: number
    periodo: string
    libro: string
    cuenta: string
    diferencia: string
    cuadra: boolean
}

/**
 * Por mes: crédito fiscal del libro de compras vs movimiento de `1.1.04` (debe − haber) de los
 * asientos de origen `compra` (registro, reclasificación desde egreso y reversos de anulaciones).
 */
export async function cuadreCompras(
    empresaId: number,
    filtros: FiltrosLibro,
    cliente: QueryClientContract = db.connection(),
): Promise<CuadreCompras[]> {
    const { desde, hasta } = mesesDelRango(filtros)
    const filas = await filasLibroCompras(cliente, empresaId, desde, hasta)
    const libro = new Map<string, ReturnType<typeof dec>>()
    for (const fila of filas) {
        const mes = String(fila.movimiento === 'registro' ? fila.periodo_iva : String(fila.fecha).slice(0, 7))
        libro.set(mes, (libro.get(mes) ?? dec('0')).plus(dec(String(fila.iva_credito))))
    }
    const { rows } = (await cliente.rawQuery(
        `SELECT to_char(a.fecha, 'YYYY-MM') AS mes, sum(m.debe - m.haber)::text AS monto
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE a.empresa_id = ? AND a.origen_tipo = 'compra' AND c.codigo = ?
            AND a.fecha BETWEEN ? AND ?
          GROUP BY 1`,
        [empresaId, CUENTAS_GT.IVA_CREDITO, desde, finDeMes(hasta)],
    )) as { rows: Array<{ mes: string; monto: string }> }
    const cuenta = new Map(rows.map((r) => [r.mes, dec(r.monto)]))
    const meses = [...new Set([...libro.keys(), ...cuenta.keys()])].sort()
    return meses.map((mes) => {
        const l = libro.get(mes) ?? dec('0')
        const c = cuenta.get(mes) ?? dec('0')
        return {
            empresa_id: empresaId,
            periodo: mes,
            libro: aTexto(l),
            cuenta: aTexto(c),
            diferencia: aTexto(l.minus(c)),
            cuadra: l.equals(c),
        }
    })
}
