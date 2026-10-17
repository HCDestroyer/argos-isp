<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui'

const { puede } = usePermisos()
const comprobantes = useComprobantes()
const route = useRoute()

/** Menú del teléfono (USlideover) abierto. */
const abierto = ref(false)
/** Barra compacta (solo iconos), recordada por usuario. */
const { compacto } = useMenuCompacto()
/** Buscador de secciones (Ctrl/Cmd+K). */
const buscando = ref(false)

/** Contadores junto a una sección del menú (hoy, los comprobantes pendientes de verificar). */
const contadores = computed<Record<string, string | undefined>>(() => ({
    comprobantes: textoContador(comprobantes.contador.value),
}))

function actualizarContadores() {
    if (puede('comprobantes.ver')) {
        void comprobantes.actualizarContador()
    }
}

onMounted(actualizarContadores)
// Otra empresa activa: los pendientes de verificar son otros.
watch(useEmpresaActiva().eleccion, actualizarContadores)

function cerrarMovil() {
    abierto.value = false
}

/** Grupos con al menos una sección permitida; sin ninguna, el grupo no aparece. */
const gruposVisibles = computed(() => GRUPOS_PANEL
    .map(grupo => ({ ...grupo, secciones: grupo.secciones.filter(seccion => puede(seccion.permiso)) }))
    .filter(grupo => grupo.secciones.length > 0))

/** El grupo de la página actual se abre solo (al cambiar de grupo, el menú se vuelve a montar). */
const grupoActual = computed(() => grupoDeRuta(route.path)?.id ?? null)

const items = computed<NavigationMenuItem[]>(() => [
    {
        'label': 'Inicio',
        'icon': 'i-lucide-house',
        'to': '/',
        'aria-label': 'Inicio',
        'onSelect': cerrarMovil,
    },
    ...gruposVisibles.value.map((grupo) => {
        const pendientes = grupo.secciones.map(seccion => contadores.value[seccion.id]).find(Boolean)
        return {
            'label': grupo.etiqueta,
            'icon': grupo.icono,
            'aria-label': grupo.etiqueta,
            'defaultOpen': grupo.id === grupoActual.value,
            'badge': pendientes ? { label: pendientes, color: 'warning' as const, variant: 'subtle' as const } : undefined,
            'children': grupo.secciones.map(seccion => ({
                'label': seccion.etiqueta,
                'icon': seccion.icono,
                'to': seccion.ruta,
                'aria-label': seccion.etiqueta,
                'badge': contadores.value[seccion.id] ? { label: contadores.value[seccion.id], color: 'warning' as const, variant: 'subtle' as const } : undefined,
                'onSelect': cerrarMovil,
            })),
        }
    }),
])

/** Buscador: las mismas secciones permitidas, por grupo, con su descripción. */
const gruposBusqueda = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [
    {
        id: 'inicio',
        items: [{ label: 'Inicio', suffix: 'Tablero y accesos', icon: 'i-lucide-house', to: '/' }],
    },
    ...gruposVisibles.value.map(grupo => ({
        id: grupo.id,
        label: grupo.etiqueta,
        items: grupo.secciones.map(seccion => ({
            label: seccion.etiqueta,
            suffix: seccion.descripcion,
            icon: seccion.icono,
            to: seccion.ruta,
        })),
    })),
])
</script>

<template>
    <UDashboardGroup
        unit="rem"
        :persistent="false"
    >
        <!-- Aura: fondo de color difuminado bajo toda la app, para que el vidrio tenga qué reflejar. -->
        <div
            class="app-aura"
            aria-hidden="true"
        />
        <!-- Vidrio en la barra lateral y la superior (PanelPagina); el contenido va en tarjetas. -->
        <UDashboardSidebar
            id="principal"
            v-model:open="abierto"
            v-model:collapsed="compacto"
            collapsible
            class="glass-material"
            :ui="{
                footer: 'lg:border-t lg:border-default',
            }"
        >
            <template #header="{ collapsed }">
                <NuxtLink
                    to="/"
                    class="flex min-w-0 items-center gap-2 px-1 font-semibold text-highlighted"
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
                <UDashboardSearchButton
                    :collapsed="collapsed"
                    label="Buscar"
                    aria-label="Buscar sección (Ctrl+K)"
                    class="bg-transparent ring-default"
                />
                <UNavigationMenu
                    :key="`${grupoActual}-${collapsed}`"
                    :collapsed="collapsed"
                    :items="items"
                    orientation="vertical"
                    tooltip
                    popover
                    aria-label="Menú principal"
                    data-prueba="menu-principal"
                />
            </template>

            <template #footer="{ collapsed }">
                <MenuUsuario :collapsed="collapsed" />
            </template>
        </UDashboardSidebar>

        <UDashboardSearch
            v-model:open="buscando"
            :groups="gruposBusqueda"
            :color-mode="false"
            placeholder="Ir a una sección…"
            title="Buscar sección"
            description="Escribe el nombre de una sección y pulsa Enter"
        />

        <slot />

        <AvisoTopeSesion />
        <SesionBloqueo />
    </UDashboardGroup>
</template>
