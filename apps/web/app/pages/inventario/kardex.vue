<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Kardex por producto (A3, `GET /inventario/movimientos`): cada entrada y salida con su costo y el
 * saldo corrido (cantidad y valor) de su bodega, filtrable por bodega, fechas y tipo. Solo
 * inserción: una corrección es otro movimiento.
 */
definePageMeta({ permiso: 'inventario.ver' })

const { enlace } = usePermisos()

useHead({ title: 'Kardex · ArgosIsp' })

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
const itemsBodega = computed<SelectItem[]>(() => [{ label: 'Todas las bodegas', value: 0 }, ...bodegas.value.map(b => ({ label: b.nombre, value: b.id }))])
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
    { accessorKey: 'tipo', header: 'Movimiento', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'costo_total', header: 'Costo', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
    { accessorKey: 'saldo_cantidad', header: 'Saldo', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
    { accessorKey: 'saldo_valor', header: 'Valor del saldo', meta: { class: { th: 'text-right hidden lg:table-cell', td: 'text-right hidden lg:table-cell' } } },
]

function entra(m: MovimientoInventario): boolean {
    return new Decimal(m.cantidad).isPositive()
}
</script>

<template>
    <PanelPagina
        id="inventario-kardex"
        titulo="Kardex"
        icono="i-lucide-list-ordered"
    >
        <div class="flex flex-col gap-4">
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <USelectMenu
                    :model-value="producto || undefined"
                    :items="itemsProducto"
                    value-key="value"
                    placeholder="Todos los productos"
                    class="w-full lg:col-span-2"
                    aria-label="Producto"
                    data-prueba="kardex-producto"
                    @update:model-value="v => producto = typeof v === 'number' ? v : 0"
                />
                <USelect
                    v-model="bodega"
                    :items="itemsBodega"
                    class="w-full"
                    aria-label="Bodega"
                />
                <UInput
                    v-model="desde"
                    type="date"
                    aria-label="Desde"
                    class="w-full"
                />
                <UInput
                    v-model="hasta"
                    type="date"
                    aria-label="Hasta"
                    class="w-full"
                />
                <USelect
                    v-model="tipo"
                    :items="itemsTipo"
                    class="w-full sm:col-span-2 lg:col-span-1"
                    aria-label="Tipo de movimiento"
                />
            </div>
            <p
                v-if="elegido"
                class="text-sm text-muted"
            >
                {{ elegido.nombre }}: {{ formatearCantidad(elegido.existencia, elegido.unidad) }} en todas las bodegas, valor {{ formatearQuetzales(elegido.valor) }}. El saldo de cada fila es el de su bodega.
            </p>
            <ProblemaAlerta
                v-if="problemaCatalogos"
                :problema="problemaCatalogos"
                :reintentar="cargarCatalogos"
            />
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
                    :ui="{ td: 'py-2.5' }"
                    data-prueba="tabla-kardex"
                >
                    <template #fecha-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearFecha(row.original.fecha) }}</span>
                    </template>
                    <template #tipo-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col gap-0.5"
                            :data-movimiento="row.original.id"
                        >
                            <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                                <UIcon
                                    :name="entra(row.original) ? 'i-lucide-arrow-down-left' : 'i-lucide-arrow-up-right'"
                                    :class="entra(row.original) ? 'text-success' : 'text-error'"
                                    class="size-4"
                                />
                                {{ TIPOS_MOVIMIENTO_INVENTARIO[row.original.tipo] }}
                            </span>
                            <span class="text-xs text-muted">{{ row.original.producto_nombre }} · {{ row.original.bodega_nombre }}</span>
                            <span
                                v-if="row.original.motivo || row.original.causa"
                                class="text-xs text-muted"
                            >{{ [row.original.causa ? CAUSAS_BAJA[row.original.causa] : null, row.original.motivo].filter(Boolean).join(' · ') }}</span>
                            <ULink
                                v-if="row.original.servicio_id"
                                :to="enlace(`/servicios/${row.original.servicio_id}`)"
                                class="text-xs text-primary"
                            >Servicio #{{ row.original.servicio_id }}</ULink>
                        </div>
                    </template>
                    <template #cantidad-cell="{ row }">
                        <span
                            class="text-sm font-medium tabular-nums"
                            :class="entra(row.original) ? 'text-success' : 'text-error'"
                        >{{ entra(row.original) ? '+' : '' }}{{ formatearCantidad(row.original.cantidad) }}</span>
                    </template>
                    <template #costo_total-cell="{ row }">
                        <div class="flex flex-col items-end text-sm tabular-nums">
                            <span>{{ formatearQuetzales(row.original.costo_total) }}</span>
                            <span class="text-xs text-muted">{{ formatearQuetzales(new Decimal(row.original.costo_unitario).toFixed(2)) }} c/u</span>
                        </div>
                    </template>
                    <template #saldo_cantidad-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearCantidad(row.original.saldo_cantidad) }}</span>
                    </template>
                    <template #saldo_valor-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearQuetzales(row.original.saldo_valor) }}</span>
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
