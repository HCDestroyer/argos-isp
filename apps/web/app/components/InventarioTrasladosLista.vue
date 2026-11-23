<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h } from 'vue'

/**
 * Lista de órdenes de traslado (tablero NuevoBodegas): número, de → a, enviado, estado y contenido,
 * con las pastillas «Todos / En camino / Con faltante». La usan «Bodegas y traslados» y la pantalla
 * de traslados (que agrega número y bodega en `#filtros`). Cada fila lleva a su orden.
 */
const props = withDefaults(defineProps<{
    /** Título de la tarjeta («Traslados»); sin título, solo las pastillas. */
    titulo?: string
    /** Filtros extra de la pantalla (bodega, número) que se suman a la pastilla. */
    filtros?: FiltrosOrdenesTraslado
}>(), {
    titulo: undefined,
    filtros: () => ({}),
})

type Pastilla = 'todos' | 'en_transito' | 'recibida_con_diferencias'

const route = useRoute()
const { enlace } = usePermisos()
const inicial = route.query.estado === 'en_transito' || route.query.estado === 'recibida_con_diferencias' ? route.query.estado : 'todos'
const pastilla = ref<Pastilla>(inicial)
const enCamino = ref<number | null>(null)

const lista = usePaginacionCursor(cursor => useOrdenesTraslado().listar({
    ...props.filtros,
    ...(pastilla.value !== 'todos' ? { estado: pastilla.value } : {}),
}, cursor))

async function contarEnCamino() {
    const r = await useOrdenesTraslado().listar({ estado: 'en_transito', limit: 50 })
    enCamino.value = r.ok ? r.data.data.length : null
}

function recargar() {
    void lista.recargar()
    void contarEnCamino()
}

defineExpose({ recargar })
watch([pastilla, () => props.filtros], () => void lista.recargar(), { deep: true })
onMounted(recargar)

const pastillas = computed(() => [
    { valor: 'todos' as const, etiqueta: 'Todos', n: null },
    { valor: 'en_transito' as const, etiqueta: 'En camino', n: enCamino.value },
    { valor: 'recibida_con_diferencias' as const, etiqueta: 'Con faltante', n: null },
])

/** «En camino», «Recibido con firma», «Con faltante»… como en el tablero. */
function estadoDe(o: OrdenTraslado): { etiqueta: string, color: 'warning' | 'success' | 'error' | 'neutral', icono: string } {
    switch (o.estado) {
        case 'en_transito': return { etiqueta: 'En camino', color: 'warning', icono: 'i-lucide-truck' }
        case 'recibida': return { etiqueta: o.metodo_recepcion === 'firma_digital' || o.metodo_recepcion === 'firma_papel' ? 'Recibido con firma' : 'Recibido', color: 'success', icono: 'i-lucide-package-check' }
        case 'recibida_con_diferencias': return { etiqueta: 'Con faltante', color: 'error', icono: 'i-lucide-package-x' }
        default: return { etiqueta: ESTADOS_ORDEN_TRASLADO[o.estado].etiqueta, color: 'neutral', icono: ESTADOS_ORDEN_TRASLADO[o.estado].icono }
    }
}

const destino = (o: OrdenTraslado) => (o.usuario_destino_nombre ? o.usuario_destino_nombre.split(' ')[0] : nombreCortoBodega(o.bodega_destino_nombre))

const columnas: TableColumn<OrdenTraslado>[] = [
    { accessorKey: 'numero', header: 'Número' },
    { id: 'ruta', header: 'De → a', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'enviado_en', header: 'Enviado', meta: SOLO_ANCHO },
    { accessorKey: 'estado', header: 'Estado' },
    { id: 'contenido', header: 'Contenido', meta: SOLO_ESCRITORIO },
    { id: 'ir', header: () => h('span', { class: 'sr-only' }, 'Abrir'), meta: { class: { td: 'w-0 text-end', th: 'w-0' } } },
]

/** Sin permiso para abrir la orden, la fila no navega y el número queda como texto. */
function alElegir(_evento: Event, fila: { original: OrdenTraslado }) {
    const destino = enlace(`/inventario/traslados/${fila.original.id}`)
    if (destino) {
        void navigateTo(destino)
    }
}
</script>

<template>
    <div class="flex min-w-0 flex-col">
        <div class="flex flex-wrap items-center gap-2 p-3 sm:px-4">
            <h2
                v-if="titulo"
                class="me-2 text-lg font-semibold text-highlighted"
            >
                {{ titulo }}
            </h2>
            <div
                class="flex flex-wrap gap-1.5"
                role="group"
                aria-label="Filtrar traslados por estado"
                data-prueba="filtro-estado-traslado"
            >
                <UButton
                    v-for="p in pastillas"
                    :key="p.valor"
                    :label="p.etiqueta"
                    :color="pastilla === p.valor ? 'primary' : 'neutral'"
                    :variant="pastilla === p.valor ? 'solid' : 'outline'"
                    :aria-pressed="pastilla === p.valor"
                    size="sm"
                    class="rounded-full"
                    :data-pastilla="p.valor"
                    @click="pastilla = p.valor"
                >
                    <template
                        v-if="p.n"
                        #trailing
                    >
                        <UBadge
                            :label="String(p.n)"
                            size="sm"
                            color="neutral"
                            variant="soft"
                        />
                    </template>
                </UButton>
            </div>
            <slot name="filtros" />
        </div>
        <div
            v-if="lista.problema.value"
            class="p-3 sm:p-4"
        >
            <ProblemaAlerta
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
            />
        </div>
        <template v-else>
            <UTable
                :data="lista.filas.value"
                :columns="columnas"
                :loading="lista.cargando.value"
                sticky
                :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3', tr: 'cursor-pointer' }"
                data-prueba="tabla-traslados"
                @select="alElegir"
            >
                <template #numero-cell="{ row }">
                    <ULink
                        :to="enlace(`/inventario/traslados/${row.original.id}`)"
                        class="font-mono text-sm text-highlighted hover:text-primary"
                        :data-orden="row.original.numero"
                    >T-{{ String(row.original.numero).padStart(4, '0') }}</ULink>
                </template>
                <template #ruta-cell="{ row }">
                    <div class="flex flex-col">
                        <span class="font-semibold text-highlighted">{{ nombreCortoBodega(row.original.bodega_origen_nombre) }} → {{ destino(row.original) }}</span>
                        <span class="text-xs text-muted sm:hidden">{{ formatearFechaCorta(row.original.enviado_en) }} {{ formatearHora(row.original.enviado_en) }}</span>
                    </div>
                </template>
                <template #enviado_en-cell="{ row }">
                    <span class="whitespace-nowrap text-sm text-muted">{{ formatearFechaCorta(row.original.enviado_en) }} {{ formatearHora(row.original.enviado_en) }}</span>
                </template>
                <template #estado-cell="{ row }">
                    <UBadge
                        :label="estadoDe(row.original).etiqueta"
                        :icon="estadoDe(row.original).icono"
                        :color="estadoDe(row.original).color"
                        variant="subtle"
                        size="sm"
                        class="rounded-full"
                        data-prueba="estado-orden"
                    />
                </template>
                <template #contenido-cell="{ row }">
                    <span class="text-sm">{{ row.original.lineas_total }} {{ row.original.lineas_total === 1 ? 'producto' : 'productos' }} · {{ formatearQuetzales(row.original.costo_total) }}</span>
                </template>
                <template #ir-cell>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="size-4 text-muted"
                    />
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-truck"
                        title="Sin traslados"
                        :description="pastilla === 'todos' ? 'Todavía no se ha enviado ninguna orden de traslado.' : 'Ninguna orden con este estado.'"
                        variant="naked"
                    />
                </template>
            </UTable>
            <div
                v-if="lista.hayAnterior.value || lista.haySiguiente.value"
                class="border-t border-(--ax-borde) px-3 py-2 sm:px-4"
            >
                <PaginacionCursor
                    :pagina="lista.pagina.value"
                    :hay-anterior="lista.hayAnterior.value"
                    :hay-siguiente="lista.haySiguiente.value"
                    :cargando="lista.cargando.value"
                    :filas="lista.filas.value.length"
                    @anterior="lista.anterior"
                    @siguiente="lista.siguiente"
                />
            </div>
        </template>
    </div>
</template>
