<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Rechazo al editar o migrar redes, bloques y pools: título en lenguaje simple, qué hacer y la lista
 * de direcciones o servicios afectados (`errors[]`). Otros errores, como `ProblemaAlerta`.
 */
const props = defineProps<{
    problema: Problem
}>()

const rechazo = computed(() => {
    const codigo = codigoProblema(props.problema)
    return codigo ? (RECHAZOS_POOLS[codigo] ?? null) : null
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
