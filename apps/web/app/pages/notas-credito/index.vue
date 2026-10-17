<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ permiso: 'facturas.ver' })

useHead({ title: 'Notas de crédito · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede, enlace } = usePermisos()

const FECHA = /^\d{4}-\d{2}-\d{2}$/

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function idQuery(valor: unknown): number {
    const id = Number(textoQuery(valor))
    return Number.isInteger(id) && id > 0 ? id : 0
}

const clienteId = ref(idQuery(route.query.cliente))
const facturaTexto = ref(idQuery(route.query.factura) ? String(idQuery(route.query.factura)) : '')
const desde = ref(FECHA.test(textoQuery(route.query.desde)) ? textoQuery(route.query.desde) : '')
const hasta = ref(FECHA.test(textoQuery(route.query.hasta)) ? textoQuery(route.query.hasta) : '')
const clienteElegido = shallowRef<Cliente | null>(null)

/** Número de factura escrito, si es un id válido (si no, no se filtra por factura). */
const facturaId = computed(() => idQuery(facturaTexto.value.trim().replace(/^#/, '')))

function filtros(): FiltrosNotasCredito {
    const resultado: FiltrosNotasCredito = {}
    if (clienteId.value) {
        resultado.cliente_id = clienteId.value
    }
    if (facturaId.value) {
        resultado.factura_id = facturaId.value
    }
    // La API filtra por fecha contable (día en Guatemala), no por instante.
    if (desde.value) {
        resultado.desde = desde.value
    }
    if (hasta.value) {
        resultado.hasta = hasta.value
    }
    return resultado
}

const lista = usePaginacionCursor(cursor => useNotasCredito().listar(filtros(), cursor))

const DERECHA = { class: { th: 'text-right', td: 'text-right' } }

const columnas: TableColumn<NotaCredito>[] = [
    { accessorKey: 'id', header: 'Nota' },
    { accessorKey: 'cliente_nombre', header: 'Cliente', meta: SOLO_ANCHO },
    { accessorKey: 'factura_id', header: 'Factura', meta: SOLO_ESCRITORIO },
    { accessorKey: 'motivo', header: 'Motivo', meta: SOLO_ESCRITORIO },
    { accessorKey: 'iva', header: 'IVA', meta: { class: { th: 'text-right hidden lg:table-cell', td: 'text-right hidden lg:table-cell' } } },
    { accessorKey: 'monto', header: 'Monto', meta: DERECHA },
]

const hayFiltros = computed(() => clienteId.value !== 0 || facturaTexto.value !== '' || desde.value !== '' || hasta.value !== '')

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (clienteId.value) {
        query.cliente = String(clienteId.value)
    }
    if (facturaId.value) {
        query.factura = String(facturaId.value)
    }
    if (desde.value) {
        query.desde = desde.value
    }
    if (hasta.value) {
        query.hasta = hasta.value
    }
    await router.replace({ query })
    await lista.recargar()
}

function limpiarFiltros() {
    clienteId.value = 0
    clienteElegido.value = null
    facturaTexto.value = ''
    desde.value = ''
    hasta.value = ''
}

function alElegirCliente(cliente: Cliente) {
    clienteElegido.value = cliente
}

watch([clienteId, facturaId, desde, hasta], aplicarFiltros)

onMounted(async () => {
    void lista.recargar()
    if (clienteId.value && puede('clientes.ver')) {
        const resultado = await useClientes().ver(clienteId.value)
        if (resultado.ok) {
            alElegirCliente(resultado.data)
        }
    }
})
</script>

<template>
    <PanelPagina
        id="notas-credito"
        titulo="Notas de crédito"
        icono="i-lucide-file-minus"
    >
        <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
                Rebajas sobre el saldo de una factura, con su asiento en el libro. Se emiten desde el detalle de la factura.
            </p>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto]">
                <ClienteSelector
                    v-model="clienteId"
                    :seleccionado="clienteElegido"
                    placeholder="Filtrar por cliente: nombre, NIT o teléfono"
                    aria-label="Filtrar por cliente"
                    class="w-full sm:col-span-2 lg:col-span-1"
                    @elegido="alElegirCliente"
                />
                <UInput
                    v-model="facturaTexto"
                    inputmode="numeric"
                    placeholder="Factura #"
                    icon="i-lucide-receipt"
                    aria-label="Filtrar por número de factura"
                    class="w-full"
                    data-prueba="filtro-factura"
                />
                <UInput
                    v-model="desde"
                    type="date"
                    :max="hasta || undefined"
                    aria-label="Desde (fecha contable)"
                    class="w-full lg:w-44"
                />
                <UInput
                    v-model="hasta"
                    type="date"
                    :min="desde || undefined"
                    aria-label="Hasta (fecha contable)"
                    class="w-full lg:w-44"
                />
            </div>

            <div
                v-if="hayFiltros"
                class="flex"
            >
                <UButton
                    label="Limpiar filtros"
                    icon="i-lucide-filter-x"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="limpiarFiltros"
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
                    sticky
                    class="flex-1"
                    :ui="{ td: 'py-3' }"
                    data-prueba="tabla-notas"
                >
                    <template #id-cell="{ row }">
                        <div class="flex min-w-32 flex-col">
                            <ULink
                                :to="`/notas-credito/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                Nota #{{ row.original.id }}
                            </ULink>
                            <span class="text-xs text-muted">{{ formatearFecha(row.original.fecha) }}</span>
                            <span class="truncate text-xs text-muted sm:hidden">{{ row.original.cliente_nombre }}</span>
                            <span class="text-xs text-muted lg:hidden">Factura #{{ row.original.factura_id }}</span>
                        </div>
                    </template>

                    <template #cliente_nombre-cell="{ row }">
                        <ULink
                            :to="enlace(`/clientes/${row.original.cliente_id}?tab=cuenta`)"
                            class="text-sm text-default hover:text-primary"
                        >
                            {{ row.original.cliente_nombre }}
                        </ULink>
                    </template>

                    <template #factura_id-cell="{ row }">
                        <ULink
                            :to="`/facturas/${row.original.factura_id}`"
                            class="text-sm text-default hover:text-primary"
                        >
                            Factura #{{ row.original.factura_id }}
                        </ULink>
                    </template>

                    <template #motivo-cell="{ row }">
                        <div class="flex max-w-80 flex-col">
                            <span class="truncate text-sm">{{ row.original.motivo }}</span>
                            <span
                                v-if="row.original.created_by_nombre"
                                class="text-xs text-muted"
                            >{{ row.original.created_by_nombre }}</span>
                        </div>
                    </template>

                    <template #iva-cell="{ row }">
                        <span class="tabular-nums text-muted">{{ formatearQuetzales(row.original.iva) }}</span>
                    </template>

                    <template #monto-cell="{ row }">
                        <span class="tabular-nums font-medium text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                    </template>

                    <template #empty>
                        <UEmpty
                            icon="i-lucide-search-x"
                            :title="hayFiltros ? 'Ninguna nota coincide' : 'Todavía no hay notas de crédito'"
                            :description="hayFiltros ? 'Prueba con otro cliente, factura o fechas.' : 'Se emiten desde el detalle de una factura con saldo.'"
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
