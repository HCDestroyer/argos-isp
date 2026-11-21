<script setup lang="ts">
/**
 * Navegación del cliente con sesión (diseño aprobado, tableros `Portal` y `NuevoPortal`).
 *
 * - `inferior` (teléfono, < lg): barra fija abajo, de vidrio, con las secciones (Inicio, Facturas,
 *   Soporte con Iris, Puntos con el programa visible, Cuenta). Cada destino mide al menos 56 × 44 px
 *   y la barra deja libre la zona del indicador de inicio del iPhone (`env(safe-area-inset-bottom)`,
 *   con `viewport-fit=cover` en `nuxt.config.ts`).
 * - `lateral` (escritorio, ≥ lg): menú «isla» a la izquierda, flotando a 16 px del borde como el del
 *   panel, con la marca de la empresa arriba, las secciones con su nombre largo («Facturas y pagos»,
 *   «Mis puntos», «Mi cuenta») y el cambio de tema abajo.
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

    <nav
        v-else
        aria-label="Menú de mi cuenta"
        class="ax-isla sticky top-4 hidden max-h-[calc(100dvh-2rem)] w-60 shrink-0 flex-col gap-1 overflow-y-auto p-3.5 lg:flex"
        data-testid="navegacion-lateral"
    >
        <NuxtLink
            to="/cuenta"
            class="mb-3 flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg px-2 pt-1 font-semibold tracking-[-0.015em] text-highlighted"
        >
            <PortalMarcaEmpresa
                :nombre="props.nombre ?? ''"
                :logo-url="props.logoUrl ?? null"
                respaldo="argos"
                class="size-8"
            />
            <span class="truncate">{{ props.nombre }}</span>
        </NuxtLink>
        <ul class="flex flex-col gap-1">
            <li
                v-for="item in secciones"
                :key="item.seccion"
            >
                <UButton
                    :to="item.to"
                    :icon="item.icono"
                    :label="item.etiquetaLarga"
                    color="neutral"
                    variant="ghost"
                    :aria-current="activa === item.seccion ? 'page' : undefined"
                    block
                    :data-testid="`nav-${item.seccion}`"
                    :ui="{
                        base: ['min-h-11 justify-start gap-2.5 rounded-[0.625rem] px-3 text-sm font-medium', activa === item.seccion ? 'bg-(--ax-nav-activa) text-highlighted hover:bg-(--ax-nav-activa)' : 'text-toned'].join(' '),
                        leadingIcon: ['size-[18px]', activa === item.seccion ? 'text-primary' : ''].join(' '),
                    }"
                />
            </li>
        </ul>
        <div class="mt-auto flex items-center justify-between gap-2 border-t border-default px-1 pt-3">
            <span class="text-xs text-muted">Tema</span>
            <UColorModeButton />
        </div>
    </nav>
</template>
