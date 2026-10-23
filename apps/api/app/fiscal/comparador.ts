import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { Problema, ValidacionFallida } from '#shared/errores'
import { CERO, D, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { idsEmpresasActivas } from '#core/empresas'
import { hoyFiscal } from '#fiscal/comun'
import { ParametroSinConfirmar } from '#fiscal/errores'
import { catalogo, datosFiscales, resolver, type DatosFiscales } from '#fiscal/parametros'
import { instalacionVigente } from '#fiscal/instalador'
import { libroVentasLegal } from '#fiscal/libros_legales'
import { calcularBloque, type Bloque } from '#fiscal/bloques'
import { escalaOpcional, resultadosDelRango, saldoActivo, type Tramo } from '#fiscal/declaraciones_renta'

/**
 * Comparador de regímenes (`GET /fiscal/comparador?crecimiento=`, contrato §9.4; fase 8 PR B; inv. E.1).
 * Es una **simulación**: lee los datos reales de los últimos 12 meses terminados y los parámetros
 * vigentes hoy; no escribe nada, no cambia el régimen (eso es `POST /fiscal/regimen`, §6.2) y no tiene
 * «aplicar». Cada parte es un bloque independiente: si falta un parámetro, ese bloque trae su error y
 * ninguna cifra, y los que dependen de él responden 422 `bloque_dependiente`.
 *
 * - `datos`: `R` = ventas sin IVA del libro de ventas por mes; `m` = margen fiscal = (ingresos − gastos
 *   del libro + no deducibles) / `R`, en los mismos meses.
 * - `opcional`: Σ por mes de la escala del art. 44 (`isr_opcional_tramos`, que da `0.07·R − 600` sobre
 *   Q30,000 y 5 % debajo) y, aparte, el 7 % plano del art. 46 (`isr_opcional_directo`) si los clientes no
 *   retienen.
 * - `utilidades`: `isr_utilidades_tasa × m × R` (sin pérdidas: 0 con margen negativo).
 * - `iso_piso`: ISO de un año con la base del periodo (`iso_tasa` × la mayor entre el activo neto al
 *   cierre del último mes y los ingresos `R`), como piso del régimen sobre utilidades cuando es mayor.
 * - `comparacion`: ISR anual de cada régimen (utilidades con el piso), la diferencia y el margen de
 *   equilibrio `m*` = opcional / (tasa × `R`) (= `0.28 − 2,400 / R` mensual sobre Q30,000).
 * - `proyeccion`: los próximos 12 meses con `crecimiento` (por ciento mensual; por defecto la tendencia
 *   de los meses leídos) y el mismo margen.
 *
 * `supuestos` lista los parámetros usados con su vigencia, confianza y si el contador debe confirmarlos;
 * `matices` son las advertencias fijas del informe.
 */

export const BLOQUES_COMPARADOR = [
    'datos',
    'opcional',
    'utilidades',
    'iso_piso',
    'comparacion',
    'proyeccion',
] as const
export type NombreBloqueComparador = (typeof BLOQUES_COMPARADOR)[number]

export interface SupuestoComparador {
    clave: string
    valor: unknown
    vigente_desde: string | null
    confianza: string | null
    confirmar_contador: boolean
}

export interface ComparadorEmpresa {
    empresa_id: number
    regimen: string | null
    desde: string | null
    hasta: string | null
    crecimiento: string | null
    supuestos: SupuestoComparador[]
    matices: Array<{ clave: string; texto: string; confirmar_contador: boolean }>
    bloques: Record<NombreBloqueComparador, Bloque>
}

export interface Comparador {
    hoy: string
    aviso: string
    empresas: ComparadorEmpresa[]
}

export const AVISO_COMPARADOR =
    'Simulación de referencia con los datos del libro y los parámetros vigentes; no cambia el régimen. Valídela con su contador'

/** Matices fijos del informe (inv. E.1, §9.4). */
export const MATICES = [
    {
        clave: 'dividendos',
        texto: 'Los dividendos tributan igual en los dos regímenes (5 %): no cambian la comparación',
        confirmar_contador: false,
    },
    {
        clave: 'art46_plano',
        texto: 'Con clientes que no retienen, el régimen opcional paga el 7 % plano del art. 46 sobre lo no retenido; el margen de equilibrio sería 28 % (NO VERIFICADO 14)',
        confirmar_contador: true,
    },
    {
        clave: 'perdidas',
        texto: 'En utilidades una pérdida no paga ISR (salvo el ISO como piso); el régimen opcional paga sobre los ingresos aunque haya pérdida',
        confirmar_contador: false,
    },
    {
        clave: 'iso',
        texto: 'El ISO solo aplica al régimen sobre utilidades y es acreditable al ISR: aquí funciona como piso',
        confirmar_contador: true,
    },
    {
        clave: 'cambio_regimen',
        texto: 'El cambio de régimen se avisa a la SAT en diciembre y rige el 1 de enero siguiente; el sistema no lo hace por usted',
        confirmar_contador: false,
    },
    {
        clave: 'fragmentacion',
        texto: 'Fragmentar la empresa para quedar en pequeño contribuyente o en un tramo menor no es planeación fiscal legítima',
        confirmar_contador: false,
    },
] as const

const PARAMETROS_USADOS = [
    'isr_opcional_tramos',
    'isr_opcional_directo',
    'isr_utilidades_tasa',
    'iso_tasa',
    'iso_base',
] as const

class Dependiente extends Problema {
    constructor(bloques: string[]) {
        super(
            422,
            'bloque_dependiente',
            'Depende de otro bloque',
            `No se calcula: depende de ${bloques.join(', ')}, que no se pudo calcular`,
            bloques.map((b) => ({ field: b, message: 'bloque en error', rule: 'bloque_dependiente' })),
        )
    }
}

interface Contexto {
    c: QueryClientContract
    empresaId: number
    hoy: string
    datos: DatosFiscales
    regimen: string | null
    crecimiento: Dec | null
}

interface DatosBase {
    desde: string
    hasta: string
    meses: Array<{ mes: string; ventas: Dec }>
    R: Dec
    renta: Dec
    m: Dec
    ingresos: Dec
    gastos: Dec
    no_deducibles: Dec
}

const pct = (v: Dec) => aTexto(redondear(v.times(100)))

/** Comparador de las empresas pedidas (`null` = todas las activas). `crecimiento`: por ciento mensual. */
export async function compararRegimenes(
    empresas: number[] | null,
    crecimiento: string | null,
): Promise<Comparador> {
    if (crecimiento !== null && dec(crecimiento).lte(-100)) {
        throw new ValidacionFallida([
            { field: 'crecimiento', message: 'Mayor que -100 (por ciento mensual)', rule: 'crecimiento' },
        ])
    }
    const c = db.connection()
    const hoy = hoyFiscal()
    const ids = empresas ?? (await idsEmpresasActivas(c))
    const salida: ComparadorEmpresa[] = []
    for (const empresaId of [...ids].sort((a, b) => a - b)) {
        salida.push(await compararEmpresa(c, empresaId, hoy, crecimiento))
    }
    return { hoy, aviso: AVISO_COMPARADOR, empresas: salida }
}

async function compararEmpresa(
    c: QueryClientContract,
    empresaId: number,
    hoy: string,
    crecimiento: string | null,
): Promise<ComparadorEmpresa> {
    const vacio = (error: unknown) => calcularBloque(empresaId, 'comparador', () => Promise.reject(error))
    let ctx: Contexto
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
        ctx = {
            c,
            empresaId,
            hoy,
            datos,
            regimen: typeof regimen === 'string' ? regimen : null,
            crecimiento: crecimiento === null ? null : dec(crecimiento).dividedBy(100),
        }
    } catch (error) {
        const b = await vacio(error)
        return {
            empresa_id: empresaId,
            regimen: null,
            desde: null,
            hasta: null,
            crecimiento: null,
            supuestos: [],
            matices: [...MATICES],
            bloques: Object.fromEntries(BLOQUES_COMPARADOR.map((n) => [n, b])) as Record<
                NombreBloqueComparador,
                Bloque
            >,
        }
    }

    // cada bloque guarda su resultado interno para los que dependen de él
    const internos: Partial<Record<NombreBloqueComparador, any>> = {}
    const bloques = {} as Record<NombreBloqueComparador, Bloque>
    const correr = async (
        nombre: NombreBloqueComparador,
        deps: NombreBloqueComparador[],
        calculo: () => Promise<{ interno: unknown; datos: Record<string, unknown> }>,
    ) => {
        const fallan = deps.filter((d) => bloques[d]?.estado !== 'ok')
        bloques[nombre] = await calcularBloque(empresaId, nombre, async () => {
            if (fallan.length > 0) throw new Dependiente(fallan)
            const r = await calculo()
            internos[nombre] = r.interno
            return r.datos
        })
    }

    await correr('datos', [], () => datosBase(ctx))
    await correr('opcional', ['datos'], () => opcional(ctx, internos.datos))
    await correr('utilidades', ['datos'], () => utilidades(ctx, internos.datos))
    await correr('iso_piso', ['datos'], () => isoPiso(ctx, internos.datos))
    await correr('comparacion', ['datos', 'opcional', 'utilidades', 'iso_piso'], () =>
        comparacion(ctx, internos.datos, internos.opcional, internos.utilidades, internos.iso_piso),
    )
    await correr('proyeccion', ['datos', 'opcional', 'utilidades', 'iso_piso'], () =>
        proyeccion(ctx, internos.datos, internos.utilidades, internos.iso_piso),
    )

    const base = internos.datos as DatosBase | undefined
    return {
        empresa_id: empresaId,
        regimen: ctx.regimen,
        desde: base?.desde ?? null,
        hasta: base?.hasta ?? null,
        crecimiento:
            bloques.proyeccion.estado === 'ok' ? String(bloques.proyeccion.datos!.crecimiento_mensual) : null,
        supuestos: await supuestos(ctx),
        matices: [...MATICES],
        bloques,
    }
}

async function supuestos(ctx: Contexto): Promise<SupuestoComparador[]> {
    const instalacion = await instalacionVigente(ctx.c, ctx.empresaId)
    const pais = instalacion?.pais ?? 'GT'
    const defs = await catalogo(pais, ctx.c)
    return PARAMETROS_USADOS.map((clave) => {
        const v = resolver(ctx.datos.filas, clave, ctx.hoy)
        const def = defs.get(clave)
        return {
            clave,
            valor: v?.valor ?? null,
            vigente_desde: v?.vigente_desde ?? null,
            confianza: def?.confianza ?? null,
            confirmar_contador: Boolean(def?.confirmar_contador) || !v,
        }
    })
}

function leer<T>(ctx: Contexto, clave: string): T {
    const v = resolver(ctx.datos.filas, clave, ctx.hoy)?.valor
    if (v === undefined || v === null) throw new ParametroSinConfirmar(clave, ctx.hoy)
    return v as T
}

/*
|--------------------------------------------------------------------------
| Bloques
|--------------------------------------------------------------------------
*/

async function datosBase(ctx: Contexto) {
    const hoy = DateTime.fromISO(ctx.hoy, { zone: 'utc' })
    const ultimo = hoy.startOf('month').minus({ days: 1 })
    let primero = ultimo.startOf('month').minus({ months: 11 })
    const inicio = resolver(ctx.datos.filas, 'inicio_libros', ctx.hoy)?.valor
    if (typeof inicio === 'string') {
        const desdeLibros = DateTime.fromISO(inicio, { zone: 'utc' }).startOf('month')
        if (desdeLibros > primero) primero = desdeLibros
    }
    if (primero > ultimo) {
        throw new Problema(
            422,
            'sin_datos',
            'Sin meses terminados',
            'No hay ningún mes terminado desde inicio_libros: el comparador necesita los datos reales de al menos un mes',
        )
    }
    const desde = primero.toISODate()!
    const hasta = ultimo.toISODate()!
    const libro = await libroVentasLegal(ctx.empresaId, { desde, hasta }, ctx.c)
    const porMes = new Map<string, Dec>()
    for (let m = primero; m <= ultimo; m = m.plus({ months: 1 })) porMes.set(m.toFormat('yyyy-MM'), CERO)
    for (const f of libro.reporte.filas as Array<Record<string, any>>) {
        const mes = String(f.fecha).slice(0, 7)
        const base = dec(f.bienes ?? '0')
            .plus(dec(f.servicios ?? '0'))
            .plus(dec(f.exportacion ?? '0'))
            .plus(dec(f.exento ?? '0'))
        if (porMes.has(mes)) porMes.set(mes, porMes.get(mes)!.plus(base))
    }
    const meses = [...porMes.entries()].map(([mes, ventas]) => ({ mes, ventas: redondear(ventas) }))
    const R = meses.reduce((s, x) => s.plus(x.ventas), CERO)
    const r = await resultadosDelRango(ctx.c, ctx.empresaId, desde, hasta)
    const renta = r.ingresos.minus(r.gastos).plus(r.no_deducibles)
    const m = R.gt(0) ? renta.dividedBy(R) : CERO
    const interno: DatosBase = {
        desde,
        hasta,
        meses,
        R,
        renta,
        m,
        ingresos: r.ingresos,
        gastos: r.gastos,
        no_deducibles: r.no_deducibles,
    }
    return {
        interno,
        datos: {
            desde,
            hasta,
            meses_con_datos: meses.length,
            meses: meses.map((x) => ({ mes: x.mes, ventas: aTexto(x.ventas) })),
            ventas_sin_iva: aTexto(R),
            ventas_mensual_promedio: aTexto(redondear(R.dividedBy(meses.length))),
            ingresos: aTexto(r.ingresos),
            gastos: aTexto(r.gastos),
            no_deducibles: aTexto(r.no_deducibles),
            renta_fiscal: aTexto(redondear(renta)),
            margen_fiscal: pct(m),
        },
    }
}

async function opcional(ctx: Contexto, base: DatosBase) {
    const tramos = leer<{ tramos: Tramo[] }>(ctx, 'isr_opcional_tramos').tramos
    const directo = dec(leer<string>(ctx, 'isr_opcional_directo'))
    const porMes = base.meses.map((x) => ({ mes: x.mes, isr: escalaOpcional(x.ventas, tramos) }))
    const escala = porMes.reduce((s, x) => s.plus(x.isr), CERO)
    const plano = redondear(base.R.times(directo).dividedBy(100))
    return {
        interno: { escala, plano, tramos, directo },
        datos: {
            isr_escala: aTexto(escala),
            isr_plano_art46: aTexto(plano),
            por_mes: porMes.map((x) => ({ mes: x.mes, isr: aTexto(x.isr) })),
            tasa_efectiva: base.R.gt(0) ? pct(escala.dividedBy(base.R)) : '0.00',
        },
    }
}

async function utilidades(ctx: Contexto, base: DatosBase) {
    const tasa = dec(leer<string>(ctx, 'isr_utilidades_tasa')).dividedBy(100)
    const isr = redondear((base.renta.isNegative() ? CERO : base.renta).times(tasa))
    return {
        interno: { tasa, isr },
        datos: {
            tasa: pct(tasa),
            renta_imponible: aTexto(redondear(base.renta)),
            isr: aTexto(isr),
            perdida: base.renta.isNegative(),
        },
    }
}

async function isoPiso(ctx: Contexto, base: DatosBase) {
    const tasa = dec(leer<string>(ctx, 'iso_tasa')).dividedBy(100)
    leer(ctx, 'iso_base')
    const activo = await saldoActivo(ctx.c, ctx.empresaId, base.hasta)
    // ISO de un año: 4 trimestres de tasa × ¼ de la mayor base = tasa × la mayor base
    const mayor = activo.gt(base.R) ? activo : base.R
    const iso = redondear((mayor.isNegative() ? CERO : mayor).times(tasa))
    return {
        interno: { iso },
        datos: {
            activo_neto: aTexto(activo),
            ingresos_brutos: aTexto(base.R),
            base: aTexto(mayor.isNegative() ? CERO : mayor),
            tasa: pct(tasa),
            iso_anual: aTexto(iso),
        },
    }
}

/** Escala del opcional de un año de meses iguales. */
function anualizar(meses: number, total: Dec) {
    return meses === 12 ? total : redondear(total.times(12).dividedBy(meses))
}

async function comparacion(
    ctx: Contexto,
    base: DatosBase,
    op: { escala: Dec; plano: Dec },
    ut: { tasa: Dec; isr: Dec },
    piso: { iso: Dec },
) {
    const n = base.meses.length
    const opcionalAnual = anualizar(n, op.escala)
    const isrUtilidades = anualizar(n, ut.isr)
    const iso = piso.iso
    const utilidadesAnual = isrUtilidades.gt(iso) ? isrUtilidades : iso
    const R = anualizar(n, base.R)
    const equilibrio = R.gt(0) && ut.tasa.gt(0) ? opcionalAnual.dividedBy(ut.tasa.times(R)) : null
    const equilibrioPlano = base.R.gt(0) && ut.tasa.gt(0) ? op.plano.dividedBy(ut.tasa.times(base.R)) : null
    const diferencia = utilidadesAnual.minus(opcionalAnual)
    return {
        interno: null,
        datos: {
            meses_base: n,
            anualizado: n !== 12,
            ventas_anuales: aTexto(R),
            isr_opcional_anual: aTexto(opcionalAnual),
            isr_utilidades_anual: aTexto(isrUtilidades),
            iso_anual: aTexto(iso),
            utilidades_con_iso: aTexto(utilidadesAnual),
            iso_es_piso: iso.gt(isrUtilidades),
            diferencia: aTexto(diferencia),
            menor: diferencia.isZero()
                ? 'iguales'
                : diferencia.isPositive()
                  ? 'opcional_simplificado'
                  : 'utilidades',
            margen_fiscal: pct(base.m),
            margen_equilibrio: equilibrio === null ? null : pct(equilibrio),
            margen_equilibrio_art46: equilibrioPlano === null ? null : pct(equilibrioPlano),
            regimen_actual: ctx.regimen,
            nota: 'Con un margen fiscal mayor que el de equilibrio el régimen opcional paga menos; menor, utilidades. Referencia: valídelo con su contador',
        },
    }
}

async function proyeccion(ctx: Contexto, base: DatosBase, ut: { tasa: Dec }, piso: { iso: Dec }) {
    const tramos = leer<{ tramos: Tramo[] }>(ctx, 'isr_opcional_tramos').tramos
    const primero = base.meses[0]!.ventas
    const ultimo = base.meses.at(-1)!.ventas
    const n = base.meses.length
    // tendencia: crecimiento mensual compuesto entre el primer y el último mes leídos
    const tendencia =
        n > 1 && primero.gt(0) && ultimo.gt(0)
            ? ultimo
                  .dividedBy(primero)
                  .pow(new D(1).dividedBy(n - 1))
                  .minus(1)
            : CERO
    const g = ctx.crecimiento ?? tendencia
    const meses: Array<{ mes: string; ventas: Dec; opcional: Dec }> = []
    let ventas = ultimo
    let mes = DateTime.fromISO(`${base.meses.at(-1)!.mes}-01`, { zone: 'utc' })
    for (let i = 0; i < 12; i++) {
        ventas = ventas.times(g.plus(1))
        mes = mes.plus({ months: 1 })
        const v = redondear(ventas.isNegative() ? CERO : ventas)
        meses.push({ mes: mes.toFormat('yyyy-MM'), ventas: v, opcional: escalaOpcional(v, tramos) })
    }
    const R = meses.reduce((s, x) => s.plus(x.ventas), CERO)
    const op = meses.reduce((s, x) => s.plus(x.opcional), CERO)
    const renta = R.times(base.m)
    const isrUt = redondear((renta.isNegative() ? CERO : renta).times(ut.tasa))
    const utConIso = isrUt.gt(piso.iso) ? isrUt : piso.iso
    return {
        interno: null,
        datos: {
            crecimiento_mensual: pct(g),
            crecimiento_supuesto: ctx.crecimiento === null ? 'tendencia' : 'usuario',
            margen_fiscal: pct(base.m),
            meses: meses.map((x) => ({
                mes: x.mes,
                ventas: aTexto(x.ventas),
                isr_opcional: aTexto(x.opcional),
            })),
            ventas: aTexto(R),
            isr_opcional: aTexto(op),
            isr_utilidades: aTexto(isrUt),
            utilidades_con_iso: aTexto(utConIso),
            diferencia: aTexto(utConIso.minus(op)),
            nota: 'El ISO de la proyección es el del periodo leído (no se proyecta el activo)',
        },
    }
}
