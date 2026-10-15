<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

definePageMeta({ permiso: 'servicios.ver' })

useHead({ title: 'Servicios · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const serviciosApi = useServicios()

/** Valor de los `USelect` para "sin filtro" (Reka UI no admite `''` como valor de un ítem). */
const TODOS = 'todos'

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function estadoQuery(valor: unknown): EstadoServicio | typeof TODOS {
    const texto = textoQuery(valor)
    return esEstadoServicio(texto) ? texto : TODOS
}

function idQuery(valor: unknown): number {
    const id = Number(textoQuery(valor))
    return Number.isInteger(id) && id > 0 ? id : 0
}

const busqueda = ref(textoQuery(route.query.q))
const estado = ref<EstadoServicio | typeof TODOS>(estadoQuery(route.query.estado))
const routerId = ref(textoQuery(route.query.router) || TODOS)
const planId = ref(textoQuery(route.query.plan) || TODOS)
const clienteId = ref(idQuery(route.query.cliente))
const zonaId = ref(textoQuery(route.query.zona) || TODOS)
const conDeuda = ref(['1', 'true'].includes(textoQuery(route.query.deuda)))
const clienteElegido = shallowRef<Cliente | null>(null)

const verRouters = computed(() => puede('routers.ver'))
const verPlanes = computed(() => puede('planes.ver'))
const verZonas = computed(() => puede('zonas.ver'))

const routers = shallowRef<RouterNas[]>([])
const planes = shallowRef<Plan[]>([])
const zonas = shallowRef<Zona[]>([])
/** Nombres de los clientes de la página. `Servicio` no trae `cliente_nombre` (pedido a A1). */
const clientes = ref(new Map<number, Cliente>())

const nombresRouter = computed(() => new Map(routers.value.map(r => [r.id, r.nombre])))
const nombresPlan = computed(() => new Map(planes.value.map(p => [p.id, p])))

const itemsEstado: SelectItem[] = [
    { label: 'Todos los estados', value: TODOS },
    ...ESTADOS_FILTRO.map(e => ({ label: e.etiqueta, value: e.estado, icon: ESTADOS_SERVICIO[e.estado].icono })),
]

const itemsRouter = computed<SelectItem[]>(() => [
    { label: 'Todos los routers', value: TODOS },
    ...routers.value.map(r => ({ label: r.nombre, value: String(r.id) })),
])

const itemsPlan = computed<SelectItem[]>(() => [
    { label: 'Todos los planes', value: TODOS },
    ...planes.value.map(p => ({ label: p.nombre, value: String(p.id) })),
])

const itemsZona = computed<SelectItem[]>(() => [
    { label: 'Todas las zonas', value: TODOS },
    ...zonas.value.map(z => ({ label: z.nombre, value: String(z.id) })),
])

function filtros(): FiltrosServicios {
    const resultado: FiltrosServicios = { limit: LIMITE_SERVICIOS }
    const q = busqueda.value.trim()
    if (q) {
        resultado.q = q
    }
    if (estado.value !== TODOS) {
        resultado.estado = estado.value
    }
    if (routerId.value !== TODOS) {
        resultado.router_id = Number(routerId.value)
    }
    if (planId.value !== TODOS) {
        resultado.plan_id = Number(planId.value)
    }
    if (clienteId.value) {
        resultado.cliente_id = clienteId.value
    }
    if (zonaId.value !== TODOS) {
        resultado.zona_id = Number(zonaId.value)
    }
    // `false` en la API es "sin deuda"; apagado no se manda.
    if (conDeuda.value) {
        resultado.con_deuda_vencida = true
    }
    return resultado
}

async function cargarClientes(filas: Servicio[]) {
    const faltan = [...new Set(filas.map(s => s.cliente_id))].filter(id => !clientes.value.has(id))
    const resultados = await Promise.all(faltan.map(id => useClientes().ver(id)))
    const mapa = new Map(clientes.value)
    for (const resultado of resultados) {
        if (resultado.ok) {
            mapa.set(resultado.data.id, resultado.data)
        }
    }
    clientes.value = mapa
}

const lista = usePaginacionCursor(async (cursor) => {
    const resultado = await serviciosApi.listar(filtros(), cursor)
    if (resultado.ok) {
        void cargarClientes(resultado.data.data)
    }
    return resultado
})

const columnas = computed<TableColumn<Servicio>[]>(() => {
    const base: TableColumn<Servicio>[] = [
        { accessorKey: 'user_ppp', header: 'Servicio' },
        // El plan va dentro de la celda "Servicio" para que el estado quepa a 1280 px.
        { accessorKey: 'cliente_id', header: 'Cliente', meta: SOLO_ANCHO },
    ]
    if (verRouters.value) {
        base.push({ accessorKey: 'router_id', header: 'Router', meta: SOLO_ESCRITORIO })
    }
    base.push(
        { accessorKey: 'ipv4', header: 'Direcciones', meta: SOLO_ANCHO },
        { accessorKey: 'estado', header: 'Estado' },
    )
    return base
})

const hayFiltros = computed(() => busqueda.value.trim() !== ''
    || estado.value !== TODOS
    || routerId.value !== TODOS
    || planId.value !== TODOS
    || clienteId.value !== 0
    || zonaId.value !== TODOS
    || conDeuda.value)

/** Accesos rápidos: "Todos", "Cortados" (suspendido), "Limitados" y "Con deuda" vencida. */
interface AccesoServicios {
    etiqueta: string
    estado: EstadoServicio | typeof TODOS
    deuda: boolean
    color: 'neutral' | 'error' | 'warning'
}

const accesos: AccesoServicios[] = [
    { etiqueta: 'Todos', estado: TODOS, deuda: false, color: 'neutral' },
    { etiqueta: 'Cortados', estado: 'suspendido', deuda: false, color: 'error' },
    { etiqueta: 'Limitados', estado: 'limitado', deuda: false, color: 'warning' },
    { etiqueta: 'Con deuda', estado: TODOS, deuda: true, color: 'warning' },
]

function accesoActivo(acceso: AccesoServicios): boolean {
    return estado.value === acceso.estado && conDeuda.value === acceso.deuda
}

function elegirAcceso(acceso: AccesoServicios) {
    estado.value = acceso.estado
    conDeuda.value = acceso.deuda
}

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    const q = busqueda.value.trim()
    if (q) {
        query.q = q
    }
    if (estado.value !== TODOS) {
        query.estado = estado.value
    }
    if (routerId.value !== TODOS) {
        query.router = routerId.value
    }
    if (planId.value !== TODOS) {
        query.plan = planId.value
    }
    if (clienteId.value) {
        query.cliente = String(clienteId.value)
    }
    if (zonaId.value !== TODOS) {
        query.zona = zonaId.value
    }
    if (conDeuda.value) {
        query.deuda = '1'
    }
    await router.replace({ query })
    await lista.recargar()
}

function limpiarFiltros() {
    busqueda.value = ''
    estado.value = TODOS
    routerId.value = TODOS
    planId.value = TODOS
    clienteId.value = 0
    clienteElegido.value = null
    zonaId.value = TODOS
    conDeuda.value = false
}

let temporizador: ReturnType<typeof setTimeout> | undefined
watch(busqueda, () => {
    clearTimeout(temporizador)
    temporizador = setTimeout(aplicarFiltros, 300)
})
watch([estado, routerId, planId, clienteId, zonaId, conDeuda], aplicarFiltros)
onBeforeUnmount(() => clearTimeout(temporizador))

function nombreCliente(servicio: Servicio): string {
    return clientes.value.get(servicio.cliente_id)?.nombre ?? `Cliente #${servicio.cliente_id}`
}

function nombrePlan(servicio: Servicio): string {
    return nombresPlan.value.get(servicio.plan_id)?.nombre ?? `Plan #${servicio.plan_id}`
}

onMounted(async () => {
    void lista.recargar()
    const [resultadoRouters, resultadoPlanes, resultadoZonas, resultadoCliente] = await Promise.all([
        verRouters.value ? useRouters().listar() : null,
        verPlanes.value ? usePlanes().listar() : null,
        verZonas.value ? useZonas().listar() : null,
        clienteId.value ? useClientes().ver(clienteId.value) : null,
    ])
    if (resultadoZonas?.ok) {
        zonas.value = resultadoZonas.data
    }
    if (resultadoRouters?.ok) {
        routers.value = resultadoRouters.data.data
    }
    if (resultadoPlanes?.ok) {
        planes.value = resultadoPlanes.data.data
    }
    if (resultadoCliente?.ok) {
        clienteElegido.value = resultadoCliente.data
    }
})
</script>

<template>
    <PanelPagina
        id="servicios"
        titulo="Servicios"
        icono="i-lucide-wifi"
    >
        <template #acciones>
            <UButton
                v-if="puede('servicios.crear')"
                to="/servicios/nuevo"
                icon="i-lucide-plus"
                label="Nuevo servicio"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Nuevo servicio"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div
                class="flex flex-wrap gap-2"
                role="group"
                aria-label="Accesos rápidos por estado"
            >
                <UButton
                    v-for="acceso in accesos"
                    :key="acceso.etiqueta"
                    :label="acceso.etiqueta"
                    :color="acceso.color"
                    :variant="accesoActivo(acceso) ? 'solid' : 'outline'"
                    :aria-pressed="accesoActivo(acceso)"
                    size="sm"
                    class="rounded-full"
                    @click="elegirAcceso(acceso)"
                />
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Usuario PPP, IP o nombre del cliente"
                    aria-label="Buscar servicios"
                    class="w-full sm:col-span-2 lg:col-span-1"
                    :loading="lista.cargando.value"
                >
                    <template
                        v-if="busqueda"
                        #trailing
                    >
                        <UButton
                            icon="i-lucide-x"
                            color="neutral"
                            variant="link"
                            size="sm"
                            aria-label="Borrar búsqueda"
                            @click="busqueda = ''"
                        />
                    </template>
                </UInput>

                <USelect
                    v-model="estado"
                    :items="itemsEstado"
                    icon="i-lucide-activity"
                    aria-label="Filtrar por estado"
                    class="w-full"
                />

                <USelect
                    v-if="verRouters"
                    v-model="routerId"
                    :items="itemsRouter"
                    icon="i-lucide-router"
                    aria-label="Filtrar por router"
                    class="w-full"
                />

                <USelect
                    v-if="verPlanes"
                    v-model="planId"
                    :items="itemsPlan"
                    icon="i-lucide-gauge"
                    aria-label="Filtrar por plan"
                    class="w-full"
                />
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <ClienteSelector
                    v-model="clienteId"
                    :seleccionado="clienteElegido"
                    placeholder="Filtrar por cliente: nombre, NIT o teléfono"
                    aria-label="Filtrar por cliente"
                    class="w-full sm:max-w-md"
                    @elegido="clienteElegido = $event"
                />
                <USelect
                    v-if="verZonas"
                    v-model="zonaId"
                    :items="itemsZona"
                    icon="i-lucide-map-pin"
                    aria-label="Filtrar por zona"
                    class="w-full sm:w-52"
                />
                <USwitch
                    v-model="conDeuda"
                    label="Con deuda vencida"
                    class="shrink-0"
                />
                <UButton
                    v-if="hayFiltros"
                    label="Limpiar filtros"
                    icon="i-lucide-filter-x"
                    color="neutral"
                    variant="ghost"
                    class="self-start sm:self-auto"
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
                    :ui="{
                        td: 'py-3',
                    }"
                >
                    <template #user_ppp-cell="{ row }">
                        <div class="flex min-w-36 flex-col">
                            <ULink
                                :to="`/servicios/${row.original.id}`"
                                class="font-mono text-sm font-medium text-highlighted hover:text-primary"
                            >
                                {{ row.original.user_ppp }}
                            </ULink>
                            <span class="text-xs text-muted">
                                #{{ row.original.id }} · {{ nombrePlan(row.original) }}
                                <template v-if="row.original.costo_override"> · {{ formatearQuetzales(row.original.costo_override) }} precio especial</template>
                            </span>
                            <span class="truncate text-xs text-muted sm:hidden">{{ nombreCliente(row.original) }}</span>
                            <span
                                v-if="row.original.ipv4"
                                class="font-mono text-xs text-muted sm:hidden"
                            >{{ row.original.ipv4 }}</span>
                        </div>
                    </template>

                    <template #cliente_id-cell="{ row }">
                        <ULink
                            :to="`/clientes/${row.original.cliente_id}`"
                            class="text-sm text-default hover:text-primary"
                        >
                            {{ nombreCliente(row.original) }}
                        </ULink>
                    </template>

                    <template #router_id-cell="{ row }">
                        <span class="text-sm">{{ nombresRouter.get(row.original.router_id) ?? `Router #${row.original.router_id}` }}</span>
                    </template>

                    <template #ipv4-cell="{ row }">
                        <div class="flex flex-col font-mono text-xs">
                            <span class="text-sm">{{ row.original.ipv4 ?? 'Sin IPv4' }}</span>
                            <span
                                v-if="row.original.prefijo_delegado_v6"
                                class="text-muted"
                            >{{ row.original.prefijo_delegado_v6 }}</span>
                        </div>
                    </template>

                    <template #estado-cell="{ row }">
                        <div class="flex flex-wrap items-center gap-1">
                            <EstadoServicioBadge
                                :estado="row.original.estado"
                                size="sm"
                            />
                            <UBadge
                                v-if="row.original.promesa_activa"
                                label="Promesa"
                                icon="i-lucide-calendar-clock"
                                color="info"
                                variant="outline"
                                size="sm"
                            />
                        </div>
                    </template>

                    <template #empty>
                        <UEmpty
                            icon="i-lucide-search-x"
                            :title="hayFiltros ? 'Ningún servicio coincide' : 'Todavía no hay servicios'"
                            :description="hayFiltros ? 'Prueba con otro estado, router, plan, zona o búsqueda.' : undefined"
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
