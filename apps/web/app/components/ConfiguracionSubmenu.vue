<script setup lang="ts">
/**
 * Submenú de Configuración (tableros OperConfig*): isla con «Configuración», el buscador de ajustes y
 * las secciones con su frase corta. Una sección sin ninguna pantalla permitida no aparece; la que
 * contiene la ruta actual queda resaltada. Al tocar una sección se abre su primera pantalla
 * permitida.
 */
const props = withDefaults(defineProps<{
    /** Id de la sección activa (o `null` en el índice). */
    activa?: string | null
}>(), {
    activa: null,
})

const { puedePagina } = usePaginasConfiguracion()
const busqueda = ref('')

const secciones = computed(() => {
    const termino = normalizarBusqueda(busqueda.value.trim())
    return SECCIONES_CONFIGURACION
        .map(seccion => ({ seccion, paginas: seccion.paginas.filter(puedePagina) }))
        .filter(({ paginas }) => paginas.length > 0)
        .filter(({ seccion, paginas }) => !termino || normalizarBusqueda(`${seccion.etiqueta} ${seccion.resumen} ${paginas.map(p => p.etiqueta).join(' ')}`).includes(termino))
})
</script>

<template>
    <nav
        class="surface-card flex min-h-0 flex-col gap-3 rounded-2xl p-3 lg:h-full"
        aria-label="Secciones de la configuración"
        data-prueba="submenu-configuracion"
    >
        <p class="px-2 pt-1 text-lg font-bold tracking-[-0.01em] text-highlighted">
            Configuración
        </p>
        <UInput
            v-model="busqueda"
            icon="i-lucide-search"
            placeholder="Buscar un ajuste…"
            aria-label="Buscar un ajuste"
            class="w-full"
            :ui="{ base: 'rounded-full' }"
            data-prueba="buscar-ajuste"
        />
        <ul class="-mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1">
            <li
                v-for="{ seccion, paginas } in secciones"
                :key="seccion.id"
            >
                <ULink
                    :to="paginas[0]?.ruta"
                    class="flex items-start gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-(--ax-fila-hover)"
                    :class="props.activa === seccion.id ? 'bg-primary/10 text-primary hover:bg-primary/10' : 'text-default'"
                    :aria-current="props.activa === seccion.id ? 'page' : undefined"
                    :data-seccion-config="seccion.id"
                >
                    <UIcon
                        :name="seccion.icono"
                        class="mt-0.5 size-4 shrink-0"
                        :class="props.activa === seccion.id ? 'text-primary' : 'text-muted'"
                    />
                    <span class="flex min-w-0 flex-col">
                        <span
                            class="text-sm font-semibold"
                            :class="props.activa === seccion.id ? 'text-primary' : 'text-highlighted'"
                        >{{ seccion.etiqueta }}</span>
                        <span class="text-xs text-muted">{{ seccion.resumen }}</span>
                    </span>
                </ULink>
            </li>
        </ul>
        <p
            v-if="!secciones.length"
            class="px-2 text-sm text-muted"
        >
            Nada coincide con «{{ busqueda }}».
        </p>
    </nav>
</template>
