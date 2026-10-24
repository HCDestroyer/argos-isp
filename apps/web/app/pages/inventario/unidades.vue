<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Equipos por serie o MAC (A3, `GET /inventario/unidades`): búsqueda por serie («contiene») o MAC
 * (con o sin separadores), estado, dónde está (bodega o servicio) y su historial. `?unidad=<id>`
 * (desde la bitácora) abre su historial.
 */
definePageMeta({ permiso: 'inventario.ver' })

const { enlace } = usePermisos()

useHead({ title: 'Equipos por serie · ArgosIsp' })

const route = useRoute()

const TODOS = 'todos'
const busqueda = ref(typeof route.query.q === 'string' ? route.query.q : '')
const estado = ref<EstadoUnidadInventario | typeof TODOS>(typeof route.query.estado === 'string' && route.query.estado in ESTADOS_UNIDAD ? route.query.estado as EstadoUnidadInventario : TODOS)
const itemsEstado: SelectItem[] = [{ label: 'Todos los estados', value: TODOS }, ...Object.entries(ESTADOS_UNIDAD).map(([value, e]) => ({ label: e.etiqueta, value, icon: e.icono }))]

const lista = usePaginacionCursor(cursor => useUnidadesInventario().listar({
    ...(busqueda.value.trim() ? { q: busqueda.value.trim() } : {}),
    ...(estado.value !== TODOS ? { estado: estado.value } : {}),
}, cursor))

let espera: ReturnType<typeof setTimeout> | undefined
watch(busqueda, () => {
    clearTimeout(espera)
    espera = setTimeout(() => void lista.recargar(), 300)
})
watch(estado, () => void lista.recargar())
onMounted(() => void lista.recargar())

const columnas: TableColumn<UnidadInventario>[] = [
    { id: 'equipo', header: 'Equipo', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'estado', header: 'Estado' },
    { id: 'ubicacion', header: 'Dónde está', meta: SOLO_ANCHO },
    { accessorKey: 'costo', header: 'Costo', meta: { class: { th: 'text-right hidden lg:table-cell', td: 'text-right hidden lg:table-cell' } } },
]

const desdeEnlace = Number(route.query.unidad)
const detalleAbierto = ref(Number.isInteger(desdeEnlace) && desdeEnlace > 0)
const elegida = ref<number | null>(detalleAbierto.value ? desdeEnlace : null)

function abrir(unidad: UnidadInventario) {
    elegida.value = unidad.id
    detalleAbierto.value = true
}

function alCambiar(unidad: UnidadInventario) {
    lista.filas.value = lista.filas.value.map(u => (u.id === unidad.id ? unidad : u))
}
</script>

<template>
    <PanelPagina
        id="inventario-unidades"
        titulo="Equipos por serie"
        icono="i-lucide-barcode"
    >
        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2 sm:flex-row">
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Serie o MAC"
                    class="w-full sm:w-72"
                    aria-label="Buscar por serie o MAC"
                    data-prueba="buscar-unidad"
                />
                <USelect
                    v-model="estado"
                    :items="itemsEstado"
                    class="w-full sm:w-52"
                    aria-label="Estado"
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
                    data-prueba="tabla-unidades"
                >
                    <template #equipo-cell="{ row }">
                        <div class="flex min-w-0 flex-col gap-0.5">
                            <ULink
                                class="font-mono text-sm font-medium text-highlighted hover:text-primary"
                                :data-unidad="row.original.id"
                                @click="abrir(row.original)"
                            >{{ identificacionUnidad(row.original) }}</ULink>
                            <span class="text-xs text-muted">{{ row.original.producto_nombre }} · {{ CONDICIONES_UNIDAD[row.original.condicion] }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ row.original.bodega_nombre ?? (row.original.servicio_id ? `Servicio #${row.original.servicio_id}` : '') }}</span>
                        </div>
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="ESTADOS_UNIDAD[row.original.estado].etiqueta"
                            :icon="ESTADOS_UNIDAD[row.original.estado].icono"
                            :color="ESTADOS_UNIDAD[row.original.estado].color"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #ubicacion-cell="{ row }">
                        <ULink
                            v-if="row.original.servicio_id"
                            :to="enlace(`/servicios/${row.original.servicio_id}`)"
                            class="text-sm text-primary"
                        >Servicio #{{ row.original.servicio_id }}</ULink>
                        <span
                            v-else
                            class="text-sm"
                        >{{ row.original.bodega_nombre ?? '—' }}</span>
                    </template>
                    <template #costo-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearQuetzales(row.original.costo) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-barcode"
                            title="Sin equipos"
                            :description="busqueda ? 'Ningún equipo con esa serie o MAC.' : 'Los equipos entran por compra o saldo inicial.'"
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

        <UnidadInventarioDetalle
            v-model:open="detalleAbierto"
            :unidad-id="elegida"
            @cambiada="alCambiar"
        />
    </PanelPagina>
</template>
