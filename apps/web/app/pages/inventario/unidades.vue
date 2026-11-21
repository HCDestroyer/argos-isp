<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'
import { h } from 'vue'

/**
 * Inventario · Equipos por serie o MAC (tablero NuevoInventario, A3 y A48): equipo, serie y MAC,
 * estado del equipo (con icono, texto y color) y dónde o con quién está. Clic en la fila abre su
 * ficha con el historial y las acciones que permite su estado (cambiar, recibir, contacto, no
 * recuperado, revisión y garantía), cada una con su permiso. `?unidad=<id>` (desde la bitácora)
 * abre su ficha; `?q=` y `?producto=` llegan desde Existencias.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Equipos · Inventario · ArgosIsp' })

const route = useRoute()
const { puede, enlace } = usePermisos()

const TODOS = 'todos'
const busqueda = ref(typeof route.query.q === 'string' ? route.query.q : '')
const estado = ref<EstadoUnidadInventario | typeof TODOS>(typeof route.query.estado === 'string' && route.query.estado in ESTADOS_UNIDAD ? route.query.estado as EstadoUnidadInventario : TODOS)
const producto = Number(route.query.producto) || null
const itemsEstado: SelectItem[] = [{ label: 'Estado: todos', value: TODOS }, ...Object.entries(ESTADOS_UNIDAD).map(([value, e]) => ({ label: value === 'en_reparacion' ? 'En revisión o garantía' : e.etiqueta, value, icon: e.icono }))]

const marco = useTemplateRef<{ recargar: () => void }>('marco')
const accionesEquipoRef = useTemplateRef<{ ejecutar: (accion: AccionEquipo, unidad: UnidadInventario) => void }>('accionesEquipo')

const bodegas = shallowRef<Bodega[]>([])
onMounted(async () => {
    const r = await useBodegas().listar({ limit: 200 })
    bodegas.value = r.ok ? r.data.data : []
})

const lista = usePaginacionCursor(cursor => useUnidadesInventario().listar({
    ...(busqueda.value.trim() ? { q: busqueda.value.trim() } : {}),
    ...(estado.value !== TODOS ? { estado: estado.value } : {}),
    ...(producto ? { producto_id: producto } : {}),
}, cursor))

let espera: ReturnType<typeof setTimeout> | undefined
watch(busqueda, () => {
    clearTimeout(espera)
    espera = setTimeout(() => void lista.recargar(), 300)
})
onBeforeUnmount(() => clearTimeout(espera))
watch(estado, () => void lista.recargar())
onMounted(() => void lista.recargar())

const columnas: TableColumn<UnidadInventario>[] = [
    { id: 'equipo', header: 'Equipo', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'serie', header: 'Serie · MAC', meta: SOLO_ANCHO },
    { id: 'estado', header: 'Estado' },
    { id: 'ubicacion', header: 'Dónde o con quién', meta: SOLO_ESCRITORIO },
    { id: 'acciones', header: () => h('span', { class: 'sr-only' }, 'Acciones'), meta: { class: { td: 'w-0 text-end', th: 'w-0' } } },
]

const desdeEnlace = Number(route.query.unidad)
const detalleAbierto = ref(Number.isInteger(desdeEnlace) && desdeEnlace > 0)
const elegida = ref<number | null>(detalleAbierto.value ? desdeEnlace : null)

function abrir(unidad: UnidadInventario) {
    elegida.value = unidad.id
    detalleAbierto.value = true
}

function ubicacion(u: UnidadInventario): string {
    if (u.servicio_id) {
        return `Servicio #${u.servicio_id}`
    }
    return u.bodega_nombre ?? '—'
}

function accionesUnidad(u: UnidadInventario): AccionFila[] {
    return [
        { etiqueta: 'Ver historial', icono: 'i-lucide-history', alElegir: () => abrir(u), grupo: 'Ver' },
        ...(u.servicio_id ? [{ etiqueta: 'Abrir el servicio', icono: ICONOS.abrir, to: enlace(`/servicios/${u.servicio_id}#equipos`), grupo: 'Ver' }] : []),
        ...accionesEquipo(u, puede).map(a => ({ etiqueta: ACCIONES_EQUIPO[a].etiqueta, icono: ACCIONES_EQUIPO[a].icono, color: ACCIONES_EQUIPO[a].color, alElegir: () => accionesEquipoRef.value?.ejecutar(a, u), grupo: 'Equipo' })),
    ]
}

const menuFila = useMenuFila(accionesUnidad)

function alElegirFila(_evento: Event, fila: { original: UnidadInventario }) {
    abrir(fila.original)
}

function alAccion(accion: AccionEquipo, unidad: UnidadInventario) {
    accionesEquipoRef.value?.ejecutar(accion, unidad)
}

function alHacer() {
    void lista.recargar()
    marco.value?.recargar()
}
</script>

<template>
    <PanelPagina
        id="inventario-unidades"
        titulo="Inventario"
        icono="i-lucide-barcode"
        sin-descripcion
    >
        <template #acciones>
            <InventarioAcciones @hecho="alHacer" />
        </template>

        <InventarioMarco
            ref="marco"
            pestana="unidades"
        >
            <template #herramientas>
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Producto, serie o MAC"
                    aria-label="Buscar equipo por serie o MAC"
                    class="w-full sm:w-72"
                    :ui="{ base: 'rounded-full' }"
                    data-prueba="buscar-unidad"
                />
                <USelect
                    v-model="estado"
                    :items="itemsEstado"
                    icon="i-lucide-filter"
                    class="w-full sm:w-52"
                    aria-label="Filtrar por estado"
                />
            </template>

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
                <UContextMenu :items="menuFila.items.value">
                    <UTable
                        :data="lista.filas.value"
                        :columns="columnas"
                        :loading="lista.cargando.value"
                        sticky
                        :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3', tr: 'cursor-pointer' }"
                        data-menu-contextual
                        data-prueba="tabla-unidades"
                        @select="alElegirFila"
                        @contextmenu="menuFila.alContextmenu"
                    >
                        <template #equipo-cell="{ row }">
                            <div
                                class="flex min-w-0 flex-col"
                                :data-unidad="row.original.id"
                            >
                                <span class="font-semibold text-highlighted">{{ row.original.producto_nombre }}</span>
                                <span class="font-mono text-xs text-muted sm:hidden">{{ identificacionUnidad(row.original) }}</span>
                                <span class="text-xs text-muted lg:hidden">{{ ubicacion(row.original) }}</span>
                            </div>
                        </template>
                        <template #serie-cell="{ row }">
                            <span class="font-mono text-xs text-muted">{{ identificacionUnidad(row.original) }}</span>
                        </template>
                        <template #estado-cell="{ row }">
                            <UBadge
                                :label="estadoVisibleDe(row.original, bodegas).etiqueta"
                                :icon="estadoVisibleDe(row.original, bodegas).icono"
                                :color="estadoVisibleDe(row.original, bodegas).color"
                                variant="subtle"
                                size="sm"
                                class="rounded-full"
                            />
                        </template>
                        <template #ubicacion-cell="{ row }">
                            <ULink
                                v-if="row.original.servicio_id"
                                :to="enlace(`/servicios/${row.original.servicio_id}#equipos`)"
                                class="text-sm text-highlighted hover:text-primary"
                                @click.stop
                            >{{ ubicacion(row.original) }}</ULink>
                            <span
                                v-else
                                class="text-sm"
                            >{{ ubicacion(row.original) }}</span>
                        </template>
                        <template #acciones-cell="{ row }">
                            <div class="flex items-center justify-end gap-1">
                                <UButton
                                    icon="i-lucide-history"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    :title="`Historial de ${identificacionUnidad(row.original)}`"
                                    :aria-label="`Historial de ${identificacionUnidad(row.original)}`"
                                    @click.stop="abrir(row.original)"
                                />
                                <UDropdownMenu
                                    :items="menuFila.itemsDe(row.original)"
                                    :content="{ align: 'end' }"
                                >
                                    <UButton
                                        icon="i-lucide-ellipsis"
                                        color="neutral"
                                        variant="ghost"
                                        size="sm"
                                        :aria-label="`Más acciones: ${identificacionUnidad(row.original)}`"
                                        @click.stop
                                    />
                                </UDropdownMenu>
                            </div>
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
                </UContextMenu>
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
        </InventarioMarco>

        <UnidadInventarioDetalle
            v-model:open="detalleAbierto"
            :unidad-id="elegida"
            @accion="alAccion"
        />
        <EquipoAcciones
            ref="accionesEquipo"
            @hecho="alHacer"
        />
    </PanelPagina>
</template>
