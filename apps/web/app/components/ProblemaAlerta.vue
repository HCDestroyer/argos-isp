<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Muestra un error RFC 9457 de la API, con botón de reintento opcional. Úsalo en lugar de los
 * datos que no se pudieron leer, nunca junto a totales o tablas vacías.
 */
const props = withDefaults(defineProps<{
    problema: Problem
    reintentar?: () => void
    /** Pone el botón "Reintentar" en espera mientras se repite la llamada. */
    reintentando?: boolean
    /** Lista también `errors[]` (p. ej. las líneas repetidas de un extracto, 409 `extracto_duplicado`). */
    conErrores?: boolean
}>(), {
    reintentar: undefined,
    reintentando: false,
    conErrores: false,
})

const errores = computed(() => (props.conErrores ? (props.problema.errors ?? []) : []))

const descripcion = computed(() => {
    if (props.problema.detail) {
        return props.problema.detail
    }
    if (props.problema.status === 501) {
        return 'Esta función no está disponible en esta instalación.'
    }
    return undefined
})

const acciones = computed(() => {
    if (!props.reintentar) {
        return undefined
    }
    return [{
        label: 'Reintentar',
        icon: 'i-lucide-rotate-cw',
        color: 'error' as const,
        variant: 'outline' as const,
        loading: props.reintentando,
        onClick: props.reintentar,
    }]
})
</script>

<template>
    <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="problema.title"
        :description="descripcion"
        :actions="acciones"
    >
        <template
            v-if="errores.length"
            #description
        >
            <p v-if="descripcion">
                {{ descripcion }}
            </p>
            <ul
                class="mt-1 list-disc pl-5"
                data-prueba="problema-errores"
            >
                <li
                    v-for="(error, indice) in errores.slice(0, 20)"
                    :key="indice"
                >
                    {{ error.message }}<span
                        v-if="error.field"
                        class="text-dimmed"
                    > ({{ error.field }})</span>
                </li>
            </ul>
            <p
                v-if="errores.length > 20"
                class="mt-1"
            >
                y {{ errores.length - 20 }} más.
            </p>
        </template>
    </UAlert>
</template>
