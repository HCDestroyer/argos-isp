<script setup lang="ts">
/**
 * Tarjeta de sección de las fichas de Red y del servicio (tableros RedRouterFicha y
 * OperServicioFicha): ícono y título en versalitas, una marca opcional, la acción a la derecha
 * (`#accion`, un enlace corto) y el contenido. El título es el nombre accesible de la sección.
 */
withDefaults(defineProps<{
    titulo: string
    icono: string
    /** Marca junto al título (por ejemplo «nuevo» o un contador). */
    marca?: string
    /** Sin relleno en el cuerpo (listas que llegan al borde). */
    pegado?: boolean
}>(), {
    marca: undefined,
    pegado: false,
})

const id = useId()
const tituloId = computed(() => `red-tarjeta-${id}`)
</script>

<template>
    <section
        class="flex min-w-0 flex-col rounded-2xl border border-(--ax-borde) bg-(--ax-tarjeta)"
        :aria-labelledby="tituloId"
    >
        <header class="flex min-h-12 items-center justify-between gap-2 px-4 pt-3.5 pb-2">
            <h2
                :id="tituloId"
                class="flex min-w-0 items-center gap-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase"
            >
                <UIcon
                    :name="icono"
                    class="size-4 shrink-0"
                />
                <span class="truncate">{{ titulo }}</span>
                <UBadge
                    v-if="marca"
                    :label="marca"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    class="rounded-full normal-case tracking-normal"
                />
            </h2>
            <div
                v-if="$slots.accion"
                class="flex shrink-0 items-center gap-1"
            >
                <slot name="accion" />
            </div>
        </header>
        <div
            class="flex min-w-0 flex-1 flex-col"
            :class="pegado ? 'pb-2' : 'gap-3 px-4 pb-4'"
        >
            <slot />
        </div>
    </section>
</template>
