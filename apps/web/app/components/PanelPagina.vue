<script setup lang="ts">
import type { BreadcrumbItem } from '@nuxt/ui'

const route = useRoute()

/**
 * Estructura común de una página del panel (sistema visual Argos, `docs/sistema-visual.md`):
 * encabezado sin barra ni pastillas (diseño final aprobado por el PM, maquetas IslasA5/A6), cada
 * control es un botón flotante suelto. A la izquierda «lo que haces»: buscador (Ctrl+K) y los
 * accesos rápidos (2 directos y «Más»); en medio, aire; a la derecha «lo que vigilas»: caja,
 * sistema, avisos y la cuenta (iniciales; el nombre y la empresa van dentro de su menú).
 *
 * El título nunca va en el encabezado: el cuerpo empieza con las migas y el título.
 * - Página de una sección del menú (la ruta es la de la sección) o con `descripcion`: título
 *   grande, descripción y las acciones (`#acciones`) a la derecha.
 * - Ficha o subpágina: migas hasta la sección a la que pertenece, título con su icono y las
 *   acciones a la derecha.
 * - `tituloOculto` (Inicio): la pantalla pinta su propio saludo; el título queda solo para lectores
 *   de pantalla.
 */
const props = withDefaults(defineProps<{
    id: string
    titulo: string
    icono?: string
    descripcion?: string
    tituloOculto?: boolean
    /** Sin la frase de la sección bajo el título (pantallas cuyo tablero no la lleva, como Clientes). */
    sinDescripcion?: boolean
    /** La pantalla pinta su propio encabezado con el `h1` (franja de la ficha del cliente): aquí solo las migas. */
    encabezadoPropio?: boolean
    /** Con `encabezadoPropio`: tampoco las migas (la pantalla las pinta dentro de su tarjeta, como el alta de cliente). */
    sinMigas?: boolean
}>(), {
    icono: undefined,
    descripcion: undefined,
    tituloOculto: false,
    sinDescripcion: false,
    encabezadoPropio: false,
    sinMigas: false,
})

/**
 * Pantallas que ya pintan sus propias migas (con pasos propios): aquí no se repiten.
 * `servicios/[id]/facturas-periodo` (Servicios › servicio › Emitir facturas de periodos).
 */
const MIGAS_PROPIAS = [/^\/servicios\/\d+\/facturas-periodo$/]

const ubicacion = computed(() => (MIGAS_PROPIAS.some(patron => patron.test(route.path)) ? null : ubicacionDeRuta(route.path)))
const esSeccion = computed(() => ubicacion.value?.seccion.ruta === route.path)
const encabezado = computed(() => esSeccion.value || props.descripcion !== undefined)
const descripcionVisible = computed(() => (props.sinDescripcion ? undefined : props.descripcion ?? (esSeccion.value ? ubicacion.value?.seccion.descripcion : undefined)))

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
            <UDashboardNavbar
                :toggle="{ color: 'neutral', variant: 'ghost', class: 'boton-flotante boton-circulo' }"
                :ui="{
                    root: 'h-auto min-h-0 border-0 bg-transparent px-4 pt-4 pb-1 gap-2.5 sm:px-4',
                    left: 'min-w-0 gap-2.5',
                    right: 'gap-2.5',
                }"
            >
                <template #leading>
                    <UDashboardSearchButton
                        label="Buscar…"
                        aria-label="Buscar sección (Ctrl+K)"
                        variant="ghost"
                        color="neutral"
                        class="boton-flotante boton-pastilla hidden w-[14.375rem] font-medium text-dimmed lg:inline-flex"
                        :ui="{ leadingIcon: 'size-4', trailing: 'ms-auto' }"
                        data-prueba="buscar"
                    >
                        <template #trailing>
                            <span class="text-[0.6875rem] font-medium">Ctrl K</span>
                        </template>
                    </UDashboardSearchButton>
                    <AccesosRapidosBarra />
                </template>

                <template #right>
                    <CajaAccesoDirecto />
                    <EstadoSistemaBoton />
                    <AvisosBoton />
                    <MenuUsuario />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <AvisoFel />
            <h1
                v-if="tituloOculto"
                class="sr-only"
            >
                {{ titulo }}
            </h1>
            <UBreadcrumb
                v-else-if="encabezadoPropio && !sinMigas"
                :items="migas"
                class="hidden sm:flex"
                :ui="{ link: 'text-[0.8125rem]', linkLeadingIcon: 'size-3.5' }"
                data-prueba="migas"
            />
            <template v-else-if="encabezadoPropio" />
            <div
                v-else-if="encabezado"
                class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
                data-prueba="encabezado-pagina"
            >
                <div class="flex min-w-0 flex-col gap-1">
                    <UBreadcrumb
                        :items="migas"
                        class="hidden sm:flex"
                        :ui="{ link: 'text-[0.8125rem]', linkLeadingIcon: 'size-3.5' }"
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
            <!-- Ficha o subpágina: migas encima, título con su icono a la izquierda y las acciones de la
                 pantalla a la derecha. -->
            <div
                v-else
                class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
                data-prueba="encabezado-ficha"
            >
                <div class="flex min-w-0 flex-col gap-1">
                    <UBreadcrumb
                        v-if="ubicacion"
                        :items="migas"
                        class="hidden sm:flex"
                        :ui="{ link: 'text-[0.8125rem]', linkLeadingIcon: 'size-3.5' }"
                        data-prueba="migas"
                    />
                    <h1 class="flex min-w-0 items-center gap-2 text-xl font-bold tracking-[-0.02em] text-highlighted sm:text-2xl">
                        <UIcon
                            v-if="icono"
                            :name="icono"
                            class="size-5 shrink-0 text-primary sm:size-6"
                        />
                        <span class="min-w-0 truncate">{{ titulo }}</span>
                    </h1>
                </div>
                <div
                    v-if="$slots.acciones"
                    class="flex shrink-0 flex-wrap items-center gap-2"
                >
                    <slot name="acciones" />
                </div>
            </div>
            <slot />
        </template>
    </UDashboardPanel>
</template>
