<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Puntos de lealtad de un cliente (`GET /clientes/:id/puntos`, `lealtad.ver`): saldo por empresa
 * con los puntos por vencer, los lotes vivos y los movimientos ("Ver más" por cursor). Con error no
 * muestra saldos: solo el aviso y "Reintentar". "Ajustar puntos" pide `lealtad.ajustar`.
 */
const props = defineProps<{
    clienteId: number
    clienteNombre: string
}>()

const toast = useToast()
const { puede, enlace } = usePermisos()
const { empresas, conSelector } = useEmpresaActiva()

const datos = shallowRef<PuntosCliente | null>(null)
const movimientos = shallowRef<MovimientoPuntos[]>([])
const siguiente = ref<string | null>(null)
const cargando = ref(true)
const cargandoMas = ref(false)
const problema = ref<Problem | null>(null)
const problemaMas = ref<Problem | null>(null)
const ajustando = ref(false)

const columnasLotes: TableColumn<LotePuntos>[] = [
    { accessorKey: 'created_at', header: 'Lote' },
    { accessorKey: 'restante', header: 'Vivos', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'vence_en', header: 'Vence', meta: SOLO_ANCHO },
]

const columnasMovimientos: TableColumn<MovimientoPuntos>[] = [
    { accessorKey: 'created_at', header: 'Movimiento' },
    { accessorKey: 'origen_tipo', header: 'Origen', meta: SOLO_ESCRITORIO },
    { accessorKey: 'puntos', header: 'Puntos', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

function nombreEmpresa(id: number): string {
    return empresas.value.find(e => e.id === id)?.nombre_comercial ?? `Empresa ${id}`
}

function lotesVivos(saldo: SaldoPuntos): LotePuntos[] {
    return saldo.lotes.filter(l => l.restante > 0)
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await usePuntosLealtad().deCliente(props.clienteId)
    cargando.value = false
    if (!resultado.ok) {
        datos.value = null
        movimientos.value = []
        problema.value = resultado.problema
        return
    }
    datos.value = resultado.data
    movimientos.value = resultado.data.movimientos.data
    siguiente.value = resultado.data.movimientos.nextCursor
}

async function verMas() {
    if (!siguiente.value) {
        return
    }
    cargandoMas.value = true
    problemaMas.value = null
    const resultado = await usePuntosLealtad().deCliente(props.clienteId, siguiente.value)
    cargandoMas.value = false
    if (!resultado.ok) {
        problemaMas.value = resultado.problema
        return
    }
    movimientos.value = [...movimientos.value, ...resultado.data.movimientos.data]
    siguiente.value = resultado.data.movimientos.nextCursor
}

function alAjustar(ajuste: AjustePuntos) {
    toast.add({ title: 'Puntos ajustados', description: `${formatearPuntos(ajuste.movimiento.puntos)} · saldo ${formatearPuntos(ajuste.saldo)}`, icon: 'i-lucide-circle-check', color: 'success' })
    void cargar()
}

watch(() => props.clienteId, cargar)
onMounted(cargar)
</script>

<template>
    <div class="flex flex-col gap-6">
        <div
            v-if="puede('lealtad.ajustar')"
            class="flex justify-end"
        >
            <UButton
                label="Ajustar puntos"
                icon="i-lucide-pencil"
                color="neutral"
                variant="outline"
                data-prueba="abrir-ajuste"
                @click="ajustando = true"
            />
        </div>

        <USkeleton
            v-if="cargando && !datos"
            class="h-32 w-full"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
            data-prueba="puntos-error"
        />
        <template v-else-if="datos">
            <UEmpty
                v-if="!datos.saldos.length"
                icon="i-lucide-gem"
                title="Sin puntos todavía"
                description="Gana puntos con las reglas del programa de su empresa."
                variant="naked"
            />
            <UPageCard
                v-for="saldo in datos.saldos"
                :key="saldo.empresa_id"
                variant="subtle"
                :data-saldo-empresa="saldo.empresa_id"
            >
                <div class="flex flex-col gap-4">
                    <h3
                        v-if="conSelector || datos.saldos.length > 1"
                        class="text-sm font-semibold text-highlighted"
                    >
                        {{ nombreEmpresa(saldo.empresa_id) }}
                    </h3>
                    <dl class="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
                        <DatoFicha
                            etiqueta="Saldo"
                            :valor="formatearPuntos(saldo.saldo)"
                            data-prueba="saldo-puntos"
                        />
                        <DatoFicha
                            etiqueta="Por vencer"
                            :valor="saldo.por_vencer ? `${formatearPuntos(saldo.por_vencer)} el ${formatearFecha(saldo.proximo_vencimiento)}` : 'Nada por vencer'"
                        />
                        <DatoFicha
                            etiqueta="Pasivo de sus puntos"
                            :valor="formatearQuetzales(saldo.valor_pasivo)"
                        />
                        <DatoFicha
                            etiqueta="Lotes vivos"
                            :valor="lotesVivos(saldo).length"
                        />
                    </dl>
                    <UAlert
                        v-if="saldo.saldo < 0"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        description="Saldo negativo por un reverso después de un canje: no puede canjear hasta volver a positivo."
                    />
                    <UTable
                        v-if="lotesVivos(saldo).length"
                        :data="lotesVivos(saldo)"
                        :columns="columnasLotes"
                        tabindex="0"
                        aria-label="Lotes vivos"
                    >
                        <template #created_at-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm">#{{ row.original.id }} · {{ TIPOS_MOVIMIENTO_PUNTOS[row.original.tipo].etiqueta }}</span>
                                <span class="text-xs text-muted">{{ formatearFecha(row.original.created_at) }} · de {{ formatearPuntos(row.original.puntos) }}</span>
                                <span class="text-xs text-muted sm:hidden">{{ row.original.vence_en ? `Vence ${formatearFecha(row.original.vence_en)}` : 'No vence' }}</span>
                            </div>
                        </template>
                        <template #restante-cell="{ row }">
                            <span class="tabular-nums font-medium">{{ formatearPuntos(row.original.restante) }}</span>
                        </template>
                        <template #vence_en-cell="{ row }">
                            <span class="text-sm">{{ row.original.vence_en ? formatearFecha(row.original.vence_en) : 'No vence' }}</span>
                        </template>
                    </UTable>
                </div>
            </UPageCard>

            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-highlighted">
                    Movimientos
                </h3>
                <UTable
                    :data="movimientos"
                    :columns="columnasMovimientos"
                    data-prueba="tabla-movimientos-puntos"
                >
                    <template #created_at-cell="{ row }">
                        <div class="flex min-w-0 flex-col whitespace-normal">
                            <span class="flex items-center gap-2">
                                <UBadge
                                    :label="TIPOS_MOVIMIENTO_PUNTOS[row.original.tipo].etiqueta"
                                    :color="TIPOS_MOVIMIENTO_PUNTOS[row.original.tipo].color"
                                    :icon="TIPOS_MOVIMIENTO_PUNTOS[row.original.tipo].icono"
                                    variant="subtle"
                                    size="sm"
                                />
                                <span class="text-xs text-muted">{{ formatearFechaHora(row.original.created_at) }}</span>
                            </span>
                            <span
                                v-if="row.original.motivo"
                                class="text-xs text-muted"
                            >{{ row.original.motivo }}</span>
                            <span class="text-xs text-muted lg:hidden">{{ ORIGENES_PUNTOS[row.original.origen_tipo] }}{{ row.original.origen_id ? ` #${row.original.origen_id}` : '' }}</span>
                        </div>
                    </template>
                    <template #origen_tipo-cell="{ row }">
                        <ULink
                            v-if="row.original.origen_tipo === 'factura' && row.original.origen_id"
                            :to="enlace(`/facturas/${row.original.origen_id}`)"
                            class="text-sm underline"
                        >
                            Factura #{{ row.original.origen_id }}
                        </ULink>
                        <ULink
                            v-else-if="row.original.origen_tipo === 'pago' && row.original.origen_id"
                            :to="enlace(`/pagos/${row.original.origen_id}`)"
                            class="text-sm underline"
                        >
                            Pago #{{ row.original.origen_id }}
                        </ULink>
                        <span
                            v-else
                            class="text-sm"
                        >{{ ORIGENES_PUNTOS[row.original.origen_tipo] }}{{ row.original.origen_id ? ` #${row.original.origen_id}` : '' }}</span>
                    </template>
                    <template #puntos-cell="{ row }">
                        <div class="flex flex-col items-end">
                            <span
                                class="tabular-nums font-medium"
                                :class="row.original.puntos < 0 ? 'text-error' : 'text-success'"
                            >{{ row.original.puntos > 0 ? '+' : '' }}{{ formatearPuntos(row.original.puntos) }}</span>
                            <span
                                v-if="row.original.vence_en"
                                class="text-xs text-muted"
                            >vence {{ formatearFecha(row.original.vence_en) }}</span>
                        </div>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-list"
                            title="Sin movimientos"
                            variant="naked"
                        />
                    </template>
                </UTable>
                <ProblemaAlerta
                    v-if="problemaMas"
                    :problema="problemaMas"
                    :reintentar="verMas"
                    :reintentando="cargandoMas"
                />
                <UButton
                    v-else-if="siguiente"
                    label="Ver más"
                    icon="i-lucide-chevrons-down"
                    color="neutral"
                    variant="ghost"
                    :loading="cargandoMas"
                    class="self-center"
                    @click="verMas"
                />
            </section>
        </template>

        <PuntosAjusteModal
            v-if="puede('lealtad.ajustar')"
            v-model:open="ajustando"
            :cliente-id="clienteId"
            :cliente-nombre="clienteNombre"
            @hecho="alAjustar"
        />
    </div>
</template>
