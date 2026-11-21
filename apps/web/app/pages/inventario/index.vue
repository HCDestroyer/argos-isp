<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'
import { h } from 'vue'

/**
 * Inventario · Existencias (tablero NuevoInventario, A3 `contratos/inventario.md` §9): una fila por
 * producto con el tipo de seguimiento, dónde está (una pastilla por bodega), el total, el costo
 * promedio y el valor. Filtros por bodega, bajo el mínimo y lo que viaja en tránsito; cada fila con
 * su menú «⋯» (consumo, traslado, ajuste, baja y kardex), el mismo del clic derecho.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Inventario · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()

const TODAS = 'todas'
const texto = (valor: unknown) => (typeof valor === 'string' ? valor : '')
const bodega = ref<string>(texto(route.query.bodega) || TODAS)
const bajoMinimo = ref(route.query.bajo_minimo === 'true')
/** Lo que viaja en órdenes de traslado (bodega `transito`, D.1); la API lo deja fuera si no se pide. */
const conTransito = ref(route.query.transito === 'true')
const busqueda = ref(texto(route.query.q))

const marco = useTemplateRef<{ recargar: () => void }>('marco')
const acciones = useTemplateRef<{ abrir: (o: OperacionInventario, productoId?: number | null, bodegaId?: number | null) => Promise<void>, operaciones: OperacionInventario[] }>('acciones')

const bodegas = shallowRef<Bodega[]>([])
const productos = shallowRef<Producto[]>([])

onMounted(async () => {
    const [b, p] = await Promise.all([useBodegas().activas(), useProductos().activos()])
    bodegas.value = b.ok ? b.data : []
    productos.value = p.ok ? p.data : []
})

const itemsBodega = computed<SelectItem[]>(() => [
    { label: 'Bodega: todas', value: TODAS },
    ...bodegas.value.filter(b => !esBodegaTransito(b)).map(b => ({ label: b.nombre, value: String(b.id), icon: TIPOS_BODEGA[b.tipo].icono })),
])

const lista = usePaginacionCursor(cursor => useInventario().existencias({
    limit: 200,
    ...(bodega.value !== TODAS ? { bodega_id: Number(bodega.value) } : {}),
    ...(bajoMinimo.value ? { bajo_minimo: true } : {}),
    ...(conTransito.value ? { incluir_transito: true } : {}),
}, cursor))

watch([bodega, bajoMinimo, conTransito], async () => {
    await router.replace({ query: {
        ...(bodega.value !== TODAS ? { bodega: bodega.value } : {}),
        ...(bajoMinimo.value ? { bajo_minimo: 'true' } : {}),
        ...(conTransito.value ? { transito: 'true' } : {}),
        ...(busqueda.value ? { q: busqueda.value } : {}),
    } })
    await lista.recargar()
})

onMounted(() => void lista.recargar())

interface FilaProducto {
    producto_id: number
    nombre: string
    sku: string
    unidad: string
    serie: boolean
    filas: ExistenciaInventario[]
    cantidad: Decimal
    valor: Decimal
    bajo: boolean
}

const seguimientos = computed(() => new Map(productos.value.map(p => [p.id, p.seguimiento])))

/** Una fila por producto (la API da producto × bodega). */
const agrupadas = computed<FilaProducto[]>(() => {
    const mapa = new Map<number, FilaProducto>()
    for (const fila of lista.filas.value) {
        const actual = mapa.get(fila.producto_id) ?? {
            producto_id: fila.producto_id,
            nombre: fila.producto_nombre,
            sku: fila.producto_sku,
            unidad: fila.unidad,
            serie: (seguimientos.value.get(fila.producto_id) ?? (fila.modalidad === 'comodato' ? 'serie' : 'cantidad')) === 'serie',
            filas: [],
            cantidad: new Decimal(0),
            valor: new Decimal(0),
            bajo: false,
        }
        actual.filas.push(fila)
        actual.cantidad = actual.cantidad.plus(fila.cantidad)
        actual.valor = actual.valor.plus(fila.valor)
        actual.bajo ||= fila.bajo_minimo
        mapa.set(fila.producto_id, actual)
    }
    const q = busqueda.value.trim().toLowerCase()
    return [...mapa.values()].filter(f => !q || f.nombre.toLowerCase().includes(q) || f.sku.toLowerCase().includes(q))
})

/** Lo escrito parece una serie o MAC y ningún producto coincide: se ofrece buscarlo en Equipos. */
const buscarEnEquipos = computed(() => busqueda.value.trim().length >= 4 && agrupadas.value.length === 0)

const columnas: TableColumn<FilaProducto>[] = [
    { id: 'producto', header: 'Producto', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'tipo', header: 'Tipo', meta: SOLO_ANCHO },
    { id: 'donde', header: 'Dónde está', meta: { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell whitespace-normal' } } },
    { id: 'total', header: 'Total', meta: { class: { th: 'text-end', td: 'text-end' } } },
    { id: 'costo', header: 'Costo prom.', meta: { class: { th: 'hidden xl:table-cell text-end', td: 'hidden xl:table-cell text-end' } } },
    { id: 'valor', header: 'Valor', meta: { class: { th: 'hidden sm:table-cell text-end', td: 'hidden sm:table-cell text-end' } } },
    { id: 'acciones', header: () => h('span', { class: 'sr-only' }, 'Acciones'), meta: { class: { td: 'w-0 text-end', th: 'w-0' } } },
]

function costoPromedio(f: FilaProducto): string {
    return f.cantidad.isZero() ? '—' : formatearQuetzales(f.valor.dividedBy(f.cantidad).toFixed(2))
}

function accionesProducto(f: FilaProducto): AccionFila[] {
    const unaBodega = f.filas.length === 1 ? f.filas[0]!.bodega_id : null
    const ops: AccionFila[] = (acciones.value?.operaciones ?? [])
        .filter(o => o !== 'saldo_inicial')
        .map(o => ({ etiqueta: OPERACIONES_INVENTARIO[o].etiqueta, icono: OPERACIONES_INVENTARIO[o].icono, alElegir: () => void acciones.value?.abrir(o, f.producto_id, unaBodega), grupo: 'Registrar' }))
    return [
        { etiqueta: 'Ver kardex', icono: 'i-lucide-list-ordered', to: `/inventario/kardex?producto=${f.producto_id}`, grupo: 'Ver' },
        ...(f.serie ? [{ etiqueta: 'Ver equipos', icono: 'i-lucide-barcode', to: `/inventario/unidades?producto=${f.producto_id}`, grupo: 'Ver' }] : []),
        ...(puede('productos.editar') ? [{ etiqueta: 'Editar producto', icono: ICONOS.editar, to: `/inventario/productos?editar=${f.producto_id}`, grupo: 'Ver' }] : []),
        ...ops,
    ]
}

const menuFila = useMenuFila(accionesProducto)

function alHacer() {
    void lista.recargar()
    marco.value?.recargar()
}
</script>

<template>
    <PanelPagina
        id="inventario"
        titulo="Inventario"
        icono="i-lucide-package"
        sin-descripcion
    >
        <template #acciones>
            <InventarioAcciones
                ref="acciones"
                @hecho="alHacer"
            />
        </template>

        <InventarioMarco
            ref="marco"
            pestana="existencias"
        >
            <template #herramientas>
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Producto, serie o MAC"
                    aria-label="Buscar producto, serie o MAC"
                    class="w-full sm:w-72"
                    :ui="{ base: 'rounded-full' }"
                    data-prueba="buscar-existencias"
                />
                <USelect
                    v-model="bodega"
                    :items="itemsBodega"
                    icon="i-lucide-filter"
                    class="w-full rounded-full sm:w-52"
                    aria-label="Filtrar por bodega"
                    data-prueba="filtro-bodega"
                />
                <UButton
                    label="Bajo mínimo"
                    icon="i-lucide-triangle-alert"
                    :color="bajoMinimo ? 'primary' : 'neutral'"
                    :variant="bajoMinimo ? 'solid' : 'outline'"
                    :aria-pressed="bajoMinimo"
                    class="rounded-full"
                    data-prueba="filtro-bajo-minimo"
                    @click="bajoMinimo = !bajoMinimo"
                />
                <UButton
                    label="En tránsito"
                    icon="i-lucide-truck"
                    :color="conTransito ? 'primary' : 'neutral'"
                    :variant="conTransito ? 'solid' : 'outline'"
                    :aria-pressed="conTransito"
                    class="rounded-full"
                    data-prueba="filtro-transito"
                    @click="conTransito = !conTransito"
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
                        :data="agrupadas"
                        :columns="columnas"
                        :loading="lista.cargando.value"
                        sticky
                        :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                        data-menu-contextual
                        data-prueba="tabla-existencias"
                        @contextmenu="menuFila.alContextmenu"
                    >
                        <template #producto-cell="{ row }">
                            <div
                                class="flex min-w-0 items-center gap-3"
                                :data-existencia="row.original.producto_id"
                            >
                                <span class="pastilla-icono pastilla-tono size-9 shrink-0 rounded-xl tono-marca">
                                    <UIcon
                                        :name="row.original.serie ? 'i-lucide-barcode' : 'i-lucide-package'"
                                        class="size-4"
                                    />
                                </span>
                                <div class="flex min-w-0 flex-col">
                                    <span class="font-semibold text-highlighted">{{ row.original.nombre }}</span>
                                    <span
                                        v-if="row.original.bajo"
                                        class="flex items-center gap-1 text-xs text-error"
                                    >
                                        <UIcon
                                            name="i-lucide-triangle-alert"
                                            class="size-3"
                                        />
                                        Bajo el mínimo
                                    </span>
                                    <span class="flex flex-wrap gap-1 pt-1 lg:hidden">
                                        <UBadge
                                            v-for="fila in row.original.filas"
                                            :key="fila.bodega_id"
                                            :label="`${nombreCortoBodega(fila.bodega_nombre)} ${formatearCantidad(fila.cantidad)}`"
                                            color="neutral"
                                            variant="soft"
                                            size="sm"
                                        />
                                    </span>
                                </div>
                            </div>
                        </template>
                        <template #tipo-cell="{ row }">
                            <UBadge
                                :label="row.original.serie ? 'Serie' : 'Cantidad'"
                                :icon="row.original.serie ? 'i-lucide-barcode' : 'i-lucide-ruler'"
                                :color="row.original.serie ? 'primary' : 'neutral'"
                                variant="subtle"
                                size="sm"
                                class="rounded-full"
                            />
                        </template>
                        <template #donde-cell="{ row }">
                            <span class="flex flex-wrap gap-1">
                                <UBadge
                                    v-for="fila in row.original.filas"
                                    :key="fila.bodega_id"
                                    :label="`${nombreCortoBodega(fila.bodega_nombre)} ${formatearCantidad(fila.cantidad)}`"
                                    :icon="esBodegaTransito({ tipo: fila.bodega_tipo }) ? 'i-lucide-truck' : undefined"
                                    color="neutral"
                                    variant="soft"
                                    size="sm"
                                    :data-bodega-existencia="`${fila.producto_id}/${fila.bodega_id}`"
                                />
                            </span>
                        </template>
                        <template #total-cell="{ row }">
                            <span
                                class="font-semibold tabular-nums"
                                :class="row.original.bajo ? 'text-error' : 'text-highlighted'"
                            >{{ formatearCantidad(row.original.cantidad.toString(), row.original.serie || row.original.unidad === 'unidad' ? null : row.original.unidad) }}</span>
                        </template>
                        <template #costo-cell="{ row }">
                            <span class="tabular-nums text-muted">{{ costoPromedio(row.original) }}</span>
                        </template>
                        <template #valor-cell="{ row }">
                            <span class="font-semibold tabular-nums text-highlighted">{{ formatearQuetzales(row.original.valor.toFixed(2)) }}</span>
                        </template>
                        <template #acciones-cell="{ row }">
                            <UDropdownMenu
                                :items="menuFila.itemsDe(row.original)"
                                :content="{ align: 'end' }"
                            >
                                <UButton
                                    icon="i-lucide-ellipsis"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    :aria-label="`Más acciones: ${row.original.nombre}`"
                                />
                            </UDropdownMenu>
                        </template>
                        <template #empty>
                            <UEmpty
                                :icon="buscarEnEquipos ? 'i-lucide-barcode' : 'i-lucide-package'"
                                :title="buscarEnEquipos ? 'Ningún producto se llama así' : bajoMinimo ? 'Nada bajo el mínimo' : 'Sin existencias'"
                                :description="buscarEnEquipos ? '¿Es una serie o MAC? Búscala entre los equipos.' : bajoMinimo ? 'Ningún producto está por debajo de su existencia mínima.' : 'Carga el saldo inicial o registra una compra con productos.'"
                                :actions="buscarEnEquipos ? [{ label: 'Buscar en equipos', icon: 'i-lucide-barcode', to: `/inventario/unidades?q=${encodeURIComponent(busqueda.trim())}` }] : undefined"
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
    </PanelPagina>
</template>
