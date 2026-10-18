<script setup lang="ts">
const { conSelector } = useEmpresaActiva()

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
            <!-- Un solo nodo raíz: la fila del selector (teléfono) aparece y desaparece sin mover la barra. -->
            <div class="flex shrink-0 flex-col">
                <UDashboardNavbar
                    :title="titulo"
                    :icon="icono"
                    class="chrome-material"
                >
                    <template #leading>
                        <UDashboardSidebarCollapse />
                    </template>

                    <template #right>
                        <SelectorEmpresa class="hidden sm:flex" />
                        <slot name="acciones" />
                        <UColorModeButton />
                    </template>
                </UDashboardNavbar>
                <!-- En el teléfono el selector de empresa va en su propia fila, bajo la barra. -->
                <UDashboardToolbar
                    v-show="conSelector"
                    class="chrome-material sm:hidden"
                >
                    <SelectorEmpresa class="w-full" />
                </UDashboardToolbar>
            </div>
        </template>

        <template #body>
            <slot />
        </template>
    </UDashboardPanel>
</template>
