<script setup lang="ts">
/**
 * Avisos de la barra superior: hoy, los comprobantes de pago pendientes de verificar (el mismo
 * contador del menú). Con pendientes, campana con la cifra en pastilla; sin permiso, nada.
 */
const { puede } = usePermisos()
const comprobantes = useComprobantes()

const visible = computed(() => puede('comprobantes.ver'))
const texto = computed(() => textoContador(comprobantes.contador.value))
const etiqueta = computed(() => (texto.value ? `Avisos: ${texto.value} comprobantes por verificar` : 'Avisos: nada pendiente'))
</script>

<template>
    <UChip
        v-if="visible"
        :text="texto"
        :show="Boolean(texto)"
        size="3xl"
        color="primary"
        inset
    >
        <!-- Sin UTooltip: va en la barra de todas las pantallas y las pruebas las montan sin UApp. -->
        <UButton
            to="/comprobantes"
            icon="i-lucide-bell"
            color="neutral"
            variant="ghost"
            :title="texto ? 'Comprobantes por verificar' : 'Nada pendiente de verificar'"
            :aria-label="etiqueta"
            data-prueba="avisos"
        />
    </UChip>
</template>
