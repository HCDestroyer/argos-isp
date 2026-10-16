<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Estados comunes de una lista del portal: cargando, error con "Reintentar", vacía y "Ver más".
 * La lista en sí va en el slot por defecto (solo se muestra cuando hay elementos).
 */
const props = withDefaults(defineProps<{
    cargando: boolean
    cargado: boolean
    problema: Problem | null
    vacia: boolean
    hayMas: boolean
    textoVacio: string
    iconoVacio?: string
}>(), {
    iconoVacio: 'i-lucide-inbox',
})

const emit = defineEmits<{
    reintentar: []
    cargarMas: []
}>()

const primeraCarga = computed(() => !props.cargado && props.cargando)
const errorSinDatos = computed(() => props.problema !== null && props.vacia)
</script>

<template>
    <div class="flex flex-col gap-3">
        <template v-if="primeraCarga">
            <USkeleton class="h-20 w-full" />
            <USkeleton class="h-20 w-full" />
        </template>

        <UAlert
            v-else-if="errorSinDatos && problema"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos cargar esta información"
            :description="mensajeProblema(problema)"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => emit('reintentar') }]"
        />

        <UEmpty
            v-else-if="cargado && vacia"
            :icon="iconoVacio"
            :title="textoVacio"
            variant="naked"
        />

        <template v-else>
            <slot />

            <UAlert
                v-if="problema"
                color="error"
                variant="subtle"
                icon="i-lucide-cloud-off"
                :title="mensajeProblema(problema)"
            />

            <UButton
                v-if="hayMas"
                label="Ver más"
                color="neutral"
                variant="outline"
                block
                :loading="cargando"
                @click="emit('cargarMas')"
            />
        </template>
    </div>
</template>
