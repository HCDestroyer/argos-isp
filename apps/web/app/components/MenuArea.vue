<script setup lang="ts">
/**
 * Menú flotante de un área del menú compacto (rail): sus secciones agrupadas con separadores, el
 * icono de cada una y sus contadores (Comprobantes 7, Caja «Abierta»). Se recorre con Tab y las
 * flechas; Esc lo cierra (popover) y elegir una sección también.
 */
const props = defineProps<{
    grupo: Pick<GrupoSecciones, 'id' | 'etiqueta' | 'secciones'> & { subgrupos: SubgrupoSecciones[] }
    contadores: Record<string, string | undefined>
    estadoSeccion: (id: string) => string | undefined
}>()

const emit = defineEmits<{ elegir: [] }>()

const bloques = computed(() => [
    ...(props.grupo.secciones.length ? [{ id: 'sueltas', etiqueta: props.grupo.etiqueta, secciones: props.grupo.secciones }] : []),
    ...props.grupo.subgrupos.map(subgrupo => ({ id: subgrupo.id, etiqueta: subgrupo.etiqueta, secciones: subgrupo.secciones })),
])

const lista = ref<HTMLElement | null>(null)

/** Flechas arriba y abajo entre los enlaces del menú. */
function alTeclear(evento: KeyboardEvent) {
    if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') {
        return
    }
    const enlaces = [...(lista.value?.querySelectorAll<HTMLElement>('a[href]') ?? [])]
    const actual = enlaces.indexOf(document.activeElement as HTMLElement)
    const siguiente = evento.key === 'ArrowDown' ? Math.min(enlaces.length - 1, actual + 1) : Math.max(0, actual - 1)
    enlaces[siguiente]?.focus()
    evento.preventDefault()
}
</script>

<template>
    <nav
        ref="lista"
        class="flex max-h-[min(32rem,80dvh)] w-64 flex-col gap-1 overflow-y-auto p-2"
        :aria-label="grupo.etiqueta"
        :data-prueba="`menu-area-${grupo.id}`"
        @keydown="alTeclear"
    >
        <template
            v-for="(bloque, indice) in bloques"
            :key="bloque.id"
        >
            <USeparator
                v-if="indice > 0"
                class="my-1"
            />
            <p class="px-2 pt-1 text-[0.6875rem] font-bold tracking-[0.06em] text-dimmed uppercase">
                {{ bloque.etiqueta }}
            </p>
            <ULink
                v-for="seccion in bloque.secciones"
                :key="seccion.id"
                :to="seccion.ruta"
                :title="seccion.descripcion"
                class="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-default transition-colors hover:bg-(--ax-fila-hover) hover:text-primary focus-visible:bg-(--ax-fila-hover)"
                active-class="bg-primary/10 text-primary font-semibold"
                @click="emit('elegir')"
            >
                <UIcon
                    :name="seccion.icono"
                    class="size-4 shrink-0 text-primary"
                />
                <span class="flex-1 truncate">{{ seccion.etiqueta }}</span>
                <UBadge
                    v-if="contadores[seccion.id]"
                    :label="contadores[seccion.id]"
                    size="sm"
                    variant="solid"
                    class="rounded-full"
                />
                <UBadge
                    v-else-if="estadoSeccion(seccion.id)"
                    :label="estadoSeccion(seccion.id)"
                    color="success"
                    variant="subtle"
                    size="sm"
                    class="rounded-full"
                />
            </ULink>
        </template>
    </nav>
</template>
