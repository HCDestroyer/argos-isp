<script setup lang="ts">
definePageMeta({ permiso: 'servicios.crear' })

useHead({ title: 'Nuevo servicio · ArgosIsp' })

const route = useRoute()
const { destinoPermitido, enlace } = usePermisos()

const clienteId = Number(route.query.cliente) || undefined

async function alCrear(servicio: Servicio) {
    await navigateTo(destinoPermitido(`/clientes/${servicio.cliente_id}?tab=servicios`))
}

async function alCancelar() {
    await navigateTo(destinoPermitido(clienteId ? `/clientes/${clienteId}?tab=servicios` : '/servicios'))
}
</script>

<template>
    <PanelPagina
        id="servicio-nuevo"
        titulo="Nuevo servicio"
        icono="i-lucide-wifi"
    >
        <template #acciones>
            <UButton
                v-if="clienteId && enlace(`/clientes/${clienteId}`)"
                :to="enlace(`/clientes/${clienteId}`)"
                icon="i-lucide-arrow-left"
                label="Volver al cliente"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div class="mx-auto w-full max-w-5xl">
            <ServicioAltaFormulario
                :cliente-id="clienteId"
                @creado="alCrear"
                @cancelar="alCancelar"
            />
        </div>
    </PanelPagina>
</template>
