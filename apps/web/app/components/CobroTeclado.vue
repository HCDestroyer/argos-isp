<script setup lang="ts">
/**
 * Teclado en pantalla del cobro (tablero NuevoCobro): números, punto y borrar. El teclado físico
 * también funciona (números, punto, Retroceso, Tab y Enter); lo maneja la página.
 */
const emit = defineEmits<{ tecla: [tecla: string] }>()

const TECLAS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫']
</script>

<template>
    <div
        class="grid grid-cols-3 gap-2"
        role="group"
        aria-label="Teclado numérico"
        data-prueba="teclado-cobro"
    >
        <UButton
            v-for="tecla in TECLAS"
            :key="tecla"
            color="neutral"
            variant="outline"
            :icon="tecla === '⌫' ? 'i-lucide-delete' : undefined"
            :label="tecla === '⌫' ? undefined : tecla"
            :aria-label="tecla === '⌫' ? 'Borrar' : tecla === '.' ? 'Punto' : tecla"
            class="h-13 justify-center rounded-xl bg-(--ax-tarjeta) text-xl font-semibold tabular-nums"
            :data-tecla="tecla"
            @click="emit('tecla', tecla)"
        />
    </div>
</template>
