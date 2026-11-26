<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Inventario · Kardex (tablero NuevoInventario, A3 `GET /inventario/movimientos`): el producto
 * elegido arriba y cada entrada y salida con su tipo, detalle, bodega, cantidad, costo y el saldo
 * corrido de su bodega. Filtros por bodega, fechas y tipo en «Más filtros». Solo se agregan
 * movimientos: una corrección es otro movimiento (un reverso).
 */
definePageMeta({ permiso: 'inventario.ver' })

const { enlace } = usePermisos()

useHead({ title: 'Kardex · Inventario · ArgosIsp' })

const route = useRoute()
const router = useRouter()

const TODOS = 'todos'
const numero = (valor: unknown) => (typeof valor === 'string' && Number(valor) > 0 ? Number(valor) : 0)
const texto = (valor: unknown) => (typeof valor === 'string' ? valor : '')
const producto = ref<number>(numero(route.query.producto))
const bodega = ref<number>(numero(route.query.bodega))
const desde = ref(texto(route.query.desde))
const hasta = ref(texto(route.query.hasta))
const tipo = ref<TipoMovimientoInventario | typeof TODOS>(texto(route.query.tipo) in TIPOS_MOVIMIENTO_INVENTARIO ? texto(route.query.tipo) as TipoMovimientoInventario : TODOS)

const productos = shallowRef<Producto[]>([])
const bodegas = shallowRef<Bodega[]>([])
const problemaCatalogos = ref<Problem | null>(null)

async function cargarCatalogos() {
    const [p, b] = await Promise.all([useProductos().listar({ limit: 200 }), useBodegas().listar({ limit: 200 })])
    productos.value = p.ok ? p.data.data : []
    bodegas.value = b.ok ? b.data.data : []
    problemaCatalogos.value = !p.ok ? p.problema : (!b.ok ? b.problema : null)
}

const itemsProducto = computed<SelectItem[]>(() => productos.value.map(p => ({ label: `${p.nombre} · ${p.sku}`, value: p.id })))
const itemsBodega = computed<SelectItem[]>(() => [{ label: 'Bodega: todas', value: 0 }, ...bodegas.value.map(b => ({ label: b.nombre, value: b.id }))])
const itemsTipo: SelectItem[] = [{ label: 'Todos los movimientos', value: TODOS }, ...Object.entries(TIPOS_MOVIMIENTO_INVENTARIO).map(([value, label]) => ({ label, value }))]
const elegido = computed(() => productos.value.find(p => p.id === producto.value) ?? null)

const lista = usePaginacionCursor(cursor => useInventario().kardex({
    ...(producto.value ? { producto_id: producto.value } : {}),
    ...(bodega.value ? { bodega_id: bodega.value } : {}),
    ...(desde.value ? { desde: desde.value } : {}),
    ...(hasta.value ? { hasta: hasta.value } : {}),
    ...(tipo.value !== TODOS ? { tipo: tipo.value } : {}),
}, cursor))

watch([producto, bodega, desde, hasta, tipo], async () => {
    await router.replace({ query: {
        ...(producto.value ? { producto: String(producto.value) } : {}),
        ...(bodega.value ? { bodega: String(bodega.value) } : {}),
        ...(desde.value ? { desde: desde.value } : {}),
        ...(hasta.value ? { hasta: hasta.value } : {}),
        ...(tipo.value !== TODOS ? { tipo: tipo.value } : {}),
    } })
    await lista.recargar()
})

onMounted(() => {
    void cargarCatalogos()
    void lista.recargar()
})

const columnas: TableColumn<MovimientoInventario>[] = [
    { accessorKey: 'fecha', header: 'Fecha' },
    { accessorKey: 'tipo', header: 'Tipo' },
    { id: 'detalle', header: 'Detalle', meta: { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell whitespace-normal' } } },
    { accessorKey: 'bodega_nombre', header: 'Bodega', meta: SOLO_ESCRITORIO },
    { accessorKey: 'cantidad', header: 'Cant.', meta: { class: { th: 'text-end', td: 'text-end' } } },
    { accessorKey: 'costo_total', header: 'Costo', meta: { class: { th: 'text-end hidden sm:table-cell', td: 'text-end hidden sm:table-cell' } } },
    { accessorKey: 'saldo_cantidad', header: 'Saldo', meta: { class: { th: 'text-end', td: 'text-end' } } },
]

function entra(m: MovimientoInventario): boolean {
    return new Decimal(m.cantidad).isPositive()
}

/** Tono de la pastilla del tipo: entradas en índigo, salidas en neutro. */
function colorTipo(m: MovimientoInventario): 'primary' | 'neutral' {
    return entra(m) ? 'primary' : 'neutral'
}

function detalle(m: MovimientoInventario): string {
    return [
        m.producto_nombre,
        m.servicio_id ? `servicio #${m.servicio_id}` : null,
        m.traslado_id ? `traslado ${m.traslado_id}` : null,
        m.causa ? CAUSAS_BAJA[m.causa] : null,
        m.motivo,
        m.origen_externo_id ? `orden ${m.origen_externo_id} (Iris)` : null,
    ].filter(Boolean).join(' · ')
}

const masFiltros = ref(Boolean(desde.value || hasta.value || tipo.value !== TODOS))
const filtrosPuestos = computed(() => [desde.value, hasta.value, tipo.value !== TODOS ? tipo.value : ''].filter(Boolean).length)
const marco = useTemplateRef<{ recargar: () => void }>('marco')

function alHacer() {
    void lista.recargar()
    marco.value?.recargar()
}
</script>

<template>
    <PanelPagina
        id="inventario-kardex"
        titulo="Inventario"
        icono="i-lucide-list-ordered"
        sin-descripcion
    >
        <template #acciones>
            <InventarioAcciones @hecho="alHacer" />
        </template>

        <InventarioMarco
            ref="marco"
            pestana="kardex"
        >
            <template #herramientas>
                <USelect
                    v-model="bodega"
                    :items="itemsBodega"
                    icon="i-lucide-filter"
                    class="w-full sm:w-52"
                    aria-label="Filtrar por bodega"
                />
                <UButton
                    icon="i-lucide-sliders-horizontal"
                    label="Más filtros"
                    color="neutral"
                    :variant="masFiltros ? 'subtle' : 'outline'"
                    :aria-expanded="masFiltros"
                    aria-controls="filtros-kardex"
                    class="rounded-full"
                    @click="masFiltros = !masFiltros"
                >
                    <template
                        v-if="filtrosPuestos"
                        #trailing
                    >
                        <UBadge
                            :label="String(filtrosPuestos)"
                            size="sm"
                            variant="solid"
                        />
                    </template>
                </UButton>
            </template>

            <div class="flex flex-col gap-3 p-3 sm:px-4">
                <div class="flex flex-wrap items-center gap-2 text-sm">
                    <span class="text-highlighted">Producto:</span>
                    <USelectMenu
                        :model-value="producto || undefined"
                        :items="itemsProducto"
                        value-key="value"
                        placeholder="Todos los productos"
                        class="w-full sm:w-72"
                        :ui="{ base: producto ? 'rounded-full bg-primary text-inverted font-semibold' : 'rounded-full' }"
                        aria-label="Producto"
                        data-prueba="kardex-producto"
                        @update:model-value="v => producto = typeof v === 'number' ? v : 0"
                    />
                    <span class="text-muted">· solo se agregan movimientos; las correcciones son reversos</span>
                </div>
                <div
                    v-show="masFiltros"
                    id="filtros-kardex"
                    class="grid gap-3 rounded-xl bg-(--ax-panel) p-3 sm:grid-cols-3"
                    role="group"
                    aria-label="Filtros del kardex"
                >
                    <UFormField label="Desde">
                        <CampoFecha
                            v-model="desde"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField label="Hasta">
                        <CampoFecha
                            v-model="hasta"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField label="Tipo de movimiento">
                        <USelect
                            v-model="tipo"
                            :items="itemsTipo"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <p
                    v-if="elegido"
                    class="text-xs text-muted"
                >
                    {{ elegido.nombre }}: {{ formatearCantidad(elegido.existencia, elegido.unidad) }} en todas las bodegas. El saldo de cada fila es el de su bodega.
                </p>
                <ProblemaAlerta
                    v-if="problemaCatalogos"
                    :problema="problemaCatalogos"
                    :reintentar="cargarCatalogos"
                />
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
                    :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                    data-prueba="tabla-kardex"
                >
                    <template #fecha-cell="{ row }">
                        <span class="whitespace-nowrap text-sm tabular-nums text-muted">{{ formatearFechaCorta(row.original.fecha) }} {{ formatearHora(row.original.ocurrido_en ?? row.original.created_at) }}</span>
                    </template>
                    <template #tipo-cell="{ row }">
                        <div
                            class="flex flex-col items-start gap-0.5"
                            :data-movimiento="row.original.id"
                        >
                            <UBadge
                                :label="TIPOS_MOVIMIENTO_INVENTARIO[row.original.tipo]"
                                :icon="entra(row.original) ? 'i-lucide-arrow-down-left' : 'i-lucide-arrow-up-right'"
                                :color="colorTipo(row.original)"
                                variant="subtle"
                                size="sm"
                                class="rounded-full"
                            />
                            <span class="text-xs text-muted md:hidden">{{ detalle(row.original) }}</span>
                        </div>
                    </template>
                    <template #detalle-cell="{ row }">
                        <span class="text-sm text-highlighted">{{ detalle(row.original) }}</span>
                        <ULink
                            v-if="row.original.servicio_id"
                            :to="enlace(`/servicios/${row.original.servicio_id}`)"
                            class="ms-1 text-xs text-primary"
                        >Ver servicio</ULink>
                    </template>
                    <template #bodega_nombre-cell="{ row }">
                        <span class="text-sm">{{ row.original.bodega_nombre }}</span>
                    </template>
                    <template #cantidad-cell="{ row }">
                        <span
                            class="text-sm font-semibold tabular-nums"
                            :class="entra(row.original) ? 'text-success' : 'text-error'"
                        >{{ entra(row.original) ? '+ ' : '− ' }}{{ formatearCantidad(new Decimal(row.original.cantidad).abs().toString()) }}</span>
                    </template>
                    <template #costo_total-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearQuetzales(new Decimal(row.original.costo_total).abs().toFixed(2)) }}</span>
                    </template>
                    <template #saldo_cantidad-cell="{ row }">
                        <span
                            class="text-sm tabular-nums text-muted"
                            :title="`Valor del saldo: ${formatearQuetzales(row.original.saldo_valor)}`"
                        >{{ formatearCantidad(row.original.saldo_cantidad) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-list-ordered"
                            title="Sin movimientos"
                            description="No hay movimientos con estos filtros."
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
        </InventarioMarco>
    </PanelPagina>
</template>
