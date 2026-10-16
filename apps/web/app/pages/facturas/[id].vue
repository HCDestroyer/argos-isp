<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

definePageMeta({ permiso: 'facturas.ver' })

const route = useRoute()
const { puede, enlace } = usePermisos()
const toast = useToast()
const nombres = useNombresClientes()

const facturaId = computed(() => Number(route.params.id))

const factura = shallowRef<FacturaDetalle | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const pagos = shallowRef<Pago[]>([])
const cargandoPagos = ref(false)
const problemaPagos = ref<Problem | null>(null)

const asientos = shallowRef<Asiento[]>([])
const cargandoAsientos = ref(false)
const problemaAsientos = ref<Problem | null>(null)

const anularAbierto = ref(false)
const generandoPdf = ref(false)

/**
 * Abre el PDF del aviso de cobro (`GET /documentos/aviso-cobro/:facturaId`) en otra pestaña. La
 * pestaña se abre antes de pedir el PDF para que el navegador no la bloquee; si falla, se cierra
 * y el error sale en un toast.
 */
async function abrirAvisoPdf() {
    if (!factura.value || generandoPdf.value) {
        return
    }
    const ventana = window.open('', '_blank')
    generandoPdf.value = true
    const resultado = await useDocumentos().avisoCobro(factura.value.id)
    generandoPdf.value = false
    if (!resultado.ok) {
        ventana?.close()
        toast.add({ title: 'No se pudo generar el PDF', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    const url = URL.createObjectURL(resultado.data)
    if (ventana) {
        ventana.location.href = url
    }
    else {
        const enlace = document.createElement('a')
        enlace.href = url
        enlace.download = `aviso-cobro-${factura.value.id}.pdf`
        enlace.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

useHead(() => ({ title: `Factura #${route.params.id} · ArgosIsp` }))

const puedeAnular = computed(() => puede('facturas.anular') && factura.value !== null && factura.value.estado !== 'anulada')

const pendiente = computed(() => (factura.value && factura.value.estado !== 'anulada' ? saldoFactura(factura.value) : null))

const columnasLineas: TableColumn<FacturaLinea>[] = [
    { accessorKey: 'concepto', header: 'Concepto', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'cantidad', header: 'Cant.', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'precio_unitario', header: 'Precio', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'iva', header: 'IVA', meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { accessorKey: 'total', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

interface PagoAplicado {
    pago: Pago
    aplicado: string
}

const pagosAplicados = computed<PagoAplicado[]>(() => pagos.value.map(pago => ({
    pago,
    aplicado: pago.aplicaciones.filter(a => a.factura_id === facturaId.value).reduce((suma, a) => suma.plus(a.monto), new Decimal(0)).toFixed(2),
})))

const columnasPagos: TableColumn<PagoAplicado>[] = [
    { id: 'pago', header: 'Pago' },
    { id: 'metodo', header: 'Método', meta: SOLO_ANCHO },
    { id: 'aplicado', header: 'Aplicado', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { id: 'estado', header: 'Estado' },
]

/** Cantidad con hasta 3 decimales, sin ceros de más (`1.000` → `1`). */
function cantidad(valor: string): string {
    return new Decimal(valor).toString()
}

async function cargarPagos(actual: Factura) {
    if (!puede('pagos.ver')) {
        return
    }
    cargandoPagos.value = true
    const resultado = await usePagos().deFactura(actual.cliente_id, actual.id)
    cargandoPagos.value = false
    pagos.value = resultado.ok ? resultado.data : []
    problemaPagos.value = resultado.ok ? null : resultado.problema
}

async function cargarAsientos(actual: Factura) {
    if (!puede('libro.ver')) {
        return
    }
    cargandoAsientos.value = true
    // El asiento lleva la fecha contable de la emisión; los reversos, la de la anulación.
    const desde = sumarDiasFecha(fechaGuatemala(actual.emitida_en), -1)
    const resultado = await useLibro().asientosDe(actual.tipo === 'mora' ? 'mora' : 'factura', actual.id, desde)
    cargandoAsientos.value = false
    asientos.value = resultado.ok ? resultado.data : []
    problemaAsientos.value = resultado.ok ? null : resultado.problema
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useFacturas().ver(facturaId.value)
    cargando.value = false
    if (!resultado.ok) {
        factura.value = null
        problema.value = resultado.problema
        return
    }
    factura.value = resultado.data
    void nombres.cargar([resultado.data.cliente_id])
    void cargarPagos(resultado.data)
    void cargarAsientos(resultado.data)
}

function reintentarPagos() {
    if (factura.value) {
        void cargarPagos(factura.value)
    }
}

function reintentarAsientos() {
    if (factura.value) {
        void cargarAsientos(factura.value)
    }
}

function anular(motivo: string, clave: string) {
    return useFacturas().anular(facturaId.value, motivo, clave)
}

function alAnular(actualizada: Factura) {
    toast.add({
        title: 'Factura anulada',
        description: `Factura #${actualizada.id} · se registró el asiento de reverso`,
        icon: 'i-lucide-ban',
        color: 'success',
    })
    void cargar()
}

watch(facturaId, cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="factura"
        :titulo="`Factura #${route.params.id}`"
        icono="i-lucide-receipt-text"
    >
        <template #acciones>
            <UButton
                to="/facturas"
                icon="i-lucide-arrow-left"
                label="Facturas"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div
            v-if="cargando && !factura"
            class="flex flex-col gap-4"
        >
            <USkeleton class="h-8 w-64" />
            <USkeleton class="h-32 w-full" />
        </div>

        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-file-x"
            title="Factura no encontrada"
            :description="`No existe una factura con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a facturas', to: '/facturas', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />

        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div
            v-else-if="factura"
            class="flex flex-col gap-6"
        >
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h2 class="text-xl font-semibold text-highlighted">
                            Factura #{{ factura.id }}
                        </h2>
                        <EstadoFacturaBadge :estado="factura.estado" />
                        <UBadge
                            v-if="factura.tipo === 'mora'"
                            label="Recargo por mora"
                            icon="i-lucide-calendar-x"
                            color="warning"
                            variant="outline"
                        />
                    </div>
                    <p class="text-sm text-muted">
                        {{ etiquetaPeriodo(factura.periodo) }} ·
                        <ULink
                            :to="enlace(`/clientes/${factura.cliente_id}?tab=cuenta`)"
                            class="text-default hover:text-primary"
                        >
                            {{ nombres.nombre(factura.cliente_id) }}
                        </ULink>
                        <template v-if="factura.servicio_id">
                            ·
                            <ULink
                                :to="enlace(`/servicios/${factura.servicio_id}`)"
                                class="text-default hover:text-primary"
                            >
                                servicio {{ factura.servicio_id }}
                            </ULink>
                        </template>
                        <template v-if="factura.factura_origen_id">
                            · mora de la
                            <ULink
                                :to="`/facturas/${factura.factura_origen_id}`"
                                class="text-default hover:text-primary"
                            >
                                factura #{{ factura.factura_origen_id }}
                            </ULink>
                        </template>
                    </p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        label="Aviso de cobro (PDF)"
                        icon="i-lucide-file-down"
                        color="neutral"
                        variant="outline"
                        :loading="generandoPdf"
                        data-prueba="aviso-pdf"
                        @click="abrirAvisoPdf"
                    />
                    <UButton
                        v-if="puedeAnular"
                        label="Anular"
                        icon="i-lucide-ban"
                        color="error"
                        variant="outline"
                        @click="anularAbierto = true"
                    />
                </div>
            </div>

            <div class="grid gap-4 lg:grid-cols-2">
                <UPageCard
                    title="Montos"
                    icon="i-lucide-calculator"
                    variant="subtle"
                >
                    <dl class="grid grid-cols-2 gap-x-6 gap-y-4">
                        <DatoFicha
                            etiqueta="Subtotal"
                            :valor="formatearQuetzales(factura.subtotal)"
                        />
                        <DatoFicha
                            etiqueta="IVA"
                            :valor="formatearQuetzales(factura.iva)"
                        />
                        <DatoFicha
                            etiqueta="Total"
                            :valor="formatearQuetzales(factura.total)"
                        />
                        <DatoFicha
                            etiqueta="Pagado"
                            :valor="formatearQuetzales(factura.pagado)"
                        />
                        <DatoFicha
                            etiqueta="Pendiente"
                            :valor="pendiente ? formatearQuetzales(pendiente) : 'Anulada'"
                        />
                    </dl>
                </UPageCard>

                <UPageCard
                    title="Fechas y certificación"
                    icon="i-lucide-calendar"
                    variant="subtle"
                >
                    <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                        <DatoFicha
                            etiqueta="Emitida"
                            :valor="formatearFechaHora(factura.emitida_en)"
                        />
                        <DatoFicha
                            etiqueta="Vence"
                            :valor="formatearFecha(factura.vence_en)"
                        />
                        <DatoFicha
                            v-if="factura.vencida_en"
                            etiqueta="Marcada vencida"
                            :valor="formatearFechaHora(factura.vencida_en)"
                        />
                        <DatoFicha
                            etiqueta="FEL"
                            :valor="factura.fel_estado ?? 'Sin certificar'"
                        />
                        <DatoFicha
                            v-if="factura.fel_uuid"
                            etiqueta="UUID FEL"
                            :valor="factura.fel_uuid"
                            mono
                        />
                        <DatoFicha
                            v-if="factura.fel_serie || factura.fel_numero"
                            etiqueta="Serie y número"
                            :valor="`${factura.fel_serie ?? '—'} · ${factura.fel_numero ?? '—'}`"
                            mono
                        />
                        <DatoFicha
                            etiqueta="Clave"
                            :valor="`${factura.clave_unica} · versión ${factura.version}`"
                            mono
                        />
                    </dl>
                </UPageCard>
            </div>

            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-highlighted">
                    Líneas
                </h3>
                <UTable
                    :data="factura.lineas"
                    :columns="columnasLineas"
                >
                    <template #concepto-cell="{ row }">
                        <div class="flex flex-col">
                            <span class="text-sm">{{ row.original.concepto }}</span>
                            <span class="text-xs text-muted">
                                {{ cantidad(row.original.cantidad) }} × {{ formatearQuetzales(row.original.precio_unitario) }}{{ row.original.gravable ? '' : ' · exenta' }}
                            </span>
                        </div>
                    </template>
                    <template #cantidad-cell="{ row }">
                        <span class="tabular-nums">{{ cantidad(row.original.cantidad) }}</span>
                    </template>
                    <template #precio_unitario-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.precio_unitario) }}</span>
                    </template>
                    <template #iva-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.iva) }}</span>
                    </template>
                    <template #total-cell="{ row }">
                        <span class="tabular-nums font-medium">{{ formatearQuetzales(row.original.total) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-list"
                            title="Sin líneas"
                            variant="naked"
                        />
                    </template>
                </UTable>
            </section>

            <section
                v-if="puede('pagos.ver')"
                class="flex flex-col gap-2"
            >
                <h3 class="text-sm font-semibold text-highlighted">
                    Pagos aplicados
                </h3>
                <ProblemaAlerta
                    v-if="problemaPagos"
                    :problema="problemaPagos"
                    :reintentar="reintentarPagos"
                    :reintentando="cargandoPagos"
                />
                <UTable
                    v-else
                    :data="pagosAplicados"
                    :columns="columnasPagos"
                    :loading="cargandoPagos"
                >
                    <template #pago-cell="{ row }">
                        <div class="flex flex-col">
                            <ULink
                                :to="`/pagos/${row.original.pago.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                Pago #{{ row.original.pago.id }}
                            </ULink>
                            <span class="text-xs text-muted">{{ formatearFechaHora(row.original.pago.created_at) }}</span>
                        </div>
                    </template>
                    <template #metodo-cell="{ row }">
                        <span class="text-sm">{{ ETIQUETAS_METODO[row.original.pago.metodo] }}</span>
                    </template>
                    <template #aplicado-cell="{ row }">
                        <span class="tabular-nums font-medium">{{ formatearQuetzales(row.original.aplicado) }}</span>
                    </template>
                    <template #estado-cell="{ row }">
                        <EstadoPagoBadge
                            :estado="row.original.pago.estado"
                            size="sm"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-banknote"
                            title="Sin pagos aplicados"
                            variant="naked"
                        />
                    </template>
                </UTable>
            </section>

            <section
                v-if="puede('libro.ver')"
                class="flex flex-col gap-2"
            >
                <h3 class="text-sm font-semibold text-highlighted">
                    Asientos del libro
                </h3>
                <ProblemaAlerta
                    v-if="problemaAsientos"
                    :problema="problemaAsientos"
                    :reintentar="reintentarAsientos"
                    :reintentando="cargandoAsientos"
                />
                <div
                    v-else-if="cargandoAsientos && !asientos.length"
                    class="flex flex-col gap-2"
                >
                    <USkeleton class="h-24 w-full" />
                </div>
                <p
                    v-else-if="!asientos.length"
                    class="text-sm text-muted"
                >
                    No se encontró el asiento de esta factura en el libro diario.
                </p>
                <div
                    v-else
                    class="grid gap-3 lg:grid-cols-2"
                >
                    <AsientoContable
                        v-for="asiento in asientos"
                        :key="asiento.id"
                        :asiento="asiento"
                        :con-origen="false"
                    />
                </div>
            </section>

            <AccionMotivoModal
                v-model:open="anularAbierto"
                titulo="Anular factura"
                :descripcion="`Factura #${factura.id} · ${formatearQuetzales(factura.total)}`"
                efecto="La factura deja de contar como deuda y se registra un asiento de reverso en el libro. No se puede deshacer."
                confirmar="Anular factura"
                :ejecutar="anular"
                @hecho="alAnular"
            />
        </div>
    </PanelPagina>
</template>
