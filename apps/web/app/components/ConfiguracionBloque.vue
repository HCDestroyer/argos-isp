<script setup lang="ts">
/**
 * Bloque dentro de la tarjeta de una sección de Configuración (tableros OperConfig*): recuadro con
 * borde fino, título corto en versalitas con su icono y, a la derecha, un enlace de acción
 * («Agregar», «Editar», «Ver todo»). Las filas van en el slot; `#pie` para una nota al final.
 */
const props = withDefaults(defineProps<{
    titulo: string
    icono: string
    descripcion?: string
    /** Enlace de la esquina («Agregar», «Abrir»…). */
    accion?: string
    accionA?: string
    tono?: 'normal' | 'aviso'
}>(), {
    descripcion: undefined,
    accion: undefined,
    accionA: undefined,
    tono: 'normal',
})

const emit = defineEmits<{ accion: [] }>()
const slots = useSlots()
</script>

<template>
    <section
        class="flex min-w-0 flex-col gap-1 rounded-2xl border p-4"
        :class="props.tono === 'aviso' ? 'border-warning/40 bg-warning/5' : 'border-(--ax-borde)'"
    >
        <header class="flex items-center justify-between gap-2 pb-1">
            <h2 class="flex min-w-0 items-center gap-2 text-xs font-bold tracking-[0.06em] text-muted uppercase">
                <UIcon
                    :name="props.icono"
                    class="size-4 shrink-0"
                />
                <span class="truncate">{{ props.titulo }}</span>
            </h2>
            <slot name="accion">
                <UButton
                    v-if="props.accion"
                    :label="props.accion"
                    :to="props.accionA"
                    variant="link"
                    size="sm"
                    class="shrink-0 p-0"
                    @click="emit('accion')"
                />
            </slot>
        </header>
        <p
            v-if="props.descripcion"
            class="pb-1 text-sm text-muted"
        >
            {{ props.descripcion }}
        </p>
        <div class="flex min-w-0 flex-col gap-3 has-[>[data-fila-config]]:gap-0">
            <slot />
        </div>
        <div
            v-if="slots.pie"
            class="pt-2 text-xs text-muted"
        >
            <slot name="pie" />
        </div>
    </section>
</template>
