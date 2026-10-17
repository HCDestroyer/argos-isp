<script setup lang="ts">
/**
 * Estructura común de una página del panel: barra superior con título y cuerpo con scroll.
 * Las acciones de la página van en el slot `acciones`.
 */
withDefaults(defineProps<{
    id: string
    titulo: string
    icono?: string
}>(), {
    icono: undefined,
})
</script>

<template>
    <UDashboardPanel :id="id">
        <template #header>
            <UDashboardNavbar
                :title="titulo"
                :icon="icono"
                class="chrome-material"
            >
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>

                <template #right>
                    <slot name="acciones" />
                    <UColorModeButton />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <slot />
        </template>
    </UDashboardPanel>
</template>
