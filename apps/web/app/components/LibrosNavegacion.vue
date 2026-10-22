<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

/** Las tres pantallas de los libros legales; todas con `libros.ver`. */
const { puede } = usePermisos()

const items = computed<NavigationMenuItem[]>(() => (puede('libros.ver')
    ? [
            { label: 'Vista previa', icon: 'i-lucide-eye', to: '/libros', exact: true },
            { label: 'Emisiones', icon: 'i-lucide-stamp', to: '/libros/emisiones' },
            { label: 'Habilitaciones', icon: 'i-lucide-book-plus', to: '/libros/habilitaciones' },
        ]
    : []))
</script>

<template>
    <UNavigationMenu
        :items="items"
        orientation="horizontal"
        highlight
        :ui="{ linkLabel: 'overflow-visible whitespace-nowrap text-clip' }"
        class="-mx-1 overflow-x-auto border-b border-default"
        aria-label="Libros legales"
        data-prueba="libros-navegacion"
    />
</template>
