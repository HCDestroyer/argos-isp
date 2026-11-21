<script setup lang="ts">
import type { BreadcrumbItem } from '@nuxt/ui'

const { conSelector } = useEmpresaActiva()
const route = useRoute()

/**
 * Estructura común de una página del panel (sistema visual Argos, `docs/sistema-visual.md`):
 * barra superior de vidrio (plegar menú, buscador Ctrl+K, empresa, caja, avisos, ayuda, tema y
 * usuario) y cuerpo con scroll que empieza con el encabezado de página.
 *
 * - Página de una sección del menú (la ruta es la de la sección) o con `descripcion`: encabezado
 *   grande con migas, título, descripción y las acciones (`#acciones`) a la derecha.
 * - Ficha o subpágina: el título y las acciones siguen en la barra superior y el cuerpo empieza
 *   con las migas hasta la sección a la que pertenece.
 */
const props = withDefaults(defineProps<{
    id: string
    titulo: string
    icono?: string
    descripcion?: string
}>(), {
    icono: undefined,
    descripcion: undefined,
})

const ubicacion = computed(() => ubicacionDeRuta(route.path))
const esSeccion = computed(() => ubicacion.value?.seccion.ruta === route.path)
const encabezado = computed(() => esSeccion.value || props.descripcion !== undefined)
const descripcionVisible = computed(() => props.descripcion ?? (esSeccion.value ? ubicacion.value?.seccion.descripcion : undefined))

const migas = computed<BreadcrumbItem[]>(() => {
    const lista: BreadcrumbItem[] = [{ label: 'Inicio', icon: 'i-lucide-house', to: '/' }]
    const lugar = ubicacion.value
    if (lugar && !lugar.grupo.plano && lugar.grupo.etiqueta !== props.titulo) {
        lista.push({ label: lugar.grupo.etiqueta })
    }
    if (lugar?.subgrupo) {
        lista.push({ label: lugar.subgrupo.etiqueta })
    }
    if (lugar && !esSeccion.value) {
        lista.push({ label: lugar.seccion.etiqueta, to: lugar.seccion.ruta })
    }
    lista.push({ label: props.titulo })
    return lista
})
</script>

<template>
    <UDashboardPanel :id="id">
        <template #header>
            <!-- Un solo nodo raíz: la fila del selector (teléfono) aparece y desaparece sin mover la barra. -->
            <div class="flex shrink-0 flex-col">
                <UDashboardNavbar
                    :title="encabezado ? undefined : titulo"
                    :icon="encabezado ? undefined : icono"
                    class="chrome-material"
                    :ui="{ title: 'text-base font-semibold' }"
                >
                    <template #leading>
                        <UDashboardSidebarCollapse />
                        <UDashboardSearchButton
                            v-if="encabezado"
                            label="Buscar…"
                            aria-label="Buscar sección (Ctrl+K)"
                            class="hidden w-56 rounded-full bg-transparent ring-(--ax-borde) lg:inline-flex"
                        />
                        <span
                            v-if="encabezado"
                            class="truncate font-semibold text-highlighted lg:hidden"
                        >{{ titulo }}</span>
                    </template>

                    <template #right>
                        <UDashboardSearchButton
                            v-if="!encabezado"
                            collapsed
                            aria-label="Buscar sección (Ctrl+K)"
                            class="hidden lg:inline-flex"
                        />
                        <SelectorEmpresa class="hidden sm:flex" />
                        <CajaAccesoDirecto />
                        <slot
                            v-if="!encabezado"
                            name="acciones"
                        />
                        <AvisosBoton />
                        <AyudaBoton
                            v-if="!encabezado"
                            class="hidden sm:inline-flex"
                        />
                        <UColorModeButton />
                        <div class="hidden sm:flex">
                            <MenuUsuario variante="avatar" />
                        </div>
                    </template>
                </UDashboardNavbar>
                <!-- En el teléfono el selector de empresa va en su propia fila, bajo la barra. -->
                <UDashboardToolbar
                    v-show="conSelector"
                    class="chrome-material sm:hidden"
                >
                    <SelectorEmpresa class="w-full" />
                </UDashboardToolbar>
            </div>
        </template>

        <template #body>
            <AvisoFel />
            <div
                v-if="encabezado"
                class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
                data-prueba="encabezado-pagina"
            >
                <div class="flex min-w-0 flex-col gap-1">
                    <UBreadcrumb
                        :items="migas"
                        class="hidden sm:flex"
                        :ui="{ link: 'text-xs', linkLeadingIcon: 'size-3.5' }"
                    />
                    <div class="flex items-center gap-1">
                        <h1 class="text-2xl font-bold tracking-[-0.02em] text-highlighted sm:text-[1.75rem]">
                            {{ titulo }}
                        </h1>
                        <AyudaBoton solo-icono />
                    </div>
                    <p
                        v-if="descripcionVisible"
                        class="max-w-3xl text-sm text-muted"
                    >
                        {{ descripcionVisible }}
                    </p>
                </div>
                <div
                    v-if="$slots.acciones"
                    class="flex shrink-0 flex-wrap items-center gap-2"
                >
                    <slot name="acciones" />
                </div>
            </div>
            <UBreadcrumb
                v-else-if="ubicacion"
                :items="migas"
                class="hidden sm:flex"
                :ui="{ link: 'text-xs', linkLeadingIcon: 'size-3.5' }"
                data-prueba="migas"
            />
            <slot />
        </template>
    </UDashboardPanel>
</template>
