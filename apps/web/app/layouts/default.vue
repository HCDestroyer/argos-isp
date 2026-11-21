<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui'
import type { SeccionPanel } from '~/utils/navegacion'

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

/** Grupos con al menos una sección permitida; sin ninguna, el grupo (o subgrupo) no aparece. */
const gruposVisibles = computed(() => GRUPOS_PANEL
    .map(grupo => ({
        ...grupo,
        secciones: grupo.secciones.filter(seccion => puede(seccion.permiso)),
        subgrupos: (grupo.subgrupos ?? [])
            .map(subgrupo => ({ ...subgrupo, secciones: subgrupo.secciones.filter(seccion => puede(seccion.permiso)) }))
            .filter(subgrupo => subgrupo.secciones.length > 0),
    }))
    .filter(grupo => grupo.secciones.length > 0 || grupo.subgrupos.length > 0))

/** El grupo (y subgrupo) de la página actual se abre solo (al cambiar, el menú se vuelve a montar). */
const ubicacion = computed(() => ubicacionDeRuta(route.path))
const grupoActual = computed(() => ubicacion.value?.grupo.id ?? null)
const subgrupoActual = computed(() => ubicacion.value?.subgrupo?.id ?? null)

/** Inicio de cada usuario: el cajero entra a su caja (`rutaInicio`). */
const inicio = computed(() => rutaInicio(useUsuarioActual().value))

function insignia(texto: string | undefined) {
    return texto ? { label: texto, color: 'primary' as const, variant: 'solid' as const } : undefined
}

/**
 * Enlace de una sección. Dentro de un grupo expandido lleva viñeta de punto (la jerarquía la da la
 * sangría); suelta o en el menú compacto, su icono. La descripción va en el tooltip.
 */
function itemSeccion(seccion: SeccionPanel, anidado: boolean, compacto: boolean): NavigationMenuItem {
    return {
        'label': seccion.etiqueta,
        'icon': anidado && !compacto ? 'i-lucide-dot' : seccion.icono,
        'to': seccion.ruta,
        'aria-label': seccion.etiqueta,
        'descripcion': seccion.descripcion,
        'badge': insignia(contadores.value[seccion.id]),
        'onSelect': cerrarMovil,
    }
}

function pendientesDe(secciones: SeccionPanel[]): string | undefined {
    return secciones.map(seccion => contadores.value[seccion.id]).find(Boolean)
}

/**
 * Menú por bloques (encabezados en versalitas, no clicables): Inicio y el día a día sueltos, luego
 * los grupos plegables. En el menú compacto los subgrupos se aplanan (el popover tiene un nivel).
 */
function itemsMenu(compacto: boolean): NavigationMenuItem[] {
    const lista: NavigationMenuItem[] = [{
        'label': 'Inicio',
        'icon': 'i-lucide-house',
        'to': inicio.value,
        'aria-label': 'Inicio',
        'onSelect': cerrarMovil,
    }]
    let bloque = ''
    for (const grupo of gruposVisibles.value) {
        if (grupo.bloque !== bloque) {
            bloque = grupo.bloque
            // Encabezado del bloque: versalitas, no clicable, con aire y un divisor sobre él.
            lista.push({ label: bloque, type: 'label', class: 'mt-2 border-t border-(--ax-borde) pt-3.5 uppercase tracking-[0.06em] text-[0.6875rem] font-bold text-dimmed' })
        }
        if (grupo.plano) {
            lista.push(...grupo.secciones.map(seccion => itemSeccion(seccion, false, compacto)))
            continue
        }
        const hijos: NavigationMenuItem[] = grupo.secciones.map(seccion => itemSeccion(seccion, true, compacto))
        for (const subgrupo of grupo.subgrupos) {
            if (compacto) {
                hijos.push(...subgrupo.secciones.map(seccion => itemSeccion(seccion, true, compacto)))
                continue
            }
            hijos.push({
                'label': subgrupo.etiqueta,
                'icon': subgrupo.icono,
                'aria-label': subgrupo.etiqueta,
                'defaultOpen': subgrupo.id === subgrupoActual.value,
                'badge': insignia(pendientesDe(subgrupo.secciones)),
                'children': subgrupo.secciones.map(seccion => itemSeccion(seccion, true, compacto)),
            })
        }
        lista.push({
            'label': grupo.etiqueta,
            'icon': grupo.icono,
            'aria-label': grupo.etiqueta,
            'defaultOpen': grupo.id === grupoActual.value,
            'badge': insignia(pendientesDe(seccionesDeGrupo(grupo))),
            'children': hijos,
        })
    }
    return lista
}

/** Buscador: las mismas secciones permitidas, por grupo, con su descripción. */
const gruposBusqueda = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [
    {
        id: 'inicio',
        items: [{ label: 'Inicio', suffix: 'Tablero y accesos', icon: 'i-lucide-house', to: inicio.value }],
    },
    ...gruposVisibles.value.map(grupo => ({
        id: grupo.id,
        label: grupo.etiqueta,
        items: seccionesDeGrupo(grupo).map(seccion => ({
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
            :default-size="16.5"
            :min-size="15"
            :max-size="22"
            class="glass-material lateral-argos"
            :ui="{
                header: 'h-auto flex-col items-stretch gap-3 pt-4 pb-1',
                body: 'gap-1',
                footer: 'lg:border-t lg:border-(--ax-borde)',
            }"
        >
            <template #header="{ collapsed }">
                <NuxtLink
                    :to="inicio"
                    class="flex min-w-0 items-center gap-2.5 px-1 font-semibold text-highlighted"
                    :class="collapsed ? 'justify-center' : ''"
                    aria-label="ArgosIsp, inicio"
                >
                    <LogoArgos class="size-8 shrink-0" />
                    <span
                        v-if="!collapsed"
                        class="truncate text-lg tracking-[-0.02em]"
                    >Argos<span class="text-primary">Isp</span></span>
                </NuxtLink>
                <!-- Filete con el degradado de marca: el único acento de color del menú. -->
                <div
                    class="h-0.5 rounded-full bg-(image:--argos-degradado) opacity-80"
                    aria-hidden="true"
                />
                <MenuUsuario :collapsed="collapsed" />
            </template>

            <template #default="{ collapsed }">
                <!-- En escritorio el buscador va en la barra superior; aquí, en el teléfono. -->
                <UDashboardSearchButton
                    :collapsed="collapsed"
                    label="Buscar"
                    aria-label="Buscar sección (Ctrl+K)"
                    class="bg-transparent ring-default lg:hidden"
                />
                <UNavigationMenu
                    :key="`${grupoActual}-${subgrupoActual}-${collapsed}`"
                    :collapsed="collapsed"
                    :items="itemsMenu(collapsed)"
                    orientation="vertical"
                    tooltip
                    popover
                    aria-label="Menú principal"
                    data-prueba="menu-principal"
                    :ui="{
                        link: 'py-2 rounded-lg',
                        linkTrailingBadge: 'rounded-full',
                        childList: 'ms-3 border-s border-(--ax-borde) ps-1',
                        linkLeadingIcon: 'size-[1.125rem]',
                    }"
                >
                    <template #item-label="{ item }">
                        <UTooltip
                            v-if="item.descripcion"
                            :text="item.descripcion"
                            :delay-duration="700"
                            :content="{ side: 'right', sideOffset: 16 }"
                        >
                            <span class="truncate">{{ item.label }}</span>
                        </UTooltip>
                        <span
                            v-else
                            class="truncate"
                        >{{ item.label }}</span>
                    </template>
                </UNavigationMenu>
                <!-- En el teléfono la barra superior no tiene espacio para «Ayuda»: va aquí. -->
                <AyudaBoton
                    class="sm:hidden"
                    con-etiqueta
                />
            </template>

            <template #footer="{ collapsed }">
                <p
                    v-if="!collapsed"
                    class="hidden px-1 text-xs text-dimmed lg:block"
                >
                    <UKbd value="meta" /> <UKbd value="K" /> buscar sección
                </p>
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
