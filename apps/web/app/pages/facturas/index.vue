<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn, TabsItem } from '@nuxt/ui'
import { h } from 'vue'

const { enlace, puede } = usePermisos()
const toast = useToast()

/**
 * Facturas (tablero OperFacturas): todo lo emitido con su estado de cobro y de factura electrónica.
 * Pestañas por estado dentro de la tarjeta, buscador por cliente, periodo y «Más filtros» (servicio
 * y estado exacto); a la derecha la factura abierta con total, saldo, impresión y Cobrar. «Generar
 * las del mes» emite todo lo pendiente hasta hoy (`facturas.generar`); el corte sigue en «⋯».
 */

definePageMeta({ permiso: 'facturas.ver' })

useHead({ title: 'Facturas · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const nombres = useNombresClientes()
const { empresaId: empresaActivaId } = useEmpresaActiva()

/** «Nueva factura» (antes «Cargo único»): panel lateral que primero pide el cliente. */
const nuevaAbierta = ref(false)
const puedeNueva = computed(() => puede('facturas.emitir_cargo_unico'))

async function alEmitirNueva(resultado: CargoUnicoEmitido, siguiente: { cobrar: boolean, clienteId: number }) {
    if (resultado.documento === 'bonificacion' && resultado.bonificacion) {
        toast.add({ title: 'Bonificación registrada', description: `Sin costo: ${formatearQuetzales(resultado.bonificacion.bruto)} · ${resultado.bonificacion.motivo_nombre}`, icon: 'i-lucide-hand-heart', color: 'success' })
        await navigateTo(`/bonificaciones/${resultado.bonificacion.id}`)
        return
    }
    if (resultado.factura) {
        toast.add({ title: 'Factura emitida', description: `Factura #${resultado.factura.id} por ${formatearQuetzales(resultado.factura.total)}`, icon: 'i-lucide-receipt', color: 'success' })
        await navigateTo(siguiente.cobrar ? `/cobro?cliente=${siguiente.clienteId}` : `/facturas/${resultado.factura.id}`)
    }
}

/** Valor de los `USelect` para "sin filtro" (Reka UI no admite `''`). */
const TODOS = 'todos'

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function idQuery(valor: unknown): number {
    const id = Number(textoQuery(valor))
    return Number.isInteger(id) && id > 0 ? id : 0
}

function estadoQuery(valor: unknown): EstadoFactura | typeof TODOS {
    const texto = textoQuery(valor)
    return texto in ESTADOS_FACTURA ? (texto as EstadoFactura) : TODOS
}

const estado = ref<EstadoFactura | typeof TODOS>(estadoQuery(route.query.estado))
/** Factura abierta a la derecha (`?id=`). */
const seleccionada = ref(idQuery(route.query.id))
/** «Más filtros»: servicio del cliente y estado exacto (castigada, acreditada). */
const filtrosAbiertos = ref(textoQuery(route.query.servicio) !== '')

/** Pestañas del tablero: cada una es un estado de la API («Pendientes» = emitidas sin vencer). */
const pestanas: TabsItem[] = [
    { label: 'Todas', value: TODOS },
    { label: 'Pendientes', value: 'emitida' },
    { label: 'Abonadas', value: 'parcial' },
    { label: 'Vencidas', value: 'vencida', icon: 'i-lucide-triangle-alert' },
    { label: 'Pagadas', value: 'pagada' },
    { label: 'Por certificar', value: 'por_certificar' },
    { label: 'Anuladas', value: 'anulada' },
]
const clienteId = ref(idQuery(route.query.cliente))
const servicioId = ref(textoQuery(route.query.servicio) || TODOS)
const periodo = ref(/^\d{4}-\d{2}-01$/.test(textoQuery(route.query.periodo)) ? textoQuery(route.query.periodo) : TODOS)
const clienteElegido = shallowRef<Cliente | null>(null)
const serviciosCliente = shallowRef<Servicio[]>([])

const itemsEstado: SelectItem[] = [
    { label: 'Todos los estados', value: TODOS },
    ...Object.entries(ESTADOS_FACTURA).map(([valor, datos]) => ({ label: datos.etiqueta, value: valor })),
]

const itemsPeriodo = computed<SelectItem[]>(() => {
    const periodos = periodosRecientes(hoyGuatemala(), 12)
    if (periodo.value !== TODOS && !periodos.includes(periodo.value)) {
        periodos.push(periodo.value)
    }
    return [
        { label: 'Todos los periodos', value: TODOS },
        ...periodos.map(p => ({ label: etiquetaPeriodo(p), value: p })),
    ]
})

const itemsServicio = computed<SelectItem[]>(() => {
    const items: SelectItem[] = [{ label: 'Todos los servicios', value: TODOS }]
    items.push(...serviciosCliente.value.map(s => ({ label: etiquetaServicio(s), value: String(s.id) })))
    if (servicioId.value !== TODOS && !serviciosCliente.value.some(s => String(s.id) === servicioId.value)) {
        items.push({ label: `Servicio #${servicioId.value}`, value: servicioId.value })
    }
    return items
})

function filtros(): FiltrosFacturas {
    const resultado: FiltrosFacturas = {}
    if (estado.value !== TODOS) {
        resultado.estado = estado.value
    }
    if (clienteId.value) {
        resultado.cliente_id = clienteId.value
    }
    if (servicioId.value !== TODOS) {
        resultado.servicio_id = Number(servicioId.value)
    }
    if (periodo.value !== TODOS) {
        resultado.periodo = periodo.value
    }
    return resultado
}

const lista = usePaginacionCursor(cursor => useFacturas().listar(filtros(), cursor))

watch(lista.filas, filas => void nombres.cargar(filas.map(f => f.cliente_id)))

const columnas: TableColumn<Factura>[] = [
    { accessorKey: 'cliente_id', header: 'Cliente y servicio' },
    { accessorKey: 'id', header: 'Número', meta: SOLO_ANCHO },
    { accessorKey: 'periodo', header: 'Concepto', meta: { class: { th: 'max-2xl:hidden', td: 'max-2xl:hidden' } } },
    { accessorKey: 'vence_en', header: 'Vence', meta: { class: { th: 'max-xl:hidden', td: 'max-xl:hidden' } } },
    { accessorKey: 'total', header: 'Total', meta: { class: { th: 'text-right max-sm:hidden', td: 'text-right max-sm:hidden' } } },
    { id: 'pendiente', header: 'Saldo', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'estado', header: 'Estado', meta: { class: { th: 'max-sm:hidden', td: 'max-sm:hidden' } } },
    { id: 'acciones', header: () => h('span', { class: 'sr-only' }, 'Acciones'), meta: { class: { td: 'w-0 text-end', th: 'w-0' } } },
]

const facturaAbierta = computed(() => lista.filas.value.find(f => f.id === seleccionada.value) ?? null)
const metaTabla = metaFilaElegida<Factura>(fila => fila.id === seleccionada.value)
const hoy = hoyGuatemala()

/** Estado a la vista: la vencida con saldo cuenta como vencida aunque el cron no haya pasado. */
function estadoVisible(factura: Factura): EstadoFactura {
    return diasVencidaFactura(factura, hoy) > 0 ? 'vencida' : factura.estado
}

/** Concepto corto: el periodo, o «Factura manual · …» (la de «Nueva factura») y la mora con su etiqueta. */
function concepto(factura: Factura): string {
    if (factura.cargo_unico) {
        return `Factura manual · ${factura.cargo_unico}`
    }
    const tipo = tipoFacturaVisual(factura.tipo)
    return tipo ? `${tipo.etiqueta} · ${etiquetaPeriodo(factura.periodo)}` : etiquetaPeriodo(factura.periodo)
}

/** Lo que dice la factura electrónica bajo el número. */
function textoFel(factura: Factura): string {
    if (factura.fel_estado === 'certificado') {
        return factura.estado === 'anulada' ? 'Anulada en SAT' : 'Certificada'
    }
    if (factura.fel_error) {
        return `Rechazada: ${factura.fel_error}`
    }
    const dte = estadoDteDe(factura.fel_estado)
    return dte ? ESTADOS_DTE[dte].etiqueta : (factura.aviso_cobro ? 'Aviso sin DTE' : 'Sin DTE')
}

function abrir(factura: Factura) {
    if (!esEscritorio()) {
        void navigateTo(`/facturas/${factura.id}`)
        return
    }
    seleccionada.value = factura.id
}

function alElegirFila(_evento: Event, fila: { original: Factura }) {
    abrir(fila.original)
}

function accionesFactura(factura: Factura): AccionFila[] {
    const acciones: AccionFila[] = [
        { etiqueta: 'Abrir factura', icono: ICONOS.abrir, to: `/facturas/${factura.id}`, soloMenu: true, grupo: 'Ver' },
    ]
    if (puede('clientes.ver')) {
        acciones.push({ etiqueta: 'Ficha del cliente', icono: 'i-lucide-user', to: `/clientes/${factura.cliente_id}?tab=cuenta`, soloMenu: true, grupo: 'Ver' })
    }
    if (puede('pagos.registrar') && saldoFactura(factura).gt(0) && factura.estado !== 'anulada' && factura.estado !== 'por_certificar') {
        acciones.push({ etiqueta: 'Cobrar', icono: ICONOS.cobrar, to: `/cobro?cliente=${factura.cliente_id}`, soloMenu: true, grupo: 'Cobro' })
    }
    return acciones
}

const menuFila = useMenuFila(accionesFactura)

/** «Generar las del mes»: `POST /facturas/generar`, todo lo pendiente hasta hoy (como el cron). */
const generando = ref(false)
const problemaGenerar = ref<Problem | null>(null)

async function generarDelMes() {
    generando.value = true
    problemaGenerar.value = null
    const resultado = await useFacturas().generar(nuevaClaveIdempotencia())
    generando.value = false
    if (!resultado.ok) {
        problemaGenerar.value = resultado.problema
        return
    }
    toast.add({ title: 'Facturas generadas', description: [`${resultado.data.generadas} nuevas`, `${resultado.data.omitidas} ya existían`, resultado.data.errores ? `${resultado.data.errores} con error` : null, resultado.data.bloqueados ? `${resultado.data.bloqueados} detenidas por el bloqueo del libro` : null].filter(Boolean).join(' · '), icon: 'i-lucide-zap', color: 'success' })
    void lista.recargar()
}

const hayFiltros = computed(() => estado.value !== TODOS || clienteId.value !== 0 || servicioId.value !== TODOS || periodo.value !== TODOS)

async function cargarServiciosCliente() {
    serviciosCliente.value = []
    if (!clienteId.value || !puede('servicios.ver')) {
        return
    }
    const resultado = await useServicios().listar({ cliente_id: clienteId.value })
    serviciosCliente.value = resultado.ok ? resultado.data.data : []
}

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (estado.value !== TODOS) {
        query.estado = estado.value
    }
    if (clienteId.value) {
        query.cliente = String(clienteId.value)
    }
    if (servicioId.value !== TODOS) {
        query.servicio = servicioId.value
    }
    if (periodo.value !== TODOS) {
        query.periodo = periodo.value
    }
    if (seleccionada.value) {
        query.id = String(seleccionada.value)
    }
    await router.replace({ query })
    await lista.recargar()
    asegurarSeleccion()
}

function asegurarSeleccion() {
    if (esEscritorio() && !lista.filas.value.some(f => f.id === seleccionada.value)) {
        seleccionada.value = lista.filas.value[0]?.id ?? 0
    }
}

function limpiarFiltros() {
    estado.value = TODOS
    clienteId.value = 0
    clienteElegido.value = null
    servicioId.value = TODOS
    periodo.value = TODOS
}

function alElegirCliente(cliente: Cliente) {
    clienteElegido.value = cliente
    nombres.recordar(cliente.id, cliente.nombre)
}

watch(clienteId, (nuevo, anterior) => {
    // Otro cliente: el servicio elegido ya no es suyo.
    if (anterior && nuevo !== anterior) {
        servicioId.value = TODOS
    }
    void cargarServiciosCliente()
})
watch([estado, clienteId, servicioId, periodo], aplicarFiltros)

watch(seleccionada, (id) => {
    if (id && String(id) !== route.query.id) {
        void router.replace({ query: { ...route.query, id: String(id) } })
    }
})

onMounted(async () => {
    void lista.recargar().then(asegurarSeleccion)
    if (clienteId.value) {
        void cargarServiciosCliente()
        // Sin `clientes.ver` el filtro por cliente sigue por id, sin pedir su nombre (revisión de ACL).
        const resultado = puede('clientes.ver') ? await useClientes().ver(clienteId.value) : null
        if (resultado?.ok) {
            alElegirCliente(resultado.data)
        }
    }
})
</script>

<template>
    <PanelPagina
        id="facturas"
        titulo="Facturas"
        icono="i-lucide-receipt-text"
        descripcion="Todo lo emitido, con su estado de cobro y de factura electrónica"
    >
        <template #acciones>
            <CorteAhoraBoton
                v-if="puede('facturas.generar')"
                class="boton-flotante"
                @hecho="lista.recargar()"
            />
            <UButton
                v-if="servicioId !== TODOS && puede('facturas.emitir_periodos')"
                :to="`/servicios/${servicioId}/facturas-periodo`"
                label="Emitir por periodo"
                icon="i-lucide-calendar"
                color="neutral"
                variant="outline"
                size="lg"
                class="boton-flotante"
            />
            <UButton
                v-if="puedeNueva"
                label="Nueva factura"
                icon="i-lucide-plus"
                size="lg"
                class="glow-brand rounded-full px-5"
                data-prueba="nueva-factura"
                @click="nuevaAbierta = true"
            />
            <UButton
                v-if="puede('facturas.generar')"
                label="Generar las del mes"
                icon="i-lucide-zap"
                :color="puedeNueva ? 'neutral' : 'primary'"
                :variant="puedeNueva ? 'outline' : 'solid'"
                size="lg"
                :class="puedeNueva ? 'boton-flotante' : 'glow-brand px-5'"
                :loading="generando"
                data-prueba="generar-del-mes"
                @click="generarDelMes"
            />
        </template>

        <FacturaNuevaPanel
            v-if="puedeNueva && puede('facturas.ver')"
            v-model:open="nuevaAbierta"
            :empresa-id="empresaActivaId"
            @hecho="alEmitirNueva"
        />

        <div class="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
            <ProblemaAlerta
                v-if="problemaGenerar"
                :problema="problemaGenerar"
                :reintentar="generarDelMes"
                :reintentando="generando"
            />

            <div class="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]">
                <section class="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.375rem] lg:max-h-[calc(100dvh-11rem)]">
                    <div class="flex flex-col gap-3 border-b border-(--ax-borde) p-3 sm:p-4">
                        <OperPestanas
                            v-model="estado"
                            :items="pestanas"
                            etiqueta="Facturas por estado"
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
                                v-model="periodo"
                                :items="itemsPeriodo"
                                icon="i-lucide-calendar"
                                aria-label="Filtrar por periodo"
                                class="w-full sm:w-52"
                            />
                            <UButton
                                icon="i-lucide-filter"
                                label="Más filtros"
                                color="neutral"
                                :variant="filtrosAbiertos ? 'subtle' : 'outline'"
                                :aria-expanded="filtrosAbiertos"
                                aria-controls="filtros-facturas"
                                data-prueba="mas-filtros"
                                @click="filtrosAbiertos = !filtrosAbiertos"
                            />
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
                            id="filtros-facturas"
                            class="grid gap-3 rounded-xl bg-(--ax-panel) p-3 sm:grid-cols-2"
                            role="group"
                            aria-label="Más filtros de facturas"
                        >
                            <UFormField
                                label="Servicio"
                                size="sm"
                                :help="!clienteId ? 'Elige primero un cliente' : undefined"
                            >
                                <USelect
                                    v-model="servicioId"
                                    :items="itemsServicio"
                                    icon="i-lucide-wifi"
                                    aria-label="Filtrar por servicio"
                                    :disabled="!clienteId && servicioId === TODOS"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Estado exacto"
                                size="sm"
                            >
                                <USelect
                                    v-model="estado"
                                    :items="itemsEstado"
                                    icon="i-lucide-activity"
                                    aria-label="Filtrar por estado"
                                    class="w-full"
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
                            <UContextMenu :items="menuFila.items.value">
                                <UTable
                                    :data="lista.filas.value"
                                    :columns="columnas"
                                    :loading="lista.cargando.value"
                                    :meta="metaTabla"
                                    sticky
                                    :ui="{ root: 'rounded-none bg-transparent ring-0 shadow-none dark:shadow-none', td: 'py-3' }"
                                    data-menu-contextual
                                    @select="alElegirFila"
                                    @contextmenu="menuFila.alContextmenu"
                                >
                                    <template #cliente_id-cell="{ row }">
                                        <div class="flex min-w-36 flex-col">
                                            <span class="font-semibold text-highlighted">{{ nombres.nombre(row.original.cliente_id) }}</span>
                                            <span class="text-xs text-muted">
                                                <template v-if="row.original.servicio_id">Servicio {{ row.original.servicio_id }}</template>
                                                <template v-else>Sin servicio</template>
                                                <span class="sm:hidden"> · {{ numeroFactura(row.original) }}</span>
                                            </span>
                                        </div>
                                    </template>

                                    <template #id-cell="{ row }">
                                        <div class="flex max-w-40 flex-col">
                                            <ULink
                                                :to="`/facturas/${row.original.id}`"
                                                class="font-mono text-sm text-highlighted hover:text-primary"
                                                :aria-label="`Factura #${row.original.id}`"
                                                @click.stop
                                            >
                                                {{ numeroFactura(row.original) }}
                                            </ULink>
                                            <span
                                                class="truncate text-xs text-muted"
                                                :title="textoFel(row.original)"
                                            >{{ textoFel(row.original) }}</span>
                                            <UBadge
                                                v-if="row.original.sustituida_por"
                                                :label="`Sustituida por #${row.original.sustituida_por}`"
                                                icon="i-lucide-replace"
                                                color="neutral"
                                                variant="outline"
                                                size="sm"
                                                class="mt-1 self-start"
                                            />
                                        </div>
                                    </template>

                                    <template #periodo-cell="{ row }">
                                        <span
                                            class="block max-w-44 truncate text-sm"
                                            :data-tipo="row.original.tipo"
                                        >{{ concepto(row.original) }}</span>
                                    </template>

                                    <template #vence_en-cell="{ row }">
                                        <span class="text-sm whitespace-nowrap">{{ formatearFecha(row.original.vence_en) }}</span>
                                    </template>

                                    <template #total-cell="{ row }">
                                        <span class="whitespace-nowrap tabular-nums">{{ formatearQuetzales(row.original.total) }}</span>
                                    </template>

                                    <template #pendiente-cell="{ row }">
                                        <span
                                            v-if="row.original.estado === 'por_certificar'"
                                            class="text-xs text-muted"
                                            title="Por certificar: todavía no es deuda"
                                        >No es deuda aún</span>
                                        <span
                                            v-else
                                            class="font-bold whitespace-nowrap tabular-nums text-highlighted"
                                        >{{ row.original.estado === 'anulada' ? '—' : formatearQuetzales(saldoFactura(row.original)) }}</span>
                                        <EstadoFacturaBadge
                                            :estado="estadoVisible(row.original)"
                                            size="sm"
                                            class="mt-1 sm:hidden"
                                        />
                                    </template>

                                    <template #estado-cell="{ row }">
                                        <EstadoFacturaBadge
                                            :estado="estadoVisible(row.original)"
                                            size="sm"
                                        />
                                    </template>

                                    <template #acciones-cell="{ row }">
                                        <UDropdownMenu
                                            :items="menuFila.itemsDe(row.original)"
                                            :content="{ align: 'end' }"
                                        >
                                            <UButton
                                                icon="i-lucide-ellipsis"
                                                color="neutral"
                                                variant="ghost"
                                                size="sm"
                                                :aria-label="`Más acciones: factura ${numeroFactura(row.original)}`"
                                                @click.stop
                                            />
                                        </UDropdownMenu>
                                    </template>

                                    <template #empty>
                                        <UEmpty
                                            icon="i-lucide-search-x"
                                            :title="hayFiltros ? 'Ninguna factura coincide' : 'Todavía no hay facturas'"
                                            :description="hayFiltros ? 'Prueba con otro estado, cliente o periodo.' : undefined"
                                            variant="naked"
                                        />
                                    </template>
                                </UTable>
                            </UContextMenu>
                        </div>

                        <div class="border-t border-(--ax-borde) px-4 py-2">
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
                </section>

                <!-- La factura abierta (escritorio). -->
                <OperPanelLateral
                    v-if="facturaAbierta"
                    :titulo="numeroFactura(facturaAbierta)"
                    :subtitulo="`${nombres.nombre(facturaAbierta.cliente_id)} · ${etiquetaPeriodo(facturaAbierta.periodo)}`"
                    icono="i-lucide-receipt-text"
                    titulo-mono
                    class="hidden lg:flex lg:max-h-[calc(100dvh-11rem)]"
                    data-prueba="detalle-factura"
                >
                    <template #insignia>
                        <EstadoFacturaBadge :estado="estadoVisible(facturaAbierta)" />
                    </template>

                    <div class="grid grid-cols-2 gap-2">
                        <div class="rounded-xl bg-(--ax-panel) p-3">
                            <p class="text-xs text-muted">
                                Total
                            </p>
                            <p class="text-xl font-bold tabular-nums text-highlighted">
                                {{ formatearQuetzales(facturaAbierta.total) }}
                            </p>
                        </div>
                        <div class="rounded-xl bg-(--ax-panel) p-3">
                            <p class="text-xs text-muted">
                                Saldo
                            </p>
                            <p
                                class="text-xl font-bold tabular-nums"
                                :class="saldoFactura(facturaAbierta).gt(0) && facturaAbierta.estado !== 'anulada' ? 'text-error' : 'text-highlighted'"
                            >
                                {{ facturaAbierta.estado === 'anulada' ? '—' : formatearQuetzales(saldoFactura(facturaAbierta)) }}
                            </p>
                        </div>
                    </div>

                    <dl class="flex flex-col divide-y divide-(--ax-borde) text-sm">
                        <div class="flex justify-between gap-3 py-2">
                            <dt class="text-muted">
                                Servicio
                            </dt>
                            <dd class="font-mono text-highlighted">
                                <ULink
                                    v-if="facturaAbierta.servicio_id"
                                    :to="enlace(`/servicios/${facturaAbierta.servicio_id}`)"
                                    class="hover:text-primary"
                                >
                                    {{ facturaAbierta.servicio_id }}
                                </ULink>
                                <template v-else>
                                    —
                                </template>
                            </dd>
                        </div>
                        <div class="flex justify-between gap-3 py-2">
                            <dt class="text-muted">
                                Emitida / vence
                            </dt>
                            <dd class="text-highlighted">
                                {{ formatearFecha(facturaAbierta.emitida_en) }} / {{ formatearFecha(facturaAbierta.vence_en) }}
                            </dd>
                        </div>
                        <div class="flex items-center justify-between gap-3 py-2">
                            <dt class="text-muted">
                                Factura electrónica
                            </dt>
                            <dd>
                                <EstadoDteBadge
                                    v-if="estadoDteDe(facturaAbierta.fel_estado)"
                                    :estado="estadoDteDe(facturaAbierta.fel_estado) ?? 'pendiente'"
                                    size="sm"
                                />
                                <span
                                    v-else
                                    class="text-xs text-muted"
                                >{{ facturaAbierta.aviso_cobro ? 'Aviso sin DTE' : 'Sin DTE' }}</span>
                            </dd>
                        </div>
                    </dl>

                    <section class="flex flex-col gap-2">
                        <h3 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                            Imprimir
                        </h3>
                        <FacturaImpresion
                            :factura-id="facturaAbierta.id"
                            compacta
                        />
                    </section>

                    <template #pie>
                        <UButton
                            :to="`/facturas/${facturaAbierta.id}`"
                            label="Abrir factura"
                            :icon="ICONOS.abrir"
                            color="neutral"
                            variant="outline"
                            class="flex-1 justify-center"
                        />
                        <UButton
                            v-if="puede('pagos.registrar') && saldoFactura(facturaAbierta).gt(0) && !['anulada', 'por_certificar'].includes(facturaAbierta.estado)"
                            :to="`/cobro?cliente=${facturaAbierta.cliente_id}`"
                            label="Cobrar"
                            :icon="ICONOS.cobrar"
                            color="success"
                            class="flex-1 justify-center"
                        />
                    </template>
                </OperPanelLateral>
                <div
                    v-else
                    class="surface-card hidden items-center justify-center rounded-[1.375rem] p-6 lg:flex"
                >
                    <UEmpty
                        icon="i-lucide-mouse-pointer-click"
                        title="Elige una factura"
                        description="Aquí ves su total, saldo y cómo imprimirla."
                        variant="naked"
                    />
                </div>
            </div>
        </div>
    </PanelPagina>
</template>
