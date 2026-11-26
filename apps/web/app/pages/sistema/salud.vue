<script setup lang="ts">
definePageMeta({ permiso: 'sistema.ver_salud' })

useHead({ title: 'Salud del sistema · ArgosIsp' })
</script>

<template>
    <ConfiguracionMarco
        id="salud-sistema"
    >
        <SaludSistemaTarjeta class="bg-transparent! p-0! shadow-none! sm:p-0!" />
    </ConfiguracionMarco>
</template>
