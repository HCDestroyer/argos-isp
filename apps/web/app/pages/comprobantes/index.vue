<script setup lang="ts">
import type { TableColumn, TabsItem } from '@nuxt/ui'

const { enlace, puede } = usePermisos()

/**
 * Cola de verificación de comprobantes de depósito (A3): los que el cliente subió desde el
 * portal (o un operador desde el panel). Cada fila abre el detalle con la foto o el PDF.
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

const estado = ref<EstadoComprobante>(esEstadoComprobante(route.query.estado) ? route.query.estado : 'pendiente')
const clienteId = ref(idQuery(route.query.cliente))
const clienteElegido = shallowRef<Cliente | null>(null)

const pestanas = computed<TabsItem[]>(() => (Object.keys(ESTADOS_COMPROBANTE) as EstadoComprobante[]).map(valor => ({
    label: ESTADOS_COMPROBANTE[valor].plural,
    value: valor,
    icon: ESTADOS_COMPROBANTE[valor].icono,
    badge: valor === 'pendiente' ? textoContador(comprobantes.contador.value) : undefined,
})))

const lista = usePaginacionCursor((cursor) => {
    const filtros: FiltrosComprobantes = { estado: estado.value }
    if (clienteId.value) {
        filtros.cliente_id = clienteId.value
    }
    return comprobantes.listar(filtros, cursor)
})

const columnas = computed<TableColumn<Comprobante>[]>(() => [
    { accessorKey: 'id', header: 'Comprobante' },
    { accessorKey: 'cliente_nombre', header: 'Cliente', meta: SOLO_ANCHO },
    { accessorKey: 'metodo', header: 'Método y referencia', meta: SOLO_ESCRITORIO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'created_at', header: estado.value === 'pendiente' ? 'Recibido' : 'Revisado', meta: SOLO_ANCHO },
])

const hayFiltros = computed(() => clienteId.value !== 0)

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (estado.value !== 'pendiente') {
        query.estado = estado.value
    }
    if (clienteId.value) {
        query.cliente = String(clienteId.value)
    }
    await router.replace({ query })
    await lista.recargar()
}

function alElegirCliente(cliente: Cliente) {
    clienteElegido.value = cliente
}

function limpiarFiltros() {
    clienteId.value = 0
    clienteElegido.value = null
}

watch([estado, clienteId], aplicarFiltros)

// La lista de pendientes ya es el conteo más fresco: el menú se actualiza con ella.
watch(lista.filas, () => {
    if (estado.value === 'pendiente' && !clienteId.value && lista.pagina.value === 1 && !lista.problema.value) {
        void comprobantes.actualizarContador()
    }
})

onMounted(async () => {
    void lista.recargar()
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

            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <ClienteSelector
                    v-model="clienteId"
                    :seleccionado="clienteElegido"
                    placeholder="Filtrar por cliente: nombre, NIT o teléfono"
                    aria-label="Filtrar por cliente"
                    class="w-full sm:max-w-md"
                    @elegido="alElegirCliente"
                />
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
                            :description="hayFiltros ? 'Prueba con otro cliente.' : undefined"
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
