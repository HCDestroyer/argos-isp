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
const itemsBodega = computed<SelectItem[]>(() => [{ label: 'Todas las bodegas', value: 0 }, ...bodegas.value.map(b => ({ label: b.nombre, value: b.id }))])

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
    { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'costo_promedio', header: 'Promedio', meta: { class: { th: 'text-right hidden lg:table-cell', td: 'text-right hidden lg:table-cell' } } },
    { accessorKey: 'valor', header: 'Valor', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const descuadres = computed(() => (reporte.value?.cuadre ?? []).filter(c => !new Decimal(c.diferencia).isZero()))
</script>

<template>
    <PanelPagina
        id="inventario-valorizado"
        titulo="Inventario valorizado"
        icono="i-lucide-scale"
    >
        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                    class="w-full sm:w-56"
                    aria-label="Bodega"
                />
                <USwitch
                    v-model="conCeros"
                    label="Con existencia 0"
                />
            </div>
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <template v-else>
                <div
                    v-if="reporte"
                    class="grid gap-3 sm:grid-cols-2"
                >
                    <div class="surface-card flex flex-col gap-1 p-4">
                        <span class="text-sm text-muted">Valor al {{ formatearFecha(reporte.fecha) }}</span>
                        <span
                            class="text-2xl font-semibold text-highlighted tabular-nums"
                            data-prueba="valorizado-total"
                        >{{ formatearQuetzales(reporte.total) }}</span>
                    </div>
                    <div
                        class="surface-card flex flex-col gap-1 p-4"
                        data-prueba="valorizado-cuadre"
                    >
                        <span class="text-sm text-muted">Cuadre con 1.1.14 Inventarios</span>
                        <span
                            v-if="!descuadres.length"
                            class="flex items-center gap-1.5 text-sm font-medium text-success"
                        >
                            <UIcon
                                name="i-lucide-circle-check"
                                class="size-4"
                            />
                            El kardex cuadra con el libro
                        </span>
                        <span
                            v-for="c in descuadres"
                            :key="c.empresa_id"
                            class="flex items-center gap-1.5 text-sm font-medium text-error"
                        >
                            <UIcon
                                name="i-lucide-triangle-alert"
                                class="size-4"
                            />
                            Empresa {{ c.empresa_id }}: kardex {{ formatearQuetzales(c.valor_kardex) }} · libro {{ formatearQuetzales(c.saldo_libro) }} · diferencia {{ formatearQuetzales(c.diferencia) }}
                        </span>
                    </div>
                </div>
                <UTable
                    :data="reporte?.data ?? []"
                    :columns="columnas"
                    :loading="cargando"
                    :ui="{ td: 'py-2.5' }"
                    data-prueba="tabla-valorizado"
                >
                    <template #producto_nombre-cell="{ row }">
                        <div class="flex min-w-0 flex-col gap-0.5">
                            <span class="text-sm font-medium text-highlighted">{{ row.original.producto_nombre }}</span>
                            <span class="font-mono text-xs text-muted">{{ row.original.producto_sku }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ row.original.bodega_nombre }}</span>
                        </div>
                    </template>
                    <template #cantidad-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearCantidad(row.original.cantidad, row.original.unidad) }}</span>
                    </template>
                    <template #costo_promedio-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ row.original.costo_promedio ? formatearQuetzales(new Decimal(row.original.costo_promedio).toFixed(2)) : '—' }}</span>
                    </template>
                    <template #valor-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearQuetzales(row.original.valor) }}</span>
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
            </template>
        </div>
    </PanelPagina>
</template>
