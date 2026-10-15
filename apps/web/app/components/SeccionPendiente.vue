<script setup lang="ts">
/**
 * Placeholder de una sección del panel mientras A4 construye la pantalla.
 * Reemplaza el uso de este componente en la página cuando la pantalla exista.
 */
const props = defineProps<{
    seccion: string
}>()

const datos = computed(() => obtenerSeccion(props.seccion))
</script>

<template>
    <PanelPagina
        :id="datos.id"
        :titulo="datos.etiqueta"
        :icono="datos.icono"
    >
        <UPageCard
            variant="subtle"
            class="mx-auto w-full max-w-2xl"
        >
            <UEmpty
                :icon="datos.icono"
                :title="`${datos.etiqueta}: pantalla en construcción`"
                :description="datos.descripcion"
                variant="naked"
            >
                <template #footer>
                    <UBadge
                        :label="`Permiso: ${datos.permiso}`"
                        color="neutral"
                        variant="outline"
                        icon="i-lucide-lock"
                    />
                </template>
            </UEmpty>
        </UPageCard>
    </PanelPagina>
</template>
