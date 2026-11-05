<script setup lang="ts">
/**
 * Sección del módulo de routers: la misma tarjeta, encabezado (icono, título y descripción) y
 * espaciado en la ficha, la lista y la migración. Las acciones de la sección van en `acciones`.
 */
withDefaults(defineProps<{
    titulo: string
    icono: string
    descripcion?: string
    /** id del título, para `aria-labelledby`. */
    idTitulo: string
}>(), {
    descripcion: undefined,
})
</script>

<template>
    <section
        class="surface-card flex flex-col gap-4 p-4 sm:p-6"
        :aria-labelledby="idTitulo"
    >
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex min-w-0 flex-col gap-1">
                <h2
                    :id="idTitulo"
                    class="flex items-center gap-2 text-base font-semibold text-highlighted"
                >
                    <UIcon
                        :name="icono"
                        class="size-5 shrink-0 text-primary"
                    />
                    {{ titulo }}
                </h2>
                <p
                    v-if="descripcion || $slots.descripcion"
                    class="text-sm text-muted"
                >
                    <slot name="descripcion">
                        {{ descripcion }}
                    </slot>
                </p>
            </div>
            <div
                v-if="$slots.acciones"
                class="flex flex-wrap gap-2"
            >
                <slot name="acciones" />
            </div>
        </div>
        <slot />
    </section>
</template>
