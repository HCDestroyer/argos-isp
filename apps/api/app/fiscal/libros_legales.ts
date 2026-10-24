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
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
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
    clase: 'factura' | 'mora' | 'nota_credito' | 'nota_debito'
    id: number
    factura_id: number | null
    fecha: string
    movimiento: 'original' | 'anulacion'
    tipo: string
    serie: string | null
    numero: string | null
    autorizacion: string | null
    nit: string
    cliente: string
    total: string
    iva: string
    anulado: boolean
    /** DTE de un documento cuyo IVA fue a 2.1.02 en otro mes (H31): fila sin montos */
    informativo:
        | 'certificado_posterior'
        | 'certificado_previo'
        | 'reclasificado_posterior'
        | 'reclasificado_previo'
        | null
    referencia: string | null
}

/**
 * Documentos de venta de la empresa con fecha en el rango. Un libro emitido de un mes cerrado no
 * cambia por hechos posteriores (hallazgos H28–H30 del auditor):
 *
 * - DTE certificados (con autorización) de facturas, NCRE y NDEB, en la fecha de emisión del DTE
 *   (Guatemala), con el receptor del DTE;
 * - sin FEL: facturas que no son aviso de cobro, no importadas (`clave_externa`) y sin DTE
 *   certificado hasta `hasta`, en la fecha de su asiento (la del IVA débito); y sus notas de crédito
 *   sin NCRE hasta `hasta`, en la fecha de la nota. Las notas sobre importadas también salen
 *   (H48, H62): rebajan las ventas (y 2.1.02) del mes aunque la importada no esté en el libro. Si el
 *   libro de ventas de ese mes se emitió sin ellas (`libros_emisiones.notas_importadas` NULL, antes
 *   de H48), ese libro no cambia: la nota va como fila de ajuste (con su referencia) en el primer
 *   mes siguiente sin un libro emitido así. Las notas viejas sobre importadas (antes de H50: base a
 *   2.9.01, IVA 0) no salen: su asiento no toca 2.1.02 ni una cuenta de ingreso, no rebajaron
 *   ventas. El receptor es el guardado al emitirlas
 *   (`billing.facturas.receptor`, `billing.notas_credito.receptor`), no el dato actual del cliente.
 * - Anulación (como el desvío c del libro de compras): en el mismo mes del documento, la fila sale en
 *   cero; en un mes posterior, la fila original queda vigente y en el mes de la anulación (fecha del
 *   reverso del asiento o, sin él, de la anulación) va una fila `anulacion` con los valores en
 *   negativo. Así el IVA de cada mes cuadra con el movimiento de 2.1.02.
 *
 * - H31 · los montos van al mes en que se movió 2.1.02: si el asiento original de una factura o nota
 *   (no aviso de cobro) es de otro mes que su DTE, la fila interna lleva los montos en el mes del
 *   asiento y el DTE sale como fila informativa sin montos (`certificado_posterior` o
 *   `certificado_previo`), con la referencia al documento. Las facturas y notas sin DTE (o con DTE
 *   de otro mes) son las de ese asiento; el DTE del mismo mes las reemplaza si se certificó hasta
 *   `hasta`. Los avisos de cobro siguen con el DTE (su IVA pasa de 2.1.11 a 2.1.02 al certificarse).
 *
 * Los avisos de cobro sin DTE no son venta fiscal (su IVA va a 2.1.11 hasta certificarse). La NCRE
 * y la nota sin DTE restan. Base = total − IVA a servicios (los planes y cargos son servicios); con
 * IVA cero, todo a exento. Retenciones recibidas: las constancias con fecha hasta `hasta` de los
 * pagos aplicados a la factura que no estaban anulados a esa fecha, en proporción a lo aplicado
 * (una constancia posterior no cambia el mes ya emitido: contador).
 */
export async function libroVentasLegal(
    empresaId: number,
    rango: { desde: string; hasta: string },
    cliente: QueryClientContract = db.connection(),
): Promise<LibroLegal> {
    const { rows } = (await cliente.rawQuery(
        `WITH orig AS (
             -- asiento original de cada factura y nota (el del IVA): fecha, reverso y si su IVA fue a
             -- 2.1.11 (aviso de cobro sin DTE) en lugar de 2.1.02
             SELECT x.origen_tipo AS clase, x.origen_id AS id, min(x.fecha) AS fecha,
                    (SELECT min(r.fecha) FROM ledger.asientos r WHERE r.reversa_de = min(x.id)) AS reverso,
                    EXISTS (SELECT 1 FROM ledger.movimientos m JOIN ledger.cuentas c ON c.id = m.cuenta_id
                             WHERE m.asiento_id = min(x.id) AND c.codigo = :cuenta_aviso) AS aviso,
                    EXISTS (SELECT 1 FROM ledger.movimientos m JOIN ledger.cuentas c ON c.id = m.cuenta_id
                             WHERE m.asiento_id = min(x.id) AND c.codigo = :cuenta_debito) AS debito_iva
               FROM ledger.asientos x
              WHERE x.empresa_id = :empresa AND x.origen_tipo IN ('factura', 'nota_credito', 'mora') AND x.reversa_de IS NULL
              GROUP BY x.origen_tipo, x.origen_id
         ), debito AS (
             SELECT * FROM orig WHERE NOT aviso
         ), dte_base AS (
             SELECT d.*, o.id AS o_id, o.fecha AS o_fecha, o.reverso AS o_reverso,
                    (d.fecha_emision AT TIME ZONE 'America/Guatemala')::date AS emitido,
                    -- H33: reclasificación 2.1.11 / 2.1.02 del aviso (o la NDEB de una mora aviso)
                    r.fecha AS reclas, r.reverso AS reclas_reverso
               FROM fiscal.dte d
               LEFT JOIN debito o ON o.id = d.documento_id
                    AND o.clase = CASE d.documento_tipo WHEN 'nota_debito' THEN 'mora' ELSE d.documento_tipo END
               LEFT JOIN LATERAL (
                    SELECT x.fecha, (SELECT min(y.fecha) FROM ledger.asientos y WHERE y.reversa_de = x.id) AS reverso
                      FROM ledger.asientos x
                     WHERE x.empresa_id = d.empresa_id AND x.origen_tipo = 'reclasificacion'
                       AND x.origen_id = d.id AND x.reversa_de IS NULL
                     ORDER BY x.id LIMIT 1) r ON true
              WHERE d.empresa_id = :empresa AND d.autorizacion IS NOT NULL
                AND d.estado IN ('certificado', 'anulacion_pendiente', 'anulado')
         ), dte_marcado AS (
             SELECT b.*,
                    -- H31: el IVA ya fue a 2.1.02 en el mes del asiento del documento, que es otro
                    (b.o_id IS NOT NULL AND date_trunc('month', b.o_fecha) <> date_trunc('month', b.emitido)) AS otro_mes,
                    -- H33: el IVA del aviso llegó a 2.1.02 con la reclasificación, en otro mes
                    (b.o_id IS NULL AND b.reclas IS NOT NULL
                     AND date_trunc('month', b.reclas) <> date_trunc('month', b.emitido)) AS reclasificado
               FROM dte_base b
         ), dte AS (
             -- la fila con montos: en el mes de emisión, o en el de la reclasificación (H33)
             SELECT 'dte' AS origen, d.documento_tipo AS clase, d.id,
                    CASE WHEN d.documento_tipo IN ('factura', 'nota_debito') THEN d.documento_id END AS factura_id,
                    CASE WHEN d.reclasificado THEN d.reclas ELSE d.emitido END AS fecha_doc,
                    CASE WHEN d.estado = 'anulado' AND NOT d.otro_mes
                         THEN coalesce(d.o_reverso, d.reclas_reverso, (d.anulado_en AT TIME ZONE 'America/Guatemala')::date)
                    END AS fecha_anul,
                    d.tipo_dte AS tipo, d.serie, d.numero, d.autorizacion,
                    coalesce(d.receptor->>'id', 'CF') AS nit, coalesce(d.receptor->>'nombre', '') AS cliente,
                    d.total::text AS total, d.iva::text AS iva,
                    CASE WHEN d.otro_mes
                         THEN CASE WHEN d.o_fecha < d.emitido THEN 'certificado_posterior' ELSE 'certificado_previo' END
                    END AS informativo,
                    CASE WHEN d.otro_mes
                         THEN (CASE d.documento_tipo WHEN 'factura' THEN 'Factura ' WHEN 'nota_debito' THEN 'Mora '
                                    ELSE 'Nota ' END)
                              || d.documento_id || ' del ' || to_char(d.o_fecha, 'YYYY-MM-DD')
                         WHEN d.reclasificado
                         THEN 'emitido el ' || to_char(d.emitido, 'YYYY-MM-DD')
                    END AS referencia
               FROM dte_marcado d
             UNION ALL
             -- H33: en el mes de emisión del DTE reclasificado en otro mes, fila informativa sin montos
             SELECT 'dte', d.documento_tipo, d.id,
                    CASE WHEN d.documento_tipo IN ('factura', 'nota_debito') THEN d.documento_id END,
                    d.emitido, NULL::date,
                    d.tipo_dte, d.serie, d.numero, d.autorizacion,
                    coalesce(d.receptor->>'id', 'CF'), coalesce(d.receptor->>'nombre', ''),
                    d.total::text, d.iva::text,
                    CASE WHEN d.reclas > d.emitido THEN 'reclasificado_posterior' ELSE 'reclasificado_previo' END,
                    'reclasificación del ' || to_char(d.reclas, 'YYYY-MM-DD')
               FROM dte_marcado d WHERE d.reclasificado
         ), facturas AS (
             -- sin FEL (o certificada en otro mes): la fila interna en el mes de su asiento
             SELECT 'interno' AS origen, CASE WHEN f.tipo = 'mora' THEN 'mora' ELSE 'factura' END AS clase,
                    f.id, f.id AS factura_id, o.fecha AS fecha_doc,
                    CASE WHEN f.estado = 'anulada' THEN coalesce(o.reverso,
                        (f.anulada_en AT TIME ZONE 'America/Guatemala')::date) END AS fecha_anul,
                    CASE WHEN f.tipo = 'mora' THEN 'MORA' ELSE 'FACTURA' END AS tipo, NULL::text AS serie,
                    f.id::text AS numero, NULL::text AS autorizacion,
                    coalesce(f.receptor->>'id', 'CF') AS nit, coalesce(f.receptor->>'nombre', '') AS cliente,
                    f.total::text AS total, f.iva::text AS iva, NULL::text AS informativo, NULL::text AS referencia
               FROM billing.facturas f
               JOIN debito o ON o.id = f.id AND o.clase = CASE WHEN f.tipo = 'mora' THEN 'mora' ELSE 'factura' END
              WHERE f.empresa_id = :empresa AND f.clave_externa IS NULL
                -- la mora sin IVA y sin DTE no es documento fiscal (no mueve 2.1.02)
                AND (f.tipo <> 'mora' OR o.debito_iva)
                AND NOT EXISTS (SELECT 1 FROM fiscal.dte d
                                 WHERE d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                                   AND d.documento_id = f.id AND d.autorizacion IS NOT NULL
                                   AND (d.fecha_emision AT TIME ZONE 'America/Guatemala')::date <= :hasta
                                   AND date_trunc('month', (d.fecha_emision AT TIME ZONE 'America/Guatemala')::date)
                                       = date_trunc('month', o.fecha))
         ), notas_base AS (
             SELECT n.*, o.fecha AS o_fecha,
                    (SELECT coalesce(a.fecha, (x.anulado_en AT TIME ZONE 'America/Guatemala')::date)
                       FROM billing.notas_credito_anulaciones x LEFT JOIN ledger.asientos a ON a.id = x.asiento_id
                      WHERE x.nota_id = n.id ORDER BY x.id LIMIT 1) AS anul,
                    -- un libro emitido no cambia: la nota sobre una importada en un mes cuyo libro se emitió
                    -- sin ellas (antes de H48) va como ajuste al primer mes siguiente sin un libro así
                    CASE WHEN f.clave_externa IS NOT NULL AND EXISTS (
                             SELECT 1 FROM fiscal.libros_emisiones e
                              WHERE e.empresa_id = n.empresa_id AND e.libro = 'ventas' AND e.notas_importadas IS NOT TRUE
                                AND o.fecha BETWEEN e.desde AND e.hasta)
                         THEN (SELECT min(g)::date
                                 FROM generate_series(date_trunc('month', o.fecha) + interval '1 month',
                                                      date_trunc('month', o.fecha) + interval '240 months',
                                                      interval '1 month') g
                                WHERE NOT EXISTS (
                                    SELECT 1 FROM fiscal.libros_emisiones e
                                     WHERE e.empresa_id = n.empresa_id AND e.libro = 'ventas'
                                       AND e.notas_importadas IS NOT TRUE AND g::date BETWEEN e.desde AND e.hasta))
                    END AS ajuste_en
               FROM billing.notas_credito n
               JOIN debito o ON o.clase = 'nota_credito' AND o.id = n.id
               -- H48 / H62: la nota sobre una importada (sin FEL) es una rebaja de ventas del mes, con o sin IVA
               JOIN billing.facturas f ON f.id = n.factura_id
              WHERE n.empresa_id = :empresa
                AND NOT EXISTS (SELECT 1 FROM fiscal.dte d WHERE d.documento_tipo = 'nota_credito'
                                   AND d.documento_id = n.id AND d.autorizacion IS NOT NULL
                                   AND (d.fecha_emision AT TIME ZONE 'America/Guatemala')::date <= :hasta
                                   AND date_trunc('month', (d.fecha_emision AT TIME ZONE 'America/Guatemala')::date)
                                       = date_trunc('month', o.fecha))
                -- decisión del líder: la nota vieja sobre una importada (antes de H50, base a 2.9.01 e IVA 0)
                -- no rebajó ventas: su asiento no toca 2.1.02 ni una cuenta de ingreso y queda fuera
                AND (f.clave_externa IS NULL OR EXISTS (
                        SELECT 1 FROM ledger.asientos a
                          JOIN ledger.movimientos m ON m.asiento_id = a.id
                          JOIN ledger.cuentas c ON c.id = m.cuenta_id
                         WHERE a.origen_tipo = 'nota_credito' AND a.origen_id = n.id AND a.reversa_de IS NULL
                           AND (c.codigo = :cuenta_debito OR c.tipo = 'ingreso')))
         ), notas AS (
             SELECT 'interno' AS origen, 'nota_credito' AS clase, n.id, NULL::bigint AS factura_id,
                    coalesce(n.ajuste_en, n.o_fecha) AS fecha_doc,
                    n.anul AS fecha_anul,
                    'NOTA' AS tipo, NULL::text AS serie, n.id::text AS numero, NULL::text AS autorizacion,
                    coalesce(n.receptor->>'id', 'CF') AS nit, coalesce(n.receptor->>'nombre', '') AS cliente,
                    n.monto::text AS total, n.iva::text AS iva, NULL::text AS informativo,
                    CASE WHEN n.ajuste_en IS NOT NULL
                         THEN 'ajuste: nota del ' || to_char(n.o_fecha, 'YYYY-MM-DD') || ' (libro de '
                              || to_char(n.o_fecha, 'YYYY-MM') || ' ya emitido)'
                    END AS referencia
               FROM notas_base n
              -- desplazada y anulada antes del mes del ajuste (en un mes ya emitido): no hay nada que ajustar
              WHERE NOT (n.ajuste_en IS NOT NULL AND n.anul IS NOT NULL AND n.anul < n.ajuste_en)
         ), docs AS (
             SELECT * FROM dte UNION ALL SELECT * FROM facturas UNION ALL SELECT * FROM notas
         ), filas AS (
             SELECT d.*, 'original' AS movimiento, d.fecha_doc AS fecha_fila,
                    (d.fecha_anul IS NOT NULL AND d.fecha_anul <= :hasta
                     AND date_trunc('month', d.fecha_anul) = date_trunc('month', d.fecha_doc)) AS anulado
               FROM docs d WHERE d.fecha_doc BETWEEN :desde AND :hasta
             UNION ALL
             SELECT d.*, 'anulacion', d.fecha_anul, false
               FROM docs d
              WHERE d.fecha_anul BETWEEN :desde AND :hasta
                AND date_trunc('month', d.fecha_anul) <> date_trunc('month', d.fecha_doc)
         )
         SELECT origen, clase, id, factura_id, to_char(fecha_fila, 'YYYY-MM-DD') AS fecha, movimiento, tipo, serie,
                numero, autorizacion, nit, cliente, total, iva, anulado, informativo, referencia
           FROM filas
          ORDER BY fecha_fila, origen, clase, id, movimiento DESC`,
        {
            empresa: empresaId,
            desde: rango.desde,
            hasta: rango.hasta,
            cuenta_aviso: CUENTAS_GT.IVA_POR_CERTIFICAR,
            cuenta_debito: CUENTAS.IVA_DEBITO,
        },
    )) as { rows: DocumentoVenta[] }

    const facturas = [
        ...new Set(
            rows
                .filter((r) => r.factura_id !== null && r.movimiento === 'original' && !r.informativo)
                .map((r) => Number(r.factura_id)),
        ),
    ]
    const retenciones = new Map<number, Dec>()
    if (facturas.length > 0) {
        const { rows: ret } = (await cliente.rawQuery(
            `SELECT pa.factura_id, cr.monto::text AS constancia, pa.monto::text AS aplicado, p.monto::text AS pago
               FROM billing.pagos_aplicaciones pa
               JOIN billing.pagos p ON p.id = pa.pago_id
               JOIN ledger.constancias_retencion cr ON cr.pago_id = p.id AND cr.direccion = 'recibida'
              WHERE pa.factura_id = ANY(?::bigint[]) AND p.monto > 0 AND cr.fecha <= ?
                AND (p.estado <> 'anulado' OR (p.anulado_en AT TIME ZONE 'America/Guatemala')::date > ?)`,
            [facturas, rango.hasta, rango.hasta],
        )) as { rows: Array<{ factura_id: number; constancia: string; aplicado: string; pago: string }> }
        for (const r of ret) {
            const parte = dec(r.constancia).times(dec(r.aplicado)).dividedBy(dec(r.pago))
            const id = Number(r.factura_id)
            retenciones.set(id, (retenciones.get(id) ?? CERO).plus(parte))
        }
    }

    const filas: Fila[] = rows.map((r) => {
        const anulacion = r.movimiento === 'anulacion'
        const signo = (r.clase === 'nota_credito' ? -1 : 1) * (anulacion ? -1 : 1)
        const sinMontos = r.anulado || r.informativo !== null
        const total = sinMontos ? CERO : dec(r.total).times(signo)
        const iva = sinMontos ? CERO : dec(r.iva).times(signo)
        const exento = iva.isZero() ? total : CERO
        const servicios = iva.isZero() ? CERO : total.minus(iva)
        const retenido =
            sinMontos || anulacion || r.factura_id === null
                ? CERO
                : (retenciones.get(Number(r.factura_id)) ?? CERO)
        const nombre =
            r.origen === 'dte'
                ? 'DTE'
                : r.clase === 'factura'
                  ? 'Factura'
                  : r.clase === 'mora'
                    ? 'Mora'
                    : 'Nota'
        return {
            fecha: r.fecha,
            origen: r.origen,
            documento: `${nombre} ${r.id}${anulacion ? ' (anulación)' : ''}${
                !r.referencia ? '' : r.informativo ? ` · IVA en ${r.referencia}` : ` · ${r.referencia}`
            }`,
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
            estado: anulacion ? 'anulacion' : (r.informativo ?? (r.anulado ? 'anulado' : 'vigente')),
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
