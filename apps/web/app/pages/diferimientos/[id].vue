<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Ficha de un diferimiento (A3, fase 5): origen (línea de compra o de factura), cuentas, total, meses,
 * lo amortizado y lo pendiente, y cada cuota con su asiento.
 */
definePageMeta({ permiso: 'libro.ver' })

const route = useRoute()
const { puede } = usePermisos()

const id = computed(() => Number(route.params.id))
const diferimiento = shallowRef<Diferimiento | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

useHead(() => ({ title: `${diferimiento.value?.descripcion ?? 'Diferido'} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    const resultado = await useDiferimientos().ver(id.value)
    cargando.value = false
    diferimiento.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

type Cuota = Diferimiento['cuotas'][number]
const columnas: TableColumn<Cuota>[] = [
    { accessorKey: 'mes', header: 'Mes' },
    { accessorKey: 'asiento_id', header: 'Asiento' },
    { accessorKey: 'monto', header: 'Cuota', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="diferimiento"
        :titulo="diferimiento ? `Diferido #${diferimiento.id}` : 'Diferido'"
        icono="i-lucide-calendar-range"
    >
        <div class="flex flex-col gap-6">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <template v-else-if="diferimiento">
                <UCard :ui="{ body: 'p-4 sm:p-4' }">
                    <div class="flex flex-col gap-4">
                        <div class="flex flex-wrap items-center gap-2">
                            <h2 class="text-base font-semibold text-highlighted">
                                {{ diferimiento.descripcion }}
                            </h2>
                            <UBadge
                                :label="ESTADOS_DIFERIMIENTO[diferimiento.estado].etiqueta"
                                :color="ESTADOS_DIFERIMIENTO[diferimiento.estado].color"
                                variant="subtle"
                            />
                        </div>
                        <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
                            <DatoFicha
                                etiqueta="Origen"
                                :valor="diferimiento.origen === 'compra' ? 'Gasto anticipado' : 'Ingreso diferido'"
                            />
                            <DatoFicha
                                v-if="diferimiento.compra_id"
                                etiqueta="Compra"
                            >
                                <ULink
                                    :to="puede('compras.ver') ? `/compras/${diferimiento.compra_id}` : undefined"
                                    class="text-highlighted underline"
                                >
                                    Compra #{{ diferimiento.compra_id }}
                                </ULink>
                            </DatoFicha>
                            <DatoFicha
                                v-if="diferimiento.factura_id"
                                etiqueta="Factura"
                            >
                                <ULink
                                    :to="puede('facturas.ver') ? `/facturas/${diferimiento.factura_id}` : undefined"
                                    class="text-highlighted underline"
                                >
                                    Factura #{{ diferimiento.factura_id }}
                                </ULink>
                            </DatoFicha>
                            <DatoFicha
                                etiqueta="Cuentas"
                                :valor="`${diferimiento.cuenta_diferida_codigo} → ${diferimiento.cuenta_destino_codigo}`"
                                mono
                            />
                            <DatoFicha
                                etiqueta="Meses"
                                :valor="`${diferimiento.meses} desde ${diferimiento.inicio.slice(0, 7)}`"
                            />
                            <DatoFicha etiqueta="Total">
                                <span class="tabular-nums">{{ formatearQuetzales(diferimiento.total) }}</span>
                            </DatoFicha>
                            <DatoFicha etiqueta="Amortizado">
                                <span class="tabular-nums">{{ formatearQuetzales(diferimiento.amortizado) }}</span>
                            </DatoFicha>
                            <DatoFicha etiqueta="Pendiente">
                                <span
                                    class="font-semibold tabular-nums"
                                    data-prueba="diferido-pendiente"
                                >{{ formatearQuetzales(diferimiento.pendiente) }}</span>
                            </DatoFicha>
                        </dl>
                    </div>
                </UCard>
                <UTable
                    :data="diferimiento.cuotas"
                    :columns="columnas"
                    data-prueba="tabla-cuotas"
                >
                    <template #mes-cell="{ row }">
                        {{ row.original.mes.slice(0, 7) }}
                    </template>
                    <template #asiento_id-cell="{ row }">
                        <span class="font-mono text-xs">#{{ row.original.asiento_id }}</span>
                    </template>
                    <template #monto-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.monto) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-calendar"
                            title="Todavía sin cuotas"
                            description="La primera se registra al terminar su mes."
                            variant="naked"
                        />
                    </template>
                </UTable>
            </template>
        </div>
    </PanelPagina>
</template>
