<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

definePageMeta({ permiso: 'clientes.ver' })

useHead({ title: 'Clientes · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const clientesApi = useClientes()

/** Valor de los `USelect` para "sin filtro" (Reka UI no admite `''` como valor de un ítem). */
const TODOS = 'todos'

const filtros = reactive<EstadoFiltrosClientes>(leerFiltrosClientes(route.query))
/** Panel de filtros en teléfono (en tableta y escritorio siempre está a la vista). */
const panelAbierto = ref(false)

const zonas = shallowRef<Zona[]>([])
const routers = shallowRef<RouterNas[]>([])
const planes = shallowRef<Plan[]>([])

const verZonas = computed(() => puede('zonas.ver'))
const verRouters = computed(() => puede('routers.ver'))
const verPlanes = computed(() => puede('planes.ver'))

const nombresZona = computed(() => new Map(zonas.value.map(z => [z.id, z.nombre])))

const activos = computed(() => contarFiltrosClientes(filtros))
const hayFiltros = computed(() => hayFiltrosClientes(filtros))
const acceso = computed(() => accesoRapidoClientes(filtros))

const accesos: { acceso: AccesoRapidoClientes, etiqueta: string, icono: string, color: 'neutral' | 'error' | 'warning' }[] = [
    { acceso: 'todos', etiqueta: 'Todos', icono: 'i-lucide-users', color: 'neutral' },
    { acceso: 'cortados', etiqueta: 'Cortados', icono: 'i-lucide-circle-x', color: 'error' },
    { acceso: 'deuda', etiqueta: 'Con deuda', icono: 'i-lucide-receipt', color: 'warning' },
]

function opcionesId(etiqueta: string, filas: { id: number, nombre: string }[]): SelectItem[] {
    return [{ label: etiqueta, value: TODOS }, ...filas.map(f => ({ label: f.nombre, value: String(f.id) }))]
}

const itemsEstado: SelectItem[] = [
    { label: 'Todos los estados', value: TODOS },
    ...ESTADOS_FILTRO.map(e => ({ label: e.etiqueta, value: e.estado, icon: ESTADOS_SERVICIO[e.estado].icono })),
]
const itemsZona = computed(() => opcionesId('Todas las zonas', zonas.value))
const itemsRouter = computed(() => opcionesId('Todos los routers', routers.value))
const itemsPlan = computed(() => opcionesId('Todos los planes', planes.value))

/** Puente entre un `USelect` (texto) y un id numérico del filtro (`null` = todos). */
function selectId(clave: 'zonaId' | 'routerId' | 'planId') {
    return computed({
        get: () => (filtros[clave] === null ? TODOS : String(filtros[clave])),
        set: (valor: string) => {
            filtros[clave] = valor === TODOS ? null : Number(valor)
        },
    })
}

const zona = selectId('zonaId')
const routerElegido = selectId('routerId')
const plan = selectId('planId')
const estado = computed({
    get: () => filtros.estado ?? TODOS,
    set: (valor: string) => {
        filtros.estado = esEstadoServicio(valor) ? valor : null
    },
})

const lista = usePaginacionCursor(cursor => clientesApi.listar(filtrosApiClientes(filtros), cursor))

const columnas = computed<TableColumn<Cliente>[]>(() => {
    const base: TableColumn<Cliente>[] = [
        { accessorKey: 'nombre', header: 'Cliente' },
        { accessorKey: 'nit_cui', header: 'NIT / CUI', meta: SOLO_ANCHO },
        { accessorKey: 'telefono', header: 'Teléfono' },
    ]
    if (verZonas.value) {
        base.push({ accessorKey: 'zona_id', header: 'Zona', meta: SOLO_ANCHO })
    }
    base.push({ accessorKey: 'created_at', header: 'Alta', meta: SOLO_ESCRITORIO })
    return base
})

async function aplicarFiltros() {
    await router.replace({ query: queryFiltrosClientes(filtros) })
    await lista.recargar()
}

function limpiarFiltros() {
    Object.assign(filtros, FILTROS_CLIENTES_VACIOS)
}

function elegirAcceso(elegido: AccesoRapidoClientes) {
    Object.assign(filtros, aplicarAccesoRapidoClientes(filtros, elegido))
}

let temporizador: ReturnType<typeof setTimeout> | undefined
watch(() => filtros.q, () => {
    clearTimeout(temporizador)
    temporizador = setTimeout(aplicarFiltros, 300)
})
watch(
    () => [filtros.zonaId, filtros.estado, filtros.routerId, filtros.planId, filtros.conDeuda, filtros.conPromesa],
    () => {
        clearTimeout(temporizador)
        void aplicarFiltros()
    },
)
onBeforeUnmount(() => clearTimeout(temporizador))

onMounted(async () => {
    void lista.recargar()
    const [resultadoZonas, resultadoRouters, resultadoPlanes] = await Promise.all([
        verZonas.value ? useZonas().listar() : null,
        verRouters.value ? useRouters().listar() : null,
        verPlanes.value ? usePlanes().listar() : null,
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
})
</script>

<template>
    <PanelPagina
        id="clientes"
        titulo="Clientes"
        icono="i-lucide-users"
    >
        <template #acciones>
            <UButton
                v-if="puede('clientes.crear')"
                to="/clientes/nuevo"
                icon="i-lucide-user-plus"
                label="Nuevo cliente"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Nuevo cliente"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div
                    class="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Accesos rápidos"
                >
                    <UButton
                        v-for="opcion in accesos"
                        :key="opcion.acceso"
                        :label="opcion.etiqueta"
                        :icon="opcion.icono"
                        :color="opcion.color"
                        :variant="acceso === opcion.acceso ? 'solid' : 'outline'"
                        :aria-pressed="acceso === opcion.acceso"
                        size="sm"
                        class="rounded-full"
                        @click="elegirAcceso(opcion.acceso)"
                    />
                </div>
                <UButton
                    v-if="hayFiltros"
                    label="Limpiar"
                    icon="i-lucide-filter-x"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    data-prueba="limpiar-filtros"
                    @click="limpiarFiltros"
                />
            </div>

            <div class="flex items-center gap-2">
                <UInput
                    v-model="filtros.q"
                    icon="i-lucide-search"
                    placeholder="Nombre, NIT, teléfono, usuario PPP o IP"
                    aria-label="Buscar clientes"
                    class="w-full sm:max-w-md"
                    :loading="lista.cargando.value"
                >
                    <template
                        v-if="filtros.q"
                        #trailing
                    >
                        <UButton
                            icon="i-lucide-x"
                            color="neutral"
                            variant="link"
                            size="sm"
                            aria-label="Borrar búsqueda"
                            @click="filtros.q = ''"
                        />
                    </template>
                </UInput>
                <UButton
                    icon="i-lucide-sliders-horizontal"
                    label="Filtros"
                    color="neutral"
                    :variant="panelAbierto ? 'subtle' : 'outline'"
                    :aria-expanded="panelAbierto"
                    aria-controls="filtros-clientes"
                    class="shrink-0 sm:hidden"
                    @click="panelAbierto = !panelAbierto"
                >
                    <template #trailing>
                        <UBadge
                            v-if="activos"
                            :label="String(activos)"
                            size="sm"
                            variant="solid"
                            data-prueba="contador-filtros"
                        />
                    </template>
                </UButton>
                <UBadge
                    v-if="activos"
                    :label="activos === 1 ? '1 filtro activo' : `${activos} filtros activos`"
                    color="primary"
                    variant="subtle"
                    class="hidden shrink-0 sm:inline-flex"
                />
            </div>

            <div
                id="filtros-clientes"
                :class="panelAbierto ? 'grid' : 'hidden sm:grid'"
                class="gap-3 surface-card p-3 sm:grid-cols-2 lg:grid-cols-4"
                role="group"
                aria-label="Filtros de clientes"
            >
                <UFormField label="Estado del servicio">
                    <USelect
                        v-model="estado"
                        :items="itemsEstado"
                        icon="i-lucide-activity"
                        aria-label="Filtrar por estado del servicio"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="verZonas"
                    label="Zona"
                >
                    <USelect
                        v-model="zona"
                        :items="itemsZona"
                        icon="i-lucide-map-pin"
                        aria-label="Filtrar por zona"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="verRouters"
                    label="Router"
                >
                    <USelect
                        v-model="routerElegido"
                        :items="itemsRouter"
                        icon="i-lucide-router"
                        aria-label="Filtrar por router"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="verPlanes"
                    label="Plan"
                >
                    <USelect
                        v-model="plan"
                        :items="itemsPlan"
                        icon="i-lucide-gauge"
                        aria-label="Filtrar por plan"
                        class="w-full"
                    />
                </UFormField>
                <div class="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:gap-6 lg:col-span-4">
                    <USwitch
                        v-model="filtros.conDeuda"
                        label="Con deuda vencida"
                        description="Algún aviso de cobro vencido"
                    />
                    <USwitch
                        v-model="filtros.conPromesa"
                        label="Con promesa activa"
                        description="Promesa de pago vigente"
                    />
                </div>
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
                    <template #nombre-cell="{ row }">
                        <div class="flex min-w-40 flex-col">
                            <ULink
                                :to="`/clientes/${row.original.id}`"
                                class="font-medium text-highlighted hover:text-primary"
                            >
                                {{ row.original.nombre }}
                            </ULink>
                            <span class="flex items-center gap-1.5 text-xs text-muted">
                                <UBadge
                                    v-if="row.original.tipo === 'empresa'"
                                    label="Empresa"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                />
                                <span class="truncate">{{ row.original.email ?? 'Sin correo' }}</span>
                            </span>
                            <span
                                v-if="row.original.nit_cui"
                                class="font-mono text-xs text-muted sm:hidden"
                            >NIT {{ row.original.nit_cui }}</span>
                        </div>
                    </template>

                    <template #nit_cui-cell="{ row }">
                        <span class="font-mono text-sm">{{ row.original.nit_cui ?? '—' }}</span>
                    </template>

                    <template #telefono-cell="{ row }">
                        <div class="flex flex-col text-sm">
                            <span>{{ row.original.telefono ?? '—' }}</span>
                            <span
                                v-if="row.original.movil"
                                class="text-xs text-muted"
                            >{{ row.original.movil }}</span>
                        </div>
                    </template>

                    <template #zona_id-cell="{ row }">
                        {{ row.original.zona_id ? (nombresZona.get(row.original.zona_id) ?? `Zona ${row.original.zona_id}`) : '—' }}
                    </template>

                    <template #created_at-cell="{ row }">
                        <span class="whitespace-nowrap text-sm text-muted">{{ formatearFecha(row.original.created_at) }}</span>
                    </template>

                    <template #empty>
                        <UEmpty
                            icon="i-lucide-search-x"
                            :title="hayFiltros ? 'Ningún cliente coincide' : 'Todavía no hay clientes'"
                            :description="hayFiltros ? 'Prueba con otra búsqueda o quita algún filtro.' : undefined"
                            :actions="hayFiltros ? [{ label: 'Limpiar filtros', icon: 'i-lucide-filter-x', color: 'neutral', variant: 'subtle', onClick: limpiarFiltros }] : undefined"
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
