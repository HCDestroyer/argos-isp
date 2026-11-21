<script setup lang="ts">
/**
 * Encabezado y pie con la marca de la empresa (`useEmpresa`, multiempresa): en `/cuenta`, la
 * empresa principal del cliente de la sesión; en el resto (`/corte` sobre todo), la que decide la
 * API: la del servicio de la IP de origen, si no la principal de la sesión, si no la principal de
 * la instalación. Con varias empresas, `/cuenta` además pinta una sección por empresa con su logo.
 *
 * Con sesión en escritorio, el menú lateral «isla» reemplaza la barra superior.
 *
 * Materiales "vidrio y luz": aura de fondo, barra superior de vidrio y el contenido encima. En
 * `/corte` el aura es la liviana (`app-aura-lite`, sin difuminado ni deriva): esa página se abre
 * en teléfonos de clientes suspendidos y tiene que ser lo más barata posible.
 */
const route = useRoute()
const { empresa, nombre, logoUrl } = useEmpresa({ de: () => route.path === '/cuenta' ? 'cliente' : undefined })
const anio = new Date().getFullYear()

const auraLiviana = computed(() => route.path === '/corte')
/**
 * Ancho del contenido: `/cuenta` (tablero en rejilla con indicadores, listas que son tablas y una
 * columna lateral), `/comprobante` y el login dividido (`/entrar`, `/cambiar-contrasena`) usan el
 * ancho de escritorio (hasta 1200 px); el resto, una columna de lectura.
 */
const anchoAmplio = computed(() => ['/cuenta', '/entrar', '/cambiar-contrasena', '/comprobante'].includes(route.path))
/**
 * Navegación del cliente: con sesión confirmada (`useSesionPortal`), en `/cuenta` y en `/corte`.
 * Abajo en el teléfono y la tableta; en escritorio (≥ lg), el menú «isla» a la izquierda con la
 * marca y el tema (tablero `NuevoPortal`), y sin barra superior.
 */
const { activa: sesionActiva } = useSesionPortal()
const conNavegacion = computed(() => sesionActiva.value && (route.path === '/cuenta' || route.path === '/corte'))
/** "ArgosIsp" solo como firma del sistema cuando la empresa tiene su propio nombre. */
const mostrarProducto = computed(() => nombre.value !== 'ArgosIsp')
</script>

<template>
    <div
        class="relative flex min-h-dvh"
        :class="{ 'pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0': conNavegacion }"
        :style="conNavegacion ? { '--ax-nav-inferior': 'calc(4.5rem + env(safe-area-inset-bottom))', '--ax-barra-seguro': '0px' } : undefined"
    >
        <div
            class="app-aura"
            :class="{ 'app-aura-lite': auraLiviana }"
            aria-hidden="true"
            data-testid="app-aura"
        />

        <div
            v-if="conNavegacion"
            class="relative z-10 hidden py-4 ps-4 lg:block"
        >
            <PortalNavegacion
                variante="lateral"
                :nombre="nombre"
                :logo-url="logoUrl"
            />
        </div>

        <div class="flex min-w-0 flex-1 flex-col">
            <header
                class="chrome-material ax-filo sticky top-0 z-10 border-b border-default pt-[env(safe-area-inset-top)]"
                :class="{ 'lg:hidden': conNavegacion }"
            >
                <UContainer class="flex h-14 items-center justify-between gap-3">
                    <NuxtLink
                        to="/"
                        class="flex min-h-11 min-w-0 items-center gap-2.5 font-semibold tracking-[-0.015em] text-highlighted"
                    >
                        <PortalMarcaEmpresa
                            :nombre="nombre"
                            :logo-url="logoUrl"
                            respaldo="argos"
                            class="size-8"
                        />
                        <span
                            class="truncate"
                            data-testid="marca-encabezado"
                        >{{ nombre }}</span>
                    </NuxtLink>

                    <UColorModeButton />
                </UContainer>
            </header>

            <main
                class="relative flex-1 py-6 sm:py-10"
                :class="{ 'lg:py-4': conNavegacion }"
            >
                <UContainer
                    class="entrada-pagina flex flex-col gap-4"
                    :class="[anchoAmplio ? 'max-w-[75rem]' : 'max-w-xl', conNavegacion ? 'lg:px-6' : '']"
                >
                    <slot />
                </UContainer>
            </main>

            <footer class="relative border-t border-default py-4">
                <UContainer class="flex flex-col items-center gap-1 text-center text-xs text-muted sm:flex-row sm:justify-between">
                    <span>
                        © {{ anio }} {{ nombre }}<template v-if="mostrarProducto"> · <span class="font-semibold">ArgosIsp</span></template>
                    </span>
                    <ULink
                        to="/contacto"
                        class="inline-flex min-h-11 items-center px-2 text-muted hover:text-default"
                    >
                        {{ empresa?.telefono ? `Soporte: ${empresa.telefono}` : 'Contacto' }}
                    </ULink>
                </UContainer>
                <!-- Políticas públicas (revisión de Meta): enlaces internos, sin recursos externos; también en /corte. -->
                <UContainer>
                    <nav
                        aria-label="Políticas"
                        class="flex flex-wrap items-center justify-center gap-x-1 text-xs sm:justify-end"
                        data-testid="pie-politicas"
                    >
                        <ULink
                            v-for="politica in POLITICAS"
                            :key="politica.to"
                            :to="politica.to"
                            class="inline-flex min-h-11 items-center px-2 text-muted hover:text-default"
                        >
                            {{ politica.label }}
                        </ULink>
                    </nav>
                </UContainer>
            </footer>
        </div>

        <PortalNavegacion
            v-if="conNavegacion"
            variante="inferior"
        />
    </div>
</template>
