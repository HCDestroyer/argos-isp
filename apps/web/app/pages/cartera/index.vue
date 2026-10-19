<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Cartera (A3, fase 4 §10.9): estimaciones de incobrables por año y castigos de facturas con su
 * motivo y evidencia. Provisionar (`cartera.provisionar`) y castigar (`cartera.castigar`) piden
 * confirmación escrita. El estado de cada factura castigada se lee de la API, tal cual.
 */
definePageMeta({ permiso: 'reportes.ver' })

useHead({ title: 'Cartera · ArgosIsp' })

const toast = useToast()
const { puede, enlace } = usePermisos()

const provisiones = usePaginacionCursor(cursor => useCartera().provisiones(cursor))
const castigos = usePaginacionCursor(cursor => useCartera().castigos(cursor))

/** Estado actual de cada factura castigada (`GET /facturas/:id`); sin `facturas.ver` no se muestra. */
const estadosFactura = ref<Record<number, EstadoFactura>>({})
const ultimoCastigo = shallowRef<CastigoCartera | null>(null)

const provisionando = ref(false)
const castigando = ref(false)

const columnasProvisiones: TableColumn<ProvisionCartera>[] = [
    { accessorKey: 'anio', header: 'Año' },
    { accessorKey: 'base', header: 'Saldos deudores', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'tope', header: 'Tope', meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { accessorKey: 'saldo_anterior', header: 'Ya estimado', meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { accessorKey: 'monto', header: 'Registrado', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const columnasCastigos: TableColumn<CastigoCartera>[] = [
    { accessorKey: 'cliente_nombre', header: 'Castigo' },
    { accessorKey: 'estimacion', header: 'De la estimación', meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { accessorKey: 'gasto', header: 'Al gasto', meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

async function leerEstados(lista: readonly CastigoCartera[]) {
    if (!puede('facturas.ver')) {
        return
    }
    const ids = [...new Set(lista.flatMap(c => c.facturas.map(f => f.factura_id)))].filter(id => !(id in estadosFactura.value)).slice(0, 50)
    const leidas = await Promise.all(ids.map(id => useFacturas().ver(id)))
    const nuevos: Record<number, EstadoFactura> = {}
    leidas.forEach((resultado) => {
        if (resultado.ok) {
            nuevos[resultado.data.id] = resultado.data.estado
        }
    })
    estadosFactura.value = { ...estadosFactura.value, ...nuevos }
}

async function recargarCastigos() {
    await castigos.recargar()
    await leerEstados(castigos.filas.value)
}

function alProvisionar(provision: ProvisionCartera) {
    toast.add({
        title: `Estimación ${provision.anio} registrada`,
        description: new Decimal(provision.monto).isZero()
            ? `Ya estaba en el tope (${formatearQuetzales(provision.tope)}): se registró en cero.`
            : `${formatearQuetzales(provision.monto)} hasta el tope de ${formatearQuetzales(provision.tope)}`,
        icon: 'i-lucide-shield-alert',
        color: 'success',
    })
    void provisiones.recargar()
}

async function alCastigar(castigo: CastigoCartera) {
    // El estado de las facturas castigadas se vuelve a leer: lo decide la API.
    const ids = new Set(castigo.facturas.map(f => f.factura_id))
    estadosFactura.value = Object.fromEntries(Object.entries(estadosFactura.value).filter(([id]) => !ids.has(Number(id))))
    ultimoCastigo.value = castigo
    toast.add({ title: `Castigo #${castigo.id} registrado`, description: `${castigo.cliente_nombre} · ${formatearQuetzales(castigo.monto)}`, icon: 'i-lucide-file-x', color: 'success' })
    await leerEstados([castigo])
    void recargarCastigos()
}

onMounted(() => {
    void provisiones.recargar()
    void recargarCastigos()
})
</script>

<template>
    <PanelPagina
        id="cartera"
        titulo="Cartera"
        icono="i-lucide-shield-alert"
    >
        <template #acciones>
            <UButton
                v-if="puede('cartera.provisionar')"
                label="Provisionar"
                icon="i-lucide-shield-alert"
                color="neutral"
                variant="outline"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Provisionar incobrables"
                data-prueba="abrir-provision"
                @click="provisionando = true"
            />
            <UButton
                v-if="puede('cartera.castigar')"
                label="Castigar"
                icon="i-lucide-file-x"
                color="error"
                variant="soft"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Castigar cartera"
                data-prueba="abrir-castigo"
                @click="castigando = true"
            />
        </template>

        <div class="flex flex-col gap-6">
            <UAlert
                v-if="ultimoCastigo"
                color="success"
                variant="subtle"
                icon="i-lucide-file-x"
                :title="`Castigo #${ultimoCastigo.id}: ${ultimoCastigo.cliente_nombre} · ${formatearQuetzales(ultimoCastigo.monto)}`"
                data-prueba="resultado-castigo"
            >
                <template #description>
                    <p class="tabular-nums">
                        De la estimación {{ formatearQuetzales(ultimoCastigo.estimacion) }} · al gasto {{ formatearQuetzales(ultimoCastigo.gasto) }} · IVA por certificar {{ formatearQuetzales(ultimoCastigo.iva) }}
                    </p>
                    <ul class="mt-1 flex flex-wrap gap-2">
                        <li
                            v-for="factura in ultimoCastigo.facturas"
                            :key="factura.factura_id"
                            class="flex items-center gap-1"
                        >
                            <ULink
                                :to="enlace(`/facturas/${factura.factura_id}`)"
                                class="underline"
                            >Factura #{{ factura.factura_id }}</ULink>
                            <EstadoFacturaBadge
                                v-if="estadosFactura[factura.factura_id]"
                                :estado="estadosFactura[factura.factura_id]!"
                                size="sm"
                                :data-estado-factura="factura.factura_id"
                            />
                        </li>
                    </ul>
                </template>
            </UAlert>

            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-highlighted">
                    Estimación de incobrables (1.1.12)
                </h3>
                <ProblemaAlerta
                    v-if="provisiones.problema.value"
                    :problema="provisiones.problema.value"
                    :reintentar="provisiones.recargar"
                    :reintentando="provisiones.cargando.value"
                />
                <template v-else>
                    <UTable
                        :data="provisiones.filas.value"
                        :columns="columnasProvisiones"
                        :loading="provisiones.cargando.value"
                        data-prueba="tabla-provisiones"
                    >
                        <template #anio-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-highlighted">{{ row.original.anio }}</span>
                                <span class="text-xs text-muted">Corte {{ formatearFecha(row.original.fecha) }} · {{ Number(row.original.porcentaje) }} %</span>
                            </div>
                        </template>
                        <template #base-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.base) }}</span>
                        </template>
                        <template #tope-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.tope) }}</span>
                        </template>
                        <template #saldo_anterior-cell="{ row }">
                            <span class="tabular-nums text-muted">{{ formatearQuetzales(row.original.saldo_anterior) }}</span>
                        </template>
                        <template #monto-cell="{ row }">
                            <span class="tabular-nums font-medium text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-shield"
                                title="Sin estimaciones registradas"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="provisiones.pagina.value"
                        :hay-anterior="provisiones.hayAnterior.value"
                        :hay-siguiente="provisiones.haySiguiente.value"
                        :cargando="provisiones.cargando.value"
                        :filas="provisiones.filas.value.length"
                        @anterior="provisiones.anterior"
                        @siguiente="provisiones.siguiente"
                    />
                </template>
            </section>

            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-highlighted">
                    Castigos
                </h3>
                <ProblemaAlerta
                    v-if="castigos.problema.value"
                    :problema="castigos.problema.value"
                    :reintentar="recargarCastigos"
                    :reintentando="castigos.cargando.value"
                />
                <template v-else>
                    <UTable
                        :data="castigos.filas.value"
                        :columns="columnasCastigos"
                        :loading="castigos.cargando.value"
                        data-prueba="tabla-castigos"
                    >
                        <template #cliente_nombre-cell="{ row }">
                            <div class="flex min-w-0 flex-col whitespace-normal">
                                <ULink
                                    :to="enlace(`/clientes/${row.original.cliente_id}?tab=cuenta`)"
                                    class="text-sm font-medium text-highlighted hover:text-primary"
                                >
                                    #{{ row.original.id }} · {{ row.original.cliente_nombre }}
                                </ULink>
                                <span class="text-xs text-muted">{{ formatearFecha(row.original.fecha) }} · {{ row.original.motivo }}</span>
                                <span class="text-xs text-dimmed">Gestión: {{ row.original.evidencia }}</span>
                                <span class="mt-1 flex flex-wrap gap-2">
                                    <span
                                        v-for="factura in row.original.facturas"
                                        :key="factura.factura_id"
                                        class="flex items-center gap-1 text-xs"
                                    >
                                        <ULink
                                            :to="enlace(`/facturas/${factura.factura_id}`)"
                                            class="underline"
                                        >#{{ factura.factura_id }}</ULink>
                                        <EstadoFacturaBadge
                                            v-if="estadosFactura[factura.factura_id]"
                                            :estado="estadosFactura[factura.factura_id]!"
                                            size="sm"
                                        />
                                    </span>
                                </span>
                            </div>
                        </template>
                        <template #estimacion-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.estimacion) }}</span>
                        </template>
                        <template #gasto-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.gasto) }}</span>
                        </template>
                        <template #monto-cell="{ row }">
                            <div class="flex flex-col items-end">
                                <span class="tabular-nums font-medium text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                                <span
                                    v-if="!new Decimal(row.original.iva).isZero()"
                                    class="text-xs text-muted"
                                >IVA {{ formatearQuetzales(row.original.iva) }}</span>
                            </div>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-file-x"
                                title="Sin castigos"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="castigos.pagina.value"
                        :hay-anterior="castigos.hayAnterior.value"
                        :hay-siguiente="castigos.haySiguiente.value"
                        :cargando="castigos.cargando.value"
                        :filas="castigos.filas.value.length"
                        @anterior="castigos.anterior"
                        @siguiente="castigos.siguiente"
                    />
                </template>
            </section>
        </div>

        <CarteraProvisionModal
            v-if="puede('cartera.provisionar')"
            v-model:open="provisionando"
            @hecho="alProvisionar"
        />
        <CarteraCastigoModal
            v-if="puede('cartera.castigar')"
            v-model:open="castigando"
            @hecho="alCastigar"
        />
    </PanelPagina>
</template>
