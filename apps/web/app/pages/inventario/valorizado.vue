<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Inventario valorizado a una fecha (A3, `GET /reportes/inventario-valorizado`): cantidad, costo
 * promedio y valor por producto × bodega reconstruidos del kardex, y el cuadre de cada empresa
 * contra el saldo de `1.1.14 Inventarios` a la misma fecha.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Inventario valorizado · ArgosIsp' })

const route = useRoute()
const router = useRouter()

const fecha = ref(typeof route.query.fecha === 'string' ? route.query.fecha : hoyGuatemala())
const bodega = ref<number>(Number(route.query.bodega) || 0)
const conCeros = ref(route.query.con_ceros === 'true')

const bodegas = shallowRef<Bodega[]>([])
const itemsBodega = computed<SelectItem[]>(() => [{ label: 'Bodega: todas', value: 0 }, ...bodegas.value.map(b => ({ label: b.nombre, value: b.id }))])

const reporte = shallowRef<InventarioValorizado | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useReportesInventario().valorizado({
        fecha: fecha.value,
        ...(bodega.value ? { bodega_id: bodega.value } : {}),
        ...(conCeros.value ? { con_ceros: true } : {}),
    })
    cargando.value = false
    reporte.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch([fecha, bodega, conCeros], async () => {
    await router.replace({ query: { fecha: fecha.value, ...(bodega.value ? { bodega: String(bodega.value) } : {}), ...(conCeros.value ? { con_ceros: 'true' } : {}) } })
    await cargar()
})

onMounted(async () => {
    void cargar()
    const resultado = await useBodegas().listar({ limit: 200 })
    bodegas.value = resultado.ok ? resultado.data.data : []
})

type Fila = InventarioValorizado['data'][number]
const columnas: TableColumn<Fila>[] = [
    { accessorKey: 'producto_nombre', header: 'Producto', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'bodega_nombre', header: 'Bodega', meta: SOLO_ANCHO },
    { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-end', td: 'text-end' } } },
    { accessorKey: 'costo_promedio', header: 'Promedio', meta: { class: { th: 'text-end hidden lg:table-cell', td: 'text-end hidden lg:table-cell' } } },
    { accessorKey: 'valor', header: 'Valor', meta: { class: { th: 'text-end', td: 'text-end' } } },
]

const busqueda = ref('')
const filas = computed(() => {
    const q = busqueda.value.trim().toLowerCase()
    return (reporte.value?.data ?? []).filter(f => !q || f.producto_nombre.toLowerCase().includes(q) || f.producto_sku.toLowerCase().includes(q))
})

const descuadres = computed(() => (reporte.value?.cuadre ?? []).filter(c => !new Decimal(c.diferencia).isZero()))
</script>

<template>
    <PanelPagina
        id="inventario-valorizado"
        titulo="Inventario valorizado"
        icono="i-lucide-scale"
    >
        <div class="flex min-h-0 flex-1 flex-col gap-4">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <div
                v-else
                class="grid gap-3 sm:grid-cols-2"
            >
                <TarjetaDato
                    :etiqueta="reporte ? `Valor al ${formatearFecha(reporte.fecha)}` : 'Valor'"
                    icono="i-lucide-scale"
                    tono="tono-marca"
                    :valor="reporte ? formatearQuetzales(reporte.total) : null"
                    :detalle="reporte ? `${reporte.data.length} ${reporte.data.length === 1 ? 'línea' : 'líneas'} de producto y bodega` : undefined"
                    data-prueba="valorizado-total"
                />
                <div
                    class="surface-card flex min-w-0 items-center gap-3 rounded-2xl p-3 sm:p-4"
                    data-prueba="valorizado-cuadre"
                >
                    <span
                        class="pastilla-icono pastilla-tono hidden size-10 shrink-0 rounded-xl sm:flex"
                        :class="descuadres.length ? 'tono-error' : 'tono-exito'"
                    >
                        <UIcon
                            :name="descuadres.length ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
                            class="size-5"
                        />
                    </span>
                    <div class="flex min-w-0 flex-col">
                        <span class="text-[0.8125rem] text-muted">Cuadre con 1.1.14 Inventarios</span>
                        <USkeleton
                            v-if="!reporte"
                            class="mt-1 h-5 w-40"
                        />
                        <span
                            v-else-if="!descuadres.length"
                            class="text-sm font-semibold text-success"
                        >El kardex cuadra con el libro</span>
                        <span
                            v-for="c in descuadres"
                            :key="c.empresa_id"
                            class="text-sm font-semibold text-error"
                        >Empresa {{ c.empresa_id }}: kardex {{ formatearQuetzales(c.valor_kardex) }} · libro {{ formatearQuetzales(c.saldo_libro) }} · diferencia {{ formatearQuetzales(c.diferencia) }}</span>
                    </div>
                </div>
            </div>

            <div class="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-auto rounded-2xl">
                <div class="flex flex-wrap items-center gap-2 p-3 sm:px-4">
                    <UInput
                        v-model="busqueda"
                        icon="i-lucide-search"
                        placeholder="Producto o SKU"
                        aria-label="Buscar producto"
                        class="w-full sm:w-64"
                        :ui="{ base: 'rounded-full' }"
                    />
                    <UInput
                        v-model="fecha"
                        type="date"
                        aria-label="Fecha"
                        class="w-full sm:w-44"
                        data-prueba="valorizado-fecha"
                    />
                    <USelect
                        v-model="bodega"
                        :items="itemsBodega"
                        icon="i-lucide-filter"
                        class="w-full sm:w-52"
                        aria-label="Bodega"
                    />
                    <USwitch
                        v-model="conCeros"
                        label="Con existencia 0"
                        class="sm:ms-auto"
                    />
                </div>
                <UTable
                    v-if="!problema"
                    :data="filas"
                    :columns="columnas"
                    :loading="cargando"
                    sticky
                    :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                    data-prueba="tabla-valorizado"
                >
                    <template #producto_nombre-cell="{ row }">
                        <div class="flex min-w-0 flex-col">
                            <span class="font-semibold text-highlighted">{{ row.original.producto_nombre }}</span>
                            <span class="font-mono text-xs text-muted">{{ row.original.producto_sku }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ row.original.bodega_nombre }}</span>
                        </div>
                    </template>
                    <template #cantidad-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearCantidad(row.original.cantidad, row.original.unidad) }}</span>
                    </template>
                    <template #costo_promedio-cell="{ row }">
                        <span class="text-sm tabular-nums text-muted">{{ row.original.costo_promedio ? formatearQuetzales(new Decimal(row.original.costo_promedio).toFixed(2)) : '—' }}</span>
                    </template>
                    <template #valor-cell="{ row }">
                        <span class="text-sm font-semibold tabular-nums">{{ formatearQuetzales(row.original.valor) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-scale"
                            title="Sin existencias a esa fecha"
                            description="El kardex no tenía movimientos hasta esa fecha."
                            variant="naked"
                        />
                    </template>
                </UTable>
            </div>
        </div>
    </PanelPagina>
</template>
