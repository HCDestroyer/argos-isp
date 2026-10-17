<script setup lang="ts">
/**
 * Navegación del cliente con sesión.
 *
 * - `inferior` (móvil, < md): barra fija abajo, de vidrio, con las cuatro secciones. Cada destino
 *   mide al menos 56 × 44 px y la barra deja libre la zona del indicador de inicio del iPhone
 *   (`env(safe-area-inset-bottom)`, con `viewport-fit=cover` en `nuxt.config.ts`).
 * - `superior` (escritorio, ≥ md): las mismas secciones como barra centrada sobre el contenido.
 */
const props = defineProps<{
    variante: 'inferior' | 'superior'
}>()

const route = useRoute()
const activa = computed(() => seccionActiva(route))
</script>

<template>
    <nav
        :aria-label="props.variante === 'inferior' ? 'Secciones de mi cuenta' : 'Secciones de mi cuenta (escritorio)'"
        :class="props.variante === 'inferior'
            ? 'chrome-material fixed inset-x-0 bottom-0 z-30 border-t border-default pb-[env(safe-area-inset-bottom)] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)] md:hidden'
            : 'surface-card hidden p-1 md:block'"
        :data-testid="`navegacion-${props.variante}`"
    >
        <ul class="mx-auto grid max-w-xl grid-cols-4 gap-1">
            <li
                v-for="item in SECCIONES_CUENTA"
                :key="item.seccion"
            >
                <UButton
                    :to="item.to"
                    :icon="item.icono"
                    :label="item.etiqueta"
                    :color="activa === item.seccion ? 'primary' : 'neutral'"
                    :variant="activa === item.seccion ? 'soft' : 'ghost'"
                    :aria-current="activa === item.seccion ? 'page' : undefined"
                    block
                    :data-testid="`nav-${item.seccion}`"
                    :ui="props.variante === 'inferior'
                        ? {
                            base: 'min-h-14 flex-col gap-0.5 rounded-lg px-1 py-1.5 text-xs font-medium',
                            leadingIcon: 'size-6',
                        }
                        : { base: 'min-h-11 gap-2 text-sm' }"
                />
            </li>
        </ul>
    </nav>
</template>
