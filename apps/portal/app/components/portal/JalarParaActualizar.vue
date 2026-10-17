<script setup lang="ts">
/**
 * Indicador de "jalar para actualizar" (`useJalarParaActualizar`). Baja con el dedo, gira la flecha
 * al pasar el umbral y muestra el cargador mientras `actualizando`. Decorativo para el lector de
 * pantalla: el botón "Actualizar" de la pantalla es la alternativa y anuncia el estado.
 */
const props = defineProps<{
    actualizando: boolean
}>()

const emit = defineEmits<{
    actualizar: []
}>()

const { distancia, listo } = useJalarParaActualizar(() => emit('actualizar'))
const visible = computed(() => distancia.value > 4 || props.actualizando)
const desplazamiento = computed(() => props.actualizando ? 56 : distancia.value)
</script>

<template>
    <div
        v-show="visible"
        class="pointer-events-none fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-20 flex justify-center"
        aria-hidden="true"
        data-testid="jalar-para-actualizar"
    >
        <div
            class="glass-material flex size-10 items-center justify-center rounded-full ring ring-default transition-transform duration-150 ease-out"
            :style="{ transform: `translateY(${desplazamiento - 40}px)` }"
        >
            <UIcon
                :name="actualizando ? 'i-lucide-loader-circle' : 'i-lucide-arrow-down'"
                class="size-5 text-primary transition-transform duration-150"
                :class="{ 'animate-spin': actualizando, 'rotate-180': listo && !actualizando }"
            />
        </div>
    </div>
</template>
