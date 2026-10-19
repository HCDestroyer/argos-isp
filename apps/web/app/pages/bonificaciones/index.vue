<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Bonificaciones (A3, decisión del PM: lo que antes era una factura de Q0): periodos regalados
 * (mes gratis, descuento del 100 %, canje) y cargos sin costo, con su motivo y el valor bruto que
 * no se cobró. Filtros por origen, fechas, cliente y servicio (de la URL, para llegar desde la ficha).
 */
definePageMeta({ permiso: 'facturas.ver' })

useHead({ title: 'Bonificaciones · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { enlace } = usePermisos()
const nombres = useNombresClientes()

const TODOS = 'todos'
const FECHA = /^\d{4}-\d{2}-\d{2}$/

function idQuery(valor: unknown): number | undefined {
    const n = Number(valor)
    return Number.isInteger(n) && n > 0 ? n : undefined
}

const origen = ref<OrigenBonificacion | typeof TODOS>(typeof route.query.origen === 'string' && Object.hasOwn(ORIGENES_BONIFICACION, route.query.origen) ? route.query.origen as OrigenBonificacion : TODOS)
const desde = ref(typeof route.query.desde === 'string' && FECHA.test(route.query.desde) ? route.query.desde : '')
const hasta = ref(typeof route.query.hasta === 'string' && FECHA.test(route.query.hasta) ? route.query.hasta : '')
const clienteId = idQuery(route.query.cliente)
const servicioId = idQuery(route.query.servicio)
const itemsOrigen: SelectItem[] = [{ label: 'Todos los orígenes', value: TODOS }, ...Object.entries(ORIGENES_BONIFICACION).map(([value, o]) => ({ label: o.etiqueta, value }))]

function filtros(): FiltrosBonificaciones {
    const f: FiltrosBonificaciones = {}
    if (origen.value !== TODOS) {
        f.origen = origen.value
    }
    if (desde.value) {
        f.desde = desde.value
    }
    if (hasta.value) {
        f.hasta = hasta.value
    }
    if (clienteId) {
        f.cliente_id = clienteId
    }
    if (servicioId) {
        f.servicio_id = servicioId
    }
    return f
}

const lista = usePaginacionCursor(cursor => useBonificaciones().listar(filtros(), cursor))

const columnas: TableColumn<Bonificacion>[] = [
    { accessorKey: 'periodo', header: 'Periodo' },
    { accessorKey: 'cliente_id', header: 'Cliente', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'origen', header: 'Origen', meta: SOLO_ANCHO },
    { accessorKey: 'bruto', header: 'Sin cobrar', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

watch(() => lista.filas.value, filas => void nombres.cargar(filas.map(b => b.cliente_id)))

watch([origen, desde, hasta], async () => {
    if ((desde.value && !FECHA.test(desde.value)) || (hasta.value && !FECHA.test(hasta.value))) {
        return
    }
    const query: Record<string, string> = {}
    if (origen.value !== TODOS) {
        query.origen = origen.value
    }
    if (desde.value) {
        query.desde = desde.value
    }
    if (hasta.value) {
        query.hasta = hasta.value
    }
    if (clienteId) {
        query.cliente = String(clienteId)
    }
    if (servicioId) {
        query.servicio = String(servicioId)
    }
    await router.replace({ query })
    await lista.recargar()
})

onMounted(() => {
    void lista.recargar()
})
</script>

<template>
    <PanelPagina
        id="bonificaciones"
        titulo="Bonificaciones"
        icono="i-lucide-hand-heart"
    >
        <template #acciones>
            <UButton
                v-if="enlace('/reportes/bonificaciones')"
                :to="enlace('/reportes/bonificaciones')"
                icon="i-lucide-chart-column"
                label="Reporte"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div class="flex flex-col gap-4">
            <UAlert
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                description="Un periodo regalado o un cargo sin costo no es una factura de Q 0.00: queda como bonificación, con su motivo y el valor bruto que no se cobró (asiento interno 5.1.01 / ingreso, sin IVA ni DTE)."
            />
            <div class="grid gap-3 sm:grid-cols-3">
                <USelect
                    v-model="origen"
                    :items="itemsOrigen"
                    aria-label="Origen"
                    class="w-full"
                    data-prueba="filtro-origen-bonificacion"
                />
                <UInput
                    v-model="desde"
                    type="date"
                    aria-label="Desde"
                    class="w-full"
                />
                <UInput
                    v-model="hasta"
                    type="date"
                    aria-label="Hasta"
                    class="w-full"
                />
            </div>
            <div
                v-if="clienteId || servicioId"
                class="flex flex-wrap items-center gap-2 text-sm text-muted"
            >
                <UBadge
                    :label="servicioId ? `Servicio #${servicioId}` : nombres.nombre(clienteId ?? 0)"
                    color="neutral"
                    variant="subtle"
                />
                <UButton
                    to="/bonificaciones"
                    label="Ver todas"
                    color="neutral"
                    variant="link"
                    size="sm"
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
                    data-prueba="tabla-bonificaciones"
                >
                    <template #periodo-cell="{ row }">
                        <div class="flex min-w-0 flex-col">
                            <ULink
                                :to="`/bonificaciones/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                {{ periodoBonificacion(row.original) }}
                            </ULink>
                            <span class="text-xs text-muted">{{ row.original.concepto }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ origenBonificacionVisual(row.original.origen).etiqueta }}</span>
                        </div>
                    </template>
                    <template #cliente_id-cell="{ row }">
                        <div class="flex min-w-0 flex-col">
                            <ULink
                                v-if="enlace(`/clientes/${row.original.cliente_id}`)"
                                :to="enlace(`/clientes/${row.original.cliente_id}`)"
                                class="text-sm hover:text-primary"
                            >
                                {{ nombres.nombre(row.original.cliente_id) }}
                            </ULink>
                            <span
                                v-else
                                class="text-sm"
                            >{{ nombres.nombre(row.original.cliente_id) }}</span>
                            <span class="text-xs text-muted">{{ row.original.motivo_nombre }}</span>
                        </div>
                    </template>
                    <template #origen-cell="{ row }">
                        <UBadge
                            :label="origenBonificacionVisual(row.original.origen).etiqueta"
                            :icon="origenBonificacionVisual(row.original.origen).icono"
                            :color="origenBonificacionVisual(row.original.origen).color"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #bruto-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearQuetzales(row.original.bruto) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-hand-heart"
                            title="Sin bonificaciones"
                            description="No hay periodos regalados ni cargos sin costo con estos filtros."
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
