<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Compras (A3, fase 5): documentos de proveedores con su crédito fiscal, retenciones, condición y saldo.
 * Filtros por mes del IVA, estado, condición, tipo de documento y solo pendientes de pago. «Registrar
 * compra» (`compras.registrar`); el alta desde un egreso se pide desde la lista de egresos.
 */
definePageMeta({ permiso: 'compras.ver' })

useHead({ title: 'Compras · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()

const TODOS = 'todos'
const hoy = hoyGuatemala()
const texto = (valor: unknown) => (typeof valor === 'string' ? valor : '')

const periodo = ref(/^\d{4}-\d{2}$/.test(texto(route.query.periodo)) ? texto(route.query.periodo) : '')
const estado = ref<'vigente' | 'anulada' | typeof TODOS>(route.query.estado === 'vigente' || route.query.estado === 'anulada' ? route.query.estado : TODOS)
const condicion = ref<'contado' | 'credito' | typeof TODOS>(route.query.condicion === 'contado' || route.query.condicion === 'credito' ? route.query.condicion : TODOS)
const tipo = ref<TipoDocumentoCompra | typeof TODOS>(texto(route.query.tipo) in TIPOS_DOCUMENTO_COMPRA ? texto(route.query.tipo) as TipoDocumentoCompra : TODOS)
const pendientes = ref(route.query.pendientes === 'true')

const itemsEstado: SelectItem[] = [{ label: 'Todos los estados', value: TODOS }, { label: 'Vigentes', value: 'vigente' }, { label: 'Anuladas', value: 'anulada' }]
const itemsCondicion: SelectItem[] = [{ label: 'Contado y crédito', value: TODOS }, { label: 'Al contado', value: 'contado' }, { label: 'Al crédito', value: 'credito' }]
const itemsTipo: SelectItem[] = [{ label: 'Todos los documentos', value: TODOS }, ...Object.entries(TIPOS_DOCUMENTO_COMPRA).map(([value, label]) => ({ label: `${value} · ${label}`, value }))]

function filtros(): FiltrosCompras {
    return {
        ...(periodo.value ? { periodo_iva: `${periodo.value}-01` } : {}),
        ...(estado.value !== TODOS ? { estado: estado.value } : {}),
        ...(condicion.value !== TODOS ? { condicion: condicion.value } : {}),
        ...(tipo.value !== TODOS ? { tipo_documento: tipo.value } : {}),
        ...(pendientes.value ? { pendientes: true } : {}),
    }
}

const lista = usePaginacionCursor(cursor => useCompras().listar(filtros(), cursor))
const hayFiltros = computed(() => Object.keys(filtros()).length > 0)

const columnas: TableColumn<Compra>[] = [
    { accessorKey: 'fecha_documento', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'numero', header: 'Compra', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'periodo_iva', header: 'Mes del IVA', meta: SOLO_ESCRITORIO },
    { accessorKey: 'total', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'saldo', header: 'Saldo', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
]

async function aplicarFiltros() {
    await router.replace({ query: { ...(periodo.value ? { periodo: periodo.value } : {}), ...(estado.value !== TODOS ? { estado: estado.value } : {}), ...(condicion.value !== TODOS ? { condicion: condicion.value } : {}), ...(tipo.value !== TODOS ? { tipo: tipo.value } : {}), ...(pendientes.value ? { pendientes: 'true' } : {}) } })
    await lista.recargar()
}

function limpiar() {
    periodo.value = ''
    estado.value = TODOS
    condicion.value = TODOS
    tipo.value = TODOS
    pendientes.value = false
}

watch([periodo, estado, condicion, tipo, pendientes], aplicarFiltros)

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="compras"
        titulo="Compras"
        icono="i-lucide-shopping-cart"
    >
        <template #acciones>
            <UButton
                v-if="puede('compras.cargar_borrador')"
                to="/compras/cargar"
                label="Cargar factura"
                icon="i-lucide-file-up"
                color="neutral"
                variant="outline"
                aria-label="Cargar factura"
                :ui="{ label: 'hidden sm:inline' }"
                data-prueba="cargar-factura"
            />
            <UButton
                v-if="puede('compras.registrar')"
                to="/compras/nueva"
                label="Registrar compra"
                icon="i-lucide-plus"
                data-prueba="registrar-compra"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <UInput
                    v-model="periodo"
                    type="month"
                    :max="hoy.slice(0, 7)"
                    aria-label="Mes del IVA"
                    class="w-full"
                />
                <USelect
                    v-model="tipo"
                    :items="itemsTipo"
                    aria-label="Documento"
                    class="w-full"
                />
                <USelect
                    v-model="condicion"
                    :items="itemsCondicion"
                    aria-label="Condición"
                    class="w-full"
                />
                <USelect
                    v-model="estado"
                    :items="itemsEstado"
                    aria-label="Estado"
                    class="w-full"
                />
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <USwitch
                    v-model="pendientes"
                    label="Solo con saldo por pagar"
                    data-prueba="solo-pendientes"
                />
                <UButton
                    v-if="hayFiltros"
                    label="Limpiar filtros"
                    icon="i-lucide-filter-x"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="sm:ml-auto"
                    @click="limpiar"
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
                    data-prueba="tabla-compras"
                >
                    <template #fecha_documento-cell="{ row }">
                        <span class="whitespace-nowrap text-sm">{{ formatearFecha(row.original.fecha_documento) }}</span>
                    </template>
                    <template #numero-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col"
                            :data-compra="row.original.id"
                        >
                            <ULink
                                :to="`/compras/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:underline"
                            >
                                #{{ row.original.id }} · {{ documentoCompra(row.original) }}
                            </ULink>
                            <span class="truncate text-xs text-muted">{{ row.original.proveedor_nombre }} · {{ row.original.condicion === 'credito' ? 'al crédito' : 'al contado' }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ formatearFecha(row.original.fecha_documento) }} · {{ ESTADOS_COMPRA[row.original.estado].etiqueta }}</span>
                            <span
                                v-if="diasVencida(row.original, hoy)"
                                class="text-xs text-error"
                            >Vencida hace {{ diasVencida(row.original, hoy) }} días</span>
                        </div>
                    </template>
                    <template #periodo_iva-cell="{ row }">
                        <span class="text-sm">{{ row.original.periodo_iva.slice(0, 7) }}<template v-if="!row.original.credito_fiscal"> · sin crédito</template></span>
                    </template>
                    <template #total-cell="{ row }">
                        <span
                            class="whitespace-nowrap tabular-nums"
                            :class="row.original.estado === 'anulada' ? 'text-muted line-through' : 'font-medium'"
                        >{{ formatearQuetzales(row.original.total) }}</span>
                    </template>
                    <template #saldo-cell="{ row }">
                        <span class="whitespace-nowrap tabular-nums">{{ formatearQuetzales(row.original.saldo) }}</span>
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="ESTADOS_COMPRA[row.original.estado].etiqueta"
                            :color="ESTADOS_COMPRA[row.original.estado].color"
                            :icon="ESTADOS_COMPRA[row.original.estado].icono"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-shopping-cart"
                            :title="hayFiltros ? 'Sin compras para estos filtros' : 'Todavía no hay compras'"
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
