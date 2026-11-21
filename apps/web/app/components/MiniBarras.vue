<script setup lang="ts">
import Decimal from 'decimal.js'

/**
 * Mini gráfica de barras de una tarjeta KPI (los últimos meses de una serie), en el tono de la
 * tarjeta (`--tono`). Decorativa: la cifra y la tendencia van en texto al lado y la gráfica
 * completa con su tabla vive en el tablero.
 */
const props = defineProps<{
    valores: readonly (number | string)[]
}>()

const ALTO = 40
const ANCHO_BARRA = 7
const SEPARACION = 4

const barras = computed(() => {
    const decimales = props.valores.map(valor => new Decimal(valor))
    const maximo = Decimal.max(1, ...decimales)
    return decimales.map((valor, indice) => {
        const alto = Math.max(3, valor.div(maximo).times(ALTO).toNumber())
        return { x: indice * (ANCHO_BARRA + SEPARACION), y: ALTO - alto, alto, ultima: indice === decimales.length - 1 }
    })
})
const ancho = computed(() => Math.max(1, props.valores.length * (ANCHO_BARRA + SEPARACION) - SEPARACION))
</script>

<template>
    <svg
        :viewBox="`0 0 ${ancho} ${ALTO}`"
        :width="ancho"
        :height="ALTO"
        class="max-w-full shrink-0"
        aria-hidden="true"
        focusable="false"
    >
        <rect
            v-for="(barra, indice) in barras"
            :key="indice"
            :x="barra.x"
            :y="barra.y"
            :width="ANCHO_BARRA"
            :height="barra.alto"
            rx="2"
            class="fill-(--tono) transition-[height,y] duration-500 motion-reduce:transition-none"
            :class="barra.ultima ? '' : 'opacity-45'"
        />
    </svg>
</template>
