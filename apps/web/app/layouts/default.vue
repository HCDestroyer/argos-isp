<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { puede } = usePermisos()

const abierto = ref(false)

const items = computed<NavigationMenuItem[][]>(() => {
    const inicio: NavigationMenuItem[] = [{
        label: 'Inicio',
        icon: 'i-lucide-house',
        to: '/',
        onSelect: () => {
            abierto.value = false
        },
    }]

    const grupos = GRUPOS_PANEL
        .map((grupo) => {
            const visibles = grupo.secciones.filter(seccion => puede(seccion.permiso))
            if (!visibles.length) {
                return []
            }
            return [
                { label: grupo.etiqueta, type: 'label' as const },
                ...visibles.map(seccion => ({
                    label: seccion.etiqueta,
                    icon: seccion.icono,
                    to: seccion.ruta,
                    onSelect: () => {
                        abierto.value = false
                    },
                })),
            ]
        })
        .filter(grupo => grupo.length > 0)

    return [inicio, ...grupos]
})
</script>

<template>
    <UDashboardGroup unit="rem">
        <UDashboardSidebar
            id="principal"
            v-model:open="abierto"
            collapsible
            resizable
            class="bg-elevated/25"
            :ui="{
                footer: 'lg:border-t lg:border-default',
            }"
        >
            <template #header="{ collapsed }">
                <NuxtLink
                    to="/"
                    class="flex items-center gap-2 px-1 font-semibold text-highlighted"
                    aria-label="ArgosIsp, inicio"
                >
                    <UIcon
                        name="i-lucide-radar"
                        class="size-6 shrink-0 text-primary"
                    />
                    <span
                        v-if="!collapsed"
                        class="truncate"
                    >ArgosIsp</span>
                </NuxtLink>
            </template>

            <template #default="{ collapsed }">
                <UNavigationMenu
                    v-for="(grupo, indice) in items"
                    :key="indice"
                    :collapsed="collapsed"
                    :items="grupo"
                    orientation="vertical"
                    tooltip
                    popover
                    :class="indice > 0 ? 'mt-2' : undefined"
                />
            </template>

            <template #footer="{ collapsed }">
                <MenuUsuario :collapsed="collapsed" />
            </template>
        </UDashboardSidebar>

        <slot />
    </UDashboardGroup>
</template>
