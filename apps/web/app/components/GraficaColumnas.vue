<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Columnas por categoría (meses), agrupadas o apiladas, en SVG propio: sin librería de gráficas
 * (Nuxt UI v4 no trae `UChart` y así el panel no carga ~70 KB de Chart.js). Sigue la guía de
 * gráficas: columnas de 24 px como máximo con el extremo redondeado y la base recta, 2 px de aire
 * entre columnas y segmentos, rejilla de 1 px, leyenda con 2 o más series, tooltip por mes con
 * todas las series (también con teclado) y la misma información en una tabla.
 */
const props = withDefaults(defineProps<{
    titulo: string
    /** Etiqueta corta de cada categoría en el eje (p. ej. `oct`). */
    categorias: string[]
    /** Etiqueta larga para tooltip y tabla (p. ej. `octubre 2026`); por defecto la corta. */
    categoriasLargas?: string[]
    series: SerieGrafica[]
    apilada?: boolean
    escala?: EscalaColor
    formato?: FormatoGrafica
    alto?: number
    /** Frase con el hallazgo principal, encima de la gráfica (y su descripción accesible). */
    hallazgo?: string
}>(), {
    categoriasLargas: undefined,
    hallazgo: undefined,
    apilada: false,
    escala: 'categorica',
    formato: 'quetzales',
    alto: 240,
})

const MARGEN = { arriba: 8, derecha: 4, abajo: 24 }
const ANCHO_MAX_COLUMNA = 24
const AIRE = 2

const colorMode = useColorMode()
/** Tema de la paleta: se re-tematiza al cambiar claro/oscuro sin recargar datos. */
const modo = computed<ChartMode>(() => (colorMode.value === 'dark' ? 'dark' : 'light'))
const tinta = computed(() => CHART_INK[modo.value])
const idHallazgo = useId()

function color(indice: number): string {
    return colorSerie(props.escala, indice, modo.value)
}

const contenedor = useTemplateRef<HTMLDivElement>('contenedor')
const ancho = ref(0)
const enfocada = ref<number | null>(null)
const verTabla = ref(false)
let observador: ResizeObserver | undefined

onMounted(() => {
    if (!contenedor.value) {
        return
    }
    ancho.value = contenedor.value.clientWidth
    observador = new ResizeObserver(([entrada]) => {
        ancho.value = entrada?.contentRect.width ?? 0
    })
    observador.observe(contenedor.value)
})
onBeforeUnmount(() => observador?.disconnect())

const largas = computed(() => props.categoriasLargas ?? props.categorias)
const marcas = computed(() => marcasEje(maximoGrafica(props.series, props.categorias.length, props.apilada), 4, props.formato === 'entero'))
const tope = computed(() => marcas.value.at(-1) ?? new Decimal(1))
const margenIzquierdo = computed(() => Math.max(28, ...marcas.value.map(m => etiquetaCompacta(m, props.formato).length * 6.5 + 8)))
const areaAncho = computed(() => Math.max(0, ancho.value - margenIzquierdo.value - MARGEN.derecha))
const areaAlto = computed(() => props.alto - MARGEN.arriba - MARGEN.abajo)
const banda = computed(() => (props.categorias.length ? areaAncho.value / props.categorias.length : 0))
/** Con poco espacio, una etiqueta del eje X sí y otra no. */
const saltoEtiquetas = computed(() => (banda.value < 30 ? 2 : 1))

function y(valor: Decimal): number {
    return MARGEN.arriba + areaAlto.value - valor.div(tope.value).times(areaAlto.value).toNumber()
}

interface Marca {
    serie: number
    trayecto: string
}

const columnas = computed(() => props.categorias.map((_, i) => {
    const x0 = margenIzquierdo.value + banda.value * i
    const n = props.series.length
    const marcasCategoria: Marca[] = []
    if (props.apilada) {
        const anchoColumna = Math.min(ANCHO_MAX_COLUMNA, banda.value * 0.6)
        const x = x0 + (banda.value - anchoColumna) / 2
        let acumulado = new Decimal(0)
        const visibles = props.series.map((s, indice) => ({ indice, valor: aDecimal(s.valores[i]) ?? new Decimal(0) })).filter(v => v.valor.gt(0))
        visibles.forEach((v, orden) => {
            const base = y(acumulado)
            acumulado = acumulado.plus(v.valor)
            const arriba = y(acumulado)
            // 2 px de aire entre segmentos: cada uno (salvo el de abajo) cede 2 px en su base.
            const alto = base - arriba - (orden > 0 ? AIRE : 0)
            marcasCategoria.push({ serie: v.indice, trayecto: trayectoColumna(x, arriba, anchoColumna, alto, orden === visibles.length - 1) })
        })
    }
    else {
        const anchoColumna = Math.max(1, Math.min(ANCHO_MAX_COLUMNA, (banda.value * 0.7 - AIRE * (n - 1)) / Math.max(n, 1)))
        const grupo = anchoColumna * n + AIRE * (n - 1)
        const xInicio = x0 + (banda.value - grupo) / 2
        props.series.forEach((s, indice) => {
            const valor = aDecimal(s.valores[i])
            if (valor === null || valor.lte(0)) {
                return
            }
            const arriba = y(valor)
            marcasCategoria.push({ serie: indice, trayecto: trayectoColumna(xInicio + indice * (anchoColumna + AIRE), arriba, anchoColumna, MARGEN.arriba + areaAlto.value - arriba) })
        })
    }
    return { x0, marcas: marcasCategoria }
}))

const totales = computed(() => totalesPorCategoria(props.series, props.categorias.length))

function descripcionCategoria(i: number): string {
    const partes = props.series.map(s => `${s.nombre}: ${etiquetaValor(s.valores[i], props.formato)}`)
    if (props.apilada) {
        partes.push(`Total: ${etiquetaValor(totales.value[i]?.toFixed(2) ?? null, props.formato)}`)
    }
    return `${largas.value[i] ?? ''}. ${partes.join(', ')}`
}

/** Posición del tooltip: junto a la columna, sin salirse del contenedor. */
const estiloTooltip = computed(() => {
    if (enfocada.value === null) {
        return undefined
    }
    const centro = margenIzquierdo.value + banda.value * (enfocada.value + 0.5)
    const derecha = centro > ancho.value / 2
    return derecha
        ? { right: `${Math.max(0, ancho.value - centro + 12)}px`, top: '0px' }
        : { left: `${centro + 12}px`, top: '0px' }
})

interface FilaTabla {
    categoria: string
    valores: string[]
    total: string
}

const filasTabla = computed<FilaTabla[]>(() => props.categorias.map((_, i) => ({
    categoria: largas.value[i] ?? '',
    valores: props.series.map(s => etiquetaValor(s.valores[i], props.formato)),
    total: etiquetaValor(totales.value[i]?.toFixed(2) ?? null, props.formato),
})))

const columnasTabla = computed<TableColumn<FilaTabla>[]>(() => [
    { accessorKey: 'categoria', header: 'Mes' },
    ...props.series.map((s, indice) => ({
        id: s.id,
        header: s.nombre,
        accessorFn: (fila: FilaTabla) => fila.valores[indice] ?? '—',
        meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } },
    })),
    ...(props.apilada ? [{ accessorKey: 'total', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right tabular-nums font-medium' } } }] : []),
])
</script>

<template>
    <div class="flex flex-col gap-3">
        <p
            v-if="hallazgo"
            :id="idHallazgo"
            class="text-sm text-default"
            data-prueba="hallazgo"
        >
            {{ hallazgo }}
        </p>
        <div class="flex flex-wrap items-center justify-between gap-2">
            <ul
                v-if="series.length > 1"
                class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
                :aria-label="`Leyenda de ${titulo}`"
            >
                <li
                    v-for="(serie, indice) in series"
                    :key="serie.id"
                    class="flex items-center gap-1.5"
                >
                    <span
                        class="inline-block size-2.5 rounded-[2px]"
                        :style="{ backgroundColor: color(indice) }"
                        aria-hidden="true"
                    />
                    {{ serie.nombre }}
                </li>
            </ul>
            <span v-else />
            <UButton
                :label="verTabla ? 'Ver gráfica' : 'Ver tabla'"
                :icon="verTabla ? 'i-lucide-chart-column' : 'i-lucide-table'"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="verTabla = !verTabla"
            />
        </div>

        <UTable
            v-if="verTabla"
            :data="filasTabla"
            :columns="columnasTabla"
            :ui="{
                root: 'rounded-none bg-transparent ring-0 dark:shadow-none',
                td: 'py-1.5 text-xs',
                th: 'py-1.5 text-xs',
            }"
        />

        <div
            v-show="!verTabla"
            ref="contenedor"
            class="relative w-full"
            :style="{ height: `${alto}px` }"
        >
            <svg
                v-if="ancho > 0"
                :width="ancho"
                :height="alto"
                role="img"
                :aria-label="titulo"
                :aria-describedby="hallazgo ? idHallazgo : undefined"
                class="block overflow-visible"
                @pointerleave="enfocada = null"
            >
                <g aria-hidden="true">
                    <template
                        v-for="marca in marcas"
                        :key="marca.toString()"
                    >
                        <line
                            :x1="margenIzquierdo"
                            :x2="ancho - MARGEN.derecha"
                            :y1="y(marca)"
                            :y2="y(marca)"
                            :stroke="marca.isZero() ? tinta.axis : tinta.grid"
                            stroke-width="1"
                            shape-rendering="crispEdges"
                        />
                        <text
                            :x="margenIzquierdo - 6"
                            :y="y(marca)"
                            text-anchor="end"
                            dominant-baseline="middle"
                            :fill="tinta.muted"
                            class="text-[11px] tabular-nums"
                        >{{ etiquetaCompacta(marca, formato) }}</text>
                    </template>
                    <template
                        v-for="(categoria, i) in categorias"
                        :key="`x${i}`"
                    >
                        <text
                            v-if="i % saltoEtiquetas === (categorias.length - 1) % saltoEtiquetas"
                            :x="margenIzquierdo + banda * (i + 0.5)"
                            :y="alto - 6"
                            text-anchor="middle"
                            :fill="tinta.muted"
                            class="text-[11px]"
                        >{{ categoria }}</text>
                    </template>
                </g>

                <g
                    v-for="(columna, i) in columnas"
                    :key="`c${i}`"
                    tabindex="0"
                    role="img"
                    :aria-label="descripcionCategoria(i)"
                    class="outline-none"
                    :data-categoria="i"
                    @pointerenter="enfocada = i"
                    @focus="enfocada = i"
                    @blur="enfocada = null"
                >
                    <rect
                        :x="columna.x0"
                        :y="MARGEN.arriba"
                        :width="banda"
                        :height="areaAlto"
                        :fill="enfocada === i ? 'var(--ui-bg-elevated)' : 'transparent'"
                        :opacity="enfocada === i ? 0.6 : 1"
                    />
                    <path
                        v-for="marca in columna.marcas"
                        :key="marca.serie"
                        :d="marca.trayecto"
                        :fill="color(marca.serie)"
                    />
                </g>
            </svg>

            <div
                v-if="enfocada !== null"
                class="pointer-events-none absolute z-10 min-w-44 whitespace-nowrap rounded-md border border-default bg-default px-3 py-2 text-xs shadow-lg"
                :style="estiloTooltip"
                role="status"
            >
                <p class="mb-1 text-muted">
                    {{ largas[enfocada] }}
                </p>
                <ul class="flex flex-col gap-0.5">
                    <li
                        v-for="(serie, indice) in series"
                        :key="serie.id"
                        class="flex items-center justify-between gap-3"
                    >
                        <span class="flex items-center gap-1.5 text-muted">
                            <span
                                class="inline-block h-0.5 w-3 rounded-full"
                                :style="{ backgroundColor: color(indice) }"
                                aria-hidden="true"
                            />
                            {{ serie.nombre }}
                        </span>
                        <span class="font-semibold tabular-nums text-highlighted">{{ etiquetaValor(serie.valores[enfocada], formato) }}</span>
                    </li>
                    <li
                        v-if="apilada"
                        class="mt-1 flex justify-between gap-3 border-t border-default pt-1"
                    >
                        <span class="text-muted">Total</span>
                        <span class="font-semibold tabular-nums text-highlighted">{{ etiquetaValor(totales[enfocada]?.toFixed(2) ?? null, formato) }}</span>
                    </li>
                </ul>
            </div>
        </div>
    </div>
</template>
