<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'
import { h } from 'vue'

/**
 * Cartera (tablero ContaCartera; A3, fase 4 §10.9): lo que deben los clientes por antigüedad (reporte
 * de cartera vencida por cliente), estimaciones de incobrables por año y castigos de facturas con su
 * motivo y evidencia. Provisionar (`cartera.provisionar`) y castigar (`cartera.castigar`) piden
 * confirmación escrita. El estado de cada factura castigada se lee de la API, tal cual.
 */
definePageMeta({ permiso: 'reportes.ver' })

useHead({ title: 'Cartera · ArgosIsp' })

const toast = useToast()
const { puede, enlace } = usePermisos()

const provisiones = usePaginacionCursor(cursor => useCartera().provisiones(cursor))
const castigos = usePaginacionCursor(cursor => useCartera().castigos(cursor))

/** Estado actual de cada factura castigada (`GET /facturas/:id`); sin `facturas.ver` no se muestra. */
const estadosFactura = ref<Record<number, EstadoFactura>>({})
const ultimoCastigo = shallowRef<CastigoCartera | null>(null)

const provisionando = ref(false)
const castigando = ref(false)

const columnasProvisiones: TableColumn<ProvisionCartera>[] = [
    { accessorKey: 'anio', header: 'Año' },
    { accessorKey: 'base', header: 'Saldos deudores', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'tope', header: 'Tope', meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { accessorKey: 'saldo_anterior', header: 'Ya estimado', meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { accessorKey: 'monto', header: 'Registrado', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const columnasCastigos: TableColumn<CastigoCartera>[] = [
    { accessorKey: 'cliente_nombre', header: 'Castigo' },
    { accessorKey: 'estimacion', header: 'De la estimación', meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { accessorKey: 'gasto', header: 'Al gasto', meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

async function leerEstados(lista: readonly CastigoCartera[]) {
    if (!puede('facturas.ver')) {
        return
    }
    const ids = [...new Set(lista.flatMap(c => c.facturas.map(f => f.factura_id)))].filter(id => !(id in estadosFactura.value)).slice(0, 50)
    const leidas = await Promise.all(ids.map(id => useFacturas().ver(id)))
    const nuevos: Record<number, EstadoFactura> = {}
    leidas.forEach((resultado) => {
        if (resultado.ok) {
            nuevos[resultado.data.id] = resultado.data.estado
        }
    })
    estadosFactura.value = { ...estadosFactura.value, ...nuevos }
}

async function recargarCastigos() {
    await castigos.recargar()
    await leerEstados(castigos.filas.value)
}

function alProvisionar(provision: ProvisionCartera) {
    toast.add({
        title: `Estimación ${provision.anio} registrada`,
        description: new Decimal(provision.monto).isZero()
            ? `Ya estaba en el tope (${formatearQuetzales(provision.tope)}): se registró en cero.`
            : `${formatearQuetzales(provision.monto)} hasta el tope de ${formatearQuetzales(provision.tope)}`,
        icon: 'i-lucide-shield-alert',
        color: 'success',
    })
    void provisiones.recargar()
}

async function alCastigar(castigo: CastigoCartera) {
    // El estado de las facturas castigadas se vuelve a leer: lo decide la API.
    const ids = new Set(castigo.facturas.map(f => f.factura_id))
    estadosFactura.value = Object.fromEntries(Object.entries(estadosFactura.value).filter(([id]) => !ids.has(Number(id))))
    ultimoCastigo.value = castigo
    toast.add({ title: `Castigo #${castigo.id} registrado`, description: `${castigo.cliente_nombre} · ${formatearQuetzales(castigo.monto)}`, icon: 'i-lucide-file-x', color: 'success' })
    await leerEstados([castigo])
    void recargarCastigos()
}

/* Encabezado e indicadores (tablero ContaCartera). */
const { eleccion, empresas } = useEmpresaActiva()
const resumen = shallowRef<ResumenDashboard | null>(null)
const problemaResumen = ref<Problem | null>(null)

async function cargarResumen() {
    const r = await useReportes().resumenDashboard()
    resumen.value = r.ok ? r.data : null
    problemaResumen.value = r.ok ? null : r.problema
}

type FilaPorCobrar = RespuestaReporte<'cartera-vencida'>['filas'][number]
const porCobrar = shallowRef<RespuestaReporte<'cartera-vencida'> | null>(null)
const problemaPorCobrar = ref<Problem | null>(null)

async function cargarPorCobrar() {
    const r = await useReportes().reporte('cartera-vencida', { corte: hoyGuatemala(), agrupar_cartera: 'cliente' })
    porCobrar.value = r.ok ? r.data : null
    problemaPorCobrar.value = r.ok ? null : r.problema
}

const estimacion = ref<string | null>(null)
const problemaEstimacion = ref<Problem | null>(null)

async function cargarEstimacion() {
    if (!puede('libro.ver')) {
        return
    }
    const r = await useLibro().balance(hoyGuatemala())
    if (!r.ok) {
        problemaEstimacion.value = r.problema
        return
    }
    problemaEstimacion.value = null
    const saldo = r.data.empresas.flatMap(e => e.cuentas).filter(c => c.codigo === '1.1.12' || c.codigo.startsWith('1.1.12.')).reduce((suma, c) => suma.plus(c.saldo), new Decimal(0))
    estimacion.value = formatearQuetzales(saldo.abs())
}

/** Castigado en el año: solo si todos los castigos caben en la página leída (si no, no se suma a medias). */
const castigadoAnio = computed(() => {
    if (castigos.cargando.value || castigos.haySiguiente.value || castigos.problema.value) {
        return null
    }
    const anio = hoyGuatemala().slice(0, 4)
    const delAnio = castigos.filas.value.filter(c => c.fecha.startsWith(anio))
    return { cantidad: delAnio.length, monto: delAnio.reduce((suma, c) => suma.plus(c.monto), new Decimal(0)) }
})

const descripcion = computed(() => {
    const quien = eleccion.value === 'todas' ? 'Todas las empresas' : empresas.value.find(e => e.id === eleccion.value)?.nombre_comercial
    const t = porCobrar.value?.totales
    return [quien, t?.vencido ? `${formatearQuetzales(String(t.vencido))} vencidos` : null].filter(Boolean).join(' · ') || undefined
})

/** Tramos vencidos de los totales; null si falta algún monto (se muestra «—», nunca un 0). */
const tramosPorCobrar = computed(() => (porCobrar.value ? tramosCartera(porCobrar.value.totales, false) : null))

/* Pestañas y la lista por cobrar. */
const route = useRoute()
const pestana = ref(['castigos', 'estimacion'].includes(String(route.query.tab)) ? String(route.query.tab) : 'cobrar')
const pestanas: PestanaConta[] = [
    { label: 'Por cobrar', value: 'cobrar', icon: 'i-lucide-clock' },
    { label: 'Castigos', value: 'castigos', icon: 'i-lucide-triangle-alert' },
    { label: 'Estimación', value: 'estimacion', icon: 'i-lucide-shield' },
]

const busqueda = ref('')
const antiguedad = ref<'todo' | '30' | '60' | '90'>('todo')
const itemsAntiguedad = [
    { label: 'Antigüedad: toda', value: 'todo' },
    { label: 'Más de 30 días', value: '30' },
    { label: 'Más de 60 días', value: '60' },
    { label: 'Más de 90 días', value: '90' },
]

const filasPorCobrar = computed<FilaPorCobrar[]>(() => {
    const q = busqueda.value.trim().toLowerCase()
    return (porCobrar.value?.filas ?? [])
        .filter(f => new Decimal(f.vencido).gt(0))
        .filter(f => !q || f.grupo.toLowerCase().includes(q))
        .filter((f) => {
            if (antiguedad.value === '30') {
                return new Decimal(f.dias_31_60).plus(f.dias_61_90).plus(f.dias_mas_90).gt(0)
            }
            if (antiguedad.value === '60') {
                return new Decimal(f.dias_61_90).plus(f.dias_mas_90).gt(0)
            }
            if (antiguedad.value === '90') {
                return new Decimal(f.dias_mas_90).gt(0)
            }
            return true
        })
        .sort((a, b) => new Decimal(b.vencido).comparedTo(a.vencido))
})

const montoCelda = (clave: 'dias_0_30' | 'dias_31_60' | 'dias_61_90' | 'dias_mas_90' | 'vencido') => ({ row }: { row: { original: FilaPorCobrar } }) => {
    const valor = new Decimal(row.original[clave])
    return h('span', { class: ['tabular-nums', valor.isZero() ? 'text-dimmed' : clave === 'dias_mas_90' ? 'font-semibold text-error' : clave === 'vencido' ? 'font-semibold text-highlighted' : ''] }, valor.toFixed(2))
}

const columnasPorCobrar: TableColumn<FilaPorCobrar>[] = [
    { id: 'seleccion', header: '', meta: { class: { td: 'w-0', th: 'w-0' } } },
    { accessorKey: 'grupo', header: 'Cliente' },
    { id: 'd030', header: '0–30', cell: montoCelda('dias_0_30'), meta: { class: { th: 'hidden text-right md:table-cell', td: 'hidden text-right md:table-cell' } } },
    { id: 'd3160', header: '31–60', cell: montoCelda('dias_31_60'), meta: { class: { th: 'hidden text-right md:table-cell', td: 'hidden text-right md:table-cell' } } },
    { id: 'd6190', header: '61–90', cell: montoCelda('dias_61_90'), meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { id: 'd90', header: 'Más de 90', cell: montoCelda('dias_mas_90'), meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { id: 'vencido', header: 'Vencido (Q)', cell: montoCelda('vencido'), meta: { class: { th: 'text-right', td: 'text-right' } } },
    { id: 'acciones', header: '', meta: { class: { td: 'w-0 text-end', th: 'w-0' } } },
]

const seleccion = ref<Record<string, boolean>>({})
const elegidos = computed(() => filasPorCobrar.value.filter(f => seleccion.value[String(f.grupo_id ?? f.grupo)]))
const elegidosFacturas = computed(() => elegidos.value.reduce((n, f) => n + f.facturas, 0))
const elegidosMonto = computed(() => elegidos.value.reduce((suma, f) => suma.plus(f.vencido), new Decimal(0)))

function accionesCliente(fila: FilaPorCobrar): AccionFila[] {
    if (!fila.grupo_id) {
        return []
    }
    const acciones: AccionFila[] = []
    if (puede('clientes.ver')) {
        acciones.push({ etiqueta: 'Abrir ficha del cliente', icono: ICONOS.abrir, to: `/clientes/${fila.grupo_id}`, soloMenu: true, grupo: 'Ver' })
        acciones.push({ etiqueta: 'Estado de cuenta', icono: 'i-lucide-receipt-text', to: `/clientes/${fila.grupo_id}?tab=cuenta`, soloMenu: true, grupo: 'Ver' })
    }
    if (puede('pagos.registrar')) {
        acciones.push({ etiqueta: 'Cobrar a este cliente', icono: ICONOS.cobrar, to: `/cobro?cliente=${fila.grupo_id}`, soloMenu: true, grupo: 'Cobro' })
    }
    if (puede('cartera.castigar')) {
        acciones.push({ etiqueta: 'Castigar…', icono: 'i-lucide-triangle-alert', color: 'error', alElegir: () => (castigando.value = true), soloMenu: true })
    }
    return acciones
}

const masAcciones = computed<DropdownMenuItem[]>(() => (puede('cartera.provisionar')
    ? [{ label: 'Registrar la estimación de incobrables', icon: 'i-lucide-shield-alert', onSelect: () => (provisionando.value = true) }]
    : []))

const exportando = ref(false)
async function exportar() {
    exportando.value = true
    const r = await useReportes().descargar('cartera-vencida', { corte: hoyGuatemala(), agrupar_cartera: 'cliente' }, 'xlsx')
    exportando.value = false
    if (!r.ok) {
        toast.add({ title: 'No se pudo exportar la cartera', description: r.problema.detail ?? r.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    const url = URL.createObjectURL(r.data)
    const a = document.createElement('a')
    a.href = url
    a.download = nombreDescarga('cartera-vencida', 'xlsx', hoyGuatemala())
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

onMounted(() => {
    void provisiones.recargar()
    void recargarCastigos()
    void cargarResumen()
    void cargarPorCobrar()
    void cargarEstimacion()
})
</script>

<template>
    <PanelPagina
        id="cartera"
        titulo="Cartera"
        icono="i-lucide-shield-alert"
        :descripcion="descripcion"
    >
        <template #acciones>
            <ContaSelectorEmpresa />
            <UButton
                label="Exportar"
                icon="i-lucide-download"
                color="neutral"
                variant="ghost"
                class="boton-flotante boton-pastilla"
                :loading="exportando"
                data-prueba="exportar-cartera"
                @click="exportar"
            />
            <UDropdownMenu
                v-if="masAcciones.length"
                :items="masAcciones"
                :content="{ align: 'end' }"
            >
                <UButton
                    icon="i-lucide-ellipsis"
                    color="neutral"
                    variant="ghost"
                    class="boton-flotante boton-circulo"
                    aria-label="Más acciones de cartera"
                    data-prueba="mas-cartera"
                />
            </UDropdownMenu>
        </template>

        <ContaCuerpo>
            <!-- Indicadores. -->
            <div
                class="grid gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr]"
                data-prueba="kpis-cartera"
            >
                <div class="surface-card flex min-w-0 flex-col gap-2 rounded-2xl p-4 sm:col-span-2 xl:col-span-1">
                    <span class="text-[0.8125rem] font-medium">Vencido por antigüedad</span>
                    <ProblemaAlerta
                        v-if="problemaPorCobrar"
                        :problema="problemaPorCobrar"
                        :reintentar="cargarPorCobrar"
                    />
                    <USkeleton
                        v-else-if="!porCobrar"
                        class="h-12 w-full"
                    />
                    <p
                        v-else-if="!tramosPorCobrar"
                        class="text-sm text-muted"
                    >
                        —
                    </p>
                    <ContaAntiguedad
                        v-else
                        :tramos="tramosPorCobrar"
                        etiqueta="Vencido por antigüedad"
                        modo="barra"
                    />
                </div>
                <ContaKpi
                    titulo="Con promesa activa"
                    icono="i-lucide-hand"
                    :valor="resumen ? formatearQuetzales(resumen.promesas_activas.monto) : null"
                    :detalle="resumen ? `${resumen.promesas_activas.cantidad} promesas · no se cortan` : undefined"
                    :problema="problemaResumen"
                    @reintentar="cargarResumen"
                />
                <ContaKpi
                    titulo="Castigado este año"
                    icono="i-lucide-triangle-alert"
                    tono="tono-error"
                    :valor="castigadoAnio ? formatearQuetzales(castigadoAnio.monto) : null"
                    :detalle="castigadoAnio ? `${castigadoAnio.cantidad} castigos` : undefined"
                    :sin-api="castigadoAnio === null && !castigos.cargando.value && castigos.haySiguiente.value ? 'Hay más castigos de los que caben en una página: el total del año llega con la API del panel.' : undefined"
                    :problema="castigos.problema.value"
                    @reintentar="recargarCastigos"
                />
                <ContaKpi
                    titulo="Estimación disponible"
                    icono="i-lucide-shield-check"
                    tono="tono-exito"
                    :valor="estimacion"
                    detalle="cuenta 1.1.12 del libro"
                    :problema="problemaEstimacion"
                    :sin-api="puede('libro.ver') ? undefined : 'Necesita permiso para ver el libro.'"
                    ayuda="Lo reservado para cuentas que no se van a cobrar (estimación para incobrables); se calcula al cierre del año."
                    @reintentar="cargarEstimacion"
                />
            </div>

            <UAlert
                v-if="ultimoCastigo"
                color="success"
                variant="subtle"
                icon="i-lucide-file-x"
                :title="`Castigo #${ultimoCastigo.id}: ${ultimoCastigo.cliente_nombre} · ${formatearQuetzales(ultimoCastigo.monto)}`"
                data-prueba="resultado-castigo"
            >
                <template #description>
                    <p class="tabular-nums">
                        De la estimación {{ formatearQuetzales(ultimoCastigo.estimacion) }} · al gasto {{ formatearQuetzales(ultimoCastigo.gasto) }} · IVA por certificar {{ formatearQuetzales(ultimoCastigo.iva) }}
                    </p>
                    <ul class="mt-1 flex flex-wrap gap-2">
                        <li
                            v-for="factura in ultimoCastigo.facturas"
                            :key="factura.factura_id"
                            class="flex items-center gap-1"
                        >
                            <ULink
                                :to="enlace(`/facturas/${factura.factura_id}`)"
                                class="underline"
                            >Factura #{{ factura.factura_id }}</ULink>
                            <EstadoFacturaBadge
                                v-if="estadosFactura[factura.factura_id]"
                                :estado="estadosFactura[factura.factura_id]!"
                                size="sm"
                                :data-estado-factura="factura.factura_id"
                            />
                        </li>
                    </ul>
                </template>
            </UAlert>

            <ContaIsla llenar>
                <template #cabecera>
                    <ContaPestanas
                        v-model="pestana"
                        :items="pestanas"
                        etiqueta="Vistas de la cartera"
                    />
                </template>
                <template
                    v-if="pestana === 'cobrar'"
                    #herramientas
                >
                    <UInput
                        v-model="busqueda"
                        icon="i-lucide-search"
                        placeholder="Cliente…"
                        aria-label="Buscar cliente en la cartera"
                        class="w-full sm:w-56"
                        :ui="{ base: 'rounded-full' }"
                    />
                    <USelect
                        v-model="antiguedad"
                        :items="itemsAntiguedad"
                        icon="i-lucide-clock"
                        aria-label="Antigüedad"
                        class="w-48"
                        :ui="{ base: 'rounded-full' }"
                        data-prueba="filtro-antiguedad"
                    />
                </template>

                <!-- Por cobrar: un cliente por fila con su antigüedad. -->
                <template v-if="pestana === 'cobrar'">
                    <div
                        v-if="problemaPorCobrar"
                        class="p-4"
                    >
                        <ProblemaAlerta
                            :problema="problemaPorCobrar"
                            :reintentar="cargarPorCobrar"
                        />
                    </div>
                    <UTable
                        v-else
                        v-model:row-selection="seleccion"
                        :data="filasPorCobrar"
                        :columns="columnasPorCobrar"
                        :loading="!porCobrar"
                        :get-row-id="(fila: FilaPorCobrar) => String(fila.grupo_id ?? fila.grupo)"
                        sticky
                        :ui="{ td: 'py-3' }"
                        data-prueba="tabla-por-cobrar"
                    >
                        <template #seleccion-header="{ table }">
                            <UCheckbox
                                :model-value="table.getIsSomePageRowsSelected() ? 'indeterminate' : table.getIsAllPageRowsSelected()"
                                aria-label="Elegir todos"
                                @update:model-value="(v: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(!!v)"
                            />
                        </template>
                        <template #seleccion-cell="{ row }">
                            <UCheckbox
                                :model-value="row.getIsSelected()"
                                :aria-label="`Elegir a ${row.original.grupo}`"
                                @update:model-value="(v: boolean | 'indeterminate') => row.toggleSelected(!!v)"
                            />
                        </template>
                        <template #grupo-cell="{ row }">
                            <div class="flex min-w-0 flex-col">
                                <span class="truncate text-sm font-semibold text-highlighted">{{ row.original.grupo }}</span>
                                <span class="text-xs text-muted">{{ row.original.facturas }} {{ row.original.facturas === 1 ? 'factura' : 'facturas' }}</span>
                            </div>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-circle-check"
                                :title="busqueda || antiguedad !== 'todo' ? 'Nadie con esos filtros' : 'Nadie debe nada vencido'"
                                variant="naked"
                            />
                        </template>
                        <template #acciones-cell="{ row }">
                            <ContaMenuFila
                                :acciones="accionesCliente(row.original)"
                                :nombre="row.original.grupo"
                            />
                        </template>
                    </UTable>
                </template>

                <!-- Castigos. -->
                <div
                    v-else-if="pestana === 'castigos'"
                    class="flex flex-col gap-2 p-3 sm:p-4"
                >
                    <ProblemaAlerta
                        v-if="castigos.problema.value"
                        :problema="castigos.problema.value"
                        :reintentar="recargarCastigos"
                        :reintentando="castigos.cargando.value"
                    />
                    <template v-else>
                        <UTable
                            :data="castigos.filas.value"
                            :columns="columnasCastigos"
                            :loading="castigos.cargando.value"
                            data-prueba="tabla-castigos"
                        >
                            <template #cliente_nombre-cell="{ row }">
                                <div class="flex min-w-0 flex-col whitespace-normal">
                                    <ULink
                                        :to="enlace(`/clientes/${row.original.cliente_id}?tab=cuenta`)"
                                        class="text-sm font-medium text-highlighted hover:text-primary"
                                    >
                                        #{{ row.original.id }} · {{ row.original.cliente_nombre }}
                                    </ULink>
                                    <span class="text-xs text-muted">{{ formatearFecha(row.original.fecha) }} · {{ row.original.motivo }}</span>
                                    <span class="text-xs text-dimmed">Gestión: {{ row.original.evidencia }}</span>
                                    <span class="mt-1 flex flex-wrap gap-2">
                                        <span
                                            v-for="factura in row.original.facturas"
                                            :key="factura.factura_id"
                                            class="flex items-center gap-1 text-xs"
                                        >
                                            <ULink
                                                :to="enlace(`/facturas/${factura.factura_id}`)"
                                                class="underline"
                                            >#{{ factura.factura_id }}</ULink>
                                            <EstadoFacturaBadge
                                                v-if="estadosFactura[factura.factura_id]"
                                                :estado="estadosFactura[factura.factura_id]!"
                                                size="sm"
                                            />
                                        </span>
                                    </span>
                                </div>
                            </template>
                            <template #estimacion-cell="{ row }">
                                <span class="tabular-nums">{{ formatearQuetzales(row.original.estimacion) }}</span>
                            </template>
                            <template #gasto-cell="{ row }">
                                <span class="tabular-nums">{{ formatearQuetzales(row.original.gasto) }}</span>
                            </template>
                            <template #monto-cell="{ row }">
                                <div class="flex flex-col items-end">
                                    <span class="tabular-nums font-medium text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                                    <span
                                        v-if="!new Decimal(row.original.iva).isZero()"
                                        class="text-xs text-muted"
                                    >IVA {{ formatearQuetzales(row.original.iva) }}</span>
                                </div>
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-file-x"
                                    title="Sin castigos"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                        <PaginacionCursor
                            :pagina="castigos.pagina.value"
                            :hay-anterior="castigos.hayAnterior.value"
                            :hay-siguiente="castigos.haySiguiente.value"
                            :cargando="castigos.cargando.value"
                            :filas="castigos.filas.value.length"
                            @anterior="castigos.anterior"
                            @siguiente="castigos.siguiente"
                        />
                    </template>
                </div>

                <!-- Estimación de incobrables. -->
                <div
                    v-else
                    class="flex flex-col gap-2 p-3 sm:p-4"
                >
                    <ProblemaAlerta
                        v-if="provisiones.problema.value"
                        :problema="provisiones.problema.value"
                        :reintentar="provisiones.recargar"
                        :reintentando="provisiones.cargando.value"
                    />
                    <template v-else>
                        <UTable
                            :data="provisiones.filas.value"
                            :columns="columnasProvisiones"
                            :loading="provisiones.cargando.value"
                            data-prueba="tabla-provisiones"
                        >
                            <template #anio-cell="{ row }">
                                <div class="flex flex-col">
                                    <span class="text-sm font-medium text-highlighted">{{ row.original.anio }}</span>
                                    <span class="text-xs text-muted">Corte {{ formatearFecha(row.original.fecha) }} · {{ Number(row.original.porcentaje) }} %</span>
                                </div>
                            </template>
                            <template #base-cell="{ row }">
                                <span class="tabular-nums">{{ formatearQuetzales(row.original.base) }}</span>
                            </template>
                            <template #tope-cell="{ row }">
                                <span class="tabular-nums">{{ formatearQuetzales(row.original.tope) }}</span>
                            </template>
                            <template #saldo_anterior-cell="{ row }">
                                <span class="tabular-nums text-muted">{{ formatearQuetzales(row.original.saldo_anterior) }}</span>
                            </template>
                            <template #monto-cell="{ row }">
                                <span class="tabular-nums font-medium text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-shield"
                                    title="Sin estimaciones registradas"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                        <PaginacionCursor
                            :pagina="provisiones.pagina.value"
                            :hay-anterior="provisiones.hayAnterior.value"
                            :hay-siguiente="provisiones.haySiguiente.value"
                            :cargando="provisiones.cargando.value"
                            :filas="provisiones.filas.value.length"
                            @anterior="provisiones.anterior"
                            @siguiente="provisiones.siguiente"
                        />
                    </template>
                </div>

                <template #pie>
                    <template v-if="pestana === 'cobrar' && elegidos.length">
                        <span data-prueba="seleccion-cartera">{{ elegidos.length }} {{ elegidos.length === 1 ? 'cliente elegido' : 'clientes elegidos' }} · {{ elegidosFacturas }} facturas · {{ formatearQuetzales(elegidosMonto) }} vencidos</span>
                    </template>
                    <template v-else-if="pestana === 'cobrar'">
                        Las gestiones de cobro (llamadas y visitas) se anotan aquí y son la prueba para castigar; llegan con su API.
                    </template>
                    <template v-else>
                        Un castigo no se deshace desde el panel: usa primero la estimación (1.1.12) y luego el gasto.
                    </template>
                </template>
                <template
                    v-if="pestana === 'cobrar'"
                    #pie-derecha
                >
                    <span class="flex items-center gap-2">
                        <UButton
                            title="Llega con la API de gestiones de cobro"
                            label="Registrar gestión"
                            icon="i-lucide-phone"
                            color="neutral"
                            variant="outline"
                            class="rounded-full"
                            disabled
                            data-prueba="registrar-gestion"
                        />
                        <UButton
                            v-if="puede('cartera.castigar')"
                            label="Castigar…"
                            icon="i-lucide-triangle-alert"
                            color="error"
                            class="rounded-full max-lg:hidden"
                            data-prueba="abrir-castigo"
                            @click="castigando = true"
                        />
                    </span>
                </template>
            </ContaIsla>
        </ContaCuerpo>

        <CarteraProvisionModal
            v-if="puede('cartera.provisionar')"
            v-model:open="provisionando"
            @hecho="alProvisionar"
        />
        <CarteraCastigoModal
            v-if="puede('cartera.castigar')"
            v-model:open="castigando"
            @hecho="alCastigar"
        />
    </PanelPagina>
</template>
