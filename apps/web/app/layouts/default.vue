<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui'
import type { SeccionPanel } from '~/utils/navegacion'

const { puede, puedeSeccion } = usePermisos()
const comprobantes = useComprobantes()
const route = useRoute()

/** Menú completo del teléfono abierto (lo abre «Más» de la isla de abajo, a pantalla completa). */
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

/*
 * Atajos de los accesos rápidos: Alt+1…9 abre el acceso de ese número (por la tecla física, así
 * también funciona en Mac, donde Alt+número escribe otro carácter). Nunca dentro de un campo.
 */
const accesosRapidos = useAccesosRapidos()
watch(() => useUsuarioActual().value?.id, () => void accesosRapidos.cargar(), { immediate: true })
function alTeclearAcceso(evento: KeyboardEvent) {
    if (!evento.altKey || evento.ctrlKey || evento.metaKey || !/^Digit[1-9]$/.test(evento.code)) {
        return
    }
    const objetivo = evento.target as HTMLElement | null
    if (objetivo?.closest('input, textarea, select, [contenteditable="true"]')) {
        return
    }
    const seccion = accesosRapidos.accesos.value[Number(evento.code.slice(5)) - 1]
    if (seccion) {
        evento.preventDefault()
        void navigateTo(seccion.ruta)
    }
}
onMounted(() => window.addEventListener('keydown', alTeclearAcceso))
onBeforeUnmount(() => window.removeEventListener('keydown', alTeclearAcceso))
// Otra empresa activa: los pendientes de verificar son otros.
watch(useEmpresaActiva().eleccion, actualizarContadores)

function cerrarMovil() {
    abierto.value = false
}

/** «Personalizar mis accesos» desde el menú del teléfono: primero se cierra el menú (nunca un panel sobre otro). */
const personalizando = ref(false)
function personalizarAccesos() {
    abierto.value = false
    personalizando.value = true
}

/** Grupos con al menos una sección permitida; sin ninguna, el grupo (o subgrupo) no aparece. */
const gruposVisibles = computed(() => GRUPOS_PANEL
    .map(grupo => ({
        ...grupo,
        secciones: grupo.secciones.filter(puedeSeccion),
        subgrupos: (grupo.subgrupos ?? [])
            .map(subgrupo => ({ ...subgrupo, secciones: subgrupo.secciones.filter(puedeSeccion) }))
            .filter(subgrupo => subgrupo.secciones.length > 0),
    }))
    .filter(grupo => grupo.secciones.length > 0 || grupo.subgrupos.length > 0))

/** El grupo (y subgrupo) de la página actual se abre solo (al cambiar, el menú se vuelve a montar). */
const ubicacion = computed(() => ubicacionDeRuta(route.path))
const grupoActual = computed(() => ubicacion.value?.grupo.id ?? null)
const subgrupoActual = computed(() => ubicacion.value?.subgrupo?.id ?? null)

/** Inicio de cada usuario: el cajero entra a su caja (`rutaInicio`). */
const inicio = computed(() => rutaInicio(useUsuarioActual().value))

/** Pendientes de una sección (punto y contador en el menú): hoy, los comprobantes por verificar. */
function insignia(texto: string | undefined) {
    return texto ? { label: texto, color: 'primary' as const, variant: 'solid' as const } : undefined
}

function pendientesDe(secciones: SeccionPanel[]): string | undefined {
    return secciones.map(seccion => contadores.value[seccion.id]).find(Boolean)
}

/** Estado de la caja propia en el menú («Abierta»), sin pedir nada más que lo de la barra. */
const miCaja = useMiCaja()
function estadoSeccion(id: string): string | undefined {
    return id === 'caja' && miCaja.abierta.value ? 'Abierta' : undefined
}

/**
 * Enlace de una sección en el menú expandido (IslasA5): sin icono, alineado con el texto del área
 * (42 px) y a 13 px; dentro de un subgrupo, un nivel más adentro. Descripción en el tooltip.
 */
const CLASE_SECCION = 'rounded-[0.5625rem] py-1.5 text-[0.8125rem] font-normal before:rounded-[0.5625rem]'

function itemSeccion(seccion: SeccionPanel, enSubgrupo = false): NavigationMenuItem {
    return {
        'label': seccion.etiqueta,
        'class': `${CLASE_SECCION} ${enSubgrupo ? 'ps-[3.5rem]' : 'ps-[2.625rem]'}`,
        'to': seccion.ruta,
        'aria-label': seccion.etiqueta,
        'descripcion': seccion.descripcion,
        'badge': insignia(contadores.value[seccion.id]) ?? (estadoSeccion(seccion.id) ? { label: estadoSeccion(seccion.id), color: 'success' as const, variant: 'subtle' as const } : undefined),
        'onSelect': cerrarMovil,
    }
}

const itemInicio = computed<NavigationMenuItem>(() => ({
    'label': 'Inicio',
    'icon': 'i-lucide-house',
    'to': inicio.value,
    'aria-label': 'Inicio',
    'corta': 'Inicio',
    'onSelect': cerrarMovil,
}))

/** Un área del menú expandido: acordeón (el de la página, abierto) con sus secciones y subgrupos. */
function itemGrupoExpandido(grupo: (typeof gruposVisibles.value)[number], etiqueta = grupo.etiqueta): NavigationMenuItem {
    return {
        'label': etiqueta,
        'icon': grupo.icono,
        'aria-label': etiqueta,
        'defaultOpen': grupo.id === grupoActual.value,
        'badge': insignia(pendientesDe(seccionesDeGrupo(grupo))),
        'children': [
            ...grupo.secciones.map(seccion => itemSeccion(seccion)),
            ...grupo.subgrupos.map(subgrupo => ({
                'label': subgrupo.etiqueta,
                'class': `${CLASE_SECCION} ps-[2.625rem] font-semibold text-highlighted`,
                'aria-label': subgrupo.etiqueta,
                'defaultOpen': subgrupo.id === subgrupoActual.value,
                'badge': insignia(pendientesDe(subgrupo.secciones)),
                'children': subgrupo.secciones.map(seccion => itemSeccion(seccion, true)),
            })),
        ],
    }
}

/**
 * Menú expandido (IslasA5): Inicio y un acordeón por área; Ajustes va abajo, aparte (pie del menú,
 * `itemsExpandidoAjustes`), igual que en el compacto.
 */
const itemsExpandido = computed<NavigationMenuItem[]>(() => [
    itemInicio.value,
    ...gruposVisibles.value.filter(grupo => grupo.id !== 'configuracion').map(grupo => itemGrupoExpandido(grupo)),
])
const itemsExpandidoAjustes = computed<NavigationMenuItem[]>(() => gruposVisibles.value
    .filter(grupo => grupo.id === 'configuracion')
    .map(grupo => itemGrupoExpandido(grupo, grupo.corta ?? grupo.etiqueta)))

/** Estilo común de los dos menús expandidos (áreas y Ajustes). */
const UI_EXPANDIDO = {
    list: 'gap-0.5',
    link: 'gap-3 rounded-xl px-3 py-2.5 text-sm font-medium before:rounded-xl aria-[current=page]:before:bg-primary/10',
    linkTrailingBadge: 'rounded-full group-data-[state=open]:hidden',
    linkTrailingIcon: 'group-data-[state=closed]:hidden',
    childList: 'ms-0 border-0 ps-0',
    childItem: 'ms-0 ps-0',
    linkLeadingIcon: 'size-[1.125rem]',
}

/**
 * Menú compacto (rail): un icono con etiqueta corta por área; al tocarla se abre a su derecha un
 * menú flotante con sus secciones agrupadas (slot `area-content`). Ajustes va abajo, aparte.
 */
function itemArea(grupo: (typeof gruposVisibles.value)[number]): NavigationMenuItem {
    const pendiente = pendientesDe(seccionesDeGrupo(grupo))
    return {
        'label': grupo.etiqueta,
        'corta': grupo.corta,
        'icon': grupo.icono,
        'aria-label': grupo.etiqueta,
        'grupo': grupo,
        'punto': Boolean(pendiente),
        'active': grupo.id === grupoActual.value,
        // El popover solo se pinta con hijos: el contenido real lo arma el slot.
        'children': seccionesDeGrupo(grupo).map(seccion => ({ label: seccion.etiqueta, to: seccion.ruta })),
    }
}

const itemsRail = computed<NavigationMenuItem[]>(() => [
    { ...itemInicio.value, active: route.path === inicio.value },
    ...gruposVisibles.value.filter(grupo => grupo.id !== 'configuracion').map(itemArea),
])
const itemsRailAjustes = computed<NavigationMenuItem[]>(() => gruposVisibles.value.filter(grupo => grupo.id === 'configuracion').map(itemArea))

/** Para el slot del rail: el grupo con sus permisos ya filtrados. */
function grupoDeItem(item: NavigationMenuItem): (typeof gruposVisibles.value)[number] | null {
    return (item.grupo as (typeof gruposVisibles.value)[number] | undefined) ?? null
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
            :default-size="15.25"
            :min-size="15.25"
            :max-size="20"
            :collapsed-size="4.75"
            :resizable="false"
            mode="modal"
            :menu="{ title: 'Menú', description: 'Todas las secciones del panel y el buscador' }"
            toggle-side="right"
            :toggle="{ color: 'neutral', variant: 'ghost', class: 'boton-flotante boton-circulo' }"
            class="glass-material lateral-argos"
            :ui="{
                header: 'h-auto flex-row items-center gap-3 px-4 pt-[max(0.875rem,env(safe-area-inset-top))] pb-1.5 lg:flex-col lg:items-stretch lg:px-3 lg:pt-3.5',
                body: 'gap-1 px-3',
                footer: 'max-h-[55%] min-h-0 flex-col items-stretch gap-2 overflow-y-auto px-3 pb-3.5',
                content: 'menu-movil lg:hidden',
            }"
        >
            <template #header="{ collapsed }">
                <div
                    class="flex items-center gap-2"
                    :class="collapsed ? 'justify-center' : ''"
                >
                    <NuxtLink
                        :to="inicio"
                        class="flex min-w-0 items-center gap-2.5 px-1 font-semibold text-highlighted"
                        aria-label="ArgosIsp, inicio"
                    >
                        <LogoArgos class="size-9 shrink-0" />
                        <span
                            v-if="!collapsed"
                            class="truncate text-lg tracking-[-0.02em]"
                        >Argos<span class="text-primary">Isp</span></span>
                    </NuxtLink>
                </div>
                <!-- Expandir y compactar (diseño final, IslasA5/A6): un círculo de 28 px sobre el borde
                     derecho de la isla, a la altura del logo, en el mismo lugar en los dos modos
                     (‹ compacta, › expande). La isla es `relative` (raíz del sidebar). -->
                <UButton
                    :icon="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-left'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="boton-flotante absolute top-6 -right-3.5 z-20 hidden size-7 justify-center rounded-full p-0 text-primary hover:text-primary lg:inline-flex"
                    :title="collapsed ? 'Expandir el menú (con nombres)' : 'Compactar el menú (solo iconos)'"
                    :aria-label="collapsed ? 'Expandir el menú' : 'Compactar el menú'"
                    data-prueba="alternar-menu"
                    @click="compacto = !collapsed"
                />
            </template>

            <template #default="{ collapsed }">
                <!-- En escritorio el buscador va en la barra superior; aquí, en el menú «Más» del teléfono,
                     con «Personalizar mis accesos» (los dos primeros van en la isla de abajo). -->
                <div class="flex flex-col gap-2 lg:hidden">
                    <UDashboardSearchButton
                        :collapsed="collapsed"
                        label="Buscar una sección…"
                        aria-label="Buscar sección (Ctrl+K)"
                        variant="ghost"
                        color="neutral"
                        size="lg"
                        class="boton-flotante w-full rounded-xl text-dimmed"
                        data-prueba="menu-buscar"
                    />
                    <UButton
                        v-if="accesosRapidos.accesos.value.length"
                        label="Personalizar mis accesos"
                        icon="i-lucide-sliders-horizontal"
                        color="neutral"
                        variant="soft"
                        size="sm"
                        class="self-start"
                        data-prueba="menu-personalizar-accesos"
                        @click="personalizarAccesos"
                    />
                </div>
                <UNavigationMenu
                    v-if="collapsed"
                    :key="`rail-${grupoActual}`"
                    collapsed
                    :items="itemsRail"
                    orientation="vertical"
                    tooltip
                    :popover="{ content: { side: 'right', align: 'start', sideOffset: 10 } }"
                    aria-label="Menú principal"
                    data-prueba="menu-rail"
                    :ui="{ root: 'gap-1', list: 'flex flex-col gap-1', link: 'px-0 py-0 justify-center before:hidden', content: 'min-w-0 rounded-xl bg-(--ax-tarjeta) ring ring-(--ax-borde) shadow-(--ax-sombra-flotante)' }"
                >
                    <template #item="{ item, active }">
                        <span
                            class="flex w-full flex-col items-center gap-[3px] rounded-xl px-0.5 py-2"
                            :class="active ? 'bg-primary/10 text-primary' : 'text-muted group-hover:text-highlighted'"
                        >
                            <UChip
                                :show="Boolean(item.punto)"
                                color="warning"
                                size="sm"
                            >
                                <UIcon
                                    :name="item.icon ?? 'i-lucide-circle'"
                                    class="size-5"
                                />
                            </UChip>
                            <span class="max-w-full truncate text-[0.625rem] leading-tight font-semibold">{{ item.corta ?? item.label }}</span>
                        </span>
                    </template>
                    <template #item-content="{ item, close }">
                        <MenuArea
                            v-if="grupoDeItem(item)"
                            :grupo="grupoDeItem(item)!"
                            :contadores="contadores"
                            :estado-seccion="estadoSeccion"
                            @elegir="close?.(); cerrarMovil()"
                        />
                    </template>
                </UNavigationMenu>
                <UNavigationMenu
                    v-else
                    :key="`expandido-${grupoActual}-${subgrupoActual}`"
                    :items="itemsExpandido"
                    orientation="vertical"
                    aria-label="Menú principal"
                    data-prueba="menu-principal"
                    :ui="UI_EXPANDIDO"
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
                <UNavigationMenu
                    v-if="collapsed && itemsRailAjustes.length"
                    collapsed
                    :items="itemsRailAjustes"
                    orientation="vertical"
                    :popover="{ content: { side: 'right', align: 'end', sideOffset: 10 } }"
                    aria-label="Ajustes"
                    class="w-full"
                    :ui="{ link: 'px-0 py-0 justify-center before:hidden', content: 'min-w-0 rounded-xl bg-(--ax-tarjeta) ring ring-(--ax-borde) shadow-(--ax-sombra-flotante)' }"
                >
                    <template #item="{ item, active }">
                        <span
                            class="flex w-full flex-col items-center gap-[3px] rounded-xl px-0.5 py-2"
                            :class="active ? 'bg-primary/10 text-primary' : 'text-muted group-hover:text-highlighted'"
                        >
                            <UIcon
                                :name="item.icon ?? 'i-lucide-settings'"
                                class="size-5"
                            />
                            <span class="text-[0.625rem] leading-tight font-semibold">{{ item.corta ?? item.label }}</span>
                        </span>
                    </template>
                    <template #item-content="{ item, close }">
                        <MenuArea
                            v-if="grupoDeItem(item)"
                            :grupo="grupoDeItem(item)!"
                            :contadores="contadores"
                            :estado-seccion="estadoSeccion"
                            @elegir="close?.(); cerrarMovil()"
                        />
                    </template>
                </UNavigationMenu>
                <UNavigationMenu
                    v-else-if="!collapsed && itemsExpandidoAjustes.length"
                    :key="`ajustes-${grupoActual}-${subgrupoActual}`"
                    :items="itemsExpandidoAjustes"
                    orientation="vertical"
                    aria-label="Ajustes"
                    data-prueba="menu-ajustes"
                    class="w-full"
                    :ui="UI_EXPANDIDO"
                />
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

        <!-- Teléfono y tableta (< lg): isla de navegación abajo; «Más» abre el menú completo. -->
        <PanelIslaMovil
            v-model:menu-abierto="abierto"
            :inicio="inicio"
        />
        <AccesosRapidosEditor v-model:open="personalizando" />

        <AvisoTopeSesion />
        <SesionBloqueo />
    </UDashboardGroup>
</template>
