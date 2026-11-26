<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn, TabsItem } from '@nuxt/ui'

const { puede } = usePermisos()

/**
 * Comprobantes en una sola pantalla (decisión 13 del PM, tablero OperComprobantes): a la izquierda la
 * cola con pestañas, buscador y filtros; a la derecha la foto, lo declarado, a qué se aplicaría y la
 * decisión (`ComprobanteRevision`). Al decidir pasa solo al siguiente por revisar. En el teléfono
 * (OperComprobanteMovil) la fila abre `/comprobantes/:id` a pantalla completa.
 *
 * Filtros por estado, cliente, canal, cuenta de destino, método y fecha de depósito; `resumen` da el
 * total y el monto de lo filtrado (todas las páginas) y los pendientes con los demás filtros.
 */
definePageMeta({ permiso: 'comprobantes.ver' })

useHead({ title: 'Comprobantes · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const comprobantes = useComprobantes()

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function idQuery(valor: unknown): number {
    const id = Number(textoQuery(valor))
    return Number.isInteger(id) && id > 0 ? id : 0
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const METODOS_COMPROBANTE: Comprobante['metodo'][] = ['deposito', 'transferencia', 'ach', 'remesa']

function metodoQuery(valor: unknown): Comprobante['metodo'] | 'todos' {
    const texto = textoQuery(valor)
    return (METODOS_COMPROBANTE as string[]).includes(texto) ? texto as Comprobante['metodo'] : 'todos'
}

const CANALES: Comprobante['canal'][] = ['portal', 'panel', 'iris']

function canalQuery(valor: unknown): Comprobante['canal'] | 'todos' {
    const texto = textoQuery(valor)
    return (CANALES as string[]).includes(texto) ? texto as Comprobante['canal'] : 'todos'
}

function fechaQuery(valor: unknown): string {
    const texto = textoQuery(valor)
    return FECHA.test(texto) ? texto : ''
}

/** Pestaña: un estado o `todos` (la API acepta sin estado). */
type PestanaComprobantes = EstadoComprobante | 'todos'
const estado = ref<PestanaComprobantes>(esEstadoComprobante(route.query.estado) || route.query.estado === 'todos' ? route.query.estado as PestanaComprobantes : 'pendiente')
/** Comprobante abierto a la derecha (`?id=`). */
const seleccionado = ref(idQuery(route.query.id))
const clienteId = ref(idQuery(route.query.cliente))
const clienteElegido = shallowRef<Cliente | null>(null)
const metodo = ref<Comprobante['metodo'] | 'todos'>(metodoQuery(route.query.metodo))
const cuentaId = ref<number | 'todas'>(idQuery(route.query.cuenta) || 'todas')
const canal = ref<Comprobante['canal'] | 'todos'>(canalQuery(route.query.canal))
const desde = ref(fechaQuery(route.query.desde))
const hasta = ref(fechaQuery(route.query.hasta))

/** `canal=iris`: las boletas que llegaron por chat o llamada de Iris (contrato Iris 0.6.0 §7.2). */
const itemsCanal: SelectItem[] = [
    { label: 'Todos los canales', value: 'todos' },
    ...CANALES.map(valor => ({ label: CANALES_COMPROBANTE[valor], value: valor })),
]

const itemsMetodo: SelectItem[] = [
    { label: 'Todos los métodos', value: 'todos' },
    ...METODOS_COMPROBANTE.map(valor => ({ label: ETIQUETAS_METODO[valor], value: valor })),
]

/* Cuentas de destino para el filtro (`cuentas_bancarias.ver`); sin el permiso, no hay filtro. */
const cuentas = shallowRef<CuentaBancaria[]>([])
const problemaCuentas = ref<Problem | null>(null)
const itemsCuenta = computed<SelectItem[]>(() => [
    { label: 'Todas las cuentas', value: 'todas' },
    ...cuentas.value.map(c => ({ label: `${c.banco_nombre} · ${c.alias}`, value: c.id })),
])

async function cargarCuentas() {
    if (!puede('cuentas_bancarias.ver')) {
        return
    }
    const resultado = await useCuentasBancarias().listar()
    cuentas.value = resultado.ok ? resultado.data : []
    problemaCuentas.value = resultado.ok ? null : resultado.problema
}

/** Resumen de la última página leída; `null` mientras carga o si falló (sin totales inventados). */
const resumen = shallowRef<ResumenComprobantes | null>(null)

function filtrosActuales(): FiltrosComprobantes {
    const filtros: FiltrosComprobantes = estado.value === 'todos' ? {} : { estado: estado.value }
    if (clienteId.value) {
        filtros.cliente_id = clienteId.value
    }
    if (metodo.value !== 'todos') {
        filtros.metodo = metodo.value
    }
    if (cuentaId.value !== 'todas') {
        filtros.cuenta_bancaria_id = cuentaId.value
    }
    if (canal.value !== 'todos') {
        filtros.canal = canal.value
    }
    if (desde.value) {
        filtros.desde = desde.value
    }
    if (hasta.value) {
        filtros.hasta = hasta.value
    }
    return filtros
}

/** Totales de las otras pestañas con los mismos filtros (`resumen.total` de una página de 1). */
const totales = reactive<Record<'aprobado' | 'rechazado', number | null>>({ aprobado: null, rechazado: null })

async function cargarTotales() {
    totales.aprobado = null
    totales.rechazado = null
    const base = filtrosActuales()
    delete base.estado
    const [aprobados, rechazados] = await Promise.all([
        comprobantes.listar({ ...base, estado: 'aprobado', limit: 1 }),
        comprobantes.listar({ ...base, estado: 'rechazado', limit: 1 }),
    ])
    totales.aprobado = aprobados.ok ? aprobados.data.resumen.total : null
    totales.rechazado = rechazados.ok ? rechazados.data.resumen.total : null
}

const pestanas = computed<TabsItem[]>(() => [
    { label: 'Por revisar', value: 'pendiente', icon: 'i-lucide-clock', badge: textoContador(hayFiltros.value ? (resumen.value?.pendientes ?? null) : comprobantes.contador.value) },
    { label: 'Aprobados', value: 'aprobado', badge: textoContador(totales.aprobado) },
    { label: 'Rechazados', value: 'rechazado', badge: textoContador(totales.rechazado) },
    { label: 'Todos', value: 'todos' },
])

let solicitudResumen = 0
const lista = usePaginacionCursor(async (cursor) => {
    const actual = ++solicitudResumen
    resumen.value = null
    const resultado = await comprobantes.listar(filtrosActuales(), cursor)
    if (actual === solicitudResumen) {
        resumen.value = resultado.ok ? resultado.data.resumen : null
    }
    return resultado
})

const columnas = computed<TableColumn<Comprobante>[]>(() => [
    { accessorKey: 'cliente_nombre', header: 'Cliente y servicio' },
    { accessorKey: 'canal', header: 'Llegó por', meta: { class: { th: 'max-2xl:hidden', td: 'max-2xl:hidden' } } },
    { accessorKey: 'metodo', header: 'Cuenta y referencia', meta: SOLO_ESCRITORIO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'created_at', header: estado.value === 'pendiente' ? 'Espera' : 'Revisado', meta: { class: { th: 'text-right max-sm:hidden', td: 'text-right max-sm:hidden' } } },
])

/** «Más filtros»: método y fechas de depósito (los de la barra son cliente, canal y cuenta). */
const masFiltros = computed(() => [metodo.value !== 'todos', desde.value !== '', hasta.value !== ''].filter(Boolean).length)
const filtrosAbiertos = ref(masFiltros.value > 0)

async function abrir(comprobante: Comprobante) {
    if (!esEscritorio()) {
        // La cola filtrada viaja con él: al decidir pasa al siguiente de esta misma cola.
        await navigateTo({ path: `/comprobantes/${comprobante.id}`, query: queryFiltrosCola(route.query) })
        return
    }
    seleccionado.value = comprobante.id
    await router.replace({ query: { ...route.query, id: String(comprobante.id) } })
}

/** Pendiente de más de 2 horas: la espera se pinta en rojo. */
function esperaLarga(comprobante: Comprobante): boolean {
    return Date.now() - new Date(comprobante.created_at).getTime() > 2 * 3600_000
}

/** Fila abierta resaltada con el filete índigo a la izquierda. */
const metaTabla = metaFilaElegida<Comprobante>(fila => fila.id === seleccionado.value)

function alElegirFila(_evento: Event, fila: { original: Comprobante }) {
    void abrir(fila.original)
}

/** Si no hay uno abierto (o ya no está en la lista), abre el primero. */
function asegurarSeleccion() {
    if (!esEscritorio()) {
        return
    }
    const filas = lista.filas.value
    if (!filas.some(f => f.id === seleccionado.value)) {
        seleccionado.value = filas[0]?.id ?? 0
    }
}

/**
 * Al decidir: recarga la cola y abre el siguiente por revisar (el que seguía al decidido, o el
 * primero). Si ya no queda ninguno, se queda en el decidido para ver el resultado.
 */
async function alDecidir(decidido: Comprobante) {
    const filas = lista.filas.value
    const posicion = filas.findIndex(f => f.id === decidido.id)
    const siguiente = filas.slice(posicion + 1).find(f => f.estado === 'pendiente') ?? filas.find(f => f.estado === 'pendiente' && f.id !== decidido.id)
    await lista.recargar()
    void cargarTotales()
    if (estado.value === 'pendiente' && siguiente) {
        seleccionado.value = siguiente.id
    }
}

/** Filtros además del estado (las pestañas). */
const hayFiltros = computed(() => clienteId.value !== 0 || metodo.value !== 'todos' || cuentaId.value !== 'todas' || canal.value !== 'todos' || desde.value !== '' || hasta.value !== '')
const fechasInvalidas = computed(() => desde.value !== '' && hasta.value !== '' && desde.value > hasta.value)

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (estado.value !== 'pendiente') {
        query.estado = estado.value
    }
    if (seleccionado.value) {
        query.id = String(seleccionado.value)
    }
    if (clienteId.value) {
        query.cliente = String(clienteId.value)
    }
    if (metodo.value !== 'todos') {
        query.metodo = metodo.value
    }
    if (cuentaId.value !== 'todas') {
        query.cuenta = String(cuentaId.value)
    }
    if (canal.value !== 'todos') {
        query.canal = canal.value
    }
    if (desde.value) {
        query.desde = desde.value
    }
    if (hasta.value) {
        query.hasta = hasta.value
    }
    await router.replace({ query })
    if (fechasInvalidas.value) {
        return
    }
    await lista.recargar()
    asegurarSeleccion()
    void cargarTotales()
}

function alElegirCliente(cliente: Cliente) {
    clienteElegido.value = cliente
}

function limpiarFiltros() {
    clienteId.value = 0
    clienteElegido.value = null
    metodo.value = 'todos'
    cuentaId.value = 'todas'
    canal.value = 'todos'
    desde.value = ''
    hasta.value = ''
}

watch([estado, clienteId, metodo, cuentaId, canal, desde, hasta], aplicarFiltros)

// Sin filtros, `resumen.pendientes` es el conteo más fresco: el menú se actualiza con él.
watch(resumen, (valor) => {
    if (valor && !hayFiltros.value) {
        comprobantes.contador.value = valor.pendientes
    }
})

watch(seleccionado, (id) => {
    if (id && String(id) !== route.query.id) {
        void router.replace({ query: { ...route.query, id: String(id) } })
    }
})

onMounted(async () => {
    void lista.recargar().then(asegurarSeleccion)
    void cargarTotales()
    void cargarCuentas()
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
        id="comprobantes"
        titulo="Comprobantes"
        icono="i-lucide-file-check-2"
        descripcion="Depósitos y transferencias que mandan los clientes por el portal, por Iris o que registra el equipo"
    >
        <div class="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
            <!-- La cola. -->
            <section class="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.375rem] lg:max-h-[calc(100dvh-11rem)]">
                <div class="flex flex-col gap-3 border-b border-(--ax-borde) p-3 sm:p-4">
                    <OperPestanas
                        v-model="estado"
                        :items="pestanas"
                        etiqueta="Estado de los comprobantes"
                    />
                    <div class="flex flex-wrap items-center gap-2">
                        <ClienteSelector
                            v-model="clienteId"
                            :seleccionado="clienteElegido"
                            placeholder="Cliente: nombre, NIT o teléfono"
                            aria-label="Filtrar por cliente"
                            class="w-full min-w-0 sm:min-w-60 sm:flex-1"
                            @elegido="alElegirCliente"
                        />
                        <USelect
                            v-model="canal"
                            :items="itemsCanal"
                            icon="i-lucide-message-square"
                            aria-label="Filtrar por canal"
                            class="w-full sm:w-44"
                            data-prueba="filtro-canal"
                        />
                        <USelect
                            v-if="puede('cuentas_bancarias.ver') && !problemaCuentas"
                            v-model="cuentaId"
                            :items="itemsCuenta"
                            icon="i-lucide-landmark"
                            aria-label="Filtrar por cuenta de destino"
                            class="w-full sm:w-44"
                            data-prueba="filtro-cuenta"
                        />
                        <UButton
                            v-else-if="problemaCuentas"
                            label="Cuentas no disponibles"
                            icon="i-lucide-circle-alert"
                            color="error"
                            variant="soft"
                            :title="problemaCuentas.detail ?? problemaCuentas.title"
                            @click="cargarCuentas"
                        />
                        <UButton
                            icon="i-lucide-filter"
                            label="Más filtros"
                            color="neutral"
                            :variant="filtrosAbiertos ? 'subtle' : 'outline'"
                            :aria-expanded="filtrosAbiertos"
                            aria-controls="filtros-comprobantes"
                            data-prueba="mas-filtros"
                            @click="filtrosAbiertos = !filtrosAbiertos"
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
                            @click="limpiarFiltros"
                        />
                    </div>
                    <div
                        v-show="filtrosAbiertos"
                        id="filtros-comprobantes"
                        class="grid gap-3 rounded-xl bg-(--ax-panel) p-3 sm:grid-cols-3"
                        role="group"
                        aria-label="Más filtros de comprobantes"
                    >
                        <UFormField
                            label="Método"
                            size="sm"
                        >
                            <USelect
                                v-model="metodo"
                                :items="itemsMetodo"
                                icon="i-lucide-banknote"
                                aria-label="Filtrar por método"
                                class="w-full"
                                data-prueba="filtro-metodo"
                            />
                        </UFormField>
                        <UFormField
                            label="Depositado desde"
                            size="sm"
                        >
                            <CampoFecha
                                v-model="desde"
                                :max="hasta || undefined"
                                class="w-full"
                                data-prueba="filtro-desde"
                            />
                        </UFormField>
                        <UFormField
                            label="Hasta"
                            size="sm"
                            :error="fechasInvalidas ? 'Debe ser igual o posterior a la fecha inicial' : undefined"
                        >
                            <CampoFecha
                                v-model="hasta"
                                :min="desde || undefined"
                                class="w-full"
                                data-prueba="filtro-hasta"
                            />
                        </UFormField>
                    </div>
                </div>

                <div
                    v-if="lista.problema.value"
                    class="p-4"
                >
                    <ProblemaAlerta
                        :problema="lista.problema.value"
                        :reintentar="lista.recargar"
                        :reintentando="lista.cargando.value"
                    />
                </div>

                <template v-else>
                    <div class="min-h-0 flex-1 overflow-y-auto">
                        <UTable
                            :data="lista.filas.value"
                            :columns="columnas"
                            :loading="lista.cargando.value"
                            :meta="metaTabla"
                            sticky
                            :ui="{ root: 'rounded-none bg-transparent ring-0 shadow-none dark:shadow-none', td: 'py-3' }"
                            data-prueba="cola-comprobantes"
                            @select="alElegirFila"
                        >
                            <template #cliente_nombre-cell="{ row }">
                                <div
                                    class="flex min-w-40 flex-col"
                                    :data-comprobante="row.original.id"
                                >
                                    <ULink
                                        :to="`/comprobantes/${row.original.id}`"
                                        class="font-semibold text-highlighted hover:text-primary"
                                        :aria-label="`Comprobante #${row.original.id} de ${row.original.cliente_nombre}`"
                                        @click.prevent="abrir(row.original)"
                                    >
                                        {{ row.original.cliente_nombre }}
                                    </ULink>
                                    <span class="truncate text-xs text-muted">
                                        <span class="font-mono">#{{ row.original.id }}</span>
                                        <template v-if="row.original.servicio_id"> · servicio {{ row.original.servicio_id }}</template>
                                        <span class="2xl:hidden"> · {{ CANAL_COMPROBANTE_CORTO[row.original.canal].etiqueta }}</span>
                                        <span class="sm:hidden"> · {{ haceCuanto(row.original.created_at) }}</span>
                                    </span>
                                    <span
                                        v-if="llegoPorIris(row.original) && resumenLecturaIris(row.original)"
                                        class="truncate text-xs text-muted"
                                        data-prueba="fila-iris"
                                    ><span class="sr-only">Llegó por Iris · </span>{{ resumenLecturaIris(row.original) }}</span>
                                </div>
                            </template>

                            <template #canal-cell="{ row }">
                                <span
                                    class="pastilla-tono rounded-full px-2.5 py-0.5 text-xs font-semibold"
                                    :class="CANAL_COMPROBANTE_CORTO[row.original.canal].tono"
                                >{{ CANAL_COMPROBANTE_CORTO[row.original.canal].etiqueta }}</span>
                            </template>

                            <template #metodo-cell="{ row }">
                                <div class="flex max-w-48 flex-col">
                                    <span class="truncate text-sm">{{ ETIQUETAS_METODO[row.original.metodo] }} · {{ row.original.cuenta_bancaria_nombre }}</span>
                                    <span class="truncate font-mono text-xs text-muted">Ref. {{ row.original.referencia }} · {{ formatearFecha(row.original.fecha_deposito) }}</span>
                                </div>
                            </template>

                            <template #monto-cell="{ row }">
                                <span class="text-base font-bold whitespace-nowrap tabular-nums text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                            </template>

                            <template #created_at-cell="{ row }">
                                <span
                                    v-if="row.original.estado === 'pendiente'"
                                    class="text-sm font-medium whitespace-nowrap"
                                    :class="esperaLarga(row.original) ? 'text-error' : 'text-muted'"
                                    :title="formatearFechaHora(row.original.created_at)"
                                >{{ haceCuanto(row.original.created_at) }}</span>
                                <div
                                    v-else
                                    class="flex flex-col items-end"
                                >
                                    <UBadge
                                        :label="ESTADOS_COMPROBANTE[row.original.estado].etiqueta"
                                        :icon="ESTADOS_COMPROBANTE[row.original.estado].icono"
                                        :color="ESTADOS_COMPROBANTE[row.original.estado].color"
                                        variant="subtle"
                                        size="sm"
                                    />
                                    <span class="text-xs text-muted">{{ formatearFechaHora(row.original.verificado_en ?? row.original.created_at) }}</span>
                                    <span
                                        v-if="revisadoPor(row.original)"
                                        class="text-xs text-muted"
                                    >Por {{ revisadoPor(row.original) }}</span>
                                </div>
                            </template>

                            <template #empty>
                                <UEmpty
                                    :icon="estado === 'pendiente' && !hayFiltros ? 'i-lucide-inbox' : 'i-lucide-search-x'"
                                    :title="estado === 'pendiente' && !hayFiltros ? 'No hay comprobantes por revisar' : 'Ningún comprobante con estos filtros'"
                                    :description="hayFiltros ? 'Prueba con otros filtros.' : undefined"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                    </div>

                    <div
                        v-if="lista.hayAnterior.value || lista.haySiguiente.value"
                        class="border-t border-(--ax-borde) px-4 py-2"
                    >
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
                    <footer class="flex flex-col gap-1 border-t border-(--ax-borde) px-4 py-2.5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
                        <span class="flex items-center gap-1.5">
                            <UIcon
                                name="i-lucide-info"
                                class="size-3.5 shrink-0"
                            />
                            La cola ordena primero lo más antiguo. Los que llegan por Iris traen la conversación.
                        </span>
                        <span
                            v-if="resumen"
                            class="shrink-0 tabular-nums"
                            data-prueba="resumen-comprobantes"
                        >
                            {{ resumen.total }} {{ resumen.total === 1 ? 'comprobante' : 'comprobantes' }} · {{ formatearQuetzales(resumen.monto) }}
                        </span>
                    </footer>
                </template>
            </section>

            <!-- El comprobante abierto (solo escritorio). -->
            <div class="hidden min-h-0 lg:block lg:max-h-[calc(100dvh-11rem)]">
                <ComprobanteRevision
                    v-if="seleccionado"
                    :comprobante-id="seleccionado"
                    @decidido="alDecidir"
                />
                <div
                    v-else
                    class="surface-card flex h-full items-center justify-center rounded-[1.375rem] p-6"
                >
                    <UEmpty
                        icon="i-lucide-mouse-pointer-click"
                        title="Elige un comprobante"
                        description="Aquí ves la foto, lo que declaró el cliente y decides."
                        variant="naked"
                    />
                </div>
            </div>
        </div>
    </PanelPagina>
</template>
