<script setup lang="ts">
/**
 * Aviso del estado en vivo en `/corte`: mientras se consulta `GET /portal/estado`, cuando pasan
 * los 2 min sin ver el servicio activo, y en reposo un botón para que el cliente pida revisar
 * (por ejemplo, después de pagar en caja o en el banco).
 */
withDefaults(defineProps<{
    vigilando?: boolean
    agotado?: boolean
}>(), {
    vigilando: false,
    agotado: false,
})

const emit = defineEmits<{
    revisar: []
}>()
</script>

<template>
    <div
        aria-live="polite"
        data-testid="estado-en-vivo"
    >
        <UAlert
            v-if="vigilando"
            color="info"
            variant="subtle"
            icon="i-lucide-loader-circle"
            title="Revisando tu servicio"
            description="Esta página se actualiza sola en cuanto tu servicio vuelva a estar activo."
            :ui="{ icon: 'animate-spin' }"
        />

        <UAlert
            v-else-if="agotado"
            color="neutral"
            variant="subtle"
            icon="i-lucide-clock"
            title="Aún no vemos tu servicio activo"
            description="Si ya pagaste, puede tardar unos minutos. Revisa de nuevo o comunícate con soporte."
            :actions="[{ label: 'Revisar de nuevo', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => emit('revisar') }]"
        />

        <UButton
            v-else
            label="Ya pagué: revisar mi servicio"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="link"
            block
            @click="emit('revisar')"
        />
    </div>
</template>
