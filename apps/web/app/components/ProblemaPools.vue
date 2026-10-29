<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Rechazo con código conocido (pools, script de conexión): título en lenguaje simple, qué hacer y la
 * lista de lo afectado (`errors[]`). Otros errores, como `ProblemaAlerta`.
 */
const props = withDefaults(defineProps<{
    problema: Problem
    /** Títulos y ayudas por código (por defecto, los de pools; el script de conexión trae los suyos). */
    rechazos?: Record<string, { titulo: string, ayuda: string }>
}>(), {
    rechazos: () => RECHAZOS_POOLS,
})

const rechazo = computed(() => {
    const codigo = codigoProblema(props.problema)
    return codigo ? (props.rechazos[codigo] ?? null) : null
})
const lista = computed(() => (props.problema.errors ?? []).map(e => e.message).filter(Boolean))
</script>

<template>
    <UAlert
        v-if="rechazo"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="rechazo.titulo"
        data-prueba="problema-pools"
    >
        <template #description>
            <p>{{ rechazo.ayuda }}</p>
            <p
                v-if="problema.detail"
                class="mt-1 text-xs"
            >
                {{ problema.detail }}
            </p>
            <ul
                v-if="lista.length"
                class="mt-1 max-h-48 list-disc overflow-y-auto ps-4 font-mono text-xs"
            >
                <li
                    v-for="(linea, indice) in lista.slice(0, 50)"
                    :key="indice"
                >
                    {{ linea }}
                </li>
            </ul>
            <p
                v-if="lista.length > 50"
                class="mt-1 text-xs"
            >
                Y {{ lista.length - 50 }} más.
            </p>
        </template>
    </UAlert>
    <ProblemaAlerta
        v-else
        :problema="problema"
        con-errores
    />
</template>
