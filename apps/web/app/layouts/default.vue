<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { puede } = usePermisos()
const comprobantes = useComprobantes()

const abierto = ref(false)

/** Contadores junto a una sección del menú (hoy, los comprobantes pendientes de verificar). */
const contadores = computed<Record<string, string | undefined>>(() => ({
    comprobantes: textoContador(comprobantes.contador.value),
}))

onMounted(() => {
    if (puede('comprobantes.ver')) {
        void comprobantes.actualizarContador()
    }
})

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
                    badge: contadores.value[seccion.id] ? { label: contadores.value[seccion.id], color: 'warning' as const, variant: 'subtle' as const } : undefined,
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
        <!-- Aura: fondo de color difuminado bajo toda la app, para que el vidrio tenga qué reflejar. -->
        <div
            class="app-aura"
            aria-hidden="true"
        />
        <!-- Vidrio en la barra lateral y la superior (PanelPagina); el contenido va en tarjetas. -->
        <UDashboardSidebar
            id="principal"
            v-model:open="abierto"
            collapsible
            resizable
            class="glass-material"
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
                    <LogoArgos class="size-7 shrink-0" />
                    <span
                        v-if="!collapsed"
                        class="truncate tracking-[-0.015em]"
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

        <AvisoTopeSesion />
        <SesionBloqueo />
    </UDashboardGroup>
</template>
