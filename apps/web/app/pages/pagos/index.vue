<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

definePageMeta({ permiso: 'pagos.ver' })

useHead({ title: 'Pagos · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede, enlace } = usePermisos()
const nombres = useNombresClientes()

const TODOS = 'todos'
const FECHA = /^\d{4}-\d{2}-\d{2}$/

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function idQuery(valor: unknown): number {
    const id = Number(textoQuery(valor))
    return Number.isInteger(id) && id > 0 ? id : 0
}

function enumQuery<T extends string>(valor: unknown, opciones: Record<T, unknown>): T | typeof TODOS {
    const texto = textoQuery(valor)
    return Object.keys(opciones).includes(texto) ? (texto as T) : TODOS
}

const clienteId = ref(idQuery(route.query.cliente))
const metodo = ref<MetodoPago | typeof TODOS>(enumQuery(route.query.metodo, ETIQUETAS_METODO))
const estado = ref<EstadoPago | typeof TODOS>(enumQuery(route.query.estado, ESTADOS_PAGO))
const cajaId = ref(textoQuery(route.query.caja) || TODOS)
const desde = ref(FECHA.test(textoQuery(route.query.desde)) ? textoQuery(route.query.desde) : '')
const hasta = ref(FECHA.test(textoQuery(route.query.hasta)) ? textoQuery(route.query.hasta) : '')
const clienteElegido = shallowRef<Cliente | null>(null)

const cajas = shallowRef<Caja[]>([])
const problemaCajas = ref<Problem | null>(null)

const itemsMetodo: SelectItem[] = [
    { label: 'Todos los métodos', value: TODOS },
    ...Object.entries(ETIQUETAS_METODO).map(([valor, etiqueta]) => ({ label: etiqueta, value: valor })),
]

const itemsEstado: SelectItem[] = [
    { label: 'Todos los estados', value: TODOS },
    ...Object.entries(ESTADOS_PAGO).map(([valor, datos]) => ({ label: datos.etiqueta, value: valor, icon: datos.icono })),
]

const itemsCaja = computed<SelectItem[]>(() => [
    { label: 'Todas las cajas', value: TODOS },
    ...cajas.value.map(c => ({ label: c.nombre, value: String(c.id) })),
])

const nombreCaja = (id: number | null) => (id === null ? null : (cajas.value.find(c => c.id === id)?.nombre ?? `Caja #${id}`))

function filtros(): FiltrosPagos {
    const resultado: FiltrosPagos = {}
    if (clienteId.value) {
        resultado.cliente_id = clienteId.value
    }
    if (metodo.value !== TODOS) {
        resultado.metodo = metodo.value
    }
    if (estado.value !== TODOS) {
        resultado.estado = estado.value
    }
    if (cajaId.value !== TODOS) {
        resultado.caja_id = Number(cajaId.value)
    }
    // Días de Guatemala → instantes UTC (la API filtra `created_at`).
    if (desde.value) {
        resultado.desde = inicioDiaGuatemala(desde.value)
    }
    if (hasta.value) {
        resultado.hasta = finDiaGuatemala(hasta.value)
    }
    return resultado
}

const lista = usePaginacionCursor(cursor => usePagos().listar(filtros(), cursor))

watch(lista.filas, filas => void nombres.cargar(filas.map(p => p.cliente_id)))

const columnas: TableColumn<Pago>[] = [
    { accessorKey: 'id', header: 'Pago' },
    { accessorKey: 'cliente_id', header: 'Cliente', meta: SOLO_ANCHO },
    { accessorKey: 'metodo', header: 'Método', meta: SOLO_ESCRITORIO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'estado', header: 'Estado' },
]

const hayFiltros = computed(() => clienteId.value !== 0 || metodo.value !== TODOS || estado.value !== TODOS
    || cajaId.value !== TODOS || desde.value !== '' || hasta.value !== '')

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (clienteId.value) {
        query.cliente = String(clienteId.value)
    }
    if (metodo.value !== TODOS) {
        query.metodo = metodo.value
    }
    if (estado.value !== TODOS) {
        query.estado = estado.value
    }
    if (cajaId.value !== TODOS) {
        query.caja = cajaId.value
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
    metodo.value = TODOS
    estado.value = TODOS
    cajaId.value = TODOS
    desde.value = ''
    hasta.value = ''
}

function alElegirCliente(cliente: Cliente) {
    clienteElegido.value = cliente
    nombres.recordar(cliente.id, cliente.nombre)
}

async function cargarCajas() {
    if (!puede('cajas.ver')) {
        return
    }
    const resultado = await useCajas().listar()
    cajas.value = resultado.ok ? resultado.data : []
    problemaCajas.value = resultado.ok ? null : resultado.problema
}

watch([clienteId, metodo, estado, cajaId, desde, hasta], aplicarFiltros)

onMounted(async () => {
    void lista.recargar()
    void cargarCajas()
    // Sin `clientes.ver` el filtro por cliente sigue por id, sin pedir su nombre (revisión de ACL).
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
        id="pagos"
        titulo="Pagos"
        icono="i-lucide-banknote"
    >
        <template #acciones>
            <UButton
                v-if="puede('pagos.registrar')"
                :to="clienteId ? `/cobro?cliente=${clienteId}` : '/cobro'"
                icon="i-lucide-hand-coins"
                label="Cobrar"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Cobrar"
            />
        </template>

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
                    v-model="metodo"
                    :items="itemsMetodo"
                    icon="i-lucide-wallet-cards"
                    aria-label="Filtrar por método"
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
                    v-if="puede('cajas.ver') && !problemaCajas"
                    v-model="cajaId"
                    :items="itemsCaja"
                    icon="i-lucide-wallet"
                    aria-label="Filtrar por caja"
                    class="w-full"
                />
                <UTooltip
                    v-else-if="problemaCajas"
                    :text="problemaCajas.detail ?? problemaCajas.title"
                >
                    <UButton
                        label="Cajas no disponibles"
                        icon="i-lucide-circle-alert"
                        color="error"
                        variant="soft"
                        class="w-full justify-center"
                        @click="cargarCajas"
                    />
                </UTooltip>
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
                <UFormField
                    label="Desde"
                    size="sm"
                >
                    <UInput
                        v-model="desde"
                        type="date"
                        :max="hasta || undefined"
                        class="w-full sm:w-44"
                    />
                </UFormField>
                <UFormField
                    label="Hasta"
                    size="sm"
                >
                    <UInput
                        v-model="hasta"
                        type="date"
                        :min="desde || undefined"
                        class="w-full sm:w-44"
                    />
                </UFormField>
                <p class="text-xs text-muted sm:pb-2">
                    Días en hora de Guatemala.
                </p>
                <UButton
                    v-if="hayFiltros"
                    label="Limpiar filtros"
                    icon="i-lucide-filter-x"
                    color="neutral"
                    variant="ghost"
                    class="self-start sm:ml-auto sm:self-auto"
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
                                :to="`/pagos/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                Pago #{{ row.original.id }}
                            </ULink>
                            <span class="text-xs text-muted">{{ formatearFechaHora(row.original.created_at) }}</span>
                            <span class="truncate text-xs text-muted sm:hidden">{{ nombres.nombre(row.original.cliente_id) }}</span>
                            <span class="text-xs text-muted lg:hidden">{{ ETIQUETAS_METODO[row.original.metodo] }}</span>
                        </div>
                    </template>

                    <template #cliente_id-cell="{ row }">
                        <ULink
                            :to="enlace(`/clientes/${row.original.cliente_id}?tab=cuenta`)"
                            class="text-sm text-default hover:text-primary"
                        >
                            {{ nombres.nombre(row.original.cliente_id) }}
                        </ULink>
                    </template>

                    <template #metodo-cell="{ row }">
                        <div class="flex flex-col">
                            <span class="text-sm">{{ ETIQUETAS_METODO[row.original.metodo] }}</span>
                            <span
                                v-if="esPagoHistorico(row.original)"
                                class="text-xs text-dimmed"
                                data-prueba="pago-historico"
                            >Importado (histórico)</span>
                            <span
                                v-if="row.original.referencia || row.original.caja_id"
                                class="font-mono text-xs text-muted"
                            >{{ row.original.referencia ?? nombreCaja(row.original.caja_id) }}</span>
                        </div>
                    </template>

                    <template #monto-cell="{ row }">
                        <span
                            class="tabular-nums font-medium"
                            :class="row.original.estado === 'anulado' ? 'text-muted line-through' : 'text-highlighted'"
                        >{{ formatearQuetzales(row.original.monto) }}</span>
                    </template>

                    <template #estado-cell="{ row }">
                        <EstadoPagoBadge
                            :estado="row.original.estado"
                            size="sm"
                        />
                    </template>

                    <template #empty>
                        <UEmpty
                            icon="i-lucide-search-x"
                            :title="hayFiltros ? 'Ningún pago coincide' : 'Todavía no hay pagos'"
                            :description="hayFiltros ? 'Prueba con otro cliente, método, estado o fechas.' : undefined"
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
