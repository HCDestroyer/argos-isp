<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Pagos (sistema visual nuevo): tarjeta con el buscador por cliente, pestañas por estado y «Más
 * filtros» (método, caja y fechas); cada fila abre el pago y tiene su menú «⋯» (el mismo del clic
 * derecho). Acción principal: Cobrar.
 */

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
    { id: 'acciones', header: '', meta: { class: { td: 'w-0 text-right' } } },
]

const panelAbierto = ref(metodo.value !== TODOS || cajaId.value !== TODOS || desde.value !== '' || hasta.value !== '')
const masFiltros = computed(() => [metodo.value !== TODOS, cajaId.value !== TODOS, desde.value !== '', hasta.value !== ''].filter(Boolean).length)
const pestanasEstado = computed(() => [
    { valor: TODOS, etiqueta: 'Todos' },
    ...Object.entries(ESTADOS_PAGO).map(([valor, datos]) => ({ valor, etiqueta: datos.etiqueta })),
])

const menuFila = useMenuFila<Pago>(pago => [
    { etiqueta: 'Ver pago', icono: ICONOS.ver, to: `/pagos/${pago.id}` },
    ...(enlace(`/clientes/${pago.cliente_id}`) ? [{ etiqueta: 'Ver cliente', icono: 'i-lucide-user', to: enlace(`/clientes/${pago.cliente_id}?tab=cuenta`), soloMenu: true, grupo: 'Cliente' }] : []),
    ...(puede('pagos.registrar') ? [{ etiqueta: 'Cobrar otra vez', icono: 'i-lucide-banknote', to: `/cobro?cliente=${pago.cliente_id}`, soloMenu: true, grupo: 'Cliente' }] : []),
])

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
        icono="i-lucide-hand-coins"
    >
        <template #acciones>
            <UButton
                v-if="puede('pagos.registrar')"
                :to="clienteId ? `/cobro?cliente=${clienteId}` : '/cobro'"
                icon="i-lucide-banknote"
                label="Cobrar"
                color="success"
                size="lg"
                class="rounded-full px-5"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Cobrar"
            />
        </template>

        <div class="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
            <div class="flex flex-col gap-3 p-3 sm:p-4">
                <div class="flex flex-wrap items-center gap-2">
                    <ClienteSelector
                        v-model="clienteId"
                        :seleccionado="clienteElegido"
                        placeholder="Buscar por cliente: nombre, NIT o teléfono"
                        aria-label="Filtrar por cliente"
                        class="w-full sm:w-80"
                        :ui="{ base: 'rounded-full' }"
                        @elegido="alElegirCliente"
                    />
                    <div
                        class="flex flex-wrap gap-1.5"
                        role="group"
                        aria-label="Estado del pago"
                    >
                        <UButton
                            v-for="p in pestanasEstado"
                            :key="p.valor"
                            :label="p.etiqueta"
                            :color="estado === p.valor ? 'primary' : 'neutral'"
                            :variant="estado === p.valor ? 'solid' : 'outline'"
                            :aria-pressed="estado === p.valor"
                            size="sm"
                            class="rounded-full"
                            @click="estado = p.valor as typeof estado"
                        />
                        <UButton
                            icon="i-lucide-filter"
                            label="Más filtros"
                            color="neutral"
                            :variant="panelAbierto ? 'subtle' : 'outline'"
                            :aria-expanded="panelAbierto"
                            aria-controls="filtros-pagos"
                            size="sm"
                            class="rounded-full"
                            @click="panelAbierto = !panelAbierto"
                        >
                            <template
                                v-if="masFiltros"
                                #trailing
                            >
                                <UBadge
                                    :label="String(masFiltros)"
                                    size="sm"
                                    variant="solid"
                                />
                            </template>
                        </UButton>
                        <UButton
                            v-if="hayFiltros"
                            label="Limpiar"
                            icon="i-lucide-filter-x"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            @click="limpiarFiltros"
                        />
                    </div>
                </div>
                <div
                    v-show="panelAbierto"
                    id="filtros-pagos"
                    class="grid gap-3 rounded-xl bg-(--ax-panel) p-3 sm:grid-cols-2 lg:grid-cols-4"
                    role="group"
                    aria-label="Filtros de pagos"
                >
                    <UFormField label="Método">
                        <USelect
                            v-model="metodo"
                            :items="itemsMetodo"
                            icon="i-lucide-wallet-cards"
                            aria-label="Filtrar por método"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="puede('cajas.ver')"
                        label="Caja"
                    >
                        <USelect
                            v-if="!problemaCajas"
                            v-model="cajaId"
                            :items="itemsCaja"
                            icon="i-lucide-wallet"
                            aria-label="Filtrar por caja"
                            class="w-full"
                        />
                        <UButton
                            v-else
                            label="Cajas no disponibles · Reintentar"
                            icon="i-lucide-circle-alert"
                            color="error"
                            variant="soft"
                            class="w-full justify-center"
                            :title="problemaCajas.detail ?? problemaCajas.title"
                            @click="cargarCajas"
                        />
                    </UFormField>
                    <UFormField
                        label="Desde"
                        help="Días en hora de Guatemala"
                    >
                        <UInput
                            v-model="desde"
                            type="date"
                            :max="hasta || undefined"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField label="Hasta">
                        <UInput
                            v-model="hasta"
                            type="date"
                            :min="desde || undefined"
                            class="w-full"
                        />
                    </UFormField>
                </div>
            </div>

            <div
                v-if="lista.problema.value"
                class="p-3 sm:p-4"
            >
                <ProblemaAlerta
                    :problema="lista.problema.value"
                    :reintentar="lista.recargar"
                    :reintentando="lista.cargando.value"
                />
            </div>

            <template v-else>
                <UContextMenu :items="menuFila.items.value">
                    <UTable
                        :data="lista.filas.value"
                        :columns="columnas"
                        :loading="lista.cargando.value"
                        sticky
                        class="min-h-0 flex-1"
                        :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                        data-menu-contextual
                        @contextmenu="menuFila.alContextmenu"
                    >
                        <template #id-cell="{ row }">
                            <div class="flex min-w-32 items-center gap-3">
                                <span class="pastilla-icono size-9 shrink-0 bg-primary/10 text-primary">
                                    <UIcon
                                        :name="row.original.metodo === 'caja' ? 'i-lucide-banknote' : 'i-lucide-landmark'"
                                        class="size-4"
                                    />
                                </span>
                                <div class="flex min-w-0 flex-col">
                                    <ULink
                                        :to="`/pagos/${row.original.id}`"
                                        class="font-semibold text-highlighted hover:text-primary"
                                    >
                                        Pago #{{ row.original.id }}
                                    </ULink>
                                    <span class="text-xs text-muted">{{ formatearFechaHora(row.original.created_at) }}</span>
                                    <span class="truncate text-xs text-muted sm:hidden">{{ nombres.nombre(row.original.cliente_id) }}</span>
                                    <span class="text-xs text-muted lg:hidden">{{ ETIQUETAS_METODO[row.original.metodo] }}</span>
                                </div>
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
                                class="font-bold tabular-nums"
                                :class="row.original.estado === 'anulado' ? 'text-muted line-through' : 'text-highlighted'"
                            >{{ formatearQuetzales(row.original.monto) }}</span>
                        </template>

                        <template #estado-cell="{ row }">
                            <EstadoPagoBadge
                                :estado="row.original.estado"
                                size="sm"
                            />
                        </template>

                        <template #acciones-cell="{ row }">
                            <div class="flex items-center justify-end gap-0.5">
                                <AccionesFila
                                    :acciones="menuFila.accionesDe(row.original)"
                                    :nombre="`pago ${row.original.id}`"
                                />
                                <UDropdownMenu
                                    :items="menuFila.itemsDe(row.original)"
                                    :content="{ align: 'end' }"
                                >
                                    <UButton
                                        icon="i-lucide-ellipsis"
                                        color="neutral"
                                        variant="ghost"
                                        size="sm"
                                        :aria-label="`Más acciones del pago ${row.original.id}`"
                                    />
                                </UDropdownMenu>
                            </div>
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
                </UContextMenu>

                <PaginacionCursor
                    :pagina="lista.pagina.value"
                    :hay-anterior="lista.hayAnterior.value"
                    :hay-siguiente="lista.haySiguiente.value"
                    :cargando="lista.cargando.value"
                    :filas="lista.filas.value.length"
                    class="border-t border-(--ax-borde) px-3 py-2"
                    @anterior="lista.anterior"
                    @siguiente="lista.siguiente"
                />
            </template>
        </div>
    </PanelPagina>
</template>
