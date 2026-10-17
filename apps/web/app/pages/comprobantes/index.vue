<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn, TabsItem } from '@nuxt/ui'

const { enlace, puede } = usePermisos()

/**
 * Cola de verificación de comprobantes de depósito (A3): los que el cliente subió desde el
 * portal (o un operador desde el panel). Cada fila abre el detalle con la foto o el PDF.
 * Filtros por estado, cliente, método, cuenta de destino y fecha de depósito; `resumen` da el
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

function fechaQuery(valor: unknown): string {
    const texto = textoQuery(valor)
    return FECHA.test(texto) ? texto : ''
}

const estado = ref<EstadoComprobante>(esEstadoComprobante(route.query.estado) ? route.query.estado : 'pendiente')
const clienteId = ref(idQuery(route.query.cliente))
const clienteElegido = shallowRef<Cliente | null>(null)
const metodo = ref<Comprobante['metodo'] | 'todos'>(metodoQuery(route.query.metodo))
const cuentaId = ref<number | 'todas'>(idQuery(route.query.cuenta) || 'todas')
const desde = ref(fechaQuery(route.query.desde))
const hasta = ref(fechaQuery(route.query.hasta))

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
    const filtros: FiltrosComprobantes = { estado: estado.value }
    if (clienteId.value) {
        filtros.cliente_id = clienteId.value
    }
    if (metodo.value !== 'todos') {
        filtros.metodo = metodo.value
    }
    if (cuentaId.value !== 'todas') {
        filtros.cuenta_bancaria_id = cuentaId.value
    }
    if (desde.value) {
        filtros.desde = desde.value
    }
    if (hasta.value) {
        filtros.hasta = hasta.value
    }
    return filtros
}

const pestanas = computed<TabsItem[]>(() => (Object.keys(ESTADOS_COMPROBANTE) as EstadoComprobante[]).map(valor => ({
    label: ESTADOS_COMPROBANTE[valor].plural,
    value: valor,
    icon: ESTADOS_COMPROBANTE[valor].icono,
    badge: valor === 'pendiente' ? textoContador(hayFiltros.value ? (resumen.value?.pendientes ?? null) : comprobantes.contador.value) : undefined,
})))

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
    { accessorKey: 'id', header: 'Comprobante' },
    { accessorKey: 'cliente_nombre', header: 'Cliente', meta: SOLO_ANCHO },
    { accessorKey: 'metodo', header: 'Método y referencia', meta: SOLO_ESCRITORIO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'created_at', header: estado.value === 'pendiente' ? 'Recibido' : 'Revisado', meta: SOLO_ANCHO },
])

/** Filtros además del estado (las pestañas). */
const hayFiltros = computed(() => clienteId.value !== 0 || metodo.value !== 'todos' || cuentaId.value !== 'todas' || desde.value !== '' || hasta.value !== '')
const fechasInvalidas = computed(() => desde.value !== '' && hasta.value !== '' && desde.value > hasta.value)

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (estado.value !== 'pendiente') {
        query.estado = estado.value
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
}

function alElegirCliente(cliente: Cliente) {
    clienteElegido.value = cliente
}

function limpiarFiltros() {
    clienteId.value = 0
    clienteElegido.value = null
    metodo.value = 'todos'
    cuentaId.value = 'todas'
    desde.value = ''
    hasta.value = ''
}

watch([estado, clienteId, metodo, cuentaId, desde, hasta], aplicarFiltros)

// Sin filtros, `resumen.pendientes` es el conteo más fresco: el menú se actualiza con él.
watch(resumen, (valor) => {
    if (valor && !hayFiltros.value) {
        comprobantes.contador.value = valor.pendientes
    }
})

onMounted(async () => {
    void lista.recargar()
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
    >
        <div class="flex flex-col gap-4">
            <UTabs
                v-model="estado"
                :items="pestanas"
                variant="link"
                :content="false"
                class="w-full"
                :ui="{ leadingIcon: 'hidden sm:inline-flex' }"
            />

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ClienteSelector
                    v-model="clienteId"
                    :seleccionado="clienteElegido"
                    placeholder="Cliente: nombre, NIT o teléfono"
                    aria-label="Filtrar por cliente"
                    class="w-full sm:col-span-2"
                    @elegido="alElegirCliente"
                />
                <USelect
                    v-model="metodo"
                    :items="itemsMetodo"
                    icon="i-lucide-landmark"
                    aria-label="Filtrar por método"
                    class="w-full"
                    data-prueba="filtro-metodo"
                />
                <USelect
                    v-if="puede('cuentas_bancarias.ver') && !problemaCuentas"
                    v-model="cuentaId"
                    :items="itemsCuenta"
                    icon="i-lucide-wallet"
                    aria-label="Filtrar por cuenta de destino"
                    class="w-full"
                    data-prueba="filtro-cuenta"
                />
                <UButton
                    v-else-if="problemaCuentas"
                    label="Cuentas no disponibles"
                    icon="i-lucide-circle-alert"
                    color="error"
                    variant="soft"
                    class="w-full justify-center"
                    :title="problemaCuentas.detail ?? problemaCuentas.title"
                    @click="cargarCuentas"
                />
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
                <UFormField
                    label="Depositado desde"
                    size="sm"
                >
                    <UInput
                        v-model="desde"
                        type="date"
                        :max="hasta || undefined"
                        class="w-full sm:w-44"
                        data-prueba="filtro-desde"
                    />
                </UFormField>
                <UFormField
                    label="Hasta"
                    size="sm"
                    :error="fechasInvalidas ? 'Debe ser igual o posterior a la fecha inicial' : undefined"
                >
                    <UInput
                        v-model="hasta"
                        type="date"
                        :min="desde || undefined"
                        class="w-full sm:w-44"
                        data-prueba="filtro-hasta"
                    />
                </UFormField>
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

            <div
                v-if="resumen && !lista.problema.value"
                class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
                data-prueba="resumen-comprobantes"
            >
                <span>
                    <strong class="text-highlighted tabular-nums">{{ resumen.total }}</strong>
                    {{ resumen.total === 1 ? 'comprobante' : 'comprobantes' }} {{ ESTADOS_COMPROBANTE[estado].plural.toLowerCase() }} ·
                    <strong class="text-highlighted tabular-nums">{{ formatearQuetzales(resumen.monto) }}</strong>
                </span>
                <span
                    v-if="estado !== 'pendiente' && resumen.pendientes > 0"
                    class="text-muted"
                >
                    Pendientes con estos filtros: {{ resumen.pendientes }} · {{ formatearQuetzales(resumen.monto_pendiente) }}
                </span>
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
                                :to="`/comprobantes/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                Comprobante #{{ row.original.id }}
                            </ULink>
                            <span class="text-xs text-muted">Depósito del {{ formatearFecha(row.original.fecha_deposito) }}</span>
                            <span class="truncate text-xs text-muted sm:hidden">{{ row.original.cliente_nombre }}</span>
                            <span class="text-xs text-muted lg:hidden">{{ ETIQUETAS_METODO[row.original.metodo] }} · <span class="font-mono">{{ row.original.referencia }}</span></span>
                        </div>
                    </template>

                    <template #cliente_nombre-cell="{ row }">
                        <div class="flex flex-col">
                            <ULink
                                :to="enlace(`/clientes/${row.original.cliente_id}?tab=cuenta`)"
                                class="text-sm text-default hover:text-primary"
                            >
                                {{ row.original.cliente_nombre }}
                            </ULink>
                            <span class="text-xs text-muted">{{ CANALES_COMPROBANTE[row.original.canal] }}</span>
                        </div>
                    </template>

                    <template #metodo-cell="{ row }">
                        <div class="flex flex-col">
                            <span class="text-sm">{{ ETIQUETAS_METODO[row.original.metodo] }} · {{ row.original.cuenta_bancaria_nombre }}</span>
                            <span class="font-mono text-xs text-muted">{{ row.original.referencia }}</span>
                        </div>
                    </template>

                    <template #monto-cell="{ row }">
                        <span class="font-medium tabular-nums text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                    </template>

                    <template #created_at-cell="{ row }">
                        <div class="flex flex-col">
                            <span class="text-sm">{{ formatearFechaHora(row.original.verificado_en ?? row.original.created_at) }}</span>
                            <span
                                v-if="revisadoPor(row.original)"
                                class="text-xs text-muted"
                            >Por {{ revisadoPor(row.original) }}</span>
                            <span
                                v-if="row.original.estado === 'rechazado' && row.original.motivo_rechazo"
                                class="max-w-64 truncate text-xs text-muted"
                            >{{ row.original.motivo_rechazo }}</span>
                            <ULink
                                v-else-if="row.original.pago_id"
                                :to="enlace(`/pagos/${row.original.pago_id}`)"
                                class="text-xs text-muted hover:text-primary"
                            >Pago #{{ row.original.pago_id }}</ULink>
                        </div>
                    </template>

                    <template #empty>
                        <UEmpty
                            :icon="estado === 'pendiente' && !hayFiltros ? 'i-lucide-inbox' : 'i-lucide-search-x'"
                            :title="estado === 'pendiente' && !hayFiltros ? 'No hay comprobantes por verificar' : `Ningún comprobante ${ESTADOS_COMPROBANTE[estado].etiqueta.toLowerCase()}`"
                            :description="hayFiltros ? 'Prueba con otros filtros.' : undefined"
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
