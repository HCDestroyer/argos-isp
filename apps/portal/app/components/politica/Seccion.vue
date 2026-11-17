<script setup lang="ts">
/** Sección numerada de una política: título y texto con el estilo de lectura del portal. */
defineProps<{
    titulo: string
}>()
</script>

<template>
    <section class="flex flex-col gap-2">
        <h2 class="text-base font-semibold text-highlighted sm:text-lg">
            {{ titulo }}
        </h2>
        <div class="flex flex-col gap-2 text-sm leading-relaxed text-default [&_li]:pl-1 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">
            <slot />
        </div>
    </section>
</template>
