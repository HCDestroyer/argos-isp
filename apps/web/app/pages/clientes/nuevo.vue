<script setup lang="ts">
definePageMeta({ permiso: 'clientes.crear' })

useHead({ title: 'Nuevo cliente · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()

async function alGuardar(cliente: Cliente) {
    toast.add({
        title: 'Cliente creado',
        description: cliente.nombre,
        color: 'success',
        icon: 'i-lucide-circle-check',
        actions: puede('servicios.crear')
            ? [{ label: 'Agregar servicio', to: `/servicios/nuevo?cliente=${cliente.id}`, color: 'neutral', variant: 'outline' }]
            : undefined,
    })
    await navigateTo(`/clientes/${cliente.id}`)
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
            @cancelar="navigateTo('/clientes')"
        />
    </PanelPagina>
</template>
