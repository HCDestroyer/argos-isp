import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import {
    armarReporte,
    definirColumnas,
    type Columna,
    type Fila,
    type Reporte,
    type ValorCelda,
} from '#billing/reportes/definicion'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { fechaValida, hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { saldoSegunNaturaleza } from '#ledger/consultas'
import { ValidacionFallida } from '#shared/errores'
import { COLUMNAS_LIBRO_COMPRAS, filasLibroCompras, mesesDelRango } from '#fiscal/libros'

/**
 * Libros legales con folio (contrato de localización fiscal §7, fase 6 PR D): Diario, Mayor,
 * Compras y Ventas con la forma de `/reportes/*` (`columnas`, `filas`, `totales`). La vista previa
 * (`GET /libros/:libro`) acepta cualquier rango; la emisión oficial (`libros.emitir`) usa meses
 * completos, cerrados y bloqueados.
 *
 * Cada fila puede traer `fila`: `movimiento` (suma en «Van/Vienen» y en los totales), `total`
 * (total por partida del Diario), `saldo_inicial` o `saldo_final` (por cuenta, en el Mayor). Las
 * filas sin `fila` son movimientos. `totales` suma solo los movimientos; el saldo no se suma.
 *
 * Columnas: propuesta de A3. El formato exacto de la SAT y del Registro Mercantil: contador.
 */

export const LIBROS_EMITIBLES = ['diario', 'mayor', 'compras', 'ventas'] as const
export type LibroEmitible = (typeof LIBROS_EMITIBLES)[number]

/** Libros de `fiscal.libros_habilitados` (Inventarios y estados financieros llegan después). */
export const LIBROS_HABILITABLES = [
    'diario',
    'mayor',
    'inventarios',
    'estados_financieros',
    'compras',
    'ventas',
] as const
export type LibroHabilitable = (typeof LIBROS_HABILITABLES)[number]

/** Nombre legal de cada libro (inv. B.1: usar el nombre legal). */
export const NOMBRES_LEGALES: Record<LibroHabilitable, string> = {
    diario: 'Libro Diario',
    mayor: 'Libro Mayor',
    inventarios: 'Libro de Inventarios',
    estados_financieros: 'Libro de Estados Financieros',
    compras: 'Libro de Compras y Servicios Recibidos',
    ventas: 'Libro de Ventas y Servicios Prestados',
}

export type TipoFila = 'movimiento' | 'total' | 'saldo_inicial' | 'saldo_final'

export interface LibroLegal {
    libro: LibroEmitible
    nombre_legal: string
    empresa_id: number
    desde: string
    hasta: string
    reporte: Reporte
    /** columnas de dinero que se acumulan en «Van/Vienen» (las demás de dinero, como el saldo, no) */
    acumulables: string[]
}

export interface RangoLibro {
    desde?: string
    hasta?: string
}

export function finDeMes(fecha: string): string {
    return DateTime.fromISO(fecha, { zone: 'utc' }).endOf('month').toISODate()!
}

/** Rango de fechas de la vista previa: por defecto el mes en curso; `hasta` por defecto fin del mes de `desde`. */
export function rangoFechas(filtros: RangoLibro): { desde: string; hasta: string } {
    const desde = fechaValida(filtros.desde ?? inicioDeMes(hoyGuatemala()), 'desde')
    const hasta = fechaValida(filtros.hasta ?? finDeMes(desde), 'hasta')
    if (hasta < desde) {
        throw new ValidacionFallida([
            { field: 'hasta', message: 'Debe ser igual o posterior a desde', rule: 'rango' },
        ])
    }
    return { desde, hasta }
}

/** Rango de una emisión oficial: meses completos (del primer día de `desde` al último de `hasta`). */
export function rangoMeses(filtros: RangoLibro): { desde: string; hasta: string } {
    const { desde, hasta } = rangoFechas(filtros)
    return { desde: inicioDeMes(desde), hasta: finDeMes(hasta) }
}

/** Primer día de cada mes del rango. */
export function mesesEntre(desde: string, hasta: string): string[] {
    const meses: string[] = []
    let mes = DateTime.fromISO(inicioDeMes(desde), { zone: 'utc' })
    const fin = DateTime.fromISO(inicioDeMes(hasta), { zone: 'utc' })
    while (mes <= fin) {
        meses.push(mes.toISODate()!)
        mes = mes.plus({ months: 1 })
    }
    return meses
}

const FILA: Columna = { clave: 'fila', titulo: 'Tipo de fila', tipo: 'texto' }

/** Totales: suma de los movimientos en las columnas de dinero acumulables; null en las demás. */
function totalesDeMovimientos(columnas: readonly Columna[], filas: Fila[], acumulables: string[]) {
    const totales: Record<string, ValorCelda> = {}
    for (const c of columnas) {
        if (!acumulables.includes(c.clave)) {
            totales[c.clave] = null
            continue
        }
        let suma: Dec = CERO
        for (const fila of filas) {
            if ((fila.fila ?? 'movimiento') !== 'movimiento') continue
            suma = suma.plus(dec((fila[c.clave] as string | null) ?? '0'))
        }
        totales[c.clave] = aTexto(suma)
    }
    return totales
}

function armarLibro(datos: {
    libro: LibroEmitible
    empresaId: number
    desde: string
    hasta: string
    columnas: readonly Columna[]
    filas: Fila[]
    acumulables: string[]
}): LibroLegal {
    const nombre = NOMBRES_LEGALES[datos.libro]
    return {
        libro: datos.libro,
        nombre_legal: nombre,
        empresa_id: datos.empresaId,
        desde: datos.desde,
        hasta: datos.hasta,
        acumulables: datos.acumulables,
        reporte: armarReporte({
            reporte: `libro-${datos.libro}`,
            titulo: `${nombre} (vista previa, borrador sin folio)`,
            columnas: datos.columnas,
            filas: datos.filas,
            filtros: { empresa_id: datos.empresaId, desde: datos.desde, hasta: datos.hasta },
            totales: totalesDeMovimientos(datos.columnas, datos.filas, datos.acumulables),
        }),
    }
}

/*
|--------------------------------------------------------------------------
| Diario (primera entrada)
|--------------------------------------------------------------------------
*/

export const COLUMNAS_LIBRO_DIARIO = definirColumnas([
    FILA,
    { clave: 'partida', titulo: 'Partida', tipo: 'entero', nulable: true },
    { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
    { clave: 'diario', titulo: 'Diario', tipo: 'texto', nulable: true },
    { clave: 'numero', titulo: 'Número', tipo: 'entero', nulable: true },
    { clave: 'asiento_id', titulo: 'Asiento', tipo: 'id' },
    { clave: 'cuenta', titulo: 'Cuenta', tipo: 'texto', nulable: true },
    { clave: 'cuenta_nombre', titulo: 'Nombre de la cuenta', tipo: 'texto', nulable: true },
    { clave: 'descripcion', titulo: 'Descripción', tipo: 'texto' },
    { clave: 'debe', titulo: 'Debe', tipo: 'dinero' },
    { clave: 'haber', titulo: 'Haber', tipo: 'dinero' },
])

interface MovimientoDiario {
    asiento_id: number
    fecha: string
    partida: number | null
    diario: string | null
    numero: number | null
    descripcion: string
    cuenta: string
    cuenta_nombre: string
    debe: string
    haber: string
}

/**
 * Asientos de la empresa con fecha en el rango, en orden cronológico (fecha, partida, número del
 * diario), cada movimiento en una fila y el total de cada partida debajo. La partida es la
 * guardada al cerrar el mes (`ledger.asientos_partidas`, §10.7): null en meses abiertos.
 */
export async function libroDiarioLegal(
    empresaId: number,
    rango: { desde: string; hasta: string },
    cliente: QueryClientContract = db.connection(),
): Promise<LibroLegal> {
    const { rows } = (await cliente.rawQuery(
        `SELECT a.id AS asiento_id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, p.partida, d.codigo AS diario,
                n.numero, a.descripcion, c.codigo AS cuenta, c.nombre AS cuenta_nombre,
                m.debe::text AS debe, m.haber::text AS haber
           FROM ledger.asientos a
           JOIN ledger.movimientos m ON m.asiento_id = a.id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
           LEFT JOIN ledger.asientos_partidas p ON p.asiento_id = a.id
           LEFT JOIN ledger.asientos_numeros n ON n.asiento_id = a.id
           LEFT JOIN ledger.diarios d ON d.id = n.diario_id
          WHERE a.empresa_id = ? AND a.fecha BETWEEN ? AND ?
          ORDER BY a.fecha, p.partida NULLS LAST, n.numero NULLS LAST, a.id, m.id`,
        [empresaId, rango.desde, rango.hasta],
    )) as { rows: MovimientoDiario[] }

    const filas: Fila[] = []
    let actual: number | null = null
    let debe: Dec = CERO
    let haber: Dec = CERO
    let ultimo: MovimientoDiario | null = null
    const cerrarPartida = () => {
        if (!ultimo) return
        filas.push({
            fila: 'total',
            partida: ultimo.partida === null ? null : Number(ultimo.partida),
            fecha: ultimo.fecha,
            diario: ultimo.diario,
            numero: ultimo.numero === null ? null : Number(ultimo.numero),
            asiento_id: Number(ultimo.asiento_id),
            cuenta: null,
            cuenta_nombre: null,
            descripcion:
                ultimo.partida === null
                    ? `Total del asiento ${ultimo.asiento_id}`
                    : `Total de la partida ${ultimo.partida}`,
            debe: aTexto(debe),
            haber: aTexto(haber),
        })
    }
    for (const m of rows) {
        if (actual !== Number(m.asiento_id)) {
            cerrarPartida()
            actual = Number(m.asiento_id)
            debe = CERO
            haber = CERO
        }
        debe = debe.plus(dec(m.debe))
        haber = haber.plus(dec(m.haber))
        ultimo = m
        filas.push({
            fila: 'movimiento',
            partida: m.partida === null ? null : Number(m.partida),
            fecha: m.fecha,
            diario: m.diario,
            numero: m.numero === null ? null : Number(m.numero),
            asiento_id: Number(m.asiento_id),
            cuenta: m.cuenta,
            cuenta_nombre: m.cuenta_nombre,
            descripcion: m.descripcion,
            debe: aTexto(dec(m.debe)),
            haber: aTexto(dec(m.haber)),
        })
    }
    cerrarPartida()
    return armarLibro({
        libro: 'diario',
        empresaId,
        ...rango,
        columnas: COLUMNAS_LIBRO_DIARIO,
        filas,
        acumulables: ['debe', 'haber'],
    })
}

/*
|--------------------------------------------------------------------------
| Mayor (centralizador)
|--------------------------------------------------------------------------
*/

export const COLUMNAS_LIBRO_MAYOR = definirColumnas([
    FILA,
    { clave: 'cuenta', titulo: 'Cuenta', tipo: 'texto' },
    { clave: 'cuenta_nombre', titulo: 'Nombre de la cuenta', tipo: 'texto' },
    { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha', nulable: true },
    { clave: 'partida', titulo: 'Partida', tipo: 'entero', nulable: true },
    { clave: 'asiento_id', titulo: 'Asiento', tipo: 'id', nulable: true },
    { clave: 'descripcion', titulo: 'Descripción', tipo: 'texto' },
    { clave: 'debe', titulo: 'Debe', tipo: 'dinero' },
    { clave: 'haber', titulo: 'Haber', tipo: 'dinero' },
    { clave: 'saldo', titulo: 'Saldo', tipo: 'dinero' },
])

/**
 * Por cuenta imputable con saldo inicial o movimientos en el rango: saldo inicial (lo anterior a
 * `desde`), cada movimiento con su saldo acumulado y el saldo final con la suma del debe y el
 * haber de la cuenta. El saldo va según la naturaleza de la cuenta (positivo = su lado normal).
 */
export async function libroMayorLegal(
    empresaId: number,
    rango: { desde: string; hasta: string },
    cliente: QueryClientContract = db.connection(),
): Promise<LibroLegal> {
    const { rows: cuentas } = (await cliente.rawQuery(
        `WITH previo AS (
             SELECT m.cuenta_id, sum(m.debe) AS debe, sum(m.haber) AS haber
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
              WHERE a.empresa_id = ? AND a.fecha < ?
              GROUP BY m.cuenta_id
         ), rango AS (
             SELECT DISTINCT m.cuenta_id
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
              WHERE a.empresa_id = ? AND a.fecha BETWEEN ? AND ?
         )
         SELECT c.id, c.codigo, c.nombre, c.naturaleza,
                coalesce(p.debe, 0)::text AS debe, coalesce(p.haber, 0)::text AS haber
           FROM ledger.cuentas c
           LEFT JOIN previo p ON p.cuenta_id = c.id
          WHERE c.id IN (SELECT cuenta_id FROM rango)
             OR (p.cuenta_id IS NOT NULL AND p.debe <> p.haber)
          ORDER BY c.codigo`,
        [empresaId, rango.desde, empresaId, rango.desde, rango.hasta],
    )) as {
        rows: Array<{
            id: number
            codigo: string
            nombre: string
            naturaleza: string
            debe: string
            haber: string
        }>
    }
    const { rows: movimientos } = (await cliente.rawQuery(
        `SELECT m.cuenta_id, a.id AS asiento_id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, p.partida,
                a.descripcion, m.debe::text AS debe, m.haber::text AS haber
           FROM ledger.movimientos m
           JOIN ledger.asientos a ON a.id = m.asiento_id
           LEFT JOIN ledger.asientos_partidas p ON p.asiento_id = a.id
           LEFT JOIN ledger.asientos_numeros n ON n.asiento_id = a.id
          WHERE a.empresa_id = ? AND a.fecha BETWEEN ? AND ?
          ORDER BY m.cuenta_id, a.fecha, p.partida NULLS LAST, n.numero NULLS LAST, a.id, m.id`,
        [empresaId, rango.desde, rango.hasta],
    )) as {
        rows: Array<{
            cuenta_id: number
            asiento_id: number
            fecha: string
            partida: number | null
            descripcion: string
            debe: string
            haber: string
        }>
    }
    const porCuenta = new Map<number, typeof movimientos>()
    for (const m of movimientos) {
        const lista = porCuenta.get(Number(m.cuenta_id)) ?? []
        lista.push(m)
        porCuenta.set(Number(m.cuenta_id), lista)
    }

    const filas: Fila[] = []
    for (const c of cuentas) {
        const base = { cuenta: c.codigo, cuenta_nombre: c.nombre }
        let saldo = saldoSegunNaturaleza(c.naturaleza, dec(c.debe), dec(c.haber))
        filas.push({
            fila: 'saldo_inicial',
            ...base,
            fecha: null,
            partida: null,
            asiento_id: null,
            descripcion: 'Saldo inicial',
            debe: '0.00',
            haber: '0.00',
            saldo: aTexto(saldo),
        })
        let debe: Dec = CERO
        let haber: Dec = CERO
        for (const m of porCuenta.get(Number(c.id)) ?? []) {
            debe = debe.plus(dec(m.debe))
            haber = haber.plus(dec(m.haber))
            saldo = saldo.plus(saldoSegunNaturaleza(c.naturaleza, dec(m.debe), dec(m.haber)))
            filas.push({
                fila: 'movimiento',
                ...base,
                fecha: m.fecha,
                partida: m.partida === null ? null : Number(m.partida),
                asiento_id: Number(m.asiento_id),
                descripcion: m.descripcion,
                debe: aTexto(dec(m.debe)),
                haber: aTexto(dec(m.haber)),
                saldo: aTexto(saldo),
            })
        }
        filas.push({
            fila: 'saldo_final',
            ...base,
            fecha: null,
            partida: null,
            asiento_id: null,
            descripcion: 'Saldo final',
            debe: aTexto(debe),
            haber: aTexto(haber),
            saldo: aTexto(saldo),
        })
    }
    return armarLibro({
        libro: 'mayor',
        empresaId,
        ...rango,
        columnas: COLUMNAS_LIBRO_MAYOR,
        filas,
        acumulables: ['debe', 'haber'],
    })
}

/*
|--------------------------------------------------------------------------
| Compras y servicios recibidos
|--------------------------------------------------------------------------
*/

const DINERO_COMPRAS = COLUMNAS_LIBRO_COMPRAS.filter((c) => c.tipo === 'dinero').map((c) => c.clave)

/**
 * El libro de compras va por mes del IVA (`periodo_iva`, desvío c de §19): el rango se lleva a
 * meses completos también en la vista previa.
 */
export async function libroComprasLegal(
    empresaId: number,
    rango: { desde: string; hasta: string },
    cliente: QueryClientContract = db.connection(),
): Promise<LibroLegal> {
    const meses = mesesDelRango(rango)
    const filas = await filasLibroCompras(cliente, empresaId, meses.desde, meses.hasta)
    return armarLibro({
        libro: 'compras',
        empresaId,
        desde: meses.desde,
        hasta: finDeMes(meses.hasta),
        columnas: COLUMNAS_LIBRO_COMPRAS,
        filas,
        acumulables: DINERO_COMPRAS,
    })
}

/*
|--------------------------------------------------------------------------
| Ventas y servicios prestados
|--------------------------------------------------------------------------
*/

export const COLUMNAS_LIBRO_VENTAS = definirColumnas([
    { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
    { clave: 'origen', titulo: 'Origen', tipo: 'texto' },
    { clave: 'documento', titulo: 'Documento', tipo: 'texto' },
    { clave: 'tipo', titulo: 'Tipo DTE', tipo: 'texto' },
    { clave: 'serie', titulo: 'Serie', tipo: 'texto', nulable: true },
    { clave: 'numero', titulo: 'Número', tipo: 'texto', nulable: true },
    { clave: 'autorizacion', titulo: 'Autorización', tipo: 'texto', nulable: true },
    { clave: 'nit', titulo: 'NIT/CUI/CF', tipo: 'texto' },
    { clave: 'cliente', titulo: 'Cliente', tipo: 'texto' },
    { clave: 'bienes', titulo: 'Bienes', tipo: 'dinero' },
    { clave: 'servicios', titulo: 'Servicios', tipo: 'dinero' },
    { clave: 'exportacion', titulo: 'Exportación', tipo: 'dinero' },
    { clave: 'exento', titulo: 'Exento', tipo: 'dinero' },
    { clave: 'iva', titulo: 'IVA', tipo: 'dinero' },
    { clave: 'total', titulo: 'Total', tipo: 'dinero' },
    { clave: 'estado', titulo: 'Estado', tipo: 'texto' },
    { clave: 'retenciones', titulo: 'Retenciones recibidas', tipo: 'dinero' },
])

const DINERO_VENTAS = COLUMNAS_LIBRO_VENTAS.filter((c) => c.tipo === 'dinero').map((c) => c.clave)

interface DocumentoVenta {
    origen: 'dte' | 'interno'
    clase: 'factura' | 'nota_credito' | 'nota_debito'
    id: number
    factura_id: number | null
    fecha: string
    tipo: string
    serie: string | null
    numero: string | null
    autorizacion: string | null
    nit: string
    cliente: string
    total: string
    iva: string
    anulado: boolean
}

/**
 * Documentos de venta de la empresa con fecha en el rango:
 *
 * - DTE certificados (con autorización) de facturas, NCRE y NDEB, en la fecha de emisión del DTE
 *   (Guatemala); un DTE anulado sale con los valores en cero;
 * - sin FEL: facturas que no son aviso de cobro, sin DTE certificado ni importadas
 *   (`clave_externa`), en la fecha de su asiento (la del IVA débito); y sus notas de crédito sin
 *   NCRE, en la fecha de la nota. Anuladas: valores en cero.
 *
 * Los avisos de cobro sin DTE no son venta fiscal (su IVA va a 2.1.11 hasta certificarse). La NCRE
 * y la nota sin DTE restan. Base = total − IVA a servicios (los planes y cargos son servicios); con
 * IVA cero, todo a exento. Retenciones recibidas: las constancias de los pagos vigentes aplicados a
 * la factura, en proporción a lo aplicado.
 */
export async function libroVentasLegal(
    empresaId: number,
    rango: { desde: string; hasta: string },
    cliente: QueryClientContract = db.connection(),
): Promise<LibroLegal> {
    const { rows } = (await cliente.rawQuery(
        `WITH dte AS (
             SELECT 'dte' AS origen, d.documento_tipo AS clase, d.id,
                    CASE WHEN d.documento_tipo = 'factura' THEN d.documento_id END AS factura_id,
                    to_char((d.fecha_emision AT TIME ZONE 'America/Guatemala')::date, 'YYYY-MM-DD') AS fecha,
                    d.tipo_dte AS tipo, d.serie, d.numero, d.autorizacion,
                    coalesce(d.receptor->>'id', 'CF') AS nit, coalesce(d.receptor->>'nombre', '') AS cliente,
                    d.total::text AS total, d.iva::text AS iva, d.estado = 'anulado' AS anulado
               FROM fiscal.dte d
              WHERE d.empresa_id = ? AND d.autorizacion IS NOT NULL
                AND d.estado IN ('certificado', 'anulacion_pendiente', 'anulado')
                AND (d.fecha_emision AT TIME ZONE 'America/Guatemala')::date BETWEEN ? AND ?
         ), sin_dte AS (
             SELECT f.* FROM billing.facturas f
              WHERE f.empresa_id = ? AND NOT f.aviso_cobro AND f.clave_externa IS NULL
                AND NOT EXISTS (SELECT 1 FROM fiscal.dte d WHERE d.documento_tipo = 'factura'
                                   AND d.documento_id = f.id AND d.autorizacion IS NOT NULL)
         ), facturas AS (
             SELECT 'interno' AS origen, 'factura' AS clase, f.id, f.id AS factura_id,
                    to_char(a.fecha, 'YYYY-MM-DD') AS fecha, 'FACTURA' AS tipo, NULL::text AS serie,
                    f.id::text AS numero, NULL::text AS autorizacion, f.cliente_id,
                    f.total::text AS total, f.iva::text AS iva, f.estado = 'anulada' AS anulado
               FROM sin_dte f
               JOIN LATERAL (SELECT min(x.fecha) AS fecha FROM ledger.asientos x
                              WHERE x.empresa_id = f.empresa_id AND x.origen_tipo = 'factura'
                                AND x.origen_id = f.id AND x.reversa_de IS NULL) a ON a.fecha IS NOT NULL
              WHERE a.fecha BETWEEN ? AND ?
         ), notas AS (
             SELECT 'interno' AS origen, 'nota_credito' AS clase, n.id, NULL::bigint AS factura_id,
                    to_char(n.fecha, 'YYYY-MM-DD') AS fecha, 'NOTA' AS tipo, NULL::text AS serie,
                    n.id::text AS numero, NULL::text AS autorizacion, n.cliente_id,
                    n.monto::text AS total, n.iva::text AS iva,
                    EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones x WHERE x.nota_id = n.id) AS anulado
               FROM billing.notas_credito n JOIN sin_dte f ON f.id = n.factura_id
              WHERE n.empresa_id = ? AND n.fecha BETWEEN ? AND ?
                AND NOT EXISTS (SELECT 1 FROM fiscal.dte d WHERE d.documento_tipo = 'nota_credito'
                                   AND d.documento_id = n.id AND d.autorizacion IS NOT NULL)
         ), internos AS (
             SELECT i.origen, i.clase, i.id, i.factura_id, i.fecha, i.tipo, i.serie, i.numero, i.autorizacion,
                    CASE WHEN c.nit_cui_invalido OR c.tipo_documento_fiscal = 'cf' OR coalesce(c.nit_cui, '') = ''
                         THEN 'CF' ELSE upper(regexp_replace(c.nit_cui, '[\\s-]', '', 'g')) END AS nit,
                    CASE WHEN c.nit_cui_invalido OR c.tipo_documento_fiscal = 'cf' OR coalesce(c.nit_cui, '') = ''
                         THEN 'Consumidor Final' ELSE coalesce(c.nombre_fiscal, c.nombre) END AS cliente,
                    i.total, i.iva, i.anulado
               FROM (SELECT * FROM facturas UNION ALL SELECT * FROM notas) i
               JOIN core.clientes c ON c.id = i.cliente_id
         )
         SELECT * FROM (SELECT * FROM dte UNION ALL SELECT * FROM internos) v
          ORDER BY v.fecha, v.origen, v.clase, v.id`,
        [
            empresaId,
            rango.desde,
            rango.hasta,
            empresaId,
            rango.desde,
            rango.hasta,
            empresaId,
            rango.desde,
            rango.hasta,
        ],
    )) as { rows: DocumentoVenta[] }

    const facturas = [...new Set(rows.filter((r) => r.factura_id !== null).map((r) => Number(r.factura_id)))]
    const retenciones = new Map<number, Dec>()
    if (facturas.length > 0) {
        const { rows: ret } = (await cliente.rawQuery(
            `SELECT pa.factura_id, cr.monto::text AS constancia, pa.monto::text AS aplicado, p.monto::text AS pago
               FROM billing.pagos_aplicaciones pa
               JOIN billing.pagos p ON p.id = pa.pago_id
               JOIN ledger.constancias_retencion cr ON cr.pago_id = p.id AND cr.direccion = 'recibida'
              WHERE pa.factura_id = ANY(?::bigint[]) AND p.estado <> 'anulado' AND p.monto > 0`,
            [facturas],
        )) as { rows: Array<{ factura_id: number; constancia: string; aplicado: string; pago: string }> }
        for (const r of ret) {
            const parte = dec(r.constancia).times(dec(r.aplicado)).dividedBy(dec(r.pago))
            const id = Number(r.factura_id)
            retenciones.set(id, (retenciones.get(id) ?? CERO).plus(parte))
        }
    }

    const filas: Fila[] = rows.map((r) => {
        const signo = r.clase === 'nota_credito' ? -1 : 1
        const total = r.anulado ? CERO : dec(r.total).times(signo)
        const iva = r.anulado ? CERO : dec(r.iva).times(signo)
        const exento = iva.isZero() ? total : CERO
        const servicios = iva.isZero() ? CERO : total.minus(iva)
        const retenido =
            r.anulado || r.factura_id === null ? CERO : (retenciones.get(Number(r.factura_id)) ?? CERO)
        return {
            fecha: r.fecha,
            origen: r.origen,
            documento: `${r.origen === 'dte' ? 'DTE' : r.clase === 'factura' ? 'Factura' : 'Nota'} ${r.id}`,
            tipo: r.tipo,
            serie: r.serie,
            numero: r.numero,
            autorizacion: r.autorizacion,
            nit: r.nit,
            cliente: r.cliente,
            bienes: '0.00',
            servicios: aTexto(servicios),
            exportacion: '0.00',
            exento: aTexto(exento),
            iva: aTexto(iva),
            total: aTexto(total),
            estado: r.anulado ? 'anulado' : 'vigente',
            retenciones: aTexto(retenido),
        }
    })
    return armarLibro({
        libro: 'ventas',
        empresaId,
        ...rango,
        columnas: COLUMNAS_LIBRO_VENTAS,
        filas,
        acumulables: DINERO_VENTAS,
    })
}

/*
|--------------------------------------------------------------------------
| Despacho
|--------------------------------------------------------------------------
*/

const CONSTRUCTORES: Record<
    LibroEmitible,
    (
        empresaId: number,
        rango: { desde: string; hasta: string },
        cliente?: QueryClientContract,
    ) => Promise<LibroLegal>
> = {
    diario: libroDiarioLegal,
    mayor: libroMayorLegal,
    compras: libroComprasLegal,
    ventas: libroVentasLegal,
}

export function construirLibro(
    libro: LibroEmitible,
    empresaId: number,
    rango: { desde: string; hasta: string },
    cliente: QueryClientContract = db.connection(),
): Promise<LibroLegal> {
    return CONSTRUCTORES[libro](empresaId, rango, cliente)
}

export function esLibroEmitible(valor: string): valor is LibroEmitible {
    return (LIBROS_EMITIBLES as readonly string[]).includes(valor)
}
