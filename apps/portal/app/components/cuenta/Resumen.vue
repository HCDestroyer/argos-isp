<script setup lang="ts">
/**
 * Encabezado compacto de `/cuenta`: saludo, total pendiente y el estado más urgente de los
 * servicios, con el botón "Actualizar" (la alternativa de un toque a jalar para actualizar).
 * Todo se encoge sin scroll horizontal: el nombre se recorta y el monto nunca se parte.
 */
const props = defineProps<{
    nombre: string
    montoAdeudado: string
    estado: EstadoServicio | null
    actualizando: boolean
}>()

const emit = defineEmits<{
    actualizar: []
}>()
</script>

<template>
    <UCard
        :ui="{ body: 'p-3 sm:p-4' }"
        data-testid="resumen-cuenta"
    >
        <div class="flex items-center gap-3">
            <div class="min-w-0 flex-1">
                <p class="truncate text-xs text-muted">
                    Hola, <span class="font-medium text-default">{{ props.nombre }}</span>
                </p>
                <p class="flex flex-wrap items-baseline gap-x-2">
                    <span class="text-xs text-muted">Total pendiente</span>
                    <span
                        class="text-2xl font-semibold tracking-[-0.02em] whitespace-nowrap tabular-nums text-highlighted"
                        data-testid="saldo-cuenta"
                    >{{ formatearQuetzales(props.montoAdeudado) }}</span>
                </p>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1">
                <EstadoServicioBadge
                    v-if="props.estado"
                    :estado="props.estado"
                    size="sm"
                />
                <UButton
                    :icon="props.actualizando ? undefined : 'i-lucide-refresh-cw'"
                    :loading="props.actualizando"
                    :label="props.actualizando ? 'Actualizando…' : 'Actualizar'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    data-testid="actualizar-cuenta"
                    @click="emit('actualizar')"
                />
            </div>
        </div>
        <span
            class="sr-only"
            role="status"
        >{{ props.actualizando ? 'Actualizando tu cuenta' : '' }}</span>
    </UCard>
</template>
