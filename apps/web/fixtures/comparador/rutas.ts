import Decimal from 'decimal.js'
import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture } from '~/utils/fetchFixtures'
import { hoyGuatemala } from '~/utils/cobro'
import { bd } from '../bd'
import { conPermiso, datosInvalidos, empresasDeLista, problemaTipado, usuariosPorToken } from '../comun'
import { resolverValor } from '../fiscal/rutas'

/**
 * Comparador de regímenes (A3, fase 8 PR B; `app/fiscal/comparador.ts`). Simulación de solo lectura con
 * los mismos bloques, dependencias y fórmulas que la API: `datos` (R y margen `m` de los últimos 12 meses
 * terminados), `opcional` (escala del art. 44 por mes y 7 % plano), `utilidades`, `iso_piso`,
 * `comparacion` (con `m*`) y `proyeccion` (12 meses con el crecimiento pedido o la tendencia).
 *
 * Del mundo del fixture: las ventas de cada mes salen de los renglones de `datosDeclaraciones` (julio a
 * septiembre de 2026) y, antes, de `HISTORIAL_VENTAS`; el resultado del libro de los 12 meses y el activo
 * neto al cierre son fijos por empresa (`RESULTADOS_12_MESES`, `ACTIVO_NETO`). Los libros cuentan desde el
 * 1/1/2025 (el `inicio_libros` de las declaraciones). Los parámetros se resuelven como en Configuración →
 * Fiscal y, si el paquete del fixture no los trae, con el valor del paquete gt-2026.1; una fila con valor
 * `null` deja el parámetro sin confirmar (el bloque sale en error y los que dependen de él, pendientes).
 */

type Comparador = Schema<'ComparadorRegimenes'>
type Empresa = Comparador['empresas'][number]
type Bloques = Empresa['bloques']
type Nombre = keyof Bloques

interface Tramo {
    desde: string
    hasta: string | null
    fijo: string
    porcentaje: string
    sobre_excedente_de: string
}

const INICIO_LIBROS = '2025-01-01'
const AVISO = 'Simulación de referencia con los datos del libro y los parámetros vigentes; no cambia el régimen. Valídela con su contador'

/** Ventas sin IVA por mes antes de los datos de las declaraciones. */
const HISTORIAL_VENTAS: Record<number, Record<string, string>> = {
    1: { '2025-10': '10200.00', '2025-11': '10400.00', '2025-12': '10900.00', '2026-01': '11000.00', '2026-02': '10800.00', '2026-03': '11300.00', '2026-04': '11500.00', '2026-05': '11600.00', '2026-06': '4910.71' },
    2: { '2025-10': '14000.00', '2025-11': '14500.00', '2025-12': '15200.00', '2026-01': '15000.00', '2026-02': '15400.00', '2026-03': '15900.00', '2026-04': '16300.00', '2026-05': '16800.00', '2026-06': '17100.00', '2026-07': '17500.00' },
}

/** Resultado del libro de los 12 meses leídos (`resultadosDelRango`). */
const RESULTADOS_12_MESES: Record<number, { ingresos: string, gastos: string, no_deducibles: string }> = {
    1: { ingresos: '135500.00', gastos: '98700.00', no_deducibles: '900.00' },
    2: { ingresos: '200000.00', gastos: '172000.00', no_deducibles: '0.00' },
}

/** Activo neto al cierre del último mes leído (`saldoActivo`). */
const ACTIVO_NETO: Record<number, string> = { 1: '412350.00', 2: '96000.00' }

/** Valor, confianza y marca del paquete gt-2026.1 de los parámetros que usa el comparador. */
const PARAMETROS: Record<string, { valor: unknown, vigente_desde: string, confianza: string, confirmar_contador: boolean }> = {
    isr_opcional_tramos: {
        valor: {
            tramos: [
                { desde: '0.01', hasta: '30000.00', fijo: '0.00', porcentaje: '5.00', sobre_excedente_de: '0.00' },
                { desde: '30000.01', hasta: null, fijo: '1500.00', porcentaje: '7.00', sobre_excedente_de: '30000.00' },
            ],
        },
        vigente_desde: '2014-01-01',
        confianza: 'alta',
        confirmar_contador: false,
    },
    isr_opcional_directo: { valor: '7.00', vigente_desde: '2013-01-01', confianza: 'alta', confirmar_contador: false },
    isr_utilidades_tasa: { valor: '25.00', vigente_desde: '2015-01-01', confianza: 'alta', confirmar_contador: false },
    iso_tasa: { valor: '1.00', vigente_desde: '2013-01-01', confianza: 'media', confirmar_contador: false },
    iso_base: { valor: { regla: 'mayor_cuarto_activo_neto_o_cuarto_ingresos_brutos' }, vigente_desde: '2013-01-01', confianza: 'media', confirmar_contador: false },
}

const MATICES: Empresa['matices'] = [
    { clave: 'dividendos', texto: 'Los dividendos tributan igual en los dos regímenes (5 %): no cambian la comparación', confirmar_contador: false },
    { clave: 'art46_plano', texto: 'Con clientes que no retienen, el régimen opcional paga el 7 % plano del art. 46 sobre lo no retenido; el margen de equilibrio sería 28 % (NO VERIFICADO 14)', confirmar_contador: true },
    { clave: 'perdidas', texto: 'En utilidades una pérdida no paga ISR (salvo el ISO como piso); el régimen opcional paga sobre los ingresos aunque haya pérdida', confirmar_contador: false },
    { clave: 'iso', texto: 'El ISO solo aplica al régimen sobre utilidades y es acreditable al ISR: aquí funciona como piso', confirmar_contador: true },
    { clave: 'cambio_regimen', texto: 'El cambio de régimen se avisa a la SAT en diciembre y rige el 1 de enero siguiente; el sistema no lo hace por usted', confirmar_contador: false },
    { clave: 'fragmentacion', texto: 'Fragmentar la empresa para quedar en pequeño contribuyente o en un tramo menor no es planeación fiscal legítima', confirmar_contador: false },
]

const CERO = new Decimal(0)
const texto = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2)
const pct = (d: Decimal) => texto(d.times(100))

class FallaBloque {
    constructor(readonly problema: Problem) {}
}

function problemaDe(respuesta: RespuestaFixture): Problem {
    return respuesta.cuerpo as Problem
}

/** Valor vigente: el del usuario o el de la instalación; si no hay, el del paquete. */
function parametro(empresaId: number, clave: string, hoy: string): { valor: unknown, vigente_desde: string | null } | null {
    const fila = resolverValor(empresaId, clave, hoy)
    if (fila) {
        return { valor: fila.valor, vigente_desde: fila.vigente_desde }
    }
    const paquete = PARAMETROS[clave]
    return paquete ? { valor: paquete.valor, vigente_desde: paquete.vigente_desde } : null
}

function leer<T>(empresaId: number, clave: string, hoy: string): T {
    const valor = parametro(empresaId, clave, hoy)?.valor
    if (valor === undefined || valor === null) {
        throw new FallaBloque(problemaDe(problemaTipado(422, 'parametro_sin_confirmar', 'Parámetro sin confirmar', `El parámetro ${clave} no tiene valor vigente al ${hoy}; debe confirmarlo el contador`, [{ field: clave, message: `Sin valor vigente al ${hoy}`, rule: 'parametro_sin_confirmar' }])))
    }
    return valor as T
}

function regimenDe(empresaId: number, hoy: string): string | null {
    const vigente = resolverValor(empresaId, 'regimen', hoy)
    if (vigente && vigente.origen !== 'paquete' && typeof vigente.valor === 'string') {
        return vigente.valor
    }
    const instalado = bd.fiscal.valores.find(v => v.clave === 'regimen' && v.empresa_id === empresaId && v.origen === 'instalacion')?.valor
    return typeof instalado === 'string' ? instalado : null
}

function escalaOpcional(base: Decimal, tramos: Tramo[]): Decimal {
    if (base.lte(0)) {
        return CERO
    }
    const tramo = tramos.find(t => base.gte(t.desde) && (t.hasta === null || base.lte(t.hasta)))
    if (!tramo) {
        return CERO
    }
    return new Decimal(tramo.fijo).plus(base.minus(tramo.sobre_excedente_de).times(tramo.porcentaje).dividedBy(100)).toDecimalPlaces(2)
}

function mesTexto(anio: number, mes: number, desplazamiento: number): string {
    return new Date(Date.UTC(anio, mes - 1 + desplazamiento, 1)).toISOString().slice(0, 7)
}

function finDeMes(mes: string): string {
    const [anio = 0, numero = 0] = mes.split('-').map(Number)
    return new Date(Date.UTC(anio, numero, 0)).toISOString().slice(0, 10)
}

interface Base {
    desde: string
    hasta: string
    meses: { mes: string, ventas: Decimal }[]
    R: Decimal
    renta: Decimal
    m: Decimal
}

interface Contexto {
    empresaId: number
    hoy: string
    regimen: string | null
    crecimiento: Decimal | null
    base?: Base
    opcional?: { escala: Decimal, plano: Decimal }
    utilidades?: { tasa: Decimal, isr: Decimal }
    iso?: { iso: Decimal }
}

const CALCULOS: { [N in Nombre]: (ctx: Contexto) => NonNullable<Bloques[N]['datos']> } = {
    datos: (ctx) => {
        const [anio = 0, mes = 0] = ctx.hoy.split('-').map(Number)
        const ultimo = mesTexto(anio, mes, -1)
        let primero = mesTexto(anio, mes, -12)
        if (INICIO_LIBROS.slice(0, 7) > primero) {
            primero = INICIO_LIBROS.slice(0, 7)
        }
        if (primero > ultimo) {
            throw new FallaBloque(problemaDe(problemaTipado(422, 'sin_datos', 'Sin meses terminados', 'No hay ningún mes terminado desde inicio_libros: el comparador necesita los datos reales de al menos un mes')))
        }
        const meses: Base['meses'] = []
        for (let i = 0, m = primero; m <= ultimo; i++, m = mesTexto(Number(primero.slice(0, 4)), Number(primero.slice(5, 7)), i)) {
            const renglones = bd.datosDeclaraciones.find(d => d.empresa_id === ctx.empresaId && d.periodo === m)?.renglones.filter(r => r.seccion === 'ventas')
            const ventas = renglones
                ? renglones.reduce((s, r) => s.plus(r.base), CERO)
                : new Decimal(HISTORIAL_VENTAS[ctx.empresaId]?.[m] ?? '0')
            meses.push({ mes: m, ventas: ventas.toDecimalPlaces(2) })
        }
        const R = meses.reduce((s, x) => s.plus(x.ventas), CERO)
        const r = RESULTADOS_12_MESES[ctx.empresaId] ?? { ingresos: '0.00', gastos: '0.00', no_deducibles: '0.00' }
        const renta = new Decimal(r.ingresos).minus(r.gastos).plus(r.no_deducibles)
        const m = R.gt(0) ? renta.dividedBy(R) : CERO
        const desde = `${primero}-01`
        const hasta = finDeMes(ultimo)
        ctx.base = { desde, hasta, meses, R, renta, m }
        return {
            desde,
            hasta,
            meses_con_datos: meses.length,
            meses: meses.map(x => ({ mes: x.mes, ventas: texto(x.ventas) })),
            ventas_sin_iva: texto(R),
            ventas_mensual_promedio: texto(R.dividedBy(meses.length)),
            ingresos: r.ingresos,
            gastos: r.gastos,
            no_deducibles: r.no_deducibles,
            renta_fiscal: texto(renta),
            margen_fiscal: pct(m),
        }
    },

    opcional: (ctx) => {
        const base = ctx.base!
        const tramos = leer<{ tramos: Tramo[] }>(ctx.empresaId, 'isr_opcional_tramos', ctx.hoy).tramos
        const directo = new Decimal(leer<string>(ctx.empresaId, 'isr_opcional_directo', ctx.hoy))
        const porMes = base.meses.map(x => ({ mes: x.mes, isr: escalaOpcional(x.ventas, tramos) }))
        const escala = porMes.reduce((s, x) => s.plus(x.isr), CERO)
        const plano = base.R.times(directo).dividedBy(100).toDecimalPlaces(2)
        ctx.opcional = { escala, plano }
        return {
            isr_escala: texto(escala),
            isr_plano_art46: texto(plano),
            por_mes: porMes.map(x => ({ mes: x.mes, isr: texto(x.isr) })),
            tasa_efectiva: base.R.gt(0) ? pct(escala.dividedBy(base.R)) : '0.00',
        }
    },

    utilidades: (ctx) => {
        const base = ctx.base!
        const tasa = new Decimal(leer<string>(ctx.empresaId, 'isr_utilidades_tasa', ctx.hoy)).dividedBy(100)
        const isr = (base.renta.isNegative() ? CERO : base.renta).times(tasa).toDecimalPlaces(2)
        ctx.utilidades = { tasa, isr }
        return { tasa: pct(tasa), renta_imponible: texto(base.renta), isr: texto(isr), perdida: base.renta.isNegative() }
    },

    iso_piso: (ctx) => {
        const base = ctx.base!
        const tasa = new Decimal(leer<string>(ctx.empresaId, 'iso_tasa', ctx.hoy)).dividedBy(100)
        leer(ctx.empresaId, 'iso_base', ctx.hoy)
        const activo = new Decimal(ACTIVO_NETO[ctx.empresaId] ?? '0')
        const mayor = activo.gt(base.R) ? activo : base.R
        const positivo = mayor.isNegative() ? CERO : mayor
        const iso = positivo.times(tasa).toDecimalPlaces(2)
        ctx.iso = { iso }
        return { activo_neto: texto(activo), ingresos_brutos: texto(base.R), base: texto(positivo), tasa: pct(tasa), iso_anual: texto(iso) }
    },

    comparacion: (ctx) => {
        const base = ctx.base!
        const { escala, plano } = ctx.opcional!
        const { tasa, isr } = ctx.utilidades!
        const iso = ctx.iso!.iso
        const n = base.meses.length
        const anualizar = (total: Decimal) => (n === 12 ? total : total.times(12).dividedBy(n).toDecimalPlaces(2))
        const opcionalAnual = anualizar(escala)
        const isrUtilidades = anualizar(isr)
        const conIso = isrUtilidades.gt(iso) ? isrUtilidades : iso
        const R = anualizar(base.R)
        const diferencia = conIso.minus(opcionalAnual)
        return {
            meses_base: n,
            anualizado: n !== 12,
            ventas_anuales: texto(R),
            isr_opcional_anual: texto(opcionalAnual),
            isr_utilidades_anual: texto(isrUtilidades),
            iso_anual: texto(iso),
            utilidades_con_iso: texto(conIso),
            iso_es_piso: iso.gt(isrUtilidades),
            diferencia: texto(diferencia),
            menor: diferencia.isZero() ? 'iguales' : diferencia.isPositive() ? 'opcional_simplificado' : 'utilidades',
            margen_fiscal: pct(base.m),
            margen_equilibrio: R.gt(0) && tasa.gt(0) ? pct(opcionalAnual.dividedBy(tasa.times(R))) : null,
            margen_equilibrio_art46: base.R.gt(0) && tasa.gt(0) ? pct(plano.dividedBy(tasa.times(base.R))) : null,
            regimen_actual: ctx.regimen,
            nota: 'Con un margen fiscal mayor que el de equilibrio el régimen opcional paga menos; menor, utilidades. Referencia: valídelo con su contador',
        }
    },

    proyeccion: (ctx) => {
        const base = ctx.base!
        const tramos = leer<{ tramos: Tramo[] }>(ctx.empresaId, 'isr_opcional_tramos', ctx.hoy).tramos
        const primero = base.meses[0]!.ventas
        const ultimo = base.meses.at(-1)!.ventas
        const n = base.meses.length
        const tendencia = n > 1 && primero.gt(0) && ultimo.gt(0)
            ? ultimo.dividedBy(primero).pow(new Decimal(1).dividedBy(n - 1)).minus(1)
            : CERO
        const g = ctx.crecimiento ?? tendencia
        const [anio = 0, mes = 0] = base.meses.at(-1)!.mes.split('-').map(Number)
        const meses: { mes: string, ventas: Decimal, opcional: Decimal }[] = []
        let ventas = ultimo
        for (let i = 1; i <= 12; i++) {
            ventas = ventas.times(g.plus(1))
            const v = (ventas.isNegative() ? CERO : ventas).toDecimalPlaces(2)
            meses.push({ mes: mesTexto(anio, mes, i), ventas: v, opcional: escalaOpcional(v, tramos) })
        }
        const R = meses.reduce((s, x) => s.plus(x.ventas), CERO)
        const op = meses.reduce((s, x) => s.plus(x.opcional), CERO)
        const renta = R.times(base.m)
        const isrUt = (renta.isNegative() ? CERO : renta).times(ctx.utilidades!.tasa).toDecimalPlaces(2)
        const conIso = isrUt.gt(ctx.iso!.iso) ? isrUt : ctx.iso!.iso
        return {
            crecimiento_mensual: pct(g),
            crecimiento_supuesto: ctx.crecimiento === null ? 'tendencia' : 'usuario',
            margen_fiscal: pct(base.m),
            meses: meses.map(x => ({ mes: x.mes, ventas: texto(x.ventas), isr_opcional: texto(x.opcional) })),
            ventas: texto(R),
            isr_opcional: texto(op),
            isr_utilidades: texto(isrUt),
            utilidades_con_iso: texto(conIso),
            diferencia: texto(conIso.minus(op)),
            nota: 'El ISO de la proyección es el del periodo leído (no se proyecta el activo)',
        }
    },
}

const DEPENDENCIAS: Record<Nombre, Nombre[]> = {
    datos: [],
    opcional: ['datos'],
    utilidades: ['datos'],
    iso_piso: ['datos'],
    comparacion: ['datos', 'opcional', 'utilidades', 'iso_piso'],
    proyeccion: ['datos', 'opcional', 'utilidades', 'iso_piso'],
}

function compararEmpresa(empresaId: number, hoy: string, crecimiento: Decimal | null): Empresa {
    const ctx: Contexto = { empresaId, hoy, regimen: regimenDe(empresaId, hoy), crecimiento }
    const bloques = {} as Bloques
    for (const nombre of Object.keys(DEPENDENCIAS) as Nombre[]) {
        const fallan = DEPENDENCIAS[nombre].filter(d => bloques[d].estado !== 'ok')
        try {
            if (fallan.length) {
                throw new FallaBloque(problemaDe(problemaTipado(422, 'bloque_dependiente', 'Depende de otro bloque', `No se calcula: depende de ${fallan.join(', ')}, que no se pudo calcular`, fallan.map(b => ({ field: b, message: 'bloque en error', rule: 'bloque_dependiente' })))))
            }
            Object.assign(bloques, { [nombre]: { estado: 'ok', motivo: null, error: null, datos: CALCULOS[nombre](ctx) } })
        }
        catch (error) {
            const problema = error instanceof FallaBloque ? error.problema : problemaDe(problemaTipado(500, 'error_interno', 'Error interno', `No se pudo calcular el bloque ${nombre}`))
            Object.assign(bloques, { [nombre]: { estado: 'error', motivo: null, error: problema, datos: null } })
        }
    }
    const proyeccion = bloques.proyeccion.datos
    return {
        empresa_id: empresaId,
        regimen: ctx.regimen,
        desde: ctx.base?.desde ?? null,
        hasta: ctx.base?.hasta ?? null,
        crecimiento: proyeccion ? proyeccion.crecimiento_mensual : null,
        supuestos: Object.entries(PARAMETROS).map(([clave, def]) => {
            const vigente = parametro(empresaId, clave, hoy)
            const valor = vigente?.valor ?? null
            return { clave, valor, vigente_desde: valor === null ? null : (vigente?.vigente_desde ?? null), confianza: def.confianza, confirmar_contador: def.confirmar_contador || valor === null }
        }),
        matices: MATICES.map(m => ({ ...m })),
        bloques,
    }
}

const CRECIMIENTO = /^-?\d{1,3}(\.\d{1,2})?$/

export const rutasComparador: RutasFixture = {
    'GET /api/v1/fiscal/comparador': conPermiso('fiscal.ver', (solicitud) => {
        const pedido = solicitud.query.get('empresas')
        const crecimiento = solicitud.query.get('crecimiento')?.trim() || null
        if (pedido !== null && pedido !== '' && pedido !== 'todas') {
            return datosInvalidos([{ field: 'empresas', message: 'Valor no permitido', rule: 'enum' }])
        }
        if (crecimiento !== null && !CRECIMIENTO.test(crecimiento)) {
            return datosInvalidos([{ field: 'crecimiento', message: 'El formato de crecimiento no es válido', rule: 'regex' }])
        }
        if (crecimiento !== null && new Decimal(crecimiento).lte(-100)) {
            return datosInvalidos([{ field: 'crecimiento', message: 'Mayor que -100 (por ciento mensual)', rule: 'crecimiento' }])
        }
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        if (pedido === 'todas' && usuario?.alcance_global !== true) {
            return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', 'El consolidado de todas las empresas (empresas=todas) requiere alcance global')
        }
        const hoy = hoyGuatemala()
        const g = crecimiento === null ? null : new Decimal(crecimiento).dividedBy(100)
        const ids = empresasDeLista(solicitud) ?? bd.empresas.filter(e => e.activa).map(e => e.id)
        const cuerpo: Comparador = { hoy, aviso: AVISO, empresas: [...ids].sort((a, b) => a - b).map(id => compararEmpresa(id, hoy, g)) }
        return { status: 200, cuerpo }
    }),
}
