/**
 * Consejos fiscales de Guatemala (contrato §9.4, inv. E.2; fase 8 PR C). Cada consejo dice de qué
 * bloques del tablero o del comparador sale (`fuentes`) y su condición se evalúa **solo** con las
 * cifras de esos bloques y los parámetros vigentes: nunca calcula cifras propias. Si un bloque fuente
 * está en error, el consejo queda `sin_datos` (no se inventa); si no aplica al régimen, `no_aplica`.
 *
 * Como `obligaciones.ts`, no entra al checksum del paquete (no agrega cuentas, parámetros ni valores).
 * Todos llevan el aviso «Referencia; valídelo con su contador».
 *
 * Fuera de este catálogo por ahora (necesitan cifras que el tablero no tiene; §22 PR C, desvío a):
 * compras ≥ Q2,500 sin NIT, crédito fiscal por vencer, reserva de incobrables sin usar y depreciación
 * por debajo del máximo legal.
 */

import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'

export type FuenteConsejo =
    | 'tablero.vencimientos'
    | 'tablero.isr'
    | 'tablero.pequeno_contribuyente'
    | 'tablero.libros'
    | 'tablero.fel'
    | 'comparador.datos'
    | 'comparador.comparacion'

/** Datos de los bloques fuente (solo los que están en `ok`) y lectura de parámetros vigentes. */
export interface EntradaConsejo {
    regimen: string | null
    bloques: Partial<Record<FuenteConsejo, Record<string, any>>>
    parametro: (clave: string) => unknown
}

export interface ResultadoConsejo {
    aplica: boolean
    /** texto con las cifras de los bloques fuente (solo si aplica) */
    texto?: string
    /** las cifras que usó, tal como vienen de los bloques */
    datos?: Record<string, string | number | boolean | null>
    /** por qué no aplica (régimen) */
    no_aplica?: string
}

export interface DefinicionConsejo {
    clave: string
    titulo: string
    fuente: string
    confirmar_contador: boolean
    fuentes: readonly FuenteConsejo[]
    evaluar: (e: EntradaConsejo) => ResultadoConsejo
}

/** dinero y por cientos de los bloques (texto con 2 decimales) a decimal; nunca `number` */
const num = (v: unknown): Dec => dec(v === null || v === undefined ? '0' : String(v))
const suma = (xs: unknown[]) => xs.reduce<Dec>((s, x) => s.plus(num(x)), CERO)

export const CONSEJOS_GT: readonly DefinicionConsejo[] = [
    {
        clave: 'pago_antes_requerimiento',
        titulo: 'Pague lo vencido antes del requerimiento',
        fuente: 'inv. E.2 (Código Tributario, rebaja de la mora y de los intereses)',
        confirmar_contador: true,
        fuentes: ['tablero.vencimientos'],
        evaluar: (e) => {
            const v = e.bloques['tablero.vencimientos']!
            const vencidas = (v.obligaciones as any[]).filter(
                (o) => o.vencida && o.a_pagar !== null && num(o.a_pagar).gt(0),
            )
            if (vencidas.length === 0) return { aplica: false }
            const mora = aTexto(suma(vencidas.map((o) => o.mora_estimada)))
            return {
                aplica: true,
                texto: `Tiene ${vencidas.length} declaración(es) vencida(s) con impuesto por pagar (mora estimada Q${mora} según el tablero). Pagar antes de que la SAT lo requiera rebaja la mora en 85 % y los intereses en 50 %`,
                datos: { vencidas: vencidas.length, mora_estimada: mora },
            }
        },
    },
    {
        clave: 'retenciones_sin_enterar',
        titulo: 'Entere las retenciones',
        fuente: 'inv. E.2; LAT (el gasto con retención no es deducible hasta enterarla)',
        confirmar_contador: true,
        fuentes: ['tablero.vencimientos'],
        evaluar: (e) => {
            const v = e.bloques['tablero.vencimientos']!
            const pendientes = (v.obligaciones as any[]).filter(
                (o) =>
                    String(o.impuesto).startsWith('retenciones_') &&
                    o.a_pagar !== null &&
                    num(o.a_pagar).gt(0),
            )
            if (pendientes.length === 0) return { aplica: false }
            const monto = aTexto(suma(pendientes.map((o) => o.a_pagar)))
            return {
                aplica: true,
                texto: `Hay Q${monto} de retenciones por enterar (${pendientes.map((o) => o.nombre).join(', ')}). El gasto de las compras con retención no es deducible hasta enterarla`,
                datos: { declaraciones: pendientes.length, a_pagar: monto },
            }
        },
    },
    {
        clave: 'iso_por_vencer',
        titulo: 'ISO por vencer sin acreditar',
        fuente: 'inv. A.4 (Ley ISO: acreditable al ISR en los 3 años siguientes)',
        confirmar_contador: true,
        fuentes: ['tablero.isr'],
        evaluar: (e) => {
            const anual = e.bloques['tablero.isr']!.anual
            if (!anual) return { aplica: false, no_aplica: `regimen_${e.regimen}` }
            if (!num(anual.totales?.iso_por_vencer).gt(0)) return { aplica: false }
            return {
                aplica: true,
                texto: `Q${anual.totales.iso_por_vencer} de ISO vencen este año sin acreditar al ISR: en el cierre anual pasarán a gasto (5.3.03)`,
                datos: { iso_por_vencer: anual.totales.iso_por_vencer },
            }
        },
    },
    {
        clave: 'forma_pago_trimestral',
        titulo: 'Forma del pago trimestral del ISR según su margen',
        fuente: 'inv. A.2 (LAT, art. 38: renta presunta o cierres parciales; cambiarla exige autorización de la SAT)',
        confirmar_contador: true,
        fuentes: ['comparador.datos'],
        evaluar: (e) => {
            if (e.regimen !== 'utilidades') return { aplica: false, no_aplica: `regimen_${e.regimen}` }
            const metodo = e.parametro('isr_trimestral_metodo')
            const presunta = num(e.parametro('isr_trimestral_presunta'))
            // sin ventas en los meses leídos el margen no dice nada
            if (!num(e.bloques['comparador.datos']!.ventas_sin_iva).gt(0)) return { aplica: false }
            const margen = num(e.bloques['comparador.datos']!.margen_fiscal)
            const conviene =
                metodo === 'renta_presunta' && margen.lt(presunta)
                    ? 'cierre_parcial'
                    : metodo === 'cierre_parcial' && margen.gt(presunta)
                      ? 'renta_presunta'
                      : null
            if (!conviene) return { aplica: false }
            return {
                aplica: true,
                texto: `Su margen fiscal de los últimos meses es ${aTexto(margen)} % y la renta presunta es ${aTexto(presunta)} %: con ${conviene === 'cierre_parcial' ? 'cierres parciales' : 'renta presunta'} los pagos trimestrales serían menores. Cambiar la forma exige autorización de la SAT`,
                datos: {
                    margen_fiscal: aTexto(margen),
                    renta_presunta: aTexto(presunta),
                    metodo: String(metodo),
                    sugerido: conviene,
                },
            }
        },
    },
    {
        clave: 'regimen_simulado',
        titulo: 'El otro régimen pagaría menos según la simulación',
        fuente: 'inv. E.1 (comparador de regímenes)',
        confirmar_contador: true,
        fuentes: ['comparador.comparacion'],
        evaluar: (e) => {
            const c = e.bloques['comparador.comparacion']!
            if (e.regimen !== 'utilidades' && e.regimen !== 'opcional_simplificado') {
                return { aplica: false, no_aplica: `regimen_${e.regimen}` }
            }
            if (c.menor === 'iguales' || c.menor === e.regimen) return { aplica: false }
            const diferencia = aTexto(num(c.diferencia).abs())
            return {
                aplica: true,
                texto: `Con sus datos de los últimos meses el régimen ${c.menor === 'utilidades' ? 'sobre utilidades' : 'opcional simplificado'} pagaría Q${diferencia} menos de ISR al año (margen ${c.margen_fiscal} %, equilibrio ${c.margen_equilibrio ?? '—'} %). Es una simulación: el cambio se avisa a la SAT en diciembre y rige el 1 de enero; el sistema no lo hace`,
                datos: {
                    menor: c.menor,
                    diferencia,
                    margen_fiscal: c.margen_fiscal,
                    margen_equilibrio: c.margen_equilibrio,
                },
            }
        },
    },
    {
        clave: 'limite_pequeno',
        titulo: 'Cerca del límite del pequeño contribuyente',
        fuente: 'inv. A.3 (Ley IVA, art. 45)',
        confirmar_contador: false,
        fuentes: ['tablero.pequeno_contribuyente'],
        evaluar: (e) => {
            const p = e.bloques['tablero.pequeno_contribuyente']!
            if (p.umbral_alcanzado === null) return { aplica: false }
            return {
                aplica: true,
                texto: p.supera_limite
                    ? `Facturó Q${p.acumulado} este año y superó el límite de Q${p.limite}: debe pasar al régimen general`
                    : `Facturó Q${p.acumulado} este año (${p.porcentaje} % del límite de Q${p.limite}): planifique el paso al régimen general si lo supera`,
                datos: { acumulado: p.acumulado, limite: p.limite, porcentaje: p.porcentaje },
            }
        },
    },
    {
        clave: 'libros_atrasados',
        titulo: 'Emita los libros atrasados',
        fuente: 'inv. B.1 y E.2 (Código Tributario, art. 94: multa por libros atrasados)',
        confirmar_contador: true,
        fuentes: ['tablero.libros'],
        evaluar: (e) => {
            const l = e.bloques['tablero.libros']!
            const atrasados = (l.libros as any[]).filter((x) => !x.al_dia)
            if (atrasados.length === 0) return { aplica: false }
            return {
                aplica: true,
                texto: `Libros con meses sin emitir fuera del plazo de ${l.ventana_meses} meses: ${atrasados.map((x) => `${x.libro} (${x.meses_atrasados})`).join(', ')}. Emítalos con folio para evitar la multa`,
                datos: { libros: atrasados.length },
            }
        },
    },
    {
        clave: 'fel_desactivada',
        titulo: 'Active la FEL',
        fuente: 'inv. C (SAT: la FEL es obligatoria)',
        confirmar_contador: false,
        fuentes: ['tablero.fel'],
        evaluar: (e) => {
            const f = e.bloques['tablero.fel']!
            if (!f.alerta) return { aplica: false }
            return { aplica: true, texto: f.alerta, datos: { modo: f.modo } }
        },
    },
]

/** Consejos del paquete por país (hoy solo GT). */
export const CONSEJOS_POR_PAIS: Readonly<Record<string, readonly DefinicionConsejo[]>> = { GT: CONSEJOS_GT }
