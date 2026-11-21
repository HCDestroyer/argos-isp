<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

/**
 * Las tres pantallas del ACL como pestañas segmentadas (tablero OperUsuarios): usuarios, roles y
 * permisos, tokens de API; cada una con su permiso y su ruta. Va dentro de la tarjeta de la pantalla.
 */
const { puede } = usePermisos()
const route = useRoute()

const RUTAS: Record<string, string> = { usuarios: '/usuarios', roles: '/usuarios/roles', tokens: '/usuarios/tokens' }

const items = computed<TabsItem[]>(() => [
    ...(puede('usuarios.ver') ? [{ label: 'Usuarios', icon: 'i-lucide-users', value: 'usuarios' }] : []),
    ...(puede('roles.ver') ? [{ label: 'Roles y permisos', icon: 'i-lucide-shield', value: 'roles' }] : []),
    ...(puede('tokens.ver') ? [{ label: 'Tokens y sistemas', icon: 'i-lucide-key-round', value: 'tokens' }] : []),
])

const valor = computed({
    get: () => Object.entries(RUTAS).find(([, ruta]) => ruta === route.path)?.[0] ?? 'usuarios',
    set: (nuevo: string | number) => {
        const destino = RUTAS[String(nuevo)]
        if (destino && destino !== route.path) {
            void navigateTo(destino)
        }
    },
})
</script>

<template>
    <OperPestanas
        v-if="items.length > 1"
        v-model="valor"
        :items="items"
        etiqueta="Usuarios y permisos"
        data-prueba="usuarios-navegacion"
    />
</template>
