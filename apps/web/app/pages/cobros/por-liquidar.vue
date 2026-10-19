<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Cobros por liquidar (A3, fase 4 §10.3): por proveedor, el saldo de su cuenta puente 1.1.10.NN
 * contra lo pendiente, los pagos sin liquidar con su antigüedad (anomalía sobre
 * `cobros_liquidar_dias`) y "Registrar liquidación" (`cobros.liquidar`). Debajo, las liquidaciones.
 */
definePageMeta({ permiso: 'bancos.ver' })

useHead({ title: 'Cobros por liquidar · ArgosIsp' })

const toast = useToast()
const { puede, enlace } = usePermisos()
const nombres = useNombresClientes()

const resumenes = shallowRef<ResumenCobrosPorLiquidar[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const aLiquidar = shallowRef<ResumenCobrosPorLiquidar | null>(null)
const liquidando = computed({
    get: () => aLiquidar.value !== null,
    set: (valor) => {
        if (!valor) {
            aLiquidar.value = null
        }
    },
})

const liquidaciones = usePaginacionCursor(cursor => useLiquidaciones().listar({}, cursor))

const columnasPagos: TableColumn<PagoPorLiquidar>[] = [
    { accessorKey: 'pago_id', header: 'Pago' },
    { accessorKey: 'cliente_id', header: 'Cliente', meta: SOLO_ANCHO },
    { accessorKey: 'dias', header: 'Antigüedad' },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const columnasLiquidaciones: TableColumn<LiquidacionCobro>[] = [
    { accessorKey: 'referencia', header: 'Liquidación' },
    { accessorKey: 'cuenta_codigo', header: 'Banco', meta: SOLO_ESCRITORIO },
    { accessorKey: 'bruto', header: 'Bruto', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'comision', header: 'Comisión', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'neto', header: 'Neto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

async function cargar() {
    cargando.value = true
    const resultado = await useLiquidaciones().porLiquidar()
    cargando.value = false
    resumenes.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        void nombres.cargar(resultado.data.flatMap(r => r.pagos.map(p => p.cliente_id)))
    }
}

function esAnomalia(resumen: ResumenCobrosPorLiquidar, pago: PagoPorLiquidar): boolean {
    return resumen.anomalias.some(a => a.pago_id === pago.pago_id && a.tipo === pago.tipo)
}

function alLiquidar(liquidacion: LiquidacionCobro) {
    toast.add({
        title: `Liquidación ${liquidacion.referencia} registrada`,
        description: `Neto ${formatearQuetzales(liquidacion.neto)} a ${liquidacion.cuenta_codigo} · comisión ${formatearQuetzales(liquidacion.comision)}`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    void cargar()
    void liquidaciones.recargar()
}

onMounted(() => {
    void cargar()
    void liquidaciones.recargar()
})
</script>

<template>
    <PanelPagina
        id="cobros-por-liquidar"
        titulo="Cobros por liquidar"
        icono="i-lucide-hand-coins"
    >
        <template #acciones>
            <UButton
                :to="enlace('/configuracion/proveedores-cobro')"
                label="Proveedores"
                icon="i-lucide-credit-card"
                color="neutral"
                variant="outline"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Proveedores de cobro"
            />
        </template>

        <div class="flex flex-col gap-6">
            <USkeleton
                v-if="cargando && !resumenes.length"
                class="h-48 w-full"
            />

            <ProblemaAlerta
                v-else-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
                data-prueba="por-liquidar-error"
            />

            <UEmpty
                v-else-if="!resumenes.length"
                icon="i-lucide-hand-coins"
                title="Sin proveedores de cobro"
                description="Configura una pasarela, agente o débito con su fecha de corte para que sus pagos esperen su liquidación aquí."
                :actions="puede('cobros.configurar') ? [{ label: 'Proveedores de cobro', icon: 'i-lucide-credit-card', to: '/configuracion/proveedores-cobro' }] : []"
            />

            <UPageCard
                v-for="resumen in resumenes"
                v-else
                :key="resumen.proveedor_cobro_id"
                variant="subtle"
                :data-proveedor="resumen.proveedor_cobro_id"
            >
                <div class="flex min-w-0 flex-col gap-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex min-w-0 flex-col">
                            <h2 class="flex items-center gap-2 text-lg font-semibold text-highlighted">
                                <UIcon
                                    :name="METODOS_PROVEEDOR[resumen.metodo].icono"
                                    class="size-5 text-muted"
                                />
                                {{ resumen.nombre }}
                            </h2>
                            <p class="text-sm text-muted">
                                {{ METODOS_PROVEEDOR[resumen.metodo].etiqueta }} · puente <span class="font-mono">{{ resumen.cuenta_codigo }}</span> · límite {{ resumen.dias_limite }} días
                            </p>
                        </div>
                        <UButton
                            v-if="puede('cobros.liquidar') && resumen.pagos.length"
                            label="Registrar liquidación"
                            icon="i-lucide-hand-coins"
                            data-prueba="abrir-liquidacion"
                            @click="aLiquidar = resumen"
                        />
                    </div>

                    <dl class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                        <DatoFicha
                            etiqueta="Saldo del puente"
                            :valor="formatearQuetzales(resumen.saldo_libro)"
                            data-prueba="saldo-puente"
                        />
                        <DatoFicha
                            etiqueta="Pendiente de liquidar"
                            :valor="formatearQuetzales(resumen.pendiente)"
                        />
                        <DatoFicha etiqueta="Libro vs pendiente">
                            <UBadge
                                :label="resumen.cuadra ? 'Cuadra' : `Diferencia ${formatearQuetzales(resumen.diferencia)}`"
                                :color="resumen.cuadra ? 'success' : 'error'"
                                :icon="resumen.cuadra ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
                                variant="subtle"
                                data-prueba="cuadra-puente"
                            />
                        </DatoFicha>
                        <DatoFicha etiqueta="Anomalías">
                            <UBadge
                                :label="resumen.anomalias.length ? `${resumen.anomalias.length} con más de ${resumen.dias_limite} días` : 'Ninguna'"
                                :color="resumen.anomalias.length ? 'error' : 'neutral'"
                                :icon="resumen.anomalias.length ? 'i-lucide-alarm-clock' : 'i-lucide-check'"
                                variant="subtle"
                                data-prueba="anomalias"
                            />
                        </DatoFicha>
                    </dl>

                    <UTable
                        :data="resumen.pagos"
                        :columns="columnasPagos"
                        tabindex="0"
                        :aria-label="`Pagos sin liquidar de ${resumen.nombre}`"
                    >
                        <template #pago_id-cell="{ row }">
                            <div class="flex min-w-0 flex-col whitespace-normal">
                                <ULink
                                    :to="enlace(`/pagos/${row.original.pago_id}`)"
                                    class="text-sm font-medium text-highlighted hover:text-primary"
                                >
                                    {{ row.original.tipo === 'contracargo' ? 'Contracargo' : 'Pago' }} #{{ row.original.pago_id }}
                                </ULink>
                                <span class="text-xs text-muted">{{ formatearFecha(row.original.fecha) }}<template v-if="row.original.referencia"> · <span class="break-all">{{ row.original.referencia }}</span></template></span>
                                <span class="truncate text-xs text-muted sm:hidden">{{ nombres.nombre(row.original.cliente_id) }}</span>
                            </div>
                        </template>
                        <template #cliente_id-cell="{ row }">
                            <span class="text-sm">{{ nombres.nombre(row.original.cliente_id) }}</span>
                        </template>
                        <template #dias-cell="{ row }">
                            <UBadge
                                :label="antiguedad(row.original.dias, resumen.dias_limite).etiqueta"
                                :color="esAnomalia(resumen, row.original) ? 'error' : antiguedad(row.original.dias, resumen.dias_limite).color"
                                :icon="esAnomalia(resumen, row.original) ? 'i-lucide-alarm-clock' : undefined"
                                variant="subtle"
                                size="sm"
                                :data-anomalia="esAnomalia(resumen, row.original) ? 'si' : 'no'"
                            />
                        </template>
                        <template #monto-cell="{ row }">
                            <span
                                class="whitespace-nowrap tabular-nums font-medium"
                                :class="row.original.tipo === 'contracargo' ? 'text-error' : 'text-highlighted'"
                            >{{ row.original.tipo === 'contracargo' ? `− ${formatearQuetzales(row.original.monto)}` : formatearQuetzales(row.original.monto) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-circle-check"
                                title="Todo liquidado"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                </div>
            </UPageCard>

            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-highlighted">
                    Liquidaciones registradas
                </h3>
                <ProblemaAlerta
                    v-if="liquidaciones.problema.value"
                    :problema="liquidaciones.problema.value"
                    :reintentar="liquidaciones.recargar"
                    :reintentando="liquidaciones.cargando.value"
                />
                <template v-else>
                    <UTable
                        :data="liquidaciones.filas.value"
                        :columns="columnasLiquidaciones"
                        :loading="liquidaciones.cargando.value"
                        data-prueba="tabla-liquidaciones"
                    >
                        <template #referencia-cell="{ row }">
                            <div class="flex min-w-0 flex-col">
                                <ULink
                                    :to="`/cobros/liquidaciones/${row.original.id}`"
                                    class="text-sm font-medium text-highlighted hover:text-primary"
                                >
                                    {{ row.original.referencia }}
                                </ULink>
                                <span class="text-xs text-muted">{{ row.original.proveedor_nombre }} · {{ formatearFecha(row.original.fecha) }} · {{ row.original.pagos.length }} {{ row.original.pagos.length === 1 ? 'pago' : 'pagos' }}</span>
                            </div>
                        </template>
                        <template #cuenta_codigo-cell="{ row }">
                            <span class="font-mono text-sm">{{ row.original.cuenta_codigo }}</span>
                        </template>
                        <template #bruto-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.bruto) }}</span>
                        </template>
                        <template #comision-cell="{ row }">
                            <span class="tabular-nums text-muted">{{ formatearQuetzales(row.original.comision) }}</span>
                        </template>
                        <template #neto-cell="{ row }">
                            <span class="tabular-nums font-medium text-highlighted">{{ formatearQuetzales(row.original.neto) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-file-spreadsheet"
                                title="Todavía no hay liquidaciones"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="liquidaciones.pagina.value"
                        :hay-anterior="liquidaciones.hayAnterior.value"
                        :hay-siguiente="liquidaciones.haySiguiente.value"
                        :cargando="liquidaciones.cargando.value"
                        :filas="liquidaciones.filas.value.length"
                        @anterior="liquidaciones.anterior"
                        @siguiente="liquidaciones.siguiente"
                    />
                </template>
            </section>
        </div>

        <LiquidacionRegistrarModal
            v-if="aLiquidar"
            v-model:open="liquidando"
            :resumen="aLiquidar"
            @hecho="alLiquidar"
        />
    </PanelPagina>
</template>
