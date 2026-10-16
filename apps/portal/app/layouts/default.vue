<script setup lang="ts">
/** Encabezado y pie con los datos de la empresa configurados en el panel (`useEmpresa`). */
const { empresa, nombre } = useEmpresa()
const anio = new Date().getFullYear()
</script>

<template>
    <div class="flex min-h-dvh flex-col bg-default">
        <header class="sticky top-0 z-10 border-b border-default bg-default/90 backdrop-blur">
            <UContainer class="flex h-14 items-center justify-between gap-3">
                <NuxtLink
                    to="/"
                    class="flex min-h-11 min-w-0 items-center gap-2 font-semibold text-highlighted"
                >
                    <UIcon
                        name="i-lucide-wifi"
                        class="size-6 shrink-0 text-primary"
                        aria-hidden="true"
                    />
                    <span class="truncate">{{ nombre }}</span>
                </NuxtLink>

                <UColorModeButton />
            </UContainer>
        </header>

        <main class="flex-1 py-6 sm:py-10">
            <UContainer class="max-w-xl">
                <slot />
            </UContainer>
        </main>

        <footer class="border-t border-default py-4">
            <UContainer class="flex flex-col items-center gap-1 text-center text-xs text-muted sm:flex-row sm:justify-between">
                <span>© {{ anio }} {{ nombre }}</span>
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
