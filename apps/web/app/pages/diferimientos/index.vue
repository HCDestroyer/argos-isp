<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Diferidos (A3, fase 5; §10.10): gastos pagados por anticipado (1.1.13) e ingresos diferidos (2.1.12)
 * con lo amortizado y lo pendiente. «Amortizar pendiente» (`libro.registrar_asiento`) hace lo mismo que el
 * cron diario: las cuotas hasta el mes anterior. Una línea de compra se difiere desde su compra.
 */
definePageMeta({ permiso: 'libro.ver' })

useHead({ title: 'Diferidos · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()

const TODOS = 'todos'
const origen = ref<'compra' | 'factura' | typeof TODOS>(route.query.origen === 'compra' || route.query.origen === 'factura' ? route.query.origen : TODOS)
const itemsOrigen: SelectItem[] = [{ label: 'Gastos e ingresos', value: TODOS }, { label: 'Gastos anticipados (compras)', value: 'compra' }, { label: 'Ingresos diferidos (facturas)', value: 'factura' }]

const lista = usePaginacionCursor(cursor => useDiferimientos().listar(origen.value !== TODOS ? { origen: origen.value } : {}, cursor))

const columnas: TableColumn<Diferimiento>[] = [
    { accessorKey: 'descripcion', header: 'Diferido', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'total', header: 'Total', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
    { accessorKey: 'pendiente', header: 'Pendiente', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
]

watch(origen, async () => {
    await router.replace({ query: origen.value !== TODOS ? { origen: origen.value } : {} })
    await lista.recargar()
})

const amortizando = ref(false)

async function amortizar() {
    amortizando.value = true
    const resultado = await useDiferimientos().amortizar()
    amortizando.value = false
    if (!resultado.ok) {
        const legible = problemaCompraLegible(resultado.problema)
        toast.add({ title: legible.title, description: legible.detail, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    toast.add({
        title: resultado.data.cuotas ? `${resultado.data.cuotas} cuotas registradas` : 'Nada pendiente',
        description: resultado.data.cuotas ? `${formatearQuetzales(resultado.data.monto)} hasta ${resultado.data.hasta.slice(0, 7)}` : `Los diferidos ya están al día hasta ${resultado.data.hasta.slice(0, 7)}.`,
        icon: 'i-lucide-calendar-range',
        color: 'success',
    })
    void lista.recargar()
}

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="diferimientos"
        titulo="Diferidos"
        icono="i-lucide-calendar-range"
    >
        <template #acciones>
            <UButton
                v-if="puede('libro.registrar_asiento')"
                label="Amortizar pendiente"
                icon="i-lucide-calendar-check"
                color="neutral"
                variant="outline"
                :loading="amortizando"
                data-prueba="amortizar-pendiente"
                @click="amortizar"
            />
        </template>

        <div class="flex flex-col gap-4">
            <USelect
                v-model="origen"
                :items="itemsOrigen"
                aria-label="Origen"
                class="w-full sm:max-w-xs"
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
                    data-prueba="tabla-diferimientos"
                >
                    <template #descripcion-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col"
                            :data-diferimiento="row.original.id"
                        >
                            <ULink
                                :to="`/diferimientos/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:underline"
                            >
                                #{{ row.original.id }} · {{ row.original.descripcion }}
                            </ULink>
                            <span class="text-xs text-muted">{{ row.original.origen === 'compra' ? 'Gasto anticipado' : 'Ingreso diferido' }} · {{ row.original.meses }} meses desde {{ row.original.inicio.slice(0, 7) }} · {{ row.original.cuotas.length }} cuotas</span>
                        </div>
                    </template>
                    <template #total-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.total) }}</span>
                    </template>
                    <template #pendiente-cell="{ row }">
                        <span class="font-medium tabular-nums">{{ formatearQuetzales(row.original.pendiente) }}</span>
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="ESTADOS_DIFERIMIENTO[row.original.estado].etiqueta"
                            :color="ESTADOS_DIFERIMIENTO[row.original.estado].color"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-calendar-range"
                            title="Sin diferidos"
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
