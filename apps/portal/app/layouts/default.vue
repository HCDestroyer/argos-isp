<script setup lang="ts">
/**
 * Encabezado y pie con la marca de la empresa (`useEmpresa`, multiempresa): en `/cuenta`, la
 * empresa principal del cliente de la sesión; en el resto (`/corte` sobre todo), la que decide la
 * API: la del servicio de la IP de origen, si no la principal de la sesión, si no la principal de
 * la instalación. Con varias empresas, `/cuenta` además pinta una sección por empresa con su logo.
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
 * Navegación del cliente: con sesión confirmada (`useSesionPortal`), en `/cuenta` y en `/corte`.
 * Abajo en el teléfono, arriba del contenido en escritorio.
 */
const { activa: sesionActiva } = useSesionPortal()
const conNavegacion = computed(() => sesionActiva.value && (route.path === '/cuenta' || route.path === '/corte'))
/** "ArgosIsp" solo como firma del sistema cuando la empresa tiene su propio nombre. */
const mostrarProducto = computed(() => nombre.value !== 'ArgosIsp')
</script>

<template>
    <div
        class="relative flex min-h-dvh flex-col"
        :class="{ 'pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0': conNavegacion }"
    >
        <div
            class="app-aura"
            :class="{ 'app-aura-lite': auraLiviana }"
            aria-hidden="true"
            data-testid="app-aura"
        />

        <header class="chrome-material sticky top-0 z-10 border-b border-default pt-[env(safe-area-inset-top)]">
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

        <main class="relative flex-1 py-6 sm:py-10">
            <UContainer class="flex max-w-xl flex-col gap-4">
                <PortalNavegacion
                    v-if="conNavegacion"
                    variante="superior"
                />
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
        </footer>

        <PortalNavegacion
            v-if="conNavegacion"
            variante="inferior"
        />
    </div>
</template>
