<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Compras (A3, fase 5): documentos de proveedores con su crédito fiscal, retenciones, condición y saldo.
 * Filtros por mes del IVA, estado, condición, tipo de documento y solo pendientes de pago. «Registrar
 * compra» (`compras.registrar`); el alta desde un egreso se pide desde la lista de egresos.
 */
definePageMeta({ permiso: 'compras.ver' })

useHead({ title: 'Compras y gastos · ArgosIsp' })

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
    { id: 'acciones', header: '', meta: { class: { td: 'w-0 text-end', th: 'w-0' } } },
]

/** Menú «⋯» de cada compra: ver, pagar y su asiento. */
function accionesCompra(compra: Compra): AccionFila[] {
    const acciones: AccionFila[] = [
        { etiqueta: 'Ver la compra', icono: ICONOS.abrir, to: `/compras/${compra.id}`, soloMenu: true, grupo: 'Ver' },
        { etiqueta: 'Ver el proveedor', icono: 'i-lucide-truck', to: `/proveedores/${compra.proveedor_id}`, soloMenu: true, grupo: 'Ver' },
    ]
    if (compra.asiento_id && puede('libro.ver')) {
        acciones.push({ etiqueta: 'Ver su asiento', icono: 'i-lucide-book-open', to: `/libro?origen=compra`, soloMenu: true, grupo: 'Ver' })
    }
    if (puede('compras.registrar') && compra.estado === 'vigente' && new Decimal(compra.saldo).gt(0)) {
        acciones.push({ etiqueta: 'Pagar en Pagos a proveedores', icono: ICONOS.cobrar, to: '/pagos-proveedores', soloMenu: true, grupo: 'Pago' })
    }
    return acciones
}

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
        titulo="Compras y gastos"
        icono="i-lucide-shopping-cart"
        descripcion="Facturas de proveedores con su crédito de IVA, retenciones, condición y lo que falta pagar."
    >
        <template #acciones>
            <ContaComprasAcciones />
        </template>

        <ContaCuerpo>
            <ContaIsla
                llenar
                ancho-lateral="lg:w-[22rem]"
            >
                <template #cabecera>
                    <ContaComprasPestanas />
                </template>
                <template #herramientas>
                    <USelect
                        v-model="estado"
                        :items="itemsEstado"
                        icon="i-lucide-filter"
                        aria-label="Estado"
                        class="w-44"
                        :ui="{ base: 'rounded-full' }"
                    />
                    <UPopover>
                        <UButton
                            label="Más filtros"
                            icon="i-lucide-sliders-horizontal"
                            color="neutral"
                            :variant="periodo || tipo !== TODOS || condicion !== TODOS || pendientes ? 'subtle' : 'outline'"
                            class="rounded-full"
                        />
                        <template #content>
                            <div class="flex w-72 flex-col gap-3 p-3">
                                <UFormField label="Mes del IVA">
                                    <UInput
                                        v-model="periodo"
                                        type="month"
                                        :max="hoy.slice(0, 7)"
                                        aria-label="Mes del IVA"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField label="Documento">
                                    <USelect
                                        v-model="tipo"
                                        :items="itemsTipo"
                                        aria-label="Documento"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField label="Condición">
                                    <USelect
                                        v-model="condicion"
                                        :items="itemsCondicion"
                                        aria-label="Condición"
                                        class="w-full"
                                    />
                                </UFormField>
                                <USwitch
                                    v-model="pendientes"
                                    label="Solo con saldo por pagar"
                                    data-prueba="solo-pendientes"
                                />
                            </div>
                        </template>
                    </UPopover>
                    <UButton
                        v-if="hayFiltros"
                        label="Limpiar"
                        icon="i-lucide-rotate-ccw"
                        color="primary"
                        variant="ghost"
                        size="sm"
                        @click="limpiar"
                    />
                </template>

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
                    <UTable
                        :data="lista.filas.value"
                        :columns="columnas"
                        :loading="lista.cargando.value"
                        sticky
                        :ui="{ td: 'py-3' }"
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
                        <template #acciones-cell="{ row }">
                            <ContaMenuFila
                                :acciones="accionesCompra(row.original)"
                                :nombre="`Compra ${row.original.id}`"
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
                    <div class="px-3 pb-3">
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

                <template #lateral>
                    <ContaCuentasPorPagar />
                </template>
                <template #pie>
                    Una compra no se edita: se anula con su reverso y se registra de nuevo. El crédito de IVA vale dos meses.
                </template>
            </ContaIsla>
        </ContaCuerpo>
    </PanelPagina>
</template>
