<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Existencias del inventario (A3, `contratos/inventario.md` §9): cantidad, costo promedio y valor
 * por producto × bodega, con el filtro «bajo mínimo». Desde aquí se registran el saldo inicial, el
 * consumo, el traslado, el ajuste y la baja, cada uno con su permiso; cada fila lleva a su kardex.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Existencias · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()

const TODAS = 0
const numero = (valor: unknown) => (typeof valor === 'string' && Number(valor) > 0 ? Number(valor) : TODAS)
const bodega = ref<number>(numero(route.query.bodega))
const producto = ref<number>(numero(route.query.producto))
const bajoMinimo = ref(route.query.bajo_minimo === 'true')
/** Lo que viaja en órdenes de traslado (bodega `transito`, D.1); la API lo deja fuera si no se pide. */
const conTransito = ref(route.query.transito === 'true')

const productos = shallowRef<Producto[]>([])
const bodegas = shallowRef<Bodega[]>([])
const problemaCatalogos = ref<Problem | null>(null)

async function cargarCatalogos() {
    const [p, b] = await Promise.all([useProductos().activos(), useBodegas().activas()])
    productos.value = p.ok ? p.data : []
    bodegas.value = b.ok ? b.data : []
    problemaCatalogos.value = !p.ok ? p.problema : (!b.ok ? b.problema : null)
}

const itemsBodega = computed<SelectItem[]>(() => [{ label: 'Todas las bodegas', value: TODAS }, ...bodegas.value.map(b => ({ label: b.nombre, value: b.id, icon: TIPOS_BODEGA[b.tipo].icono }))])
const itemsProducto = computed<SelectItem[]>(() => [{ label: 'Todos los productos', value: TODAS }, ...productos.value.map(p => ({ label: `${p.nombre} · ${p.sku}`, value: p.id }))])

function filtros(): FiltrosExistencias {
    return {
        ...(bodega.value ? { bodega_id: bodega.value } : {}),
        ...(producto.value ? { producto_id: producto.value } : {}),
        ...(bajoMinimo.value ? { bajo_minimo: true } : {}),
        ...(conTransito.value ? { incluir_transito: true } : {}),
    }
}

const lista = usePaginacionCursor(cursor => useInventario().existencias(filtros(), cursor))

watch([bodega, producto, bajoMinimo, conTransito], async () => {
    await router.replace({ query: { ...(bodega.value ? { bodega: String(bodega.value) } : {}), ...(producto.value ? { producto: String(producto.value) } : {}), ...(bajoMinimo.value ? { bajo_minimo: 'true' } : {}), ...(conTransito.value ? { transito: 'true' } : {}) } })
    await lista.recargar()
})

onMounted(() => {
    void cargarCatalogos()
    void lista.recargar()
})

const columnas: TableColumn<ExistenciaInventario>[] = [
    { accessorKey: 'producto_nombre', header: 'Producto', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'bodega_nombre', header: 'Bodega', meta: SOLO_ANCHO },
    { accessorKey: 'cantidad', header: 'Existencia', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'costo_promedio', header: 'Promedio', meta: { class: { th: 'text-right hidden lg:table-cell', td: 'text-right hidden lg:table-cell' } } },
    { accessorKey: 'valor', header: 'Valor', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const total = computed(() => lista.filas.value.reduce((suma, fila) => suma.plus(fila.valor), new Decimal(0)))

/* Operaciones */
const operaciones = computed(() => (Object.keys(OPERACIONES_INVENTARIO) as OperacionInventario[]).filter(o => puede(OPERACIONES_INVENTARIO[o].permiso)))
const operacion = ref<OperacionInventario>('consumo')
const operacionAbierta = ref(false)
const elegida = shallowRef<{ productoId: number | null, bodegaId: number | null }>({ productoId: null, bodegaId: null })

function abrir(o: OperacionInventario, fila?: ExistenciaInventario) {
    operacion.value = o
    elegida.value = { productoId: fila?.producto_id ?? null, bodegaId: fila?.bodega_id ?? null }
    operacionAbierta.value = true
}

function menuFila(fila: ExistenciaInventario) {
    return [
        operaciones.value.filter(o => o !== 'saldo_inicial').map(o => ({ label: OPERACIONES_INVENTARIO[o].etiqueta, icon: OPERACIONES_INVENTARIO[o].icono, onSelect: () => abrir(o, fila) })),
        [{ label: 'Ver kardex', icon: 'i-lucide-list-ordered', to: `/inventario/kardex?producto=${fila.producto_id}&bodega=${fila.bodega_id}` }],
    ]
}

function alHacer(o: OperacionInventario) {
    toast.add({ title: `${OPERACIONES_INVENTARIO[o].etiqueta} registrado`, icon: 'i-lucide-circle-check', color: 'success' })
    void lista.recargar()
}
</script>

<template>
    <PanelPagina
        id="inventario"
        titulo="Existencias"
        icono="i-lucide-package"
    >
        <template #acciones>
            <UDropdownMenu
                v-if="operaciones.length"
                :items="operaciones.map(o => ({ label: OPERACIONES_INVENTARIO[o].etiqueta, icon: OPERACIONES_INVENTARIO[o].icono, onSelect: () => abrir(o) }))"
            >
                <UButton
                    label="Registrar"
                    icon="i-lucide-plus"
                    trailing-icon="i-lucide-chevron-down"
                    data-prueba="inventario-registrar"
                />
            </UDropdownMenu>
        </template>

        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                <USelect
                    v-model="bodega"
                    :items="itemsBodega"
                    class="w-full sm:w-56"
                    aria-label="Bodega"
                    data-prueba="filtro-bodega"
                />
                <USelectMenu
                    v-model="producto"
                    :items="itemsProducto"
                    value-key="value"
                    class="w-full sm:w-72"
                    aria-label="Producto"
                />
                <USwitch
                    v-model="bajoMinimo"
                    label="Bajo mínimo"
                    data-prueba="filtro-bajo-minimo"
                />
                <USwitch
                    v-model="conTransito"
                    label="En tránsito"
                    description="Lo que viaja en órdenes de traslado"
                    data-prueba="filtro-transito"
                />
            </div>
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
                    :ui="{ td: 'py-3' }"
                    data-prueba="tabla-existencias"
                >
                    <template #producto_nombre-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col gap-0.5"
                            :data-existencia="`${row.original.producto_id}/${row.original.bodega_id}`"
                        >
                            <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                                {{ row.original.producto_nombre }}
                                <UBadge
                                    v-if="row.original.bajo_minimo"
                                    label="Bajo mínimo"
                                    icon="i-lucide-triangle-alert"
                                    color="warning"
                                    variant="subtle"
                                    size="sm"
                                />
                            </span>
                            <span class="font-mono text-xs text-muted">{{ row.original.producto_sku }}</span>
                            <ModalidadBadge
                                v-if="row.original.modalidad"
                                :modalidad="row.original.modalidad"
                                class="self-start"
                            />
                            <span class="text-xs text-muted sm:hidden">{{ row.original.bodega_nombre }} · {{ formatearQuetzales(row.original.valor) }}</span>
                        </div>
                    </template>
                    <template #bodega_nombre-cell="{ row }">
                        <span class="flex items-center gap-1.5 text-sm">
                            <UIcon
                                :name="TIPOS_BODEGA[row.original.bodega_tipo].icono"
                                class="size-4 text-muted"
                            />
                            {{ row.original.bodega_nombre }}
                        </span>
                    </template>
                    <template #cantidad-cell="{ row }">
                        <div class="flex flex-col items-end text-sm tabular-nums">
                            <span class="font-medium text-highlighted">{{ formatearCantidad(row.original.cantidad, row.original.unidad) }}</span>
                            <span
                                v-if="row.original.existencia_minima"
                                class="text-xs text-muted"
                            >mín. {{ formatearCantidad(row.original.existencia_minima) }} · total {{ formatearCantidad(row.original.existencia_total) }}</span>
                        </div>
                    </template>
                    <template #costo_promedio-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ row.original.costo_promedio ? formatearQuetzales(new Decimal(row.original.costo_promedio).toFixed(2)) : '—' }}</span>
                    </template>
                    <template #valor-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearQuetzales(row.original.valor) }}</span>
                    </template>
                    <template #acciones-cell="{ row }">
                        <UButton
                            v-if="esBodegaTransito({ tipo: row.original.bodega_tipo })"
                            icon="i-lucide-truck"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            to="/inventario/traslados?estado=en_transito"
                            :aria-label="`Ver las órdenes en tránsito de ${row.original.producto_nombre}`"
                        />
                        <UDropdownMenu
                            v-else
                            :items="menuFila(row.original)"
                        >
                            <UButton
                                icon="i-lucide-ellipsis-vertical"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Acciones de ${row.original.producto_nombre} en ${row.original.bodega_nombre}`"
                            />
                        </UDropdownMenu>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-package"
                            :title="bajoMinimo ? 'Nada bajo el mínimo' : 'Sin existencias'"
                            :description="bajoMinimo ? 'Ningún producto está por debajo de su existencia mínima.' : 'Carga el saldo inicial o registra una compra con productos.'"
                            variant="naked"
                        />
                    </template>
                </UTable>
                <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <PaginacionCursor
                        :pagina="lista.pagina.value"
                        :hay-anterior="lista.hayAnterior.value"
                        :hay-siguiente="lista.haySiguiente.value"
                        :cargando="lista.cargando.value"
                        :filas="lista.filas.value.length"
                        @anterior="lista.anterior"
                        @siguiente="lista.siguiente"
                    />
                    <p
                        v-if="lista.filas.value.length"
                        class="text-sm text-muted"
                        data-prueba="existencias-total"
                    >
                        Valor de esta página: <span class="font-medium text-highlighted tabular-nums">{{ formatearQuetzales(total.toFixed(2)) }}</span>
                    </p>
                </div>
            </template>
        </div>

        <MovimientoInventarioModal
            v-model:open="operacionAbierta"
            :operacion="operacion"
            :productos="productos"
            :bodegas="bodegas"
            :producto-id="elegida.productoId"
            :bodega-id="elegida.bodegaId"
            @hecho="alHacer"
        />
    </PanelPagina>
</template>
