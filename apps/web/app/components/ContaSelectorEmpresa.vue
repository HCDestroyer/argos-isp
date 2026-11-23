<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Empresa de la pantalla en el encabezado de Finanzas (tableros Conta*): botón flotante con el
 * edificio y el nombre, que cambia la empresa activa de todo el panel (`useEmpresaActiva`; la
 * página se vuelve a montar con su `X-Empresa-Id`). «Todas las empresas» solo con alcance global.
 * Con una sola empresa no se muestra (multiempresa: todo se comporta igual que antes).
 */
const { eleccion, empresas, alcanceGlobal, conSelector, elegir } = useEmpresaActiva()

const nombre = computed(() => (eleccion.value === 'todas'
    ? 'Todas las empresas'
    : empresas.value.find(e => e.id === eleccion.value)?.nombre_comercial ?? 'Empresa'))

const items = computed<DropdownMenuItem[]>(() => [
    ...(alcanceGlobal.value
        ? [{
                label: 'Todas las empresas',
                icon: 'i-lucide-layers',
                description: 'Consolidado: cada NIT lleva su libro',
                type: 'checkbox' as const,
                checked: eleccion.value === 'todas',
                onSelect: () => elegir('todas'),
            }]
        : []),
    ...empresas.value.map(e => ({
        label: e.nombre_comercial,
        icon: 'i-lucide-building-2',
        description: e.nit ? `NIT ${e.nit}` : undefined,
        type: 'checkbox' as const,
        checked: eleccion.value === e.id,
        onSelect: () => elegir(e.id),
    })),
])
</script>

<template>
    <UDropdownMenu
        v-if="conSelector"
        :items="items"
        :content="{ align: 'end' }"
        :ui="{ content: 'min-w-64' }"
    >
        <UButton
            :label="nombre"
            icon="i-lucide-building"
            trailing-icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            class="boton-flotante boton-pastilla max-w-64"
            :ui="{ label: 'truncate' }"
            aria-label="Empresa de la pantalla"
            data-prueba="selector-empresa-conta"
        />
    </UDropdownMenu>
</template>
