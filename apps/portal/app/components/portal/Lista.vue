<script setup lang="ts">
/**
 * Lista del sistema visual: una tarjeta con cabecera (título, descripción, filtros en pestañas y
 * acciones) y filas `PortalFila` separadas por una línea. Desde 768 px la cabecera de columnas en
 * mayúsculas pequeñas sobre gris la convierte en tabla; en el teléfono cada fila es compacta.
 *
 * Es una lista (`<ul>`): la cabecera de columnas es visual (`aria-hidden`), cada fila se lee sola.
 */
const props = withDefaults(defineProps<{
    titulo?: string
    descripcion?: string
    /** Nivel del título (el de la sección que la contiene). */
    nivel?: 'h2' | 'h3'
    /** Etiquetas de la cabecera de tabla: concepto, monto y estado (escritorio). */
    columnas?: { concepto: string, monto?: string, estado?: string }
}>(), {
    titulo: undefined,
    descripcion: undefined,
    nivel: 'h2',
    columnas: undefined,
})

const idTitulo = useId()
</script>

<template>
    <section
        class="ax-lista"
        :aria-labelledby="props.titulo ? idTitulo : undefined"
    >
        <header
            v-if="props.titulo || $slots.filtros || $slots.acciones"
            class="flex flex-wrap items-center justify-between gap-3 border-b border-(--ax-borde) px-4 py-3 md:px-5"
        >
            <div
                v-if="props.titulo"
                class="min-w-0"
            >
                <component
                    :is="props.nivel"
                    :id="idTitulo"
                    class="text-base font-semibold text-highlighted"
                >
                    {{ props.titulo }}
                </component>
                <p
                    v-if="props.descripcion"
                    class="text-xs text-muted"
                >
                    {{ props.descripcion }}
                </p>
            </div>
            <div
                v-if="$slots.acciones"
                class="flex items-center gap-2"
            >
                <slot name="acciones" />
            </div>
            <div
                v-if="$slots.filtros"
                class="w-full"
            >
                <slot name="filtros" />
            </div>
        </header>
        <div
            v-if="props.columnas"
            class="ax-lista-cabecera ax-grilla"
            aria-hidden="true"
        >
            <span class="ax-a-txt">{{ props.columnas.concepto }}</span>
            <span class="ax-a-monto">{{ props.columnas.monto }}</span>
            <span class="ax-a-est">{{ props.columnas.estado }}</span>
        </div>
        <ul role="list">
            <slot />
        </ul>
    </section>
</template>
