<script setup lang="ts">
/**
 * Tarjeta de acceso a una sección (índices como Configuración): icono en pastilla del primario,
 * título y descripción corta; toda la tarjeta es el enlace. Compacta, para listas de 3 columnas.
 */
defineProps<{
    titulo: string
    descripcion?: string
    icono: string
    to: string
}>()
</script>

<template>
    <ULink
        :to="to"
        class="tarjeta-interactiva flex items-start gap-3 surface-card p-4"
    >
        <span class="pastilla-icono tono-marca pastilla-tono">
            <UIcon
                :name="icono"
                class="size-5"
            />
        </span>
        <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-sm font-semibold text-highlighted">{{ titulo }}</span>
            <span
                v-if="descripcion"
                class="line-clamp-2 text-xs text-muted"
            >{{ descripcion }}</span>
        </span>
    </ULink>
</template>
