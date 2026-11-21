<script setup lang="ts">
/**
 * Navegación del cliente con sesión (diseño aprobado, tableros `Portal` y `NuevoPortal`).
 *
 * - `inferior` (teléfono, < lg): barra fija abajo, de vidrio, con las secciones (Inicio, Facturas,
 *   Soporte con Iris, Puntos con el programa visible, Cuenta). Cada destino mide al menos 56 × 44 px
 *   y la barra deja libre la zona del indicador de inicio del iPhone (`env(safe-area-inset-bottom)`,
 *   con `viewport-fit=cover` en `nuxt.config.ts`).
 * - `lateral` (escritorio, ≥ lg): el mismo menú «isla» del panel (`apps/web/app/layouts/default.vue`,
 *   diseño IslasA5/A6): flota a 16 px del borde, 76 px compacto (icono y nombre corto) o 244 px
 *   expandido (icono y nombre largo: «Facturas y pagos», «Mis puntos», «Mi cuenta»), logo de 36 px
 *   y el botón ‹ › de 28 px sobre el borde derecho a la altura del logo, en el mismo lugar en los dos
 *   modos (`useMenuCompacto`). El tema va abajo. En el rail el nombre largo va en `title`, no en
 *   un `UTooltip` como en el panel: el tooltip necesita el proveedor de `UApp` y el menú se monta
 *   también fuera de él (pruebas del layout). Pendiente: extraerlo con el del panel a `packages/`.
 *
 * La activa lleva el texto en `text-highlighted` sobre el tinte índigo: el primario sobre su propio
 * tinte no llegaba al contraste AA (axe, `tests/e2e/accesibilidad.spec.ts`).
 */
const props = defineProps<{
    variante: 'inferior' | 'lateral'
    /** Marca del menú lateral (la empresa de la cuenta). */
    nombre?: string
    logoUrl?: string | null
}>()

const route = useRoute()
const activa = computed(() => seccionActiva(route))
// «Puntos» aparece solo si el programa está visible en el portal (lo activa el panel).
const { visible: conPuntos } = usePuntos()
// «Soporte» aparece solo con Iris conectado (tickets y solicitudes del cliente).
const { visible: conSoporte } = useSoporte()
const secciones = computed(() => seccionesVisibles(conPuntos.value, conSoporte.value))
const columnas: Record<number, string> = { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' }

const { compacto, alternar } = useMenuCompacto()
/** Secciones como ítems de `UNavigationMenu` (rail y expandido, como en el panel). */
const items = computed(() => secciones.value.map(item => ({
    label: item.etiquetaLarga,
    corta: item.etiqueta,
    icon: item.icono,
    to: item.to,
    active: activa.value === item.seccion,
    seccion: item.seccion,
})))
/**
 * Estilo del menú expandido: el del panel (`UI_EXPANDIDO`). La activa lleva el texto en
 * `text-highlighted` (el primario sobre su tinte no llegaba a AA en el portal) y el icono en primario.
 */
const UI_EXPANDIDO = {
    list: 'gap-0.5',
    link: 'gap-3 rounded-xl px-3 py-2.5 text-sm font-medium before:rounded-xl data-active:before:bg-primary/10 data-active:text-highlighted',
    linkLeadingIcon: 'size-[1.125rem] group-data-active:text-primary',
}
</script>

<template>
    <nav
        v-if="props.variante === 'inferior'"
        aria-label="Secciones de mi cuenta"
        class="chrome-material fixed inset-x-0 bottom-0 z-30 border-t border-default pb-[env(safe-area-inset-bottom)] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)] lg:hidden"
        data-testid="navegacion-inferior"
    >
        <ul
            class="mx-auto grid w-full max-w-xl gap-1 px-1"
            :class="columnas[secciones.length] ?? 'grid-cols-5'"
        >
            <li
                v-for="item in secciones"
                :key="item.seccion"
            >
                <UButton
                    :to="item.to"
                    :icon="item.icono"
                    :label="item.etiqueta"
                    :color="activa === item.seccion ? 'primary' : 'neutral'"
                    variant="ghost"
                    :aria-current="activa === item.seccion ? 'page' : undefined"
                    block
                    :data-testid="`nav-${item.seccion}`"
                    :ui="{
                        base: ['min-h-14 flex-col gap-0.5 rounded-lg px-1 py-1.5 text-xs font-medium hover:bg-transparent', activa === item.seccion ? 'text-primary' : 'text-muted'].join(' '),
                        leadingIcon: 'size-6',
                    }"
                />
            </li>
        </ul>
    </nav>

    <aside
        v-else
        aria-label="Menú de mi cuenta"
        class="glass-material lateral-portal sticky top-4 hidden h-[calc(100dvh-2rem)] shrink-0 flex-col transition-[width] duration-200 lg:flex"
        :class="compacto ? 'w-[4.75rem]' : 'w-[15.25rem]'"
        :data-compacto="compacto ? 'si' : 'no'"
        data-testid="navegacion-lateral"
    >
        <div
            class="flex items-center gap-2 px-3 pt-3.5 pb-1.5"
            :class="compacto ? 'justify-center' : ''"
        >
            <NuxtLink
                to="/cuenta"
                class="flex min-w-0 items-center gap-2.5 px-1 font-semibold text-highlighted"
                :aria-label="`${props.nombre ?? 'Mi cuenta'}, inicio`"
            >
                <PortalMarcaEmpresa
                    :nombre="props.nombre ?? ''"
                    :logo-url="props.logoUrl ?? null"
                    respaldo="argos"
                    class="size-9 shrink-0"
                />
                <span
                    v-if="!compacto"
                    class="truncate text-lg tracking-[-0.02em]"
                >{{ props.nombre }}</span>
            </NuxtLink>
        </div>
        <!-- Expandir y compactar (IslasA5/A6, como el panel): un círculo de 28 px sobre el borde derecho
             de la isla, a la altura del logo, en el mismo lugar en los dos modos (‹ compacta, › expande). -->
        <UButton
            :icon="compacto ? 'i-lucide-chevron-right' : 'i-lucide-chevron-left'"
            color="neutral"
            variant="ghost"
            size="xs"
            class="boton-flotante absolute top-6 -right-3.5 z-20 size-7 min-h-0 min-w-0 justify-center rounded-full p-0 text-primary hover:text-primary"
            :title="compacto ? 'Expandir el menú (con nombres)' : 'Compactar el menú (solo iconos)'"
            :aria-label="compacto ? 'Expandir el menú' : 'Compactar el menú'"
            :aria-expanded="!compacto"
            data-testid="alternar-menu"
            @click="alternar"
        />

        <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pt-2">
            <UNavigationMenu
                v-if="compacto"
                collapsed
                :items="items"
                orientation="vertical"
                aria-label="Secciones de mi cuenta (escritorio)"
                :ui="{ root: 'gap-1', list: 'flex flex-col gap-1', link: 'px-0 py-0 justify-center before:hidden' }"
            >
                <template #item="{ item }">
                    <span
                        class="flex w-full flex-col items-center gap-[3px] rounded-xl px-0.5 py-2"
                        :class="item.active ? 'bg-primary/10 text-highlighted' : 'text-muted group-hover:text-highlighted'"
                        :title="item.label"
                        :data-testid="`nav-${item.seccion}`"
                    >
                        <UIcon
                            :name="item.icon"
                            class="size-5"
                            :class="item.active ? 'text-primary' : ''"
                        />
                        <span class="max-w-full truncate text-[0.625rem] leading-tight font-semibold">{{ item.corta }}</span>
                    </span>
                </template>
            </UNavigationMenu>
            <UNavigationMenu
                v-else
                :items="items"
                orientation="vertical"
                aria-label="Secciones de mi cuenta (escritorio)"
                :ui="UI_EXPANDIDO"
            >
                <template #item-label="{ item }">
                    <span
                        class="truncate"
                        :data-testid="`nav-${item.seccion}`"
                    >{{ item.label }}</span>
                </template>
            </UNavigationMenu>
        </div>

        <div
            class="flex items-center gap-2 border-t border-default px-3 py-3"
            :class="compacto ? 'justify-center' : 'justify-between'"
        >
            <span
                v-if="!compacto"
                class="ps-1 text-xs text-muted"
            >Tema</span>
            <UColorModeButton />
        </div>
    </aside>
</template>
