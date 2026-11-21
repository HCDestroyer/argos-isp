<script setup lang="ts">
/**
 * Sección de un formulario en página (sistema visual Argos): en escritorio, título y descripción a
 * la izquierda y los campos a la derecha; en el teléfono, apilados. Va dentro de una tarjeta; varias
 * secciones seguidas se separan con una línea fina.
 */
defineProps<{
    titulo: string
    descripcion?: string
}>()
</script>

<template>
    <!-- Consulta de contenedor: en un panel lateral angosto se apila aunque la pantalla sea ancha. -->
    <section class="@container border-(--ax-borde) not-first:border-t">
        <div class="grid gap-4 p-4 sm:p-6 @3xl:grid-cols-[15rem_minmax(0,1fr)] @3xl:gap-8">
            <div class="flex flex-col gap-1">
                <h2 class="text-sm font-semibold text-highlighted">
                    {{ titulo }}
                </h2>
                <p
                    v-if="descripcion"
                    class="text-xs text-muted"
                >
                    {{ descripcion }}
                </p>
            </div>
            <div class="min-w-0">
                <slot />
            </div>
        </div>
    </section>
</template>
