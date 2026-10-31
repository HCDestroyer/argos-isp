<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Órdenes de traslado (A3, `contratos/inventario.md` D.1): lo enviado viaja «en tránsito» hasta que
 * el destino lo recibe. Filtros por estado, bodega, técnico y número; «Recibida con diferencias»
 * es la lista de faltantes por investigar. «Nueva orden» con `inventario.crear_traslado`.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Traslados · ArgosIsp' })

const { puede } = usePermisos()
const route = useRoute()

const TODOS = 'todos'
const estado = ref<OrdenTraslado['estado'] | typeof TODOS>(typeof route.query.estado === 'string' && route.query.estado in ESTADOS_ORDEN_TRASLADO ? route.query.estado as OrdenTraslado['estado'] : TODOS)
const bodegaId = ref<number | typeof TODOS>(TODOS)
const tecnicoBodegaId = ref<number | typeof TODOS>(TODOS)
const numero = ref('')

const itemsEstado: SelectItem[] = [
    { label: 'Todo estado', value: TODOS },
    ...Object.entries(ESTADOS_ORDEN_TRASLADO).map(([value, e]) => ({ label: e.etiqueta, value, icon: e.icono })),
]

const bodegas = shallowRef<Bodega[]>([])
const itemsBodega = computed<SelectItem[]>(() => [{ label: 'Toda bodega', value: TODOS }, ...bodegas.value.filter(b => b.tipo === 'bodega').map(b => ({ label: b.nombre, value: b.id }))])
const itemsTecnico = computed<SelectItem[]>(() => [{ label: 'Todo técnico', value: TODOS }, ...bodegas.value.filter(b => b.tipo === 'tecnico').map(b => ({ label: b.usuario_nombre ?? b.nombre, value: b.id, description: b.nombre }))])

const lista = usePaginacionCursor(cursor => useOrdenesTraslado().listar({
    ...(estado.value !== TODOS ? { estado: estado.value } : {}),
    ...(tecnicoBodegaId.value !== TODOS ? { bodega_id: tecnicoBodegaId.value } : bodegaId.value !== TODOS ? { bodega_id: bodegaId.value } : {}),
    ...(/^\d+$/.test(numero.value.trim()) ? { numero: Number(numero.value.trim()) } : {}),
}, cursor))

watch(bodegaId, (valor) => {
    if (valor !== TODOS) {
        tecnicoBodegaId.value = TODOS
    }
})
watch(tecnicoBodegaId, (valor) => {
    if (valor !== TODOS) {
        bodegaId.value = TODOS
    }
})
watch([estado, bodegaId, tecnicoBodegaId], () => void lista.recargar())
let espera: ReturnType<typeof setTimeout> | undefined
watch(numero, () => {
    clearTimeout(espera)
    espera = setTimeout(() => void lista.recargar(), 300)
})

onMounted(async () => {
    void lista.recargar()
    const resultado = await useBodegas().listar({ limit: 200 })
    bodegas.value = resultado.ok ? resultado.data.data : []
})

const columnas: TableColumn<OrdenTraslado>[] = [
    { accessorKey: 'numero', header: 'Orden', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
    { accessorKey: 'enviado_en', header: 'Enviada', meta: SOLO_ANCHO },
    { accessorKey: 'lineas_total', header: 'Líneas', meta: { class: { th: 'text-right hidden lg:table-cell', td: 'text-right hidden lg:table-cell' } } },
    { accessorKey: 'costo_total', header: 'Valor', meta: { class: { th: 'text-right hidden lg:table-cell', td: 'text-right hidden lg:table-cell' } } },
]
</script>

<template>
    <PanelPagina
        id="inventario-traslados"
        titulo="Órdenes de traslado"
        icono="i-lucide-truck"
    >
        <template #acciones>
            <UButton
                v-if="puede('inventario.crear_traslado')"
                label="Nueva orden"
                icon="i-lucide-plus"
                to="/inventario/traslados/nueva"
                data-prueba="nueva-orden-traslado"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-row">
                <USelect
                    v-model="estado"
                    :items="itemsEstado"
                    class="w-full lg:w-56"
                    aria-label="Estado"
                    data-prueba="filtro-estado-traslado"
                />
                <USelect
                    v-model="bodegaId"
                    :items="itemsBodega"
                    class="w-full lg:w-52"
                    aria-label="Bodega"
                />
                <USelect
                    v-model="tecnicoBodegaId"
                    :items="itemsTecnico"
                    class="w-full lg:w-52"
                    aria-label="Técnico"
                />
                <UInput
                    v-model="numero"
                    icon="i-lucide-hash"
                    inputmode="numeric"
                    placeholder="Número"
                    class="w-full lg:w-36"
                    aria-label="Número de orden"
                />
            </div>
            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
            />
            <template v-else>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    :ui="{ td: 'py-3' }"
                    data-prueba="tabla-traslados"
                >
                    <template #numero-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col gap-0.5"
                            :data-orden="row.original.numero"
                        >
                            <ULink
                                :to="`/inventario/traslados/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >Orden N.º {{ row.original.numero }}</ULink>
                            <span class="text-xs text-muted">{{ rutaOrden(row.original) }}</span>
                            <span class="sm:hidden">
                                <UBadge
                                    :label="ESTADOS_ORDEN_TRASLADO[row.original.estado].etiqueta"
                                    :color="ESTADOS_ORDEN_TRASLADO[row.original.estado].color"
                                    variant="subtle"
                                    size="sm"
                                />
                            </span>
                        </div>
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="ESTADOS_ORDEN_TRASLADO[row.original.estado].etiqueta"
                            :icon="ESTADOS_ORDEN_TRASLADO[row.original.estado].icono"
                            :color="ESTADOS_ORDEN_TRASLADO[row.original.estado].color"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #enviado_en-cell="{ row }">
                        <span class="text-sm">{{ formatearFechaHora(row.original.enviado_en) }}</span>
                    </template>
                    <template #costo_total-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearQuetzales(row.original.costo_total) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-truck"
                            title="Sin órdenes de traslado"
                            description="Envía productos y equipos a otra bodega o a un técnico; quien recibe firma al llegar."
                            variant="naked"
                        />
                    </template>
                </UTable>
                <PaginacionCursor
                    :pagina="lista.pagina.value"
                    :hay-anterior="lista.hayAnterior.value"
                    :hay-siguiente="lista.haySiguiente.value"
                    :cargando="lista.cargando.value"
                    :filas="lista.filas.value.length"
                    @anterior="lista.anterior"
                    @siguiente="lista.siguiente"
                />
            </template>
        </div>
    </PanelPagina>
</template>
