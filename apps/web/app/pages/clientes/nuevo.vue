<script setup lang="ts">
definePageMeta({ permiso: 'clientes.crear' })

useHead({ title: 'Nuevo cliente · ArgosIsp' })

const toast = useToast()
const { puede, destinoPermitido } = usePermisos()

async function alGuardar(cliente: Cliente) {
    toast.add({
        title: 'Cliente creado',
        description: cliente.nombre,
        color: 'success',
        icon: 'i-lucide-circle-check',
        actions: puede('servicios.crear')
            ? [{ label: 'Agregar servicio', to: `/clientes/${cliente.id}?tab=servicios&nuevo_servicio=1`, color: 'neutral', variant: 'outline' }]
            : undefined,
    })
    await navigateTo(destinoPermitido(`/clientes/${cliente.id}`))
}
</script>

<template>
    <PanelPagina
        id="cliente-nuevo"
        titulo="Nuevo cliente"
        icono="i-lucide-user-plus"
    >
        <ClienteFormulario
            @guardado="alGuardar"
            @cancelar="navigateTo(destinoPermitido('/clientes'))"
        />
    </PanelPagina>
</template>
