import { createHash } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar } from '#shared/paginacion'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { datosFiscales, resolver } from '#fiscal/parametros'
import { resolverImpuesto } from '#fiscal/impuestos'
import { ParametroSinConfirmar } from '#fiscal/errores'
import { libroVentasLegal } from '#fiscal/libros_legales'
import { filasLibroCompras } from '#fiscal/libros'
import { calcularRenta } from '#fiscal/declaraciones_renta'

/**
 * Declaraciones de IVA y de pequeño contribuyente (contrato §9.3, §10.2 y §10.6; fase 7 PR B).
 * Son **borradores**: el sistema nunca presenta nada a la SAT.
 *
 * El borrador sale de los documentos: el libro de ventas del mes (DTE certificados y documentos sin
 * FEL, `libroVentasLegal`), el libro de compras del mes del IVA (`filasLibroCompras`) y las
 * constancias de retención de IVA recibidas (en el mes del asiento de su pago; su anulación resta
 * en el mes del reverso). Antes de revisarlo se cuadra contra las etiquetas del libro (check
 * `iva_cuadrado`): Σ `V_IVA` = débito, Σ `C_IVA` = crédito, Σ `RET_IVA_REC` = retenciones.
 *
 * IVA (régimen general): D débito, C crédito, R retenciones, A remanentes del mes anterior (de su
 * última versión revisada). El crédito (C + A + una venta neta negativa) se usa primero y luego las
 * retenciones; `a_pagar` = lo que queda del débito. Lo no usado pasa al mes siguiente como
 * remanente, sin asiento (en `1.1.04` y `1.1.05`, como el _tax carryover_ de Odoo).
 *
 * Pequeño contribuyente: `IVA_PC` (5 %) sobre el total del libro de ventas del mes, menos las
 * retenciones del 5 % recibidas (y su remanente).
 *
 * ISR (opcional mensual, trimestral y anual), ISO trimestral y retenciones (fase 7 PR C) se calculan
 * en `#fiscal/declaraciones_renta`; este módulo los despacha y comparte versiones, hash y lecturas.
 */

export const IMPUESTOS_DECLARABLES = [
    'iva_mensual',
    'pc_mensual',
    'isr_opcional_mensual',
    'isr_trimestral',
    'iso_trimestral',
    'isr_anual',
    'retenciones_iva',
    'retenciones_isr',
] as const
export type ImpuestoDeclarable = (typeof IMPUESTOS_DECLARABLES)[number]
/** Las del IVA: remanentes de un mes al siguiente, cascada (H34) y checks `iva_cuadrado`/`iva_liquidado`. */
export const IMPUESTOS_IVA = ['iva_mensual', 'pc_mensual'] as const
export const IMPUESTOS_RETENCIONES = ['retenciones_iva', 'retenciones_isr'] as const
export const ESTADOS_DECLARACION = ['borrador', 'revisada', 'presentada', 'sustituida'] as const
export type EstadoDeclaracion = (typeof ESTADOS_DECLARACION)[number]

export const esDeIva = (impuesto: string) => (IMPUESTOS_IVA as readonly string[]).includes(impuesto)
export const esDeRetenciones = (impuesto: string) =>
    (IMPUESTOS_RETENCIONES as readonly string[]).includes(impuesto)

/** Parámetro del plazo y formulario (el del calendario, `l10n/gt/obligaciones.ts`). */
export const FORMULARIOS: Record<ImpuestoDeclarable, { parametro: string }> = {
    iva_mensual: { parametro: 'iva_declaracion' },
    pc_mensual: { parametro: 'pc_declaracion' },
    isr_opcional_mensual: { parametro: 'isr_opcional_plazo' },
    isr_trimestral: { parametro: 'isr_trimestral_plazo' },
    iso_trimestral: { parametro: 'iso_plazo' },
    isr_anual: { parametro: 'isr_anual_plazo' },
    retenciones_iva: { parametro: 'ret_iva_plazo' },
    retenciones_isr: { parametro: 'isr_retenciones_plazo' },
}

export type PeriodicidadDeclaracion = 'mensual' | 'trimestral' | 'anual'
export const PERIODICIDAD: Record<ImpuestoDeclarable, PeriodicidadDeclaracion> = {
    iva_mensual: 'mensual',
    pc_mensual: 'mensual',
    isr_opcional_mensual: 'mensual',
    isr_trimestral: 'trimestral',
    iso_trimestral: 'trimestral',
    isr_anual: 'anual',
    retenciones_iva: 'mensual',
    retenciones_isr: 'mensual',
}

/** Cuenta por pagar que salda el pago de la declaración (§9.3). */
export const CUENTA_POR_PAGAR: Record<ImpuestoDeclarable, string> = {
    iva_mensual: CUENTAS_GT.IVA_POR_PAGAR,
    pc_mensual: CUENTAS_GT.PC_POR_PAGAR,
    isr_opcional_mensual: CUENTAS_GT.ISR_POR_PAGAR,
    isr_trimestral: CUENTAS_GT.ISR_POR_PAGAR,
    isr_anual: CUENTAS_GT.ISR_POR_PAGAR,
    iso_trimestral: CUENTAS_GT.ISO_POR_PAGAR,
    retenciones_iva: CUENTAS_GT.RETENCIONES_IVA_POR_PAGAR,
    retenciones_isr: CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR,
}

const FORMATO_PERIODO: Record<PeriodicidadDeclaracion, { regex: RegExp; texto: string }> = {
    mensual: { regex: /^(\d{4})-(0[1-9]|1[0-2])$/, texto: 'AAAA-MM' },
    trimestral: { regex: /^(\d{4})-T([1-4])$/, texto: 'AAAA-Tn (T1 a T4)' },
    anual: { regex: /^(\d{4})$/, texto: 'AAAA' },
}

/** Formato del periodo de un impuesto (`AAAA-MM`, `AAAA-Tn`, `AAAA`). */
export function formatoPeriodo(impuesto: ImpuestoDeclarable): string {
    return FORMATO_PERIODO[PERIODICIDAD[impuesto]].texto
}

/** Primer día del periodo escrito como texto, o null si no tiene el formato de su periodicidad. */
export function inicioDePeriodo(impuesto: ImpuestoDeclarable, texto: string): string | null {
    const periodicidad = PERIODICIDAD[impuesto]
    const m = FORMATO_PERIODO[periodicidad].regex.exec(texto ?? '')
    if (!m) return null
    if (periodicidad === 'mensual') return `${m[1]}-${m[2]}-01`
    if (periodicidad === 'trimestral') return `${m[1]}-${String(Number(m[2]) * 3 - 2).padStart(2, '0')}-01`
    return `${m[1]}-01-01`
}

/** Último día del periodo que empieza en `desde`. */
export function finDePeriodo(impuesto: ImpuestoDeclarable | string, desde: string): string {
    const inicio = DateTime.fromISO(desde, { zone: 'utc' })
    const periodicidad = PERIODICIDAD[impuesto as ImpuestoDeclarable] ?? 'mensual'
    if (periodicidad === 'trimestral') return inicio.plus({ months: 2 }).endOf('month').toISODate()!
    if (periodicidad === 'anual') return inicio.endOf('year').toISODate()!
    return inicio.endOf('month').toISODate()!
}

/** Texto del periodo (`2026-03`, `2026-T1`, `2026`) para mensajes y eventos. */
export function textoDePeriodo(impuesto: ImpuestoDeclarable | string, desde: string): string {
    const periodicidad = PERIODICIDAD[impuesto as ImpuestoDeclarable] ?? 'mensual'
    if (periodicidad === 'trimestral') {
        return `${desde.slice(0, 4)}-T${Math.floor((Number(desde.slice(5, 7)) - 1) / 3) + 1}`
    }
    if (periodicidad === 'anual') return desde.slice(0, 4)
    return desde.slice(0, 7)
}

/** Advisory lock de las declaraciones de una empresa (calcular, revisar, presentar, pagar). */
export const LOCK_DECLARACIONES = 3043

export type SeccionRenglon =
    'ventas' | 'compras' | 'retenciones' | 'resultados' | 'ajustes' | 'declaraciones' | 'iso'

const SECCIONES_DOCUMENTOS: ReadonlySet<SeccionRenglon> = new Set(['ventas', 'compras', 'retenciones'])

export interface RenglonDeclaracion {
    seccion: SeccionRenglon
    origen: string
    documento: string
    fecha: string
    tipo: string | null
    nit: string | null
    base: string
    iva: string
    total: string
    estado: string | null
}

export interface ParametroUsado {
    clave: string
    valor: unknown
    vigente_desde: string | null
    nivel: string
}

export interface LibroEnlazado {
    emision_id: number
    libro: 'ventas' | 'compras'
    desde: string
    hasta: string
    folio_inicial: number
    folio_final: number
    sha256: string
    /** IVA guardado en la emisión (ventas: iva; compras: iva_credito) */
    iva: string | null
    /** la emisión cubre exactamente el mes: su IVA debe ser el del borrador */
    mismo_periodo: boolean
}

export interface DatosDeclaracion {
    parametros: ParametroUsado[]
    detalle: {
        renglones: RenglonDeclaracion[]
        libros: LibroEnlazado[]
        anterior_id: number | null
        /** criterios aplicados o sin confirmar (ISR, ISO; fase 7 PR C) */
        notas?: string[]
        /**
         * renglones del cálculo de ISR e ISO (secciones resultados, ajustes, declaraciones, iso; PR C), aparte
         * de los de documentos (`renglones`: ventas, compras, retenciones)
         */
        calculo?: RenglonDeclaracion[]
    }
    totales: Record<string, string>
    datos_hash: string
    formulario: string | null
}

const fin = (desde: string) => DateTime.fromISO(desde, { zone: 'utc' }).endOf('month').toISODate()!
const mesAnterior = (desde: string) =>
    DateTime.fromISO(desde, { zone: 'utc' }).minus({ months: 1 }).toISODate()!

/** JSON con las claves ordenadas (jsonb no guarda el orden): base del `datos_hash`. */
export function canonico(valor: unknown): string {
    if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`
    if (valor !== null && typeof valor === 'object') {
        const objeto = valor as Record<string, unknown>
        return `{${Object.keys(objeto)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonico(objeto[k])}`)
            .join(',')}}`
    }
    return JSON.stringify(valor ?? null)
}

export function hash(datos: unknown): string {
    return createHash('sha256').update(canonico(datos)).digest('hex')
}

/** Constancias de retención recibidas: + en el mes del asiento del pago, − en el de su reverso. */
export async function retencionesDelMes(
    c: QueryClientContract,
    empresaId: number,
    desde: string,
    hasta: string,
    impuesto: 'iva' | 'isr' = 'iva',
) {
    const { rows } = (await c.rawQuery(
        `WITH k AS (
             SELECT cr.id, cr.numero, cr.monto, cr.pago_id, cl.nit_cui AS nit,
                    (SELECT min(a.id) FROM ledger.asientos a
                      WHERE a.origen_tipo = 'pago' AND a.origen_id = cr.pago_id AND a.reversa_de IS NULL) AS asiento_id
               FROM ledger.constancias_retencion cr LEFT JOIN core.clientes cl ON cl.id = cr.cliente_id
              WHERE cr.empresa_id = ? AND cr.direccion = 'recibida' AND cr.impuesto = ?
         )
         SELECT k.id, k.numero, k.nit, k.pago_id, k.monto::text AS monto, to_char(a.fecha, 'YYYY-MM-DD') AS fecha,
                'registro' AS movimiento
           FROM k JOIN ledger.asientos a ON a.id = k.asiento_id
          WHERE a.fecha BETWEEN ? AND ?
         UNION ALL
         SELECT k.id, k.numero, k.nit, k.pago_id, (-k.monto)::text, to_char(r.fecha, 'YYYY-MM-DD'), 'anulacion'
           FROM k JOIN ledger.asientos r ON r.reversa_de = k.asiento_id
          WHERE r.fecha BETWEEN ? AND ?
          ORDER BY 6, 1, 7 DESC`,
        [empresaId, impuesto, desde, hasta, desde, hasta],
    )) as {
        rows: Array<{
            id: number
            numero: string
            nit: string | null
            pago_id: number
            monto: string
            fecha: string
            movimiento: string
        }>
    }
    return rows.map((r): RenglonDeclaracion => ({
        seccion: 'retenciones',
        origen: 'constancia',
        documento: `Constancia ${r.numero} · pago ${r.pago_id}${r.movimiento === 'anulacion' ? ' (anulación)' : ''}`,
        fecha: r.fecha,
        tipo: impuesto === 'iva' ? 'RET_IVA' : 'RET_ISR',
        nit: r.nit,
        base: '0.00',
        iva: aTexto(r.monto),
        total: aTexto(r.monto),
        estado: r.movimiento,
    }))
}

/** Libros de ventas y compras emitidos con folio que cubren el mes (fase 6 PR D). */
export async function librosEmitidos(
    c: QueryClientContract,
    empresaId: number,
    desde: string,
    hasta: string,
) {
    const filas = (await c
        .from('fiscal.libros_emisiones')
        .where('empresa_id', empresaId)
        .whereIn('libro', ['ventas', 'compras'])
        .where('desde', '<=', desde)
        .where('hasta', '>=', hasta)
        .orderBy('id', 'asc')
        .select(
            'id',
            'libro',
            c.raw(`to_char(desde, 'YYYY-MM-DD') as desde`),
            c.raw(`to_char(hasta, 'YYYY-MM-DD') as hasta`),
            'folio_inicial',
            'folio_final',
            'sha256',
            'totales',
        )) as Array<Record<string, any>>
    return filas.map((f): LibroEnlazado => {
        const totales = (typeof f.totales === 'string' ? JSON.parse(f.totales) : f.totales) ?? {}
        const iva = f.libro === 'ventas' ? totales.iva : totales.iva_credito
        return {
            emision_id: Number(f.id),
            libro: f.libro,
            desde: f.desde,
            hasta: f.hasta,
            folio_inicial: Number(f.folio_inicial),
            folio_final: Number(f.folio_final),
            sha256: f.sha256,
            iva: iva === undefined || iva === null ? null : aTexto(String(iva)),
            mismo_periodo: f.desde === desde && f.hasta === hasta,
        }
    })
}

/** Remanentes que dejó la última versión revisada del mes anterior (0 si no hay). */
async function remanentesAnteriores(
    c: QueryClientContract,
    empresaId: number,
    impuesto: ImpuestoDeclarable,
    desde: string,
): Promise<{ credito: Dec; retenciones: Dec; id: number | null }> {
    const fila = (await c
        .from('fiscal.declaraciones')
        .where({ empresa_id: empresaId, impuesto })
        .where('periodo_desde', mesAnterior(desde))
        .whereNotNull('revisada_en')
        .orderBy('version', 'desc')
        .select('id', 'totales')
        .first()) as { id: number; totales: Record<string, string> } | null
    if (!fila) return { credito: CERO, retenciones: CERO, id: null }
    return {
        credito: dec(fila.totales.remanente_credito ?? '0'),
        retenciones: dec(fila.totales.remanente_retenciones ?? '0'),
        id: Number(fila.id),
    }
}

export function parametroUsado(
    filas: Parameters<typeof resolver>[0],
    clave: string,
    fecha: string,
): ParametroUsado | null {
    const v = resolver(filas, clave, fecha)
    return v ? { clave, valor: v.valor, vigente_desde: v.vigente_desde, nivel: v.nivel } : null
}

export const min = (a: Dec, b: Dec) => (a.lt(b) ? a : b)
export const max0 = (a: Dec) => (a.isNegative() ? CERO : a)

/** Renglones del libro de ventas legal del rango (DTE certificados y documentos sin FEL). */
export async function ventasDelRango(
    c: QueryClientContract,
    empresaId: number,
    desde: string,
    hasta: string,
) {
    const ventas = await libroVentasLegal(empresaId, { desde, hasta }, c)
    const renglones: RenglonDeclaracion[] = ventas.reporte.filas.map((f: Record<string, any>) => ({
        seccion: 'ventas',
        origen: String(f.origen),
        documento: String(f.documento),
        fecha: String(f.fecha),
        tipo: f.tipo ?? null,
        nit: f.nit ?? null,
        base: aTexto(
            dec(f.bienes ?? '0')
                .plus(dec(f.servicios ?? '0'))
                .plus(dec(f.exportacion ?? '0'))
                .plus(dec(f.exento ?? '0')),
        ),
        iva: aTexto(f.iva ?? '0'),
        total: aTexto(f.total ?? '0'),
        estado: f.estado ?? null,
    }))
    const t = ventas.reporte.totales as Record<string, unknown>
    const suma = (clave: string) => redondear(dec(String(t[clave] ?? '0')))
    return {
        renglones,
        iva: suma('iva'),
        total: suma('total'),
        /** bienes + servicios + exportación (sin exentas) */
        gravado: suma('bienes').plus(suma('servicios')).plus(suma('exportacion')),
        exento: suma('exento'),
    }
}

/**
 * Calcula el borrador de `impuesto` del mes que empieza en `desde` con los datos de hoy. Mismos datos
 * ⇒ mismo `datos_hash` (no entra la hora ni los libros emitidos, que son solo un enlace).
 */
export async function calcularDatos(
    c: QueryClientContract,
    empresaId: number,
    impuesto: ImpuestoDeclarable,
    desde: string,
): Promise<DatosDeclaracion> {
    const hasta = finDePeriodo(impuesto, desde)
    const datos = await datosFiscales(empresaId, c)
    const parametros: ParametroUsado[] = []
    const plazo = parametroUsado(datos.filas, FORMULARIOS[impuesto].parametro, hasta)
    if (plazo) parametros.push(plazo)
    const formulario =
        plazo && typeof plazo.valor === 'object' && plazo.valor !== null
            ? ((plazo.valor as { formulario?: string | null }).formulario ?? null)
            : null

    if (!esDeIva(impuesto)) {
        const renta = await calcularRenta(c, empresaId, impuesto, desde, hasta, datos)
        parametros.push(...renta.parametros)
        const libros = renta.conLibros ? await librosEmitidos(c, empresaId, desde, hasta) : []
        return {
            parametros,
            detalle: {
                renglones: renta.renglones.filter((r) => SECCIONES_DOCUMENTOS.has(r.seccion)),
                libros,
                anterior_id: null,
                notas: renta.notas,
                calculo: renta.renglones.filter((r) => !SECCIONES_DOCUMENTOS.has(r.seccion)),
            },
            totales: renta.totales,
            formulario,
            datos_hash: hash({
                renglones: renta.renglones,
                totales: renta.totales,
                parametros,
                anterior: null,
            }),
        }
    }

    const ventas = await ventasDelRango(c, empresaId, desde, hasta)
    const renglones: RenglonDeclaracion[] = [...ventas.renglones]
    const retenciones = await retencionesDelMes(c, empresaId, desde, hasta)
    const anterior = await remanentesAnteriores(c, empresaId, impuesto, desde)
    const D = ventas.iva
    const totalVentas = ventas.total
    const R = retenciones.reduce((s, r) => s.plus(dec(r.iva)), CERO)

    let totales: Record<string, string>
    if (impuesto === 'iva_mensual') {
        const compras = await filasLibroCompras(c, empresaId, desde, desde)
        for (const f of compras) {
            renglones.push({
                seccion: 'compras',
                origen: 'compra',
                documento:
                    `Compra ${f.compra_id}${f.movimiento === 'anulacion' ? ' (anulación)' : ''} · ${f.tipo} ${f.serie ?? ''} ${f.numero ?? ''}`.trim(),
                fecha: String(f.fecha),
                tipo: (f.tipo as string) ?? null,
                nit: (f.nit as string) ?? null,
                base: aTexto(
                    dec(String(f.bienes))
                        .plus(dec(String(f.servicios)))
                        .plus(dec(String(f.importaciones)))
                        .plus(dec(String(f.exento))),
                ),
                iva: aTexto(String(f.iva_credito)),
                total: aTexto(String(f.total)),
                estado: String(f.movimiento),
            })
        }
        const C = compras.reduce((s, f) => s.plus(dec(String(f.iva_credito))), CERO)
        const credito = C.plus(anterior.credito).plus(max0(D.negated()))
        const debito = max0(D)
        const creditoUsado = min(debito, credito)
        const resto = debito.minus(creditoUsado)
        const disponibleRet = R.plus(anterior.retenciones)
        const retencionesUsadas = min(resto, max0(disponibleRet))
        totales = {
            debito: aTexto(D),
            credito: aTexto(C),
            retenciones: aTexto(R),
            remanente_credito_anterior: aTexto(anterior.credito),
            remanente_retenciones_anterior: aTexto(anterior.retenciones),
            impuesto_determinado: aTexto(D.minus(C).minus(R)),
            credito_usado: aTexto(creditoUsado),
            retenciones_usadas: aTexto(retencionesUsadas),
            a_pagar: aTexto(resto.minus(retencionesUsadas)),
            remanente_credito: aTexto(credito.minus(creditoUsado)),
            remanente_retenciones: aTexto(disponibleRet.minus(retencionesUsadas)),
            base_ventas: aTexto(
                renglones.filter((r) => r.seccion === 'ventas').reduce((s, r) => s.plus(dec(r.base)), CERO),
            ),
            base_compras: aTexto(
                renglones.filter((r) => r.seccion === 'compras').reduce((s, r) => s.plus(dec(r.base)), CERO),
            ),
            total_ventas: aTexto(totalVentas),
        }
    } else {
        const tasa = resolverImpuesto(datos.impuestos, 'IVA_PC', hasta)
        if (!tasa) throw new ParametroSinConfirmar('impuesto:IVA_PC', hasta)
        parametros.push({
            clave: 'impuesto:IVA_PC',
            valor: tasa.tasa,
            vigente_desde: tasa.vigente_desde,
            nivel: tasa.nivel,
        })
        const porcentaje = dec(tasa.tasa)
        const base = max0(totalVentas)
        const imp = redondear(base.times(porcentaje).dividedBy(100))
        const disponibleRet = R.plus(anterior.retenciones)
        const usadas = min(imp, max0(disponibleRet))
        totales = {
            ventas: aTexto(totalVentas),
            base: aTexto(base),
            impuesto: aTexto(imp),
            retenciones: aTexto(R),
            remanente_retenciones_anterior: aTexto(anterior.retenciones),
            retenciones_usadas: aTexto(usadas),
            a_pagar: aTexto(imp.minus(usadas)),
            remanente_retenciones: aTexto(disponibleRet.minus(usadas)),
            iva_en_ventas: aTexto(D),
        }
    }
    renglones.push(...retenciones)
    const libros = await librosEmitidos(c, empresaId, desde, hasta)
    return {
        parametros,
        detalle: { renglones, libros, anterior_id: anterior.id },
        totales,
        formulario,
        datos_hash: hash({ renglones, totales, parametros, anterior: anterior.id }),
    }
}

/** Hash de lo que el borrador leyó, recalculado con los datos de hoy (409 `declaracion_desactualizada`). */
export async function hashActual(
    c: QueryClientContract,
    d: Pick<DeclaracionFila, 'empresa_id' | 'impuesto' | 'periodo_desde'>,
): Promise<string> {
    const datos = await calcularDatos(c, d.empresa_id, d.impuesto as ImpuestoDeclarable, d.periodo_desde)
    return datos.datos_hash
}

/*
|--------------------------------------------------------------------------
| Liquidación (§10.6)
|--------------------------------------------------------------------------
*/

export interface LineaLiquidacion {
    cuenta: string
    debe?: string
    haber?: string
}

/** Saldo neto (debe − haber) por cuenta que debe dejar la liquidación completa del borrador. */
export function netoLiquidacion(impuesto: ImpuestoDeclarable, t: Record<string, string>): Map<string, Dec> {
    const neto = new Map<string, Dec>()
    const sumar = (cuenta: string, monto: Dec) => neto.set(cuenta, (neto.get(cuenta) ?? CERO).plus(monto))
    if (impuesto === 'iva_mensual') {
        const D = dec(t.debito ?? '0')
        // débito al debe (o, si las notas superan las ventas, al haber contra el crédito)
        sumar(CUENTAS.IVA_DEBITO, D)
        if (D.isNegative()) sumar(CUENTAS_GT.IVA_CREDITO, D.negated())
        sumar(CUENTAS_GT.IVA_CREDITO, dec(t.credito_usado ?? '0').negated())
        sumar(CUENTAS_GT.IVA_RETENIDO_CLIENTES, dec(t.retenciones_usadas ?? '0').negated())
        sumar(CUENTAS_GT.IVA_POR_PAGAR, dec(t.a_pagar ?? '0').negated())
    } else if (impuesto === 'pc_mensual') {
        sumar(CUENTAS_GT.IMPUESTO_PC, dec(t.impuesto ?? '0'))
        sumar(CUENTAS_GT.PC_POR_PAGAR, dec(t.a_pagar ?? '0').negated())
        sumar(CUENTAS_GT.IVA_RETENIDO_CLIENTES, dec(t.retenciones_usadas ?? '0').negated())
    } else if (impuesto === 'isr_opcional_mensual') {
        // 5.5.01 / 1.1.06 + 2.1.07 (§10.6)
        sumar(CUENTAS_GT.IMPUESTO_SOBRE_RENTA, dec(t.isr ?? '0'))
        sumar(CUENTAS_GT.ISR_RETENIDO_CLIENTES, dec(t.retenciones_usadas ?? '0').negated())
        sumar(CUENTAS_GT.ISR_POR_PAGAR, dec(t.a_pagar ?? '0').negated())
    } else if (impuesto === 'isr_trimestral') {
        // 1.1.07 / 2.1.07 (§10.6), con el ISO acreditado desde 1.1.08
        sumar(CUENTAS_GT.ISR_PAGOS_TRIMESTRALES, dec(t.isr ?? '0'))
        sumar(CUENTAS_GT.ISO_POR_ACREDITAR, dec(t.iso_acreditado ?? '0').negated())
        sumar(CUENTAS_GT.ISR_POR_PAGAR, dec(t.a_pagar ?? '0').negated())
    } else if (impuesto === 'iso_trimestral') {
        // 1.1.08 / 2.1.08 (§10.6)
        sumar(CUENTAS_GT.ISO_POR_ACREDITAR, dec(t.impuesto ?? '0'))
        sumar(CUENTAS_GT.ISO_POR_PAGAR, dec(t.a_pagar ?? '0').negated())
    }
    // isr_anual: lo provisiona el cierre anual; retenciones: ya están en 2.1.04 y 2.1.05 (sin asiento)
    for (const [cuenta, monto] of neto) if (monto.isZero()) neto.delete(cuenta)
    return neto
}

/** Neto por cuenta de los asientos de liquidación ya registrados de las versiones del periodo. */
export async function liquidadoDelPeriodo(
    c: QueryClientContract,
    empresaId: number,
    impuesto: string,
    desde: string,
): Promise<Map<string, Dec>> {
    const { rows } = (await c.rawQuery(
        `SELECT cu.codigo, sum(m.debe - m.haber)::text AS neto
           FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
           JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
          WHERE a.empresa_id = ? AND a.origen_tipo = 'liquidacion_impuesto'
            AND a.origen_id IN (SELECT d.id FROM fiscal.declaraciones d
                                 WHERE d.empresa_id = ? AND d.impuesto = ? AND d.periodo_desde = ?)
          GROUP BY 1`,
        [empresaId, empresaId, impuesto, desde],
    )) as { rows: Array<{ codigo: string; neto: string }> }
    return new Map(rows.map((r) => [r.codigo, dec(r.neto)]))
}

/** Partidas del asiento que lleva lo ya liquidado del periodo al neto del borrador (la diferencia). */
export function partidasDiferencia(objetivo: Map<string, Dec>, hecho: Map<string, Dec>): LineaLiquidacion[] {
    const cuentas = [...new Set([...objetivo.keys(), ...hecho.keys()])].sort()
    const salida: LineaLiquidacion[] = []
    for (const cuenta of cuentas) {
        const diferencia = (objetivo.get(cuenta) ?? CERO).minus(hecho.get(cuenta) ?? CERO)
        if (diferencia.isZero()) continue
        salida.push(
            diferencia.isPositive()
                ? { cuenta, debe: aTexto(diferencia) }
                : { cuenta, haber: aTexto(diferencia.negated()) },
        )
    }
    return salida
}

/*
|--------------------------------------------------------------------------
| Cuadre contra el libro (§10.2) y liquidación hecha (checks de impuestos)
|--------------------------------------------------------------------------
*/

/** Σ de las etiquetas del mes por cuadrícula (signo de la etiqueta) y el IVA de venta sin etiqueta. */
export async function cuadriculasDelMes(c: QueryClientContract, empresaId: number, desde: string) {
    const hasta = fin(desde)
    const { rows } = (await c.rawQuery(
        `SELECT substr(m.cuadricula, 2) AS cuadricula,
                sum(CASE WHEN left(m.cuadricula, 1) = '+' THEN 1 ELSE -1 END * (m.debe + m.haber))::text AS valor
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
          WHERE a.empresa_id = ? AND a.fecha BETWEEN ? AND ? AND m.cuadricula IS NOT NULL
          GROUP BY 1`,
        [empresaId, desde, hasta],
    )) as { rows: Array<{ cuadricula: string; valor: string }> }
    const por = new Map(rows.map((r) => [r.cuadricula, dec(r.valor)]))
    // ventas registradas antes de la fase 7 (sin etiqueta): su 2.1.02 cuenta como V_IVA, aparte
    const { rows: previas } = (await c.rawQuery(
        `SELECT coalesce(sum(m.haber - m.debe), 0)::text AS valor
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
          WHERE a.empresa_id = ? AND a.fecha BETWEEN ? AND ? AND cu.codigo = ? AND m.cuadricula IS NULL
            AND a.origen_tipo IN ('factura', 'mora', 'nota_credito', 'reclasificacion')`,
        [empresaId, desde, hasta, CUENTAS.IVA_DEBITO],
    )) as { rows: Array<{ valor: string }> }
    const sinEtiqueta = dec(previas[0]?.valor ?? '0')
    return {
        V_IVA: (por.get('V_IVA') ?? CERO).plus(sinEtiqueta),
        V_IVA_sin_etiqueta: sinEtiqueta,
        C_IVA: por.get('C_IVA') ?? CERO,
        RET_IVA_REC: por.get('RET_IVA_REC') ?? CERO,
        RET_IVA_EMI: por.get('RET_IVA_EMI') ?? CERO,
        RET_ISR_EMI: por.get('RET_ISR_EMI') ?? CERO,
    }
}

/** Neto del mes de una cuenta (debe − haber) sin los asientos de liquidación. */
export async function movimientoDelMes(
    c: QueryClientContract,
    empresaId: number,
    desde: string,
    cuenta: string,
) {
    const { rows } = (await c.rawQuery(
        `SELECT coalesce(sum(m.debe - m.haber), 0)::text AS neto
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
          WHERE a.empresa_id = ? AND a.fecha BETWEEN ? AND ? AND cu.codigo = ?
            AND a.origen_tipo <> 'liquidacion_impuesto'`,
        [empresaId, desde, fin(desde), cuenta],
    )) as { rows: Array<{ neto: string }> }
    return dec(rows[0]?.neto ?? '0')
}

/** Impuesto declarable del mes según el calendario (la obligación que aplica), o null. */
export async function impuestoDelMes(
    c: QueryClientContract,
    empresaId: number,
    desde: string,
): Promise<ImpuestoDeclarable | null> {
    const fila = (await c
        .from('fiscal.obligaciones')
        .where('empresa_id', empresaId)
        .where('periodo_desde', desde)
        .whereIn('impuesto', IMPUESTOS_IVA as unknown as string[])
        .whereNot('estado', 'no_aplica')
        .orderBy('impuesto', 'asc')
        .select('impuesto')
        .first()) as { impuesto: ImpuestoDeclarable } | null
    return fila?.impuesto ?? null
}

/** Obligaciones de retenciones del mes que aplican (`retenciones_iva`, `retenciones_isr`). */
export async function retencionesDelCalendario(
    c: QueryClientContract,
    empresaId: number,
    desde: string,
): Promise<ImpuestoDeclarable[]> {
    const filas = (await c
        .from('fiscal.obligaciones')
        .where('empresa_id', empresaId)
        .where('periodo_desde', desde)
        .whereIn('impuesto', IMPUESTOS_RETENCIONES as unknown as string[])
        .whereNot('estado', 'no_aplica')
        .orderBy('impuesto', 'asc')
        .select('impuesto')) as Array<{ impuesto: ImpuestoDeclarable }>
    return filas.map((f) => f.impuesto)
}

/*
|--------------------------------------------------------------------------
| Lecturas
|--------------------------------------------------------------------------
*/

export interface DeclaracionFila {
    id: number
    empresa_id: number
    impuesto: string
    periodo_desde: string
    periodo_hasta: string
    version: number
    sustitutiva: boolean
    sustituye_a: number | null
    obligacion_id: number
    formulario: string | null
    vence_en: string
    parametros: ParametroUsado[]
    detalle: DatosDeclaracion['detalle']
    totales: Record<string, string>
    datos_hash: string
    calculada_por: number | null
    calculada_por_nombre: string | null
    calculada_en: Date
    estado: EstadoDeclaracion
    revisada_por: number | null
    revisada_por_nombre: string | null
    revisada_en: Date | null
    asiento_id: number | null
    numero_formulario: string | null
    fecha_presentacion: string | null
    boleta: string | null
    presentada_por: number | null
    presentada_por_nombre: string | null
    presentada_en: Date | null
    /** el pago vigente (sin anulación) de esta versión */
    pago: PagoDeclaracion | null
    /** pagos anulados de esta versión (fase 7 PR C), del más antiguo al más reciente */
    pagos_anulados: PagoAnulado[]
    created_at: Date
    updated_at: Date
}

export interface PagoAnulado extends PagoDeclaracion {
    anulacion: {
        id: number
        motivo: string
        asiento_id: number
        anulado_por: number | null
        anulado_por_nombre: string | null
        created_at: Date
    }
}

export interface PagoDeclaracion {
    id: number
    fecha: string
    impuesto: string
    mora: string
    multa: string
    total: string
    dias_atraso: number
    boleta: string | null
    asiento_id: number
    registrado_por: number | null
    created_at: Date
}

/** `fiscal.declaraciones as d` con los nombres de quien calculó, revisó y presentó (pedido de A4). */
function consultaDeclaraciones(c: QueryClientContract) {
    return c
        .from('fiscal.declaraciones as d')
        .leftJoin('core.usuarios as uc', 'uc.id', 'd.calculada_por')
        .leftJoin('core.usuarios as ur', 'ur.id', 'd.revisada_por')
        .leftJoin('core.usuarios as up', 'up.id', 'd.presentada_por')
        .select(COLUMNAS(c))
}

const COLUMNAS = (c: QueryClientContract) => [
    'uc.nombre as calculada_por_nombre',
    'ur.nombre as revisada_por_nombre',
    'up.nombre as presentada_por_nombre',
    'd.id',
    'd.empresa_id',
    'd.impuesto',
    c.raw(`to_char(d.periodo_desde, 'YYYY-MM-DD') as periodo_desde`),
    c.raw(`to_char(d.periodo_hasta, 'YYYY-MM-DD') as periodo_hasta`),
    'd.version',
    'd.sustitutiva',
    'd.sustituye_a',
    'd.obligacion_id',
    'd.formulario',
    c.raw(`to_char(d.vence_en, 'YYYY-MM-DD') as vence_en`),
    'd.parametros',
    'd.detalle',
    'd.totales',
    'd.datos_hash',
    'd.calculada_por',
    'd.calculada_en',
    'd.estado',
    'd.revisada_por',
    'd.revisada_en',
    'd.asiento_id',
    'd.numero_formulario',
    c.raw(`to_char(d.fecha_presentacion, 'YYYY-MM-DD') as fecha_presentacion`),
    'd.boleta',
    'd.presentada_por',
    'd.presentada_en',
    'd.created_at',
    'd.updated_at',
]

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

async function conPagos(
    c: QueryClientContract,
    filas: Array<Record<string, any>>,
): Promise<DeclaracionFila[]> {
    const ids = filas.map((f) => Number(f.id))
    const pagos = ids.length
        ? ((await c
              .from('fiscal.declaraciones_pagos as p')
              .leftJoin('fiscal.declaraciones_pagos_anulaciones as x', 'x.pago_id', 'p.id')
              .leftJoin('core.usuarios as ux', 'ux.id', 'x.anulado_por')
              .whereIn('p.declaracion_id', ids)
              .orderBy('p.id', 'asc')
              .select(
                  'p.id',
                  'p.declaracion_id',
                  c.raw(`to_char(p.fecha, 'YYYY-MM-DD') as fecha`),
                  c.raw('p.impuesto::text as impuesto'),
                  c.raw('p.mora::text as mora'),
                  c.raw('p.multa::text as multa'),
                  c.raw('p.total::text as total'),
                  'p.dias_atraso',
                  'p.boleta',
                  'p.asiento_id',
                  'p.registrado_por',
                  'p.created_at',
                  'x.id as anulacion_id',
                  'x.motivo as anulacion_motivo',
                  'x.asiento_id as anulacion_asiento_id',
                  'x.anulado_por',
                  'ux.nombre as anulado_por_nombre',
                  'x.created_at as anulado_en',
              )) as Array<Record<string, any>>)
        : []
    const pago = (p: Record<string, any>): PagoDeclaracion => ({
        id: Number(p.id),
        fecha: p.fecha,
        impuesto: aTexto(p.impuesto),
        mora: aTexto(p.mora),
        multa: aTexto(p.multa),
        total: aTexto(p.total),
        dias_atraso: Number(p.dias_atraso),
        boleta: p.boleta ?? null,
        asiento_id: Number(p.asiento_id),
        registrado_por: n(p.registrado_por),
        created_at: p.created_at,
    })
    const pagoDe = new Map(
        pagos.filter((p) => p.anulacion_id === null).map((p) => [Number(p.declaracion_id), p]),
    )
    return filas.map((f) => {
        const p = pagoDe.get(Number(f.id))
        const anulados = pagos
            .filter((x) => Number(x.declaracion_id) === Number(f.id) && x.anulacion_id !== null)
            .map((x): PagoAnulado => ({
                ...pago(x),
                anulacion: {
                    id: Number(x.anulacion_id),
                    motivo: x.anulacion_motivo,
                    asiento_id: Number(x.anulacion_asiento_id),
                    anulado_por: n(x.anulado_por),
                    anulado_por_nombre: x.anulado_por_nombre ?? null,
                    created_at: x.anulado_en,
                },
            }))
        return {
            ...(f as DeclaracionFila),
            id: Number(f.id),
            empresa_id: Number(f.empresa_id),
            version: Number(f.version),
            sustituye_a: n(f.sustituye_a),
            obligacion_id: Number(f.obligacion_id),
            calculada_por: n(f.calculada_por),
            revisada_por: n(f.revisada_por),
            asiento_id: n(f.asiento_id),
            presentada_por: n(f.presentada_por),
            calculada_por_nombre: f.calculada_por_nombre ?? null,
            revisada_por_nombre: f.revisada_por_nombre ?? null,
            presentada_por_nombre: f.presentada_por_nombre ?? null,
            pago: p ? pago(p) : null,
            pagos_anulados: anulados,
        }
    })
}

export async function verDeclaracion(
    id: number,
    c: QueryClientContract = db.connection(),
): Promise<DeclaracionFila> {
    const fila = (await consultaDeclaraciones(c).where('d.id', id).first()) as Record<string, any> | null
    if (!fila) throw new NoEncontrado(`La declaración ${id} no existe`)
    const [d] = await conPagos(c, [fila])
    return d!
}

/** Última versión de (empresa, impuesto, periodo), o null. */
export async function ultimaVersion(
    c: QueryClientContract,
    empresaId: number,
    impuesto: string,
    desde: string,
): Promise<DeclaracionFila | null> {
    const fila = (await consultaDeclaraciones(c)
        .where({ 'd.empresa_id': empresaId, 'd.impuesto': impuesto, 'd.periodo_desde': desde })
        .orderBy('d.version', 'desc')
        .first()) as Record<string, any> | null
    if (!fila) return null
    const [d] = await conPagos(c, [fila])
    return d!
}

export interface FiltrosDeclaraciones {
    cursor?: string | null
    limit?: number | null
    impuesto?: string[] | null
    estado?: string[] | null
    /** AAAA-MM, AAAA-Tn o AAAA: el periodo que empieza ese mes, trimestre o año */
    periodo?: string | null
}

/** Primer día del periodo del filtro (`AAAA-MM`, `AAAA-Tn`, `AAAA`). */
function inicioDelFiltro(texto: string): string {
    const t = /^(\d{4})-T([1-4])$/.exec(texto)
    if (t) return `${t[1]}-${String(Number(t[2]) * 3 - 2).padStart(2, '0')}-01`
    if (/^\d{4}$/.test(texto)) return `${texto}-01-01`
    return `${texto}-01`
}

export async function listarDeclaraciones(filtros: FiltrosDeclaraciones, empresas: number[] | null) {
    const c = db.connection()
    const consulta = consultaDeclaraciones(c)
        .if(filtros.impuesto && filtros.impuesto.length > 0, (q) =>
            q.whereIn('d.impuesto', filtros.impuesto!),
        )
        .if(filtros.estado && filtros.estado.length > 0, (q) => q.whereIn('d.estado', filtros.estado!))
        .if(filtros.periodo, (q) => q.where('d.periodo_desde', inicioDelFiltro(filtros.periodo!)))
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('d.empresa_id', ids))
    const pagina = await paginar<Record<string, any>>(consulta, filtros, { columna: 'd.id' })
    return { ...pagina, data: await conPagos(c, pagina.data) }
}
