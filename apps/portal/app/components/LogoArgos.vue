<script setup lang="ts">
/**
 * Logo de ArgosIsp: ojo con pupila-nodo y tres arcos de señal (viewBox 64, geometría del video
 * de presentación). SVG en línea: sin petición extra en `/corte`.
 *
 * - `marca`: trazo blanco sobre el cuadro teal 700 con radio 7/32 (igual en claro y oscuro).
 *   Tamaño mínimo 16 px. Es la misma figura que `public/favicon.svg`: si cambia una, cambia la otra.
 * - `linea`: solo trazos en `currentColor`, para tamaños grandes (p. ej. `text-primary`).
 *
 * Decorativo por defecto (`aria-hidden`): el nombre va siempre en texto al lado.
 */
withDefaults(defineProps<{
    variante?: 'marca' | 'linea'
}>(), {
    variante: 'marca',
})
</script>

<template>
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
        data-testid="logo-argos"
    >
        <rect
            v-if="variante === 'marca'"
            width="64"
            height="64"
            rx="14"
            class="fill-(--ui-color-primary-700)"
        />
        <g
            fill="none"
            :stroke="variante === 'marca' ? 'white' : 'currentColor'"
            :stroke-width="variante === 'marca' ? 4.2 : 3.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            :transform="variante === 'marca' ? 'translate(32 32) scale(.78) translate(-32 -31.9)' : undefined"
        >
            <path d="M5 42C14.5 27 49.5 27 59 42C49.5 57 14.5 57 5 42Z" />
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
            <path d="M22.75 25.98A18.5 18.5 0 0 1 41.25 25.98" />
            <path d="M19.12 20.57A25 25 0 0 1 44.88 20.57" />
            <path d="M15.31 15.29A31.5 31.5 0 0 1 48.69 15.29" />
        </g>
    </svg>
</template>
