<script setup lang="ts">
/**
 * Encabezado y pie con los datos de la empresa configurados en el panel (`useEmpresa`).
 *
 * Materiales "vidrio y luz": aura de fondo, barra superior de vidrio y el contenido encima. En
 * `/corte` el aura es la liviana (`app-aura-lite`, sin difuminado ni deriva): esa página se abre
 * en teléfonos de clientes suspendidos y tiene que ser lo más barata posible.
 */
const { empresa, nombre } = useEmpresa()
const route = useRoute()
const anio = new Date().getFullYear()

const auraLiviana = computed(() => route.path === '/corte')
/** "ArgosIsp" solo como firma del sistema cuando la empresa tiene su propio nombre. */
const mostrarProducto = computed(() => nombre.value !== 'ArgosIsp')
</script>

<template>
    <div class="relative flex min-h-dvh flex-col">
        <div
            class="app-aura"
            :class="{ 'app-aura-lite': auraLiviana }"
            aria-hidden="true"
            data-testid="app-aura"
        />

        <header class="chrome-material sticky top-0 z-10 border-b border-default">
            <UContainer class="flex h-14 items-center justify-between gap-3">
                <NuxtLink
                    to="/"
                    class="flex min-h-11 min-w-0 items-center gap-2.5 font-semibold tracking-[-0.015em] text-highlighted"
                >
                    <LogoArgos class="size-8 shrink-0" />
                    <span class="truncate">{{ nombre }}</span>
                </NuxtLink>

                <UColorModeButton />
            </UContainer>
        </header>

        <main class="relative flex-1 py-6 sm:py-10">
            <UContainer class="max-w-xl">
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
    </div>
</template>
