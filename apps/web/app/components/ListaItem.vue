<script setup lang="ts">
/**
 * Fila de una lista del sistema visual Argos (últimos pagos, actividad…): avatar con iniciales
 * tintadas, título y subtítulo gris a la izquierda; valor en negrita y dato secundario a la
 * derecha. Con `to`, la fila entera es el enlace.
 */
withDefaults(defineProps<{
    titulo: string
    subtitulo?: string
    valor?: string
    secundario?: string
    to?: string
    /** Nombre para el avatar; por defecto, el título. Sin avatar con `icono`. */
    avatar?: string
    icono?: string
}>(), {
    subtitulo: undefined,
    valor: undefined,
    secundario: undefined,
    to: undefined,
    avatar: undefined,
    icono: undefined,
})
</script>

<template>
    <li>
        <ULink
            :to="to"
            :as="to ? undefined : 'div'"
            class="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors"
            :class="to ? 'hover:bg-(--ax-fila-hover)' : ''"
        >
            <span
                v-if="icono"
                class="pastilla-icono tono-marca pastilla-tono"
            >
                <UIcon
                    :name="icono"
                    class="size-5"
                />
            </span>
            <AvatarIniciales
                v-else
                :nombre="avatar ?? titulo"
            />
            <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm font-semibold text-highlighted">{{ titulo }}</span>
                <span
                    v-if="subtitulo"
                    class="truncate text-xs text-muted"
                >{{ subtitulo }}</span>
            </span>
            <span
                v-if="valor || secundario || $slots.derecha"
                class="flex shrink-0 flex-col items-end"
            >
                <span
                    v-if="valor"
                    class="text-sm font-bold tabular-nums text-highlighted"
                >{{ valor }}</span>
                <slot name="derecha">
                    <span
                        v-if="secundario"
                        class="text-xs text-muted"
                    >{{ secundario }}</span>
                </slot>
            </span>
        </ULink>
    </li>
</template>
