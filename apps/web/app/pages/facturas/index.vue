<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

const { enlace, puede } = usePermisos()

definePageMeta({ permiso: 'facturas.ver' })

useHead({ title: 'Facturas · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const nombres = useNombresClientes()

/** Valor de los `USelect` para "sin filtro" (Reka UI no admite `''`). */
const TODOS = 'todos'

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function idQuery(valor: unknown): number {
    const id = Number(textoQuery(valor))
    return Number.isInteger(id) && id > 0 ? id : 0
}

function estadoQuery(valor: unknown): EstadoFactura | typeof TODOS {
    const texto = textoQuery(valor)
    return texto in ESTADOS_FACTURA ? (texto as EstadoFactura) : TODOS
}

const estado = ref<EstadoFactura | typeof TODOS>(estadoQuery(route.query.estado))
const clienteId = ref(idQuery(route.query.cliente))
const servicioId = ref(textoQuery(route.query.servicio) || TODOS)
const periodo = ref(/^\d{4}-\d{2}-01$/.test(textoQuery(route.query.periodo)) ? textoQuery(route.query.periodo) : TODOS)
const clienteElegido = shallowRef<Cliente | null>(null)
const serviciosCliente = shallowRef<Servicio[]>([])

const itemsEstado: SelectItem[] = [
    { label: 'Todos los estados', value: TODOS },
    ...Object.entries(ESTADOS_FACTURA).map(([valor, datos]) => ({ label: datos.etiqueta, value: valor })),
]

const itemsPeriodo = computed<SelectItem[]>(() => {
    const periodos = periodosRecientes(hoyGuatemala(), 12)
    if (periodo.value !== TODOS && !periodos.includes(periodo.value)) {
        periodos.push(periodo.value)
    }
    return [
        { label: 'Todos los periodos', value: TODOS },
        ...periodos.map(p => ({ label: etiquetaPeriodo(p), value: p })),
    ]
})

const itemsServicio = computed<SelectItem[]>(() => {
    const items: SelectItem[] = [{ label: 'Todos los servicios', value: TODOS }]
    items.push(...serviciosCliente.value.map(s => ({ label: etiquetaServicio(s), value: String(s.id) })))
    if (servicioId.value !== TODOS && !serviciosCliente.value.some(s => String(s.id) === servicioId.value)) {
        items.push({ label: `Servicio #${servicioId.value}`, value: servicioId.value })
    }
    return items
})

function filtros(): FiltrosFacturas {
    const resultado: FiltrosFacturas = {}
    if (estado.value !== TODOS) {
        resultado.estado = estado.value
    }
    if (clienteId.value) {
        resultado.cliente_id = clienteId.value
    }
    if (servicioId.value !== TODOS) {
        resultado.servicio_id = Number(servicioId.value)
    }
    if (periodo.value !== TODOS) {
        resultado.periodo = periodo.value
    }
    return resultado
}

const lista = usePaginacionCursor(cursor => useFacturas().listar(filtros(), cursor))

watch(lista.filas, filas => void nombres.cargar(filas.map(f => f.cliente_id)))

const columnas: TableColumn<Factura>[] = [
    { accessorKey: 'id', header: 'Factura' },
    { accessorKey: 'cliente_id', header: 'Cliente', meta: SOLO_ANCHO },
    { accessorKey: 'vence_en', header: 'Vence', meta: SOLO_ESCRITORIO },
    { accessorKey: 'total', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { id: 'pendiente', header: 'Pendiente', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'estado', header: 'Estado' },
]

const hayFiltros = computed(() => estado.value !== TODOS || clienteId.value !== 0 || servicioId.value !== TODOS || periodo.value !== TODOS)

async function cargarServiciosCliente() {
    serviciosCliente.value = []
    if (!clienteId.value || !puede('servicios.ver')) {
        return
    }
    const resultado = await useServicios().listar({ cliente_id: clienteId.value })
    serviciosCliente.value = resultado.ok ? resultado.data.data : []
}

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (estado.value !== TODOS) {
        query.estado = estado.value
    }
    if (clienteId.value) {
        query.cliente = String(clienteId.value)
    }
    if (servicioId.value !== TODOS) {
        query.servicio = servicioId.value
    }
    if (periodo.value !== TODOS) {
        query.periodo = periodo.value
    }
    await router.replace({ query })
    await lista.recargar()
}

function limpiarFiltros() {
    estado.value = TODOS
    clienteId.value = 0
    clienteElegido.value = null
    servicioId.value = TODOS
    periodo.value = TODOS
}

function alElegirCliente(cliente: Cliente) {
    clienteElegido.value = cliente
    nombres.recordar(cliente.id, cliente.nombre)
}

watch(clienteId, (nuevo, anterior) => {
    // Otro cliente: el servicio elegido ya no es suyo.
    if (anterior && nuevo !== anterior) {
        servicioId.value = TODOS
    }
    void cargarServiciosCliente()
})
watch([estado, clienteId, servicioId, periodo], aplicarFiltros)

onMounted(async () => {
    void lista.recargar()
    if (clienteId.value) {
        void cargarServiciosCliente()
        // Sin `clientes.ver` el filtro por cliente sigue por id, sin pedir su nombre (revisión de ACL).
        const resultado = puede('clientes.ver') ? await useClientes().ver(clienteId.value) : null
        if (resultado?.ok) {
            alElegirCliente(resultado.data)
        }
    }
})
</script>

<template>
    <PanelPagina
        id="facturas"
        titulo="Facturas"
        icono="i-lucide-receipt-text"
    >
        <div class="flex flex-col gap-4">
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
                <ClienteSelector
                    v-model="clienteId"
                    :seleccionado="clienteElegido"
                    placeholder="Filtrar por cliente: nombre, NIT o teléfono"
                    aria-label="Filtrar por cliente"
                    class="w-full sm:col-span-2 lg:col-span-1"
                    @elegido="alElegirCliente"
                />
                <USelect
                    v-model="servicioId"
                    :items="itemsServicio"
                    icon="i-lucide-wifi"
                    aria-label="Filtrar por servicio"
                    :disabled="!clienteId && servicioId === TODOS"
                    class="w-full"
                />
                <USelect
                    v-model="estado"
                    :items="itemsEstado"
                    icon="i-lucide-activity"
                    aria-label="Filtrar por estado"
                    class="w-full"
                />
                <USelect
                    v-model="periodo"
                    :items="itemsPeriodo"
                    icon="i-lucide-calendar"
                    aria-label="Filtrar por periodo"
                    class="w-full"
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
                >
                    <template #id-cell="{ row }">
                        <div class="flex min-w-32 flex-col">
                            <ULink
                                :to="`/facturas/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                Factura #{{ row.original.id }}
                            </ULink>
                            <span class="text-xs text-muted">
                                {{ etiquetaPeriodo(row.original.periodo) }}<template v-if="row.original.servicio_id"> · servicio {{ row.original.servicio_id }}</template>
                            </span>
                            <span class="truncate text-xs text-muted sm:hidden">{{ nombres.nombre(row.original.cliente_id) }}</span>
                            <UBadge
                                v-if="tipoFacturaVisual(row.original.tipo)"
                                :label="tipoFacturaVisual(row.original.tipo)?.etiqueta"
                                :icon="tipoFacturaVisual(row.original.tipo)?.icono"
                                :color="tipoFacturaVisual(row.original.tipo)?.color"
                                variant="outline"
                                size="sm"
                                class="mt-1 self-start"
                                :data-tipo="row.original.tipo"
                            />
                        </div>
                    </template>

                    <template #cliente_id-cell="{ row }">
                        <ULink
                            :to="enlace(`/clientes/${row.original.cliente_id}`)"
                            class="text-sm text-default hover:text-primary"
                        >
                            {{ nombres.nombre(row.original.cliente_id) }}
                        </ULink>
                    </template>

                    <template #vence_en-cell="{ row }">
                        <span class="whitespace-nowrap text-sm">{{ formatearFecha(row.original.vence_en) }}</span>
                    </template>

                    <template #total-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.total) }}</span>
                    </template>

                    <template #pendiente-cell="{ row }">
                        <span class="tabular-nums font-medium text-highlighted">{{ row.original.estado === 'anulada' ? '—' : formatearQuetzales(saldoFactura(row.original)) }}</span>
                    </template>

                    <template #estado-cell="{ row }">
                        <EstadoFacturaBadge
                            :estado="row.original.estado"
                            size="sm"
                        />
                    </template>

                    <template #empty>
                        <UEmpty
                            icon="i-lucide-search-x"
                            :title="hayFiltros ? 'Ninguna factura coincide' : 'Todavía no hay facturas'"
                            :description="hayFiltros ? 'Prueba con otro estado, cliente o periodo.' : undefined"
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
