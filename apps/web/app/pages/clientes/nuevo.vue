<script setup lang="ts">
definePageMeta({ permiso: 'clientes.crear' })

useHead({ title: 'Nuevo cliente · ArgosIsp' })

const toast = useToast()

async function alGuardar(cliente: Cliente) {
    toast.add({
        title: 'Cliente creado',
        description: cliente.nombre,
        color: 'success',
        icon: 'i-lucide-circle-check',
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
