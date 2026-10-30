<script setup lang="ts">
/**
 * Ayuda corta de QoS por clases (`contratos/qos.md` §2 y §3.5): requiere el árbol y FastTrack
 * excluido, y la prioridad solo actúa cuando el plan o el router se llenan.
 */
</script>

<template>
    <UAlert
        color="info"
        variant="subtle"
        icon="i-lucide-info"
        title="Cómo funciona la prioridad por clases"
        data-prueba="qos-ayuda"
    >
        <template #description>
            <ul class="mt-1 flex list-disc flex-col gap-1 pl-5">
                <li
                    v-for="linea in AYUDA_QOS"
                    :key="linea"
                >
                    {{ linea }}
                </li>
            </ul>
        </template>
    </UAlert>
</template>
