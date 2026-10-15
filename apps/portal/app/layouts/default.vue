<script setup lang="ts">
const { empresa } = useRuntimeConfig().public
const anio = new Date().getFullYear()
</script>

<template>
    <div class="flex min-h-dvh flex-col bg-default">
        <header class="sticky top-0 z-10 border-b border-default bg-default/90 backdrop-blur">
            <UContainer class="flex h-14 items-center justify-between gap-3">
                <NuxtLink
                    to="/"
                    class="flex min-w-0 items-center gap-2 font-semibold text-highlighted"
                >
                    <UIcon
                        name="i-lucide-wifi"
                        class="size-6 shrink-0 text-primary"
                    />
                    <span class="truncate">{{ empresa.nombre }}</span>
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
                <span>© {{ anio }} {{ empresa.nombre }}</span>
                <span v-if="empresa.telefono">Soporte: {{ empresa.telefono }}</span>
            </UContainer>
        </footer>
    </div>
</template>
