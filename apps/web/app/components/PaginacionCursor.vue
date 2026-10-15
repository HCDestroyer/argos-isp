<script setup lang="ts">
/**
 * Controles de una lista con cursor: la API solo da "siguiente", así que se muestra el número
 * de página y los botones anterior/siguiente (sin total). Va debajo de `UTable`.
 */
withDefaults(defineProps<{
    pagina: number
    hayAnterior: boolean
    haySiguiente: boolean
    cargando?: boolean
    /** Filas en la página actual, para el texto de la izquierda. */
    filas?: number
}>(), {
    cargando: false,
    filas: undefined,
})

const emit = defineEmits<{
    anterior: []
    siguiente: []
}>()
</script>

<template>
    <div class="flex items-center justify-between gap-3 border-t border-default pt-3">
        <p class="text-sm text-muted">
            Página {{ pagina }}<template v-if="filas !== undefined">
                · {{ filas }} {{ filas === 1 ? 'fila' : 'filas' }}
            </template>
        </p>

        <div class="flex gap-2">
            <UButton
                label="Anterior"
                icon="i-lucide-chevron-left"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="!hayAnterior || cargando"
                @click="emit('anterior')"
            />
            <UButton
                label="Siguiente"
                trailing-icon="i-lucide-chevron-right"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="!haySiguiente || cargando"
                @click="emit('siguiente')"
            />
        </div>
    </div>
</template>
