import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { Problema } from '#shared/errores'
import { reservaIncobrables } from '#ledger/checks'
import { NoAplica, calcularBloque, type Bloque } from '#fiscal/bloques'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { idsEmpresasActivas } from '#core/empresas'
import { hoyFiscal } from '#fiscal/comun'
import { ParametroSinConfirmar } from '#fiscal/errores'
import { datosFiscales, resolver, type DatosFiscales } from '#fiscal/parametros'
import { instalacionVigente } from '#fiscal/instalador'
import { configuracionFel } from '#fiscal/fel/configuracion'
import { libroVentasLegal } from '#fiscal/libros_legales'
import {
    COLUMNAS_OBLIGACION,
    definicionObligacion,
    diasEntre,
    normalizarObligacion,
} from '#fiscal/calendario'
import {
    calcularDatos,
    finDePeriodo,
    textoDePeriodo,
    ultimaVersion,
    type ImpuestoDeclarable,
} from '#fiscal/declaraciones'

/**
 * Tablero fiscal (`GET /fiscal/tablero`, contrato §9.4; fase 8 PR A). Solo lectura: no cambia el
 * régimen, no presenta nada y no escribe nada. Cada bloque se calcula **por separado** con las mismas
 * funciones que usan las declaraciones y los libros (así sus cifras son las del libro), y si uno falla
 * devuelve su error RFC 9457 (`estado: 'error'`) sin tumbar los demás ni mostrar ceros inventados.
 * Un bloque que no corresponde al régimen de la empresa va con `estado: 'no_aplica'` y su motivo.
 *
 * Bloques: `facturado` (mes y año, por tipo de DTE), `iva` (mes en curso: IVA o pequeño contribuyente),
 * `isr` (opcional: el del mes; utilidades: trimestral en curso y anual a la fecha y proyectado), `iso`
 * (trimestre en curso), `pequeno_contribuyente` (facturado del año frente a `pc_limite_anual`),
 * `vencimientos` (obligaciones abiertas, o presentadas con impuesto pendiente, que vencen en 30 días o
 * ya vencieron; el pendiente descuenta lo pagado sin anular y la mora corre sobre él; H36),
 * `libros` (libros legales sin emitir fuera de `libros_ventana_meses`) y `fel` (alerta permanente si
 * la FEL es obligatoria y está desactivada). Fase 8 PR D: `compras_sin_nit` (compras del año desde
 * `consumidor_final_limite` sin proveedor identificado con NIT), `incobrables` (reserva permitida frente a
 * la registrada en `1.1.12`) y `depreciacion` (activos a una tasa menor que el máximo legal de su clase).
 */

export const BLOQUES_TABLERO = [
    'facturado',
    'iva',
    'isr',
    'iso',
    'pequeno_contribuyente',
    'vencimientos',
    'libros',
    'fel',
    'compras_sin_nit',
    'incobrables',
    'depreciacion',
] as const
export type NombreBloque = (typeof BLOQUES_TABLERO)[number]

export interface TableroEmpresa {
    empresa_id: number
    regimen: string | null
    bloques: Record<NombreBloque, Bloque>
}

export interface TableroFiscal {
    hoy: string
    empresas: TableroEmpresa[]
}

/** Días hacia adelante de los vencimientos que muestra el tablero. */
export const DIAS_VENCIMIENTOS = 30
/** Libros legales que se emiten con folio (fase 6 PR D) y vigila el tablero. */
const LIBROS_VIGILADOS = ['ventas', 'compras', 'diario', 'mayor'] as const
/** Meses atrasados que se listan por libro (el resto va en el conteo). */
const MAX_MESES_LISTADOS = 24

interface Contexto {
    c: QueryClientContract
    empresaId: number
    hoy: string
    datos: DatosFiscales
    regimen: string | null
}

const mesDe = (hoy: string) => `${hoy.slice(0, 7)}-01`
const trimestreDe = (hoy: string) => {
    const t = Math.floor((Number(hoy.slice(5, 7)) - 1) / 3)
    return `${hoy.slice(0, 4)}-${String(t * 3 + 1).padStart(2, '0')}-01`
}

/** Tablero de las empresas pedidas (`null` = todas las activas con localización). */
export async function tableroFiscal(empresas: number[] | null): Promise<TableroFiscal> {
    const c = db.connection()
    const hoy = hoyFiscal()
    const ids = empresas ?? (await idsEmpresasActivas(c))
    const salida: TableroEmpresa[] = []
    for (const empresaId of [...ids].sort((a, b) => a - b)) {
        salida.push(await tableroEmpresa(c, empresaId, hoy))
    }
    return { hoy, empresas: salida }
}

async function tableroEmpresa(
    c: QueryClientContract,
    empresaId: number,
    hoy: string,
): Promise<TableroEmpresa> {
    let ctx: Contexto | null = null
    let falla: Bloque | null = null
    try {
        if (!(await instalacionVigente(c, empresaId))) {
            throw new Problema(
                422,
                'localizacion_no_instalada',
                'Localización no instalada',
                `La empresa ${empresaId} no tiene localización fiscal instalada`,
            )
        }
        const datos = await datosFiscales(empresaId, c)
        const regimen = resolver(datos.filas, 'regimen', hoy)?.valor
        ctx = { c, empresaId, hoy, datos, regimen: typeof regimen === 'string' ? regimen : null }
    } catch (error) {
        falla = await calcularBloque(empresaId, 'facturado', () => Promise.reject(error))
    }
    const bloques = {} as Record<NombreBloque, Bloque>
    for (const nombre of BLOQUES_TABLERO) {
        bloques[nombre] = falla ?? (await calcularBloque(empresaId, nombre, () => CALCULOS[nombre](ctx!)))
    }
    return { empresa_id: empresaId, regimen: ctx?.regimen ?? null, bloques }
}

function exigirRegimen(ctx: Contexto): string {
    if (!ctx.regimen) throw new ParametroSinConfirmar('regimen', ctx.hoy)
    return ctx.regimen
}

/*
|--------------------------------------------------------------------------
| Bloques
|--------------------------------------------------------------------------
*/

interface ResumenVentas {
    desde: string
    hasta: string
    documentos: number
    base: string
    iva: string
    total: string
    por_tipo: Array<{ tipo: string; documentos: number; base: string; iva: string; total: string }>
}

async function resumenVentas(ctx: Contexto, desde: string): Promise<ResumenVentas> {
    const libro = await libroVentasLegal(ctx.empresaId, { desde, hasta: ctx.hoy }, ctx.c)
    const tipos = new Map<string, { documentos: number; base: Dec; iva: Dec; total: Dec }>()
    let base = CERO
    let iva = CERO
    let total = CERO
    for (const f of libro.reporte.filas as Array<Record<string, any>>) {
        const b = dec(f.bienes ?? '0')
            .plus(dec(f.servicios ?? '0'))
            .plus(dec(f.exportacion ?? '0'))
            .plus(dec(f.exento ?? '0'))
        const i = dec(f.iva ?? '0')
        const t = dec(f.total ?? '0')
        const tipo = String(f.tipo ?? 'sin_dte')
        const actual = tipos.get(tipo) ?? { documentos: 0, base: CERO, iva: CERO, total: CERO }
        tipos.set(tipo, {
            documentos: actual.documentos + 1,
            base: actual.base.plus(b),
            iva: actual.iva.plus(i),
            total: actual.total.plus(t),
        })
        base = base.plus(b)
        iva = iva.plus(i)
        total = total.plus(t)
    }
    return {
        desde,
        hasta: ctx.hoy,
        documentos: libro.reporte.filas.length,
        base: aTexto(redondear(base)),
        iva: aTexto(redondear(iva)),
        total: aTexto(redondear(total)),
        por_tipo: [...tipos.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([tipo, v]) => ({
                tipo,
                documentos: v.documentos,
                base: aTexto(redondear(v.base)),
                iva: aTexto(redondear(v.iva)),
                total: aTexto(redondear(v.total)),
            })),
    }
}

async function facturado(ctx: Contexto) {
    return {
        mes: await resumenVentas(ctx, mesDe(ctx.hoy)),
        anio: await resumenVentas(ctx, `${ctx.hoy.slice(0, 4)}-01-01`),
    }
}

/** Resumen de una declaración del periodo en curso calculada con los datos de hoy (sin guardarla). */
async function estimado(ctx: Contexto, impuesto: ImpuestoDeclarable, desde: string) {
    const calculo = await calcularDatos(ctx.c, ctx.empresaId, impuesto, desde)
    const version = await ultimaVersion(ctx.c, ctx.empresaId, impuesto, desde)
    return {
        impuesto,
        periodo: textoDePeriodo(impuesto, desde),
        periodo_desde: desde,
        periodo_hasta: finDePeriodo(impuesto, desde),
        formulario: calculo.formulario,
        totales: calculo.totales,
        notas: calculo.detalle.notas ?? [],
        declaracion: version
            ? {
                  id: version.id,
                  version: version.version,
                  estado: version.estado,
                  al_dia: version.datos_hash === calculo.datos_hash,
              }
            : null,
    }
}

async function bloqueIva(ctx: Contexto) {
    const regimen = exigirRegimen(ctx)
    const impuesto: ImpuestoDeclarable = regimen === 'pequeno_contribuyente' ? 'pc_mensual' : 'iva_mensual'
    return estimado(ctx, impuesto, mesDe(ctx.hoy))
}

async function isr(ctx: Contexto) {
    const regimen = exigirRegimen(ctx)
    if (regimen === 'pequeno_contribuyente') {
        throw new NoAplica('regimen_pequeno_contribuyente: paga el 5 % sobre sus ventas (bloque iva)')
    }
    if (regimen === 'opcional_simplificado') {
        return {
            regimen,
            mensual: await estimado(ctx, 'isr_opcional_mensual', mesDe(ctx.hoy)),
            trimestral: null,
            anual: null,
        }
    }
    // utilidades: el trimestre en curso (el 4.º va con la anual) y el anual a la fecha, proyectado
    const trimestre = trimestreDe(ctx.hoy)
    const plazo = resolver(ctx.datos.filas, 'isr_trimestral_plazo', ctx.hoy)?.valor as
        { cuarto_trimestre?: string } | undefined
    const conLaAnual = trimestre.slice(5, 7) === '10' && plazo?.cuarto_trimestre === 'con_la_anual'
    const trimestral = conLaAnual ? null : await estimado(ctx, 'isr_trimestral', trimestre)
    const anual = await estimado(ctx, 'isr_anual', `${ctx.hoy.slice(0, 4)}-01-01`)
    const meses = Number(ctx.hoy.slice(5, 7))
    const proyectado = (clave: string) =>
        aTexto(
            redondear(
                dec(anual.totales[clave] ?? '0')
                    .times(12)
                    .dividedBy(meses),
            ),
        )
    return {
        regimen,
        mensual: null,
        trimestral,
        trimestral_con_la_anual: conLaAnual,
        anual: {
            ...anual,
            meses_transcurridos: meses,
            renta_proyectada: proyectado('renta_imponible'),
            isr_proyectado: proyectado('isr'),
        },
    }
}

async function iso(ctx: Contexto) {
    const regimen = exigirRegimen(ctx)
    if (regimen !== 'utilidades') {
        throw new NoAplica(`regimen_${regimen}: el ISO es del régimen sobre utilidades`)
    }
    return estimado(ctx, 'iso_trimestral', trimestreDe(ctx.hoy))
}

async function pequenoContribuyente(ctx: Contexto) {
    const regimen = exigirRegimen(ctx)
    if (regimen !== 'pequeno_contribuyente') throw new NoAplica(`regimen_${regimen}`)
    const anio = ctx.hoy.slice(0, 4)
    const limite = resolver(ctx.datos.filas, 'pc_limite_anual', ctx.hoy)
    // el límite cambia cada año (125 salarios mínimos): el de otro año no sirve (como la alerta)
    if (!limite || typeof limite.valor !== 'string' || !limite.vigente_desde?.startsWith(anio)) {
        throw new ParametroSinConfirmar('pc_limite_anual', `${anio}-01-01`)
    }
    const umbrales = resolver(ctx.datos.filas, 'pc_alertas', ctx.hoy)?.valor
    const libro = await libroVentasLegal(ctx.empresaId, { desde: `${anio}-01-01`, hasta: ctx.hoy }, ctx.c)
    const acumulado = redondear(dec(String(libro.reporte.totales.total ?? '0')))
    const tope = dec(limite.valor)
    const porcentaje = tope.gt(0) ? redondear(acumulado.times(100).dividedBy(tope)) : CERO
    const lista = Array.isArray(umbrales) ? umbrales.map((u) => dec(String(u))) : []
    const alcanzado =
        lista
            .filter((u) => porcentaje.gte(u))
            .sort((a, b) => a.comparedTo(b))
            .at(-1) ?? null
    return {
        anio: Number(anio),
        acumulado: aTexto(acumulado),
        limite: aTexto(tope),
        porcentaje: aTexto(porcentaje),
        disponible: aTexto(tope.minus(acumulado).isNegative() ? CERO : tope.minus(acumulado)),
        umbrales: lista.map((u) => aTexto(u)),
        umbral_alcanzado: alcanzado ? aTexto(alcanzado) : null,
        supera_limite: acumulado.gt(tope),
        mensaje: acumulado.gt(tope)
            ? 'Superó el límite anual del pequeño contribuyente: debe pasar al régimen general (inv. A.3). El sistema no cambia el régimen; hágalo con su contador'
            : null,
    }
}

async function vencimientos(ctx: Contexto) {
    const limite = DateTime.fromISO(ctx.hoy, { zone: 'utc' }).plus({ days: DIAS_VENCIMIENTOS }).toISODate()!
    // abiertas (pendiente, borrador) y, con impuesto pendiente de pagar, también las presentadas: corre mora
    const filas = (
        (await ctx.c
            .from('fiscal.obligaciones as o')
            .where('o.empresa_id', ctx.empresaId)
            .whereIn('o.estado', ['pendiente', 'borrador', 'presentada'])
            .where('o.vence_en', '<=', limite)
            .orderBy('o.vence_en', 'asc')
            .orderBy('o.id', 'asc')
            .select(COLUMNAS_OBLIGACION)) as Array<Record<string, unknown>>
    ).map(normalizarObligacion)
    const mora = resolver(ctx.datos.filas, 'mora_tributaria', ctx.hoy)
    const salida = []
    for (const o of filas) {
        const dias = diasEntre(ctx.hoy, o.vence_en)
        const vencida = dias < 0
        let pendiente: Dec | null = null
        let pagado: Dec | null = null
        if (o.declaracion_id !== null) {
            const d = await ultimaVersion(ctx.c, ctx.empresaId, o.impuesto, o.periodo_desde)
            if (d) {
                // H36: lo pagado sin anular por cualquier versión del periodo (como registrar_pago)
                pagado = await pagadoDelPeriodo(ctx, o.impuesto, o.periodo_desde)
                const resto = dec(d.totales.a_pagar ?? '0').minus(pagado)
                pendiente = resto.isNegative() ? CERO : resto
            }
        }
        if (o.estado === 'presentada' && (pendiente === null || !pendiente.gt(0))) continue
        let moraEstimada: string | null = null
        if (vencida && pendiente !== null && pendiente.gt(0) && mora && typeof mora.valor === 'string') {
            moraEstimada = aTexto(redondear(pendiente.times(dec(mora.valor)).dividedBy(100).times(-dias)))
        }
        salida.push({
            obligacion_id: o.id,
            impuesto: o.impuesto,
            nombre: definicionObligacion(o.impuesto)?.nombre ?? o.impuesto,
            periodo_desde: o.periodo_desde,
            periodo_hasta: o.periodo_hasta,
            formulario: o.formulario,
            vence_en: o.vence_en,
            dias_restantes: dias,
            vencida,
            estado: o.estado,
            declaracion_id: o.declaracion_id,
            a_pagar: pendiente === null ? null : aTexto(pendiente),
            pagado: pagado === null ? null : aTexto(pagado),
            mora_estimada: moraEstimada,
        })
    }
    return {
        hasta: limite,
        mora_tributaria: mora && typeof mora.valor === 'string' ? mora.valor : null,
        vencidas: salida.filter((v) => v.vencida).length,
        obligaciones: salida,
    }
}

/** Σ impuesto de los pagos vigentes (sin anulación) de las versiones del periodo. */
async function pagadoDelPeriodo(ctx: Contexto, impuesto: string, desde: string): Promise<Dec> {
    const fila = (await ctx.c
        .from('fiscal.declaraciones_pagos as p')
        .join('fiscal.declaraciones as d', 'd.id', 'p.declaracion_id')
        .where({ 'd.empresa_id': ctx.empresaId, 'd.impuesto': impuesto, 'd.periodo_desde': desde })
        .whereNotExists((q) =>
            q.from('fiscal.declaraciones_pagos_anulaciones as x').whereRaw('x.pago_id = p.id'),
        )
        .select(ctx.c.raw('coalesce(sum(p.impuesto), 0)::text as pagado'))
        .first()) as { pagado: string }
    return dec(fila.pagado)
}

/** Meses YYYY-MM del rango (ambos incluidos). */
function mesesEntre(desde: string, hasta: string): string[] {
    const salida: string[] = []
    let m = DateTime.fromISO(`${desde.slice(0, 7)}-01`, { zone: 'utc' })
    const fin = DateTime.fromISO(`${hasta.slice(0, 7)}-01`, { zone: 'utc' })
    while (m <= fin) {
        salida.push(m.toFormat('yyyy-MM'))
        m = m.plus({ months: 1 })
    }
    return salida
}

async function libros(ctx: Contexto) {
    const ventana = resolver(ctx.datos.filas, 'libros_ventana_meses', ctx.hoy)?.valor
    if (typeof ventana !== 'number') throw new ParametroSinConfirmar('libros_ventana_meses', ctx.hoy)
    const inicio = resolver(ctx.datos.filas, 'inicio_libros', ctx.hoy)?.valor
    if (typeof inicio !== 'string') throw new ParametroSinConfirmar('inicio_libros', ctx.hoy)
    const hoy = DateTime.fromISO(ctx.hoy, { zone: 'utc' })
    // meses terminados desde inicio_libros; atrasado = terminó hace más de `ventana` meses
    const ultimoTerminado = hoy.startOf('month').minus({ months: 1 }).toFormat('yyyy-MM')
    const limiteAtraso = hoy
        .startOf('month')
        .minus({ months: ventana + 1 })
        .toFormat('yyyy-MM')
    const terminados =
        inicio.slice(0, 7) <= ultimoTerminado ? mesesEntre(inicio, `${ultimoTerminado}-01`) : []
    const emisiones = (await ctx.c
        .from('fiscal.libros_emisiones')
        .where('empresa_id', ctx.empresaId)
        .whereIn('libro', LIBROS_VIGILADOS as unknown as string[])
        .select(
            'libro',
            ctx.c.raw(`to_char(desde, 'YYYY-MM-DD') as desde`),
            ctx.c.raw(`to_char(hasta, 'YYYY-MM-DD') as hasta`),
        )) as Array<{ libro: string; desde: string; hasta: string }>
    const habilitados = new Set(
        (
            (await ctx.c
                .from('fiscal.libros_habilitados')
                .where('empresa_id', ctx.empresaId)
                .distinct('libro')) as Array<{ libro: string }>
        ).map((f) => f.libro),
    )
    const detalle = LIBROS_VIGILADOS.map((libro) => {
        const propias = emisiones.filter((e) => e.libro === libro)
        const cubierto = (mes: string) =>
            propias.some((e) => e.desde <= `${mes}-01` && e.hasta >= finDePeriodo('iva_mensual', `${mes}-01`))
        const sinEmitir = terminados.filter((m) => !cubierto(m))
        const atrasados = sinEmitir.filter((m) => m <= limiteAtraso)
        const ultimo =
            propias
                .map((e) => e.hasta)
                .sort()
                .at(-1) ?? null
        return {
            libro,
            habilitado: habilitados.has(libro),
            ultimo_emitido_hasta: ultimo,
            meses_sin_emitir: sinEmitir.length,
            meses_atrasados: atrasados.length,
            atrasados: atrasados.slice(0, MAX_MESES_LISTADOS),
            al_dia: atrasados.length === 0,
        }
    })
    const atrasados = detalle.filter((d) => !d.al_dia)
    return {
        ventana_meses: ventana,
        inicio_libros: inicio,
        libros: detalle,
        alerta:
            atrasados.length > 0
                ? `Libros sin emitir fuera del plazo (${ventana} meses): ${atrasados.map((d) => d.libro).join(', ')}. La multa de referencia es de Q5,000 por libro (inv. E.2); valídelo con su contador`
                : null,
    }
}

async function fel(ctx: Contexto) {
    const config = await configuracionFel(ctx.empresaId, ctx.c)
    const legal = resolver(ctx.datos.filas, 'fel_modo', ctx.hoy)?.valor
    const { rows } = (await ctx.c.rawQuery(
        `SELECT estado, count(*)::int AS n FROM fiscal.dte
          WHERE empresa_id = ? AND estado IN ('pendiente', 'enviando', 'error_temporal', 'contingencia')
          GROUP BY 1 ORDER BY 1`,
        [ctx.empresaId],
    )) as { rows: Array<{ estado: string; n: number }> }
    const obligatoria = legal === 'obligatoria'
    return {
        modo: config.modo,
        obligacion_legal: typeof legal === 'string' ? legal : null,
        proveedor: config.proveedor,
        contingencia_activa: config.contingencia_activa,
        dte_pendientes: rows.map((r) => ({ estado: r.estado, cantidad: Number(r.n) })),
        alerta:
            obligatoria && config.modo === 'desactivada'
                ? 'FEL es obligatoria para su régimen: la empresa emite sin DTE (FEL desactivada)'
                : null,
    }
}

/** Compras vigentes del año desde `consumidor_final_limite` cuyo proveedor no está identificado con NIT. */
async function comprasSinNit(ctx: Contexto) {
    const limite = resolver(ctx.datos.filas, 'consumidor_final_limite', ctx.hoy)?.valor
    if (typeof limite !== 'string') throw new ParametroSinConfirmar('consumidor_final_limite', ctx.hoy)
    const anio = ctx.hoy.slice(0, 4)
    const { rows } = (await ctx.c.rawQuery(
        `SELECT co.id, co.tipo_documento, co.serie, co.numero, to_char(co.fecha, 'YYYY-MM-DD') AS fecha,
                co.total::text AS total, p.id AS proveedor_id, p.nombre, p.nit, p.tipo_documento AS documento_proveedor,
                p.tipo AS tipo_proveedor
           FROM ledger.compras co JOIN ledger.proveedores p ON p.id = co.proveedor_id
          WHERE co.empresa_id = ? AND co.fecha BETWEEN ? AND ? AND co.total >= ?::numeric
            AND co.tipo_documento <> 'NCRE'
            AND NOT EXISTS (SELECT 1 FROM ledger.compras_anulaciones x WHERE x.compra_id = co.id)
            AND (p.tipo_documento <> 'nit' OR p.tipo = 'sin_documento'
                 OR upper(regexp_replace(p.nit, '[^A-Za-z0-9]', '', 'g')) = 'CF')
          ORDER BY co.fecha, co.id`,
        [ctx.empresaId, `${anio}-01-01`, ctx.hoy, limite],
    )) as {
        rows: Array<{
            id: number
            tipo_documento: string
            serie: string
            numero: string
            fecha: string
            total: string
            proveedor_id: number
            nombre: string
            nit: string
            documento_proveedor: string
            tipo_proveedor: string
        }>
    }
    const total = rows.reduce((acc, r) => acc.plus(dec(r.total)), CERO)
    return {
        anio: Number(anio),
        limite: aTexto(limite),
        cantidad: rows.length,
        total: aTexto(total),
        compras: rows.slice(0, 50).map((r) => ({
            compra_id: Number(r.id),
            fecha: r.fecha,
            documento: `${r.tipo_documento} ${r.serie} ${r.numero}`.replace(/\s+/g, ' ').trim(),
            total: aTexto(r.total),
            proveedor_id: Number(r.proveedor_id),
            proveedor: r.nombre,
            identificacion: `${r.documento_proveedor}${r.tipo_proveedor === 'sin_documento' ? ' (sin documento)' : ''}: ${r.nit}`,
        })),
    }
}

/** Reserva de incobrables a hoy: la misma cuenta que `cartera.provisionar` y el check `incobrables`. */
async function incobrables(ctx: Contexto) {
    const r = await reservaIncobrables(ctx.c, ctx.empresaId, ctx.hoy)
    const disponible = r.tope.minus(r.estimacion)
    return {
        corte: ctx.hoy,
        base: aTexto(r.base),
        porcentaje: aTexto(r.porcentaje),
        tope: aTexto(r.tope),
        estimacion: aTexto(r.estimacion),
        disponible: aTexto(disponible.isNegative() ? CERO : disponible),
        sobre_tope: r.estimacion.gt(r.tope),
    }
}

/** Activos vigentes que se deprecian a una tasa menor que el máximo legal de su clase (vigente hoy). */
async function depreciacion(ctx: Contexto) {
    const topes = resolver(ctx.datos.filas, 'depreciacion', ctx.hoy)?.valor
    if (!topes || typeof topes !== 'object') throw new ParametroSinConfirmar('depreciacion', ctx.hoy)
    const activos = (await ctx.c
        .from('ledger.activos as a')
        .where('a.empresa_id', ctx.empresaId)
        .whereNotExists((q) => q.from('ledger.activos_bajas as b').whereRaw('b.activo_id = a.id'))
        .orderBy('a.id', 'asc')
        .select(
            'a.id',
            'a.clase',
            'a.descripcion',
            ctx.c.raw('a.costo::text as costo'),
            ctx.c.raw('a.valor_residual::text as valor_residual'),
            'a.tasa_anual',
        )) as Array<{
        id: number
        clase: string
        descripcion: string
        costo: string
        valor_residual: string
        tasa_anual: string
    }>
    const tope = topes as Record<string, string>
    const bajo = activos
        .filter((a) => tope[a.clase] !== undefined && dec(a.tasa_anual).lt(dec(tope[a.clase]!)))
        .map((a) => {
            const depreciable = dec(a.costo).minus(dec(a.valor_residual))
            const actual = redondear(depreciable.times(dec(a.tasa_anual)).dividedBy(100))
            const maxima = redondear(depreciable.times(dec(tope[a.clase]!)).dividedBy(100))
            return {
                activo_id: Number(a.id),
                clase: a.clase,
                descripcion: a.descripcion,
                costo: aTexto(a.costo),
                tasa_anual: aTexto(a.tasa_anual),
                tasa_maxima: aTexto(tope[a.clase]!),
                depreciacion_anual: aTexto(actual),
                depreciacion_anual_maxima: aTexto(maxima),
                diferencia_anual: aTexto(maxima.minus(actual)),
            }
        })
    return {
        activos: activos.length,
        bajo_maximo: bajo.length,
        diferencia_anual: aTexto(bajo.reduce((acc, b) => acc.plus(dec(b.diferencia_anual)), CERO)),
        detalle: bajo.slice(0, 50),
    }
}

const CALCULOS: Record<NombreBloque, (ctx: Contexto) => Promise<Record<string, unknown>>> = {
    facturado,
    iva: bloqueIva,
    isr,
    iso,
    pequeno_contribuyente: pequenoContribuyente,
    vencimientos,
    libros,
    fel,
    compras_sin_nit: comprasSinNit,
    incobrables,
    depreciacion,
}
