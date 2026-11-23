<script setup lang="ts">
/**
 * Tarjeta «isla» de Finanzas (tableros Conta*): arriba las pestañas segmentadas y las herramientas
 * (buscador y filtros) en una sola fila; en medio el contenido, que se desplaza dentro de la
 * tarjeta y nunca en la página; abajo una nota corta con su ícono (`#pie`) y un dato a la derecha
 * (`#pie-derecha`). `#lateral` es la columna de la derecha dentro de la misma tarjeta (detalle del
 * asiento, cuentas por pagar). Con `llenar` (dentro de `ContaCuerpo`), en escritorio ocupa el alto
 * que queda en la pantalla.
 */
withDefaults(defineProps<{
    llenar?: boolean
    /** Ancho de la columna lateral en escritorio. */
    anchoLateral?: string
}>(), {
    llenar: false,
    anchoLateral: 'lg:w-[26rem]',
})

const slots = defineSlots<{
    'cabecera'?: () => unknown
    'herramientas'?: () => unknown
    'default'?: () => unknown
    'lateral'?: () => unknown
    'pie'?: () => unknown
    'pie-derecha'?: () => unknown
}>()
</script>

<template>
    <section
        class="surface-card flex min-w-0 flex-col overflow-hidden rounded-[1.375rem]"
        :class="llenar ? 'lg:min-h-0 lg:flex-1' : ''"
        data-prueba="isla-conta"
    >
        <div
            v-if="slots.cabecera || slots.herramientas"
            class="flex flex-col gap-3 border-b border-(--ax-borde) p-3 sm:p-4 xl:flex-row xl:items-center xl:justify-between"
        >
            <div class="min-w-0">
                <slot name="cabecera" />
            </div>
            <div
                v-if="slots.herramientas"
                class="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end"
            >
                <slot name="herramientas" />
            </div>
        </div>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
            <div class="min-h-0 min-w-0 flex-1 overflow-auto">
                <slot />
            </div>
            <aside
                v-if="slots.lateral"
                class="min-h-0 shrink-0 overflow-auto border-t border-(--ax-borde) lg:border-t-0 lg:border-l"
                :class="anchoLateral"
            >
                <slot name="lateral" />
            </aside>
        </div>
        <div
            v-if="slots.pie || slots['pie-derecha']"
            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-(--ax-borde) px-4 py-2.5 text-xs text-muted"
        >
            <p class="flex min-w-0 items-start gap-2">
                <UIcon
                    name="i-lucide-info"
                    class="mt-px size-3.5 shrink-0"
                />
                <span><slot name="pie" /></span>
            </p>
            <span
                v-if="slots['pie-derecha']"
                class="tabular-nums"
            ><slot name="pie-derecha" /></span>
        </div>
    </section>
</template>
