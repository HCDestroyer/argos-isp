<script setup lang="ts">
/**
 * Navegación del cliente con sesión.
 *
 * - `inferior` (móvil, < md): barra fija abajo, de vidrio, con las cuatro secciones (cinco con «Puntos»). Cada destino
 *   mide al menos 56 × 44 px y la barra deja libre la zona del indicador de inicio del iPhone
 *   (`env(safe-area-inset-bottom)`, con `viewport-fit=cover` en `nuxt.config.ts`).
 * - `superior` (escritorio, ≥ md): las mismas secciones como barra centrada sobre el contenido; con
 *   cinco (con «Puntos») van sin icono, para que «Facturas» no se corte. La
 *
 * En las dos, la activa lleva el texto en `text-highlighted` sobre el tinte teal: el primario sobre
 * su propio tinte, encima del vidrio, no llegaba al contraste AA (axe, `tests/e2e/accesibilidad.spec.ts`).
 */
const props = defineProps<{
    variante: 'inferior' | 'superior'
}>()

const route = useRoute()
const activa = computed(() => seccionActiva(route))
// «Puntos» aparece solo si el programa está visible en el portal (lo activa el panel).
const { visible: conPuntos } = usePuntos()
const secciones = computed(() => seccionesVisibles(conPuntos.value))
</script>

<template>
    <nav
        :aria-label="props.variante === 'inferior' ? 'Secciones de mi cuenta' : 'Secciones de mi cuenta (escritorio)'"
        :class="props.variante === 'inferior'
            ? 'chrome-material fixed inset-x-0 bottom-0 z-30 border-t border-default pb-[env(safe-area-inset-bottom)] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)] md:hidden'
            : 'surface-card hidden p-1 md:block'"
        :data-testid="`navegacion-${props.variante}`"
    >
        <ul
            class="mx-auto grid max-w-xl gap-1"
            :class="secciones.length === 5 ? 'grid-cols-5' : 'grid-cols-4'"
        >
            <li
                v-for="item in secciones"
                :key="item.seccion"
            >
                <UButton
                    :to="item.to"
                    :icon="props.variante === 'superior' && secciones.length === 5 ? undefined : item.icono"
                    :label="item.etiqueta"
                    :color="activa === item.seccion ? 'primary' : 'neutral'"
                    :variant="activa === item.seccion ? 'soft' : 'ghost'"
                    :aria-current="activa === item.seccion ? 'page' : undefined"
                    block
                    :data-testid="`nav-${item.seccion}`"
                    :ui="props.variante === 'inferior'
                        ? {
                            base: ['min-h-14 flex-col gap-0.5 rounded-lg px-1 py-1.5 text-xs font-medium', activa === item.seccion ? 'text-highlighted' : ''].join(' '),
                            leadingIcon: 'size-6',
                        }
                        : { base: ['min-h-11 gap-2 text-sm', secciones.length === 5 ? 'justify-center px-2' : '', activa === item.seccion ? 'text-highlighted' : ''].join(' ') }"
                />
            </li>
        </ul>
    </nav>
</template>
