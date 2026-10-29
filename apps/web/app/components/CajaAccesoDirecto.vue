<script setup lang="ts">
/**
 * Acceso directo a la caja en la barra superior, con el estado de la caja del usuario (abierta o
 * cerrada) en icono, texto y color. Solo con `cajas.ver`; no aparece en la propia página de caja.
 */
const { puede } = usePermisos()
const route = useRoute()
const miCaja = useMiCaja()

const visible = computed(() => puede('cajas.ver') && route.path !== '/caja')
const abierta = computed(() => miCaja.abierta.value !== null)
const conCaja = computed(() => miCaja.propias.value.length > 0 || abierta.value)

const texto = computed(() => {
    if (miCaja.cajas.value === null) {
        return 'Caja'
    }
    return abierta.value ? 'Caja abierta' : conCaja.value ? 'Caja cerrada' : 'Caja'
})

onMounted(() => {
    if (visible.value) {
        void miCaja.cargar()
    }
})
</script>

<template>
    <UButton
        v-if="visible"
        to="/caja"
        :icon="abierta ? 'i-lucide-lock-open' : 'i-lucide-wallet'"
        :label="texto"
        :color="abierta ? 'success' : 'neutral'"
        :variant="abierta ? 'soft' : 'outline'"
        :aria-label="abierta ? `${texto}: ${miCaja.abierta.value?.nombre}` : texto"
        :ui="{ label: 'hidden md:inline' }"
        data-prueba="acceso-caja"
    />
</template>
