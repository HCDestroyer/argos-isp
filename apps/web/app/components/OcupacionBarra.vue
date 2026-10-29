<script setup lang="ts">
/**
 * Ocupación de una red IPv4 o de un pool IPv6 (`OcupacionPool`): barra con porcentaje y su estado
 * en icono + texto + color, y cuántas hay en uso, libres y reservadas.
 */
const props = withDefaults(defineProps<{
    ocupacion: OcupacionPool
    /** «IP» en redes, «prefijos» en pools. */
    unidad?: string
}>(), {
    unidad: 'IP',
})

const estado = computed(() => estadoOcupacion(props.ocupacion.porcentaje))
const disponibles = computed(() => props.ocupacion.asignadas + props.ocupacion.libres)
</script>

<template>
    <div
        class="flex min-w-40 flex-col gap-1"
        data-prueba="ocupacion"
    >
        <UProgress
            :model-value="Math.min(100, ocupacion.porcentaje)"
            :color="estado.color"
            size="sm"
            :aria-label="`Ocupación: ${ocupacion.porcentaje}%`"
        />
        <p class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span
                class="flex items-center gap-1 font-medium"
                :class="{ 'text-success': estado.color === 'success', 'text-warning': estado.color === 'warning', 'text-error': estado.color === 'error' }"
            >
                <UIcon
                    :name="estado.icono"
                    class="size-3.5 shrink-0"
                />
                {{ ocupacion.porcentaje.toLocaleString('es-GT') }} % · {{ estado.etiqueta }}
            </span>
            <span class="text-muted tabular-nums">
                {{ ocupacion.asignadas.toLocaleString('es-GT') }} de {{ disponibles.toLocaleString('es-GT') }} {{ unidad }} en uso<template v-if="ocupacion.reservadas"> · {{ ocupacion.reservadas.toLocaleString('es-GT') }} reservadas</template>
            </span>
        </p>
    </div>
</template>
