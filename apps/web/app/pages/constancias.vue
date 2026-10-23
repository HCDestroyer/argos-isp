<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Constancias de retención (A3, fase 5): las recibidas de clientes (con su pago) y las emitidas a
 * proveedores (con su compra), por impuesto, fecha y si su pago o compra sigue vigente. La de una compra
 * se registra desde la ficha de la compra.
 */
definePageMeta({ permiso: 'compras.ver' })

useHead({ title: 'Constancias de retención · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()

const TODOS = 'todos'
const direccion = ref<'recibida' | 'emitida' | typeof TODOS>(route.query.direccion === 'recibida' || route.query.direccion === 'emitida' ? route.query.direccion : TODOS)
const impuesto = ref<'iva' | 'isr' | typeof TODOS>(route.query.impuesto === 'iva' || route.query.impuesto === 'isr' ? route.query.impuesto : TODOS)

const itemsDireccion: SelectItem[] = [{ label: 'Recibidas y emitidas', value: TODOS }, { label: 'Recibidas de clientes', value: 'recibida' }, { label: 'Emitidas a proveedores', value: 'emitida' }]
const itemsImpuesto: SelectItem[] = [{ label: 'IVA e ISR', value: TODOS }, { label: 'IVA', value: 'iva' }, { label: 'ISR', value: 'isr' }]

const lista = usePaginacionCursor(cursor => useConstancias().listar({
    ...(direccion.value !== TODOS ? { direccion: direccion.value } : {}),
    ...(impuesto.value !== TODOS ? { impuesto: impuesto.value } : {}),
}, cursor))

const columnas: TableColumn<ConstanciaRetencion>[] = [
    { accessorKey: 'fecha', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'numero', header: 'Constancia', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

watch([direccion, impuesto], async () => {
    await router.replace({ query: { ...(direccion.value !== TODOS ? { direccion: direccion.value } : {}), ...(impuesto.value !== TODOS ? { impuesto: impuesto.value } : {}) } })
    await lista.recargar()
})

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="constancias"
        titulo="Constancias de retención"
        icono="i-lucide-file-check-2"
    >
        <div class="flex flex-col gap-4">
            <div class="grid gap-3 sm:grid-cols-2">
                <USelect
                    v-model="direccion"
                    :items="itemsDireccion"
                    aria-label="Dirección"
                    class="w-full"
                />
                <USelect
                    v-model="impuesto"
                    :items="itemsImpuesto"
                    aria-label="Impuesto"
                    class="w-full"
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
                    data-prueba="tabla-constancias"
                >
                    <template #fecha-cell="{ row }">
                        <span class="whitespace-nowrap text-sm">{{ formatearFecha(row.original.fecha) }}</span>
                    </template>
                    <template #numero-cell="{ row }">
                        <div
                            class="flex flex-col"
                            :data-constancia="row.original.id"
                        >
                            <span class="text-sm font-medium text-highlighted">{{ row.original.numero }} · {{ row.original.impuesto.toUpperCase() }} {{ row.original.direccion === 'emitida' ? 'emitida' : 'recibida' }}</span>
                            <span
                                v-if="row.original.direccion === 'emitida'"
                                class="text-xs text-muted"
                            >
                                A {{ row.original.proveedor_nombre }} ·
                                <ULink
                                    v-if="row.original.compra_id"
                                    :to="`/compras/${row.original.compra_id}`"
                                    class="underline"
                                >compra #{{ row.original.compra_id }}</ULink>
                            </span>
                            <span
                                v-else
                                class="text-xs text-muted"
                            >
                                De {{ row.original.cliente_nombre }}
                                <template v-if="row.original.pago_id"> · pago #{{ row.original.pago_id }}</template>
                            </span>
                            <span
                                v-if="!row.original.vigente"
                                class="text-xs text-muted"
                            >Su {{ row.original.direccion === 'emitida' ? 'compra' : 'pago' }} se anuló</span>
                            <span class="text-xs text-muted sm:hidden">{{ formatearFecha(row.original.fecha) }}</span>
                        </div>
                    </template>
                    <template #monto-cell="{ row }">
                        <span
                            class="tabular-nums"
                            :class="row.original.vigente ? 'font-medium' : 'text-muted line-through'"
                        >{{ formatearQuetzales(row.original.monto) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-file-check-2"
                            title="Sin constancias"
                            :description="puede('compras.registrar') ? 'La constancia de una retención emitida se registra desde su compra.' : undefined"
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
