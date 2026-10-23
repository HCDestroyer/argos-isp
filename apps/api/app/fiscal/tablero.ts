import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { Problema, type ProblemaJson } from '#shared/errores'
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
 * `vencimientos` (obligaciones abiertas que vencen en 30 días o ya vencieron, con mora estimada),
 * `libros` (libros legales sin emitir fuera de `libros_ventana_meses`) y `fel` (alerta permanente si
 * la FEL es obligatoria y está desactivada).
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
] as const
export type NombreBloque = (typeof BLOQUES_TABLERO)[number]

export type EstadoBloque = 'ok' | 'error' | 'no_aplica'

export interface Bloque<T = Record<string, unknown>> {
    estado: EstadoBloque
    /** por qué no aplica (régimen) o, con `ok`, null */
    motivo: string | null
    /** el problema RFC 9457 del bloque cuando `estado = error` */
    error: ProblemaJson | null
    datos: T | null
}

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

class NoAplica extends Error {
    constructor(readonly motivo: string) {
        super(motivo)
    }
}

async function calcularBloque<T extends Record<string, unknown>>(
    empresaId: number,
    nombre: NombreBloque,
    calculo: () => Promise<T>,
): Promise<Bloque> {
    try {
        return { estado: 'ok', motivo: null, error: null, datos: await calculo() }
    } catch (error) {
        if (error instanceof NoAplica) {
            return { estado: 'no_aplica', motivo: error.motivo, error: null, datos: null }
        }
        if (error instanceof Problema) {
            return { estado: 'error', motivo: null, error: error.toJSON(), datos: null }
        }
        logger.error({ err: error, empresa_id: empresaId, bloque: nombre }, 'tablero fiscal')
        return {
            estado: 'error',
            motivo: null,
            error: new Problema(
                500,
                'error_interno',
                'Error interno',
                `El bloque ${nombre} no se pudo calcular; los demás bloques sí`,
            ).toJSON(),
            datos: null,
        }
    }
}

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
    const filas = (
        (await ctx.c
            .from('fiscal.obligaciones as o')
            .where('o.empresa_id', ctx.empresaId)
            .whereIn('o.estado', ['pendiente', 'borrador'])
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
        let monto: string | null = null
        let moraEstimada: string | null = null
        if (o.declaracion_id !== null) {
            const d = await ultimaVersion(ctx.c, ctx.empresaId, o.impuesto, o.periodo_desde)
            if (d) monto = aTexto(d.totales.a_pagar ?? '0')
        }
        if (vencida && monto !== null && mora && typeof mora.valor === 'string') {
            moraEstimada = aTexto(redondear(dec(monto).times(dec(mora.valor)).dividedBy(100).times(-dias)))
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
            a_pagar: monto,
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

const CALCULOS: Record<NombreBloque, (ctx: Contexto) => Promise<Record<string, unknown>>> = {
    facturado,
    iva: bloqueIva,
    isr,
    iso,
    pequeno_contribuyente: pequenoContribuyente,
    vencimientos,
    libros,
    fel,
}
