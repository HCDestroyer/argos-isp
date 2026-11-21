<script setup lang="ts">
definePageMeta({ permiso: 'sistema.ver_salud' })

useHead({ title: 'Salud del sistema · ArgosIsp' })
</script>

<template>
    <PanelPagina
        id="salud-sistema"
        titulo="Salud del sistema"
        icono="i-lucide-heart-pulse"
    >
        <SaludSistemaTarjeta />
    </PanelPagina>
</template>
