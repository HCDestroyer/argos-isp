<script setup lang="ts">
/**
 * Logo de ArgosIsp: ojo con ondas de señal (geometría del video, viewBox de 64).
 * - `marca`: trazo blanco sobre recuadro teal 700 con radio 7/32 (barra lateral, favicon).
 *   El recuadro no cambia de color en oscuro ni por pantalla.
 * - `linea`: solo el trazo en `currentColor`, para tamaños grandes (login).
 * Decorativo por defecto; con `titulo` se anuncia como imagen.
 */
const props = withDefaults(defineProps<{
    variante?: 'marca' | 'linea'
    titulo?: string
}>(), {
    variante: 'marca',
    titulo: undefined,
})

const TRAZOS = [
    'M5 42 C14.5 27 49.5 27 59 42 C49.5 57 14.5 57 5 42 Z',
    'M22.75 25.98 A18.5 18.5 0 0 1 41.25 25.98',
    'M19.12 20.57 A25 25 0 0 1 44.88 20.57',
    'M15.31 15.29 A31.5 31.5 0 0 1 48.69 15.29',
]

const accesible = computed(() => (props.titulo ? { 'role': 'img', 'aria-label': props.titulo } : { 'aria-hidden': 'true' as const }))
</script>

<template>
    <svg
        viewBox="0 0 64 64"
        fill="none"
        v-bind="accesible"
        :data-variante="variante"
    >
        <rect
            v-if="variante === 'marca'"
            width="64"
            height="64"
            rx="14"
            class="fill-(--argos-marca-fondo)"
        />
        <g
            :transform="variante === 'marca' ? 'translate(8 8.09) scale(0.75)' : undefined"
            :stroke-width="variante === 'marca' ? 4.5 : 3.6"
            :class="variante === 'marca' ? 'stroke-(--argos-marca-trazo)' : 'stroke-current'"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path :d="TRAZOS[0]" />
            <circle
                cx="32"
                cy="42"
                r="6.4"
            />
            <circle
                cx="32"
                cy="42"
                r="1.2"
            />
            <path
                v-for="trazo in TRAZOS.slice(1)"
                :key="trazo"
                :d="trazo"
            />
        </g>
    </svg>
</template>
