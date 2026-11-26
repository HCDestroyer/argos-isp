<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'
import { h } from 'vue'

definePageMeta({ permiso: 'clientes.ver' })

useHead({ title: 'Clientes · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const clientesApi = useClientes()

/** Valor de los `USelect` para "sin filtro" (Reka UI no admite `''` como valor de un ítem). */
const TODOS = 'todos'

const filtros = reactive<EstadoFiltrosClientes>(leerFiltrosClientes(route.query))
/** «Más filtros»: estado, zona, router, plan y banderas (se abre dentro de la tarjeta de la lista). */
const panelAbierto = ref(contarFiltrosClientes(leerFiltrosClientes(route.query)) > 0 && accesoRapidoClientes(leerFiltrosClientes(route.query)) === null)

const zonas = shallowRef<Zona[]>([])
const routers = shallowRef<RouterNas[]>([])
const planes = shallowRef<Plan[]>([])

const verZonas = computed(() => puede('zonas.ver'))
const verRouters = computed(() => puede('routers.ver'))
const verPlanes = computed(() => puede('planes.ver'))

const nombresZona = computed(() => new Map(zonas.value.map(z => [z.id, z.nombre])))

const hayFiltros = computed(() => hayFiltrosClientes(filtros))
const acceso = computed(() => accesoRapidoClientes(filtros))

/*
 * Contadores que filtran (tablero NuevoClientes). La API todavía no da los conteos
 * (`.claude/integration/a4.md`, pedido a A1): cada tarjeta dice qué filtra, sin número inventado.
 */
const contadores: { acceso: AccesoRapidoClientes, etiqueta: string, detalle: string, icono: string, tono: string }[] = [
    { acceso: 'al_dia', etiqueta: 'Al día', detalle: 'Sin facturas vencidas', icono: 'i-lucide-circle-check', tono: 'tono-exito' },
    { acceso: 'deuda', etiqueta: 'Con deuda', detalle: 'Alguna factura vencida', icono: 'i-lucide-clock', tono: 'tono-aviso' },
    { acceso: 'cortados', etiqueta: 'Suspendidos', detalle: 'Algún servicio suspendido', icono: 'i-lucide-triangle-alert', tono: 'tono-error' },
    { acceso: 'promesa', etiqueta: 'Con promesa', detalle: 'Promesa de pago vigente', icono: 'i-lucide-hand', tono: 'tono-marca' },
]

/** Pestañas segmentadas de la tarjeta de la lista: los mismos filtros que los contadores. */
const pestanas: { acceso: AccesoRapidoClientes, etiqueta: string }[] = [
    { acceso: 'todos', etiqueta: 'Todos' },
    { acceso: 'al_dia', etiqueta: 'Al día' },
    { acceso: 'deuda', etiqueta: 'Con deuda' },
    { acceso: 'cortados', etiqueta: 'Suspendidos' },
]

/** Filtros de «Más filtros» puestos (los de los contadores no cuentan aquí). */
const masFiltros = computed(() => [filtros.zonaId, filtros.routerId, filtros.planId, filtros.nitInvalido, acceso.value === null ? true : null]
    .filter(valor => valor !== null && valor !== false).length)

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
        { accessorKey: 'telefono', header: 'Teléfono', meta: SOLO_ANCHO },
    ]
    if (verZonas.value) {
        base.push({ accessorKey: 'zona_id', header: 'Zona', meta: SOLO_ANCHO })
    }
    base.push({ accessorKey: 'nit_cui', header: 'NIT / CUI', meta: SOLO_ESCRITORIO })
    base.push({ accessorKey: 'created_at', header: 'Alta', meta: SOLO_ESCRITORIO })
    base.push({ id: 'acciones', header: () => h('span', { class: 'sr-only' }, 'Acciones'), meta: { class: { td: 'w-0 text-end', th: 'w-0' } } })
    return base
})

/*
 * Acciones de cada fila (iconos con tooltip y menú contextual con clic derecho) y vista rápida
 * lateral (maestro-detalle): clic en la fila fuera del nombre.
 */
const vistaAbierta = ref(false)
const vistaCliente = shallowRef<Cliente | null>(null)

function abrirVista(cliente: Cliente) {
    vistaCliente.value = cliente
    vistaAbierta.value = true
}

function accionesCliente(cliente: Cliente): AccionFila[] {
    const acciones: AccionFila[] = [
        { etiqueta: 'Vista rápida', icono: ICONOS.vistaRapida, alElegir: () => abrirVista(cliente), soloMenu: true, grupo: 'Ver' },
        { etiqueta: 'Abrir ficha del cliente', icono: ICONOS.abrir, to: `/clientes/${cliente.id}`, soloMenu: true, grupo: 'Ver' },
        { etiqueta: 'Estado de cuenta', icono: 'i-lucide-receipt-text', to: `/clientes/${cliente.id}?tab=cuenta`, soloMenu: true, grupo: 'Ver' },
    ]
    if (puede('pagos.registrar')) {
        acciones.push({ etiqueta: 'Cobrar a este cliente', icono: ICONOS.cobrar, to: `/cobro?cliente=${cliente.id}`, soloMenu: true, grupo: 'Cobro' })
    }
    if (puede('promesas.crear') && puede('servicios.ver')) {
        acciones.push({ etiqueta: 'Promesa de pago', icono: 'i-lucide-hand', alElegir: () => abrirVista(cliente), soloMenu: true, grupo: 'Cobro' })
    }
    if (puede('clientes.editar')) {
        acciones.push({ etiqueta: 'Editar datos del cliente', icono: ICONOS.editar, to: `/clientes/${cliente.id}/editar`, soloMenu: true, grupo: 'Cliente' })
    }
    if (puede('servicios.crear')) {
        acciones.push({ etiqueta: 'Agregar servicio', icono: ICONOS.crear, to: `/clientes/${cliente.id}?tab=servicios&nuevo_servicio=1`, soloMenu: true, grupo: 'Cliente' })
    }
    return acciones
}

const menuFila = useMenuFila(accionesCliente)

function alElegirFila(_evento: Event, fila: { original: Cliente }) {
    abrirVista(fila.original)
}

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
    () => [filtros.zonaId, filtros.estado, filtros.routerId, filtros.planId, filtros.conDeuda, filtros.alDia, filtros.conPromesa, filtros.nitInvalido],
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
        sin-descripcion
    >
        <template #accion-principal>
            <UButton
                v-if="puede('clientes.crear')"
                to="/clientes/nuevo"
                icon="i-lucide-plus"
                label="Nuevo cliente"
                size="lg"
                class="glow-brand rounded-full px-5"
                data-prueba="nuevo-cliente"
            />
        </template>

        <div class="flex flex-col gap-4">
            <!-- Contadores que filtran (tablero NuevoClientes). -->
            <div
                class="grid grid-cols-2 gap-3 lg:grid-cols-4"
                role="group"
                aria-label="Filtrar por estado de cuenta"
                data-prueba="contadores-clientes"
            >
                <UButton
                    v-for="contador in contadores"
                    :key="contador.acceso"
                    color="neutral"
                    variant="ghost"
                    :aria-pressed="acceso === contador.acceso"
                    class="surface-card items-center gap-3 rounded-2xl p-3 text-start sm:p-4"
                    :class="acceso === contador.acceso ? 'ring-2 ring-primary' : ''"
                    :data-contador="contador.acceso"
                    @click="elegirAcceso(acceso === contador.acceso ? 'todos' : contador.acceso)"
                >
                    <span
                        class="pastilla-icono pastilla-tono size-10 shrink-0 rounded-xl"
                        :class="contador.tono"
                    >
                        <UIcon
                            :name="contador.icono"
                            class="size-5"
                        />
                    </span>
                    <span class="flex min-w-0 flex-col">
                        <span class="truncate text-[0.8125rem] font-semibold text-highlighted sm:text-base">{{ contador.etiqueta }}</span>
                        <span class="hidden truncate text-xs font-normal text-muted sm:block">{{ contador.detalle }}</span>
                    </span>
                </UButton>
            </div>

            <div class="surface-card flex min-w-0 flex-col overflow-hidden rounded-2xl">
                <div class="flex flex-col gap-3 p-3 sm:p-4">
                    <div class="flex flex-wrap items-center gap-2">
                        <UInput
                            v-model="filtros.q"
                            icon="i-lucide-search"
                            placeholder="Nombre, NIT, teléfono o IP"
                            aria-label="Buscar clientes por nombre, NIT, teléfono, usuario PPP o IP"
                            class="w-full sm:w-80"
                            :ui="{ base: 'rounded-full' }"
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
                        <div
                            class="flex flex-wrap gap-1.5"
                            role="group"
                            aria-label="Accesos rápidos"
                        >
                            <UButton
                                v-for="pestanaLista in pestanas"
                                :key="pestanaLista.acceso"
                                :label="pestanaLista.etiqueta"
                                :color="acceso === pestanaLista.acceso ? 'primary' : 'neutral'"
                                :variant="acceso === pestanaLista.acceso ? 'solid' : 'outline'"
                                :aria-pressed="acceso === pestanaLista.acceso"
                                size="sm"
                                class="rounded-full"
                                @click="elegirAcceso(pestanaLista.acceso)"
                            />
                            <UButton
                                icon="i-lucide-filter"
                                label="Más filtros"
                                color="neutral"
                                :variant="panelAbierto ? 'subtle' : 'outline'"
                                :aria-expanded="panelAbierto"
                                aria-controls="filtros-clientes"
                                size="sm"
                                class="rounded-full"
                                data-prueba="mas-filtros"
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
                                        data-prueba="contador-filtros"
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
                                data-prueba="limpiar-filtros"
                                @click="limpiarFiltros"
                            />
                        </div>
                    </div>

                    <div
                        v-show="panelAbierto"
                        id="filtros-clientes"
                        class="grid gap-3 rounded-xl bg-(--ax-panel) p-3 sm:grid-cols-2 lg:grid-cols-4"
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
                            <USwitch
                                v-model="filtros.nitInvalido"
                                label="NIT o CUI por corregir"
                                description="No pasó la validación fiscal"
                            />
                        </div>
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
                            class="flex-1"
                            :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                            data-menu-contextual
                            @select="alElegirFila"
                            @contextmenu="menuFila.alContextmenu"
                        >
                            <template #nombre-cell="{ row }">
                                <div class="flex min-w-48 items-center gap-3">
                                    <AvatarIniciales :nombre="row.original.nombre" />
                                    <div class="flex min-w-0 flex-col">
                                        <ULink
                                            :to="`/clientes/${row.original.id}`"
                                            class="font-semibold text-highlighted hover:text-primary"
                                        >
                                            {{ row.original.nombre }}
                                        </ULink>
                                        <span class="flex items-center gap-1.5 text-xs text-muted">
                                            <span class="font-mono">{{ row.original.codigo }}</span>
                                            <UBadge
                                                v-if="row.original.tipo === 'empresa'"
                                                label="Empresa"
                                                color="neutral"
                                                variant="outline"
                                                size="sm"
                                            />
                                        </span>
                                        <span
                                            v-if="row.original.telefono"
                                            class="text-xs text-muted sm:hidden"
                                        >{{ row.original.telefono }}</span>
                                    </div>
                                </div>
                            </template>

                            <template #acciones-cell="{ row }">
                                <div class="flex items-center justify-end gap-1">
                                    <UButton
                                        v-if="puede('pagos.registrar')"
                                        :to="`/cobro?cliente=${row.original.id}`"
                                        :icon="ICONOS.cobrar"
                                        label="Cobrar"
                                        color="success"
                                        variant="soft"
                                        size="sm"
                                        class="rounded-full"
                                        :aria-label="`Cobrar a ${row.original.nombre}`"
                                        :ui="{ label: 'hidden md:inline' }"
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
                                            :aria-label="`Más acciones: ${row.original.nombre}`"
                                            data-prueba="acciones-cliente"
                                        />
                                    </UDropdownMenu>
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
                                    :actions="hayFiltros ? [{ label: 'Limpiar filtros', icon: 'i-lucide-filter-x', color: 'neutral', variant: 'subtle', onClick: limpiarFiltros }] : puede('clientes.crear') && !lista.cargando.value ? [{ label: 'Crear el primer cliente', icon: 'i-lucide-user-plus', to: '/clientes/nuevo' }] : undefined"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                    </UContextMenu>

                    <div class="border-t border-(--ax-borde) px-3 py-2 sm:px-4">
                        <PaginacionCursor
                            :pagina="lista.pagina.value"
                            :hay-anterior="lista.hayAnterior.value"
                            :hay-siguiente="lista.haySiguiente.value"
                            :cargando="lista.cargando.value"
                            :filas="lista.filas.value.length"
                            @anterior="lista.anterior"
                            @siguiente="lista.siguiente"
                        />
                    </div>
                </template>
            </div>
        </div>
        <ClienteVistaRapida
            v-model:open="vistaAbierta"
            :cliente="vistaCliente"
            :nombre-zona="vistaCliente?.zona_id ? (nombresZona.get(vistaCliente.zona_id) ?? null) : null"
        />
    </PanelPagina>
</template>
