<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/** Ficha de una liquidación de cobros (`GET /cobros/liquidaciones/:id`): montos, pagos y su asiento. */
definePageMeta({ permiso: 'bancos.ver' })

type PagoLiquidado = LiquidacionCobro['pagos'][number]

const route = useRoute()
const { puede, enlace } = usePermisos()

const liquidacionId = computed(() => Number(route.params.id))
const liquidacion = shallowRef<LiquidacionCobro | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const asientos = shallowRef<Asiento[]>([])
const problemaAsientos = ref<Problem | null>(null)
const cargandoAsientos = ref(false)

useHead(() => ({ title: `Liquidación #${route.params.id} · ArgosIsp` }))

const columnas: TableColumn<PagoLiquidado>[] = [
    { accessorKey: 'pago_id', header: 'Pago' },
    { accessorKey: 'tipo', header: 'Tipo' },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

async function cargarAsientos(actual: LiquidacionCobro) {
    if (!puede('libro.ver')) {
        return
    }
    cargandoAsientos.value = true
    const resultado = await useLibro().asientosDe('liquidacion_cobro', actual.id, sumarDiasFecha(actual.fecha, -1))
    cargandoAsientos.value = false
    asientos.value = resultado.ok ? resultado.data : []
    problemaAsientos.value = resultado.ok ? null : resultado.problema
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useLiquidaciones().ver(liquidacionId.value)
    cargando.value = false
    if (!resultado.ok) {
        liquidacion.value = null
        problema.value = resultado.problema
        return
    }
    liquidacion.value = resultado.data
    void cargarAsientos(resultado.data)
}

watch(liquidacionId, cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="liquidacion"
        :titulo="`Liquidación #${route.params.id}`"
        icono="i-lucide-hand-coins"
    >
        <template #acciones>
            <UButton
                to="/cobros/por-liquidar"
                icon="i-lucide-arrow-left"
                label="Cobros por liquidar"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <USkeleton
            v-if="cargando && !liquidacion"
            class="h-40 w-full"
        />

        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-file-x"
            title="Liquidación no encontrada"
            :actions="[{ label: 'Volver', to: '/cobros/por-liquidar', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />

        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div
            v-else-if="liquidacion"
            class="flex flex-col gap-6"
        >
            <div class="flex flex-col gap-1">
                <h2 class="text-xl font-semibold text-highlighted">
                    {{ liquidacion.referencia }}
                </h2>
                <p class="text-sm text-muted">
                    {{ liquidacion.proveedor_nombre }} · {{ formatearFecha(liquidacion.fecha) }} · registrada {{ formatearFechaHora(liquidacion.created_at) }}
                </p>
            </div>

            <UPageCard
                title="Montos"
                icon="i-lucide-calculator"
                variant="subtle"
            >
                <dl class="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
                    <DatoFicha
                        etiqueta="Bruto (sale del puente)"
                        :valor="formatearQuetzales(liquidacion.bruto)"
                    />
                    <DatoFicha
                        etiqueta="Comisión (5.1.02)"
                        :valor="formatearQuetzales(liquidacion.comision)"
                    />
                    <DatoFicha
                        etiqueta="Neto al banco"
                        :valor="formatearQuetzales(liquidacion.neto)"
                    />
                    <DatoFicha
                        etiqueta="Banco"
                        :valor="liquidacion.cuenta_codigo"
                        mono
                    />
                    <DatoFicha
                        etiqueta="Archivo"
                        :valor="liquidacion.archivo"
                    />
                    <DatoFicha
                        etiqueta="sha256"
                        :valor="liquidacion.sha256"
                        mono
                        class="col-span-2 break-all"
                    />
                    <DatoFicha
                        etiqueta="Nota"
                        :valor="liquidacion.nota"
                    />
                </dl>
            </UPageCard>

            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-highlighted">
                    Pagos de la liquidación
                </h3>
                <UTable
                    :data="liquidacion.pagos"
                    :columns="columnas"
                >
                    <template #pago_id-cell="{ row }">
                        <ULink
                            :to="enlace(`/pagos/${row.original.pago_id}`)"
                            class="text-sm font-medium text-highlighted hover:text-primary"
                        >
                            Pago #{{ row.original.pago_id }}
                        </ULink>
                    </template>
                    <template #tipo-cell="{ row }">
                        <UBadge
                            :label="row.original.tipo === 'contracargo' ? 'Contracargo' : 'Cobro'"
                            :color="row.original.tipo === 'contracargo' ? 'error' : 'neutral'"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #monto-cell="{ row }">
                        <span class="tabular-nums font-medium">{{ row.original.tipo === 'contracargo' ? `− ${formatearQuetzales(row.original.monto)}` : formatearQuetzales(row.original.monto) }}</span>
                    </template>
                </UTable>
            </section>

            <section
                v-if="puede('libro.ver')"
                class="flex flex-col gap-2"
            >
                <h3 class="text-sm font-semibold text-highlighted">
                    Asiento del libro
                </h3>
                <ProblemaAlerta
                    v-if="problemaAsientos"
                    :problema="problemaAsientos"
                    :reintentar="() => liquidacion && cargarAsientos(liquidacion)"
                    :reintentando="cargandoAsientos"
                />
                <USkeleton
                    v-else-if="cargandoAsientos && !asientos.length"
                    class="h-24 w-full"
                />
                <p
                    v-else-if="!asientos.length"
                    class="text-sm text-muted"
                >
                    No se encontró el asiento #{{ liquidacion.asiento_id }} en el libro diario.
                </p>
                <div
                    v-else
                    class="grid gap-3 lg:grid-cols-2"
                >
                    <AsientoContable
                        v-for="asiento in asientos"
                        :key="asiento.id"
                        :asiento="asiento"
                        :con-origen="false"
                    />
                </div>
            </section>
        </div>
    </PanelPagina>
</template>
