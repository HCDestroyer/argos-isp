<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

/** Las tres pantallas del ACL, cada una con su permiso: usuarios, roles y permisos, tokens de API. */
const { puede } = usePermisos()

const items = computed<NavigationMenuItem[]>(() => [
    ...(puede('usuarios.ver') ? [{ label: 'Usuarios', icon: 'i-lucide-users', to: '/usuarios', exact: true }] : []),
    ...(puede('roles.ver') ? [{ label: 'Roles y permisos', icon: 'i-lucide-shield', to: '/usuarios/roles' }] : []),
    ...(puede('tokens.ver') ? [{ label: 'Tokens de API', icon: 'i-lucide-key-round', to: '/usuarios/tokens' }] : []),
])
</script>

<template>
    <UNavigationMenu
        v-if="items.length > 1"
        :items="items"
        orientation="horizontal"
        highlight
        :ui="{ linkLabel: 'overflow-visible whitespace-nowrap text-clip' }"
        class="-mx-1 overflow-x-auto border-b border-default"
        aria-label="Usuarios y permisos"
        data-prueba="usuarios-navegacion"
    />
</template>
