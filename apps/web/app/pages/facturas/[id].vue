<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { DropdownMenuItem, TableColumn, TabsItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Ficha de una factura (tablero OperFacturaDetalle): franja con el número, estado, saldo y las
 * acciones (Cobrar, Nota de crédito y «⋯» con sustituir, anular y el aviso en PDF); a la izquierda
 * una tarjeta con pestañas (líneas y pagos, factura electrónica, historial) y a la derecha la
 * impresión con su vista previa (Carta o POS 80 mm).
 */
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
 * Abre el PDF del aviso de cobro (`GET /documentos/aviso-cobro/:facturaId`) en otra pestaña, con la
 * plantilla predeterminada o con la elegida en «Imprimir con…» (p. ej. POS 80 mm). Si falla, el
 * error sale en un toast.
 */
async function abrirAvisoPdf(plantillaId: number | null = null) {
    if (!factura.value || generandoPdf.value) {
        return
    }
    const id = factura.value.id
    generandoPdf.value = true
    const problema = await abrirPdf(() => useDocumentos().avisoCobro(id, plantillaId), `aviso-cobro-${id}.pdf`)
    generandoPdf.value = false
    if (problema) {
        toast.add({ title: 'No se pudo generar el PDF', description: problema.detail ?? problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
    }
}

useHead(() => ({ title: `Factura #${route.params.id} · ArgosIsp` }))

/** Nota de crédito: factura con saldo (emitida, parcial o vencida) y `facturas.nota_credito`. */
const notaAbierta = ref(false)
const puedeNotaCredito = computed(() => puede('facturas.nota_credito') && factura.value !== null
    && ['emitida', 'parcial', 'vencida'].includes(factura.value.estado) && saldoFactura(factura.value).gt(0))
/** Servicios que la última nota de crédito reactivó (o dejó igual, con el motivo). */
const evaluadosNota = shallowRef<ServicioEvaluado[]>([])

function alEmitirNota(nota: NotaCreditoEmitida) {
    const reactivados = nota.servicios.filter(s => s.cambiado && s.estado === 'activo')
    evaluadosNota.value = nota.servicios
    toast.add({
        title: `Nota de crédito #${nota.id} emitida`,
        description: `${formatearQuetzales(nota.monto)} · saldo ${formatearQuetzales(saldoFactura(nota.factura))}${reactivados.length ? ' · servicio reactivado' : ''}`,
        icon: 'i-lucide-file-minus',
        color: 'success',
    })
    void cargar()
}

/** Con DTE certificado, anular pide además `fel.anular` y va en dos pasos (`AnularFacturaModal`). */
const conDteCertificado = computed(() => factura.value?.fel_estado === 'certificado')
const anulacionPendiente = computed(() => factura.value?.fel_estado === 'anulacion_pendiente')
const puedeAnular = computed(() => puede('facturas.anular') && factura.value !== null && factura.value.estado !== 'anulada'
    && !anulacionPendiente.value && (!conDteCertificado.value || puede('fel.anular')))

const tipoVisual = computed(() => tipoFacturaVisual(factura.value?.tipo))

/** Aviso de lo que no es una factura normal: acreditada por notas (H16). */
const avisoNoFiscal = computed<string | null>(() => {
    if (!factura.value) {
        return null
    }
    if (factura.value.estado === 'acreditada') {
        return 'Cubierta entera por notas de crédito internas, sin ningún cobro: no es una venta y no se certifica en FEL.'
    }
    return null
})

/** Sustituir (`facturas.sustituir`): solo una factura de servicio vigente (no una mora). La API decide el resto (409). */
const sustituirAbierto = ref(false)
const puedeSustituir = computed(() => puede('facturas.sustituir') && factura.value !== null && factura.value.estado !== 'anulada'
    && (factura.value.tipo ?? 'servicio') === 'servicio' && !factura.value.sustituida_por)

function alSustituir(sustitucion: SustitucionFactura) {
    toast.add({
        title: `Factura #${sustitucion.original.id} sustituida`,
        description: sustitucion.tipo === 'nota_credito'
            ? `Acreditada con la nota de crédito #${sustitucion.nota_credito_id ?? '—'} (NCRE) · nueva factura #${sustitucion.nueva.id}`
            : `Anulada · nueva factura #${sustitucion.nueva.id}`,
        icon: 'i-lucide-replace',
        color: 'success',
    })
    void navigateTo(`/facturas/${sustitucion.nueva.id}`)
}

/** Por certificar (obligatoria + «al emitir»): aún no es deuda; el saldo no se muestra como pendiente. */
const porCertificar = computed(() => factura.value?.estado === 'por_certificar')
const pendiente = computed(() => (factura.value && factura.value.estado !== 'anulada' && !porCertificar.value ? saldoFactura(factura.value) : null))

const columnasLineas: TableColumn<FacturaLinea>[] = [
    { accessorKey: 'concepto', header: 'Descripción', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'cantidad', header: 'Cant.', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'precio_unitario', header: 'Precio', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'total', header: 'Importe', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

interface PagoAplicado {
    pago: Pago
    aplicado: string
}

const pagosAplicados = computed<PagoAplicado[]>(() => pagos.value.map(pago => ({
    pago,
    aplicado: pago.aplicaciones.filter(a => a.factura_id === facturaId.value).reduce((suma, a) => suma.plus(a.monto), new Decimal(0)).toFixed(2),
})))

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
    // Los asientos de sus notas de crédito (`NotaCredito.asiento_id`), uno por uno.
    const deNotas = await Promise.all((factura.value?.notas_credito ?? [])
        .flatMap(nota => (nota.asiento_id === null ? [] : [useLibro().asiento(nota.asiento_id)])))
    cargandoAsientos.value = false
    const fallo = (!resultado.ok ? resultado.problema : null) ?? deNotas.flatMap(r => (r.ok ? [] : [r.problema]))[0] ?? null
    asientos.value = resultado.ok && !fallo ? [...resultado.data, ...deNotas.flatMap(r => (r.ok ? [r.data] : []))] : []
    problemaAsientos.value = fallo
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
    if (actualizada.fel_estado === 'anulacion_pendiente') {
        toast.add({
            title: 'Anulación enviada al certificador',
            description: `Factura #${actualizada.id} · se anula cuando la SAT lo confirme`,
            icon: 'i-lucide-hourglass',
            color: 'warning',
        })
    }
    else {
        toast.add({
            title: 'Factura anulada',
            description: `Factura #${actualizada.id} · se registró el asiento de reverso`,
            icon: 'i-lucide-ban',
            color: 'success',
        })
    }
    void cargar()
}

/** El DTE cambió de estado (certificado, anulado…): se relee la factura. */
function alCambiarDte() {
    void cargar()
}

const pestana = ref<'lineas' | 'fel' | 'historial'>('lineas')
const pestanas = computed<TabsItem[]>(() => [
    { label: 'Líneas y pagos', value: 'lineas', icon: 'i-lucide-list' },
    ...(puede('fel.ver') ? [{ label: 'Factura electrónica', value: 'fel', icon: 'i-lucide-badge-check' }] : []),
    { label: 'Historial', value: 'historial', icon: 'i-lucide-history' },
])

const hoy = hoyGuatemala()
const diasVencida = computed(() => (factura.value ? diasVencidaFactura(factura.value, hoy) : 0))
/** Insignia del estado: «Vencida hace 11 días» cuando aplica. */
const textoEstado = computed(() => {
    if (!factura.value) {
        return ''
    }
    const visual = estadoFacturaVisual(factura.value.estado)
    return diasVencida.value > 0 ? `Vencida hace ${diasVencida.value} ${diasVencida.value === 1 ? 'día' : 'días'}` : visual.etiqueta
})
const tonoFranja = computed(() => {
    const estado = factura.value?.estado
    if (diasVencida.value > 0 || estado === 'vencida') {
        return 'tono-error'
    }
    if (estado === 'pagada') {
        return 'tono-exito'
    }
    return estado === 'parcial' || estado === 'por_certificar' ? 'tono-aviso' : 'tono-marca'
})
const puedeCobrar = computed(() => puede('pagos.registrar') && pendiente.value !== null && pendiente.value.gt(0))

function abrirSustituir() {
    sustituirAbierto.value = true
}

function abrirAnular() {
    anularAbierto.value = true
}

/** «⋯»: lo que no es la acción principal ni la nota de crédito. */
const masAcciones = computed<DropdownMenuItem[][]>(() => {
    const documento: DropdownMenuItem[] = [
        { label: 'Aviso de cobro (PDF)', icon: 'i-lucide-file-down', onSelect: () => void abrirAvisoPdf() },
    ]
    const cambios: DropdownMenuItem[] = []
    if (puedeSustituir.value) {
        cambios.push({ label: 'Sustituir factura', icon: 'i-lucide-replace', onSelect: () => abrirSustituir() })
    }
    const peligro: DropdownMenuItem[] = []
    if (puedeAnular.value) {
        peligro.push({ label: 'Anular factura', icon: 'i-lucide-ban', color: 'error', onSelect: () => abrirAnular() })
    }
    return [documento, cambios, peligro].filter(grupo => grupo.length)
})

watch(facturaId, cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="factura"
        :titulo="factura ? `Factura ${numeroFactura(factura)}` : `Factura #${route.params.id}`"
        icono="i-lucide-receipt-text"
        encabezado-propio
    >
        <div
            v-if="cargando && !factura"
            class="flex flex-col gap-4"
        >
            <USkeleton class="h-20 w-full rounded-[1.375rem]" />
            <USkeleton class="h-96 w-full rounded-[1.375rem]" />
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
            class="flex flex-col gap-4 lg:min-h-0 lg:flex-1"
        >
            <!-- Franja: número, estado, saldo y acciones. -->
            <header
                class="surface-card flex flex-col gap-4 rounded-[1.375rem] p-4 sm:flex-row sm:items-center"
                data-prueba="franja-factura"
            >
                <div class="flex min-w-0 flex-1 items-center gap-4">
                    <span
                        class="pastilla-icono pastilla-tono hidden size-12 shrink-0 rounded-2xl sm:inline-flex"
                        :class="tonoFranja"
                    >
                        <UIcon
                            name="i-lucide-receipt-text"
                            class="size-6"
                        />
                    </span>
                    <div class="flex min-w-0 flex-col gap-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <h1 class="font-mono text-xl font-bold text-highlighted sm:text-2xl">
                                {{ factura.fel_serie && factura.fel_numero ? numeroFactura(factura) : `Factura #${factura.id}` }}
                            </h1>
                            <UBadge
                                :label="textoEstado"
                                :icon="estadoFacturaVisual(factura.estado).icono"
                                :color="diasVencida > 0 ? 'error' : estadoFacturaVisual(factura.estado).color"
                                variant="subtle"
                                data-prueba="factura-estado"
                            />
                            <UBadge
                                v-if="factura.tipo_dte"
                                :label="factura.fel_estado === 'certificado' ? 'Certificada' : (factura.aviso_cobro ? 'Aviso de cobro' : factura.tipo_dte)"
                                :icon="factura.fel_estado === 'certificado' ? 'i-lucide-shield-check' : 'i-lucide-file-clock'"
                                :color="factura.fel_estado === 'certificado' ? 'success' : 'neutral'"
                                variant="subtle"
                            />
                            <UBadge
                                v-if="tipoVisual"
                                :label="tipoVisual.etiqueta"
                                :icon="tipoVisual.icono"
                                :color="tipoVisual.color"
                                variant="outline"
                                :data-tipo="factura.tipo"
                            />
                        </div>
                        <p class="text-[0.8125rem] text-muted">
                            <ULink
                                :to="enlace(`/clientes/${factura.cliente_id}?tab=cuenta`)"
                                class="text-primary underline"
                            >{{ nombres.nombre(factura.cliente_id) }}</ULink>
                            <template v-if="factura.servicio_id">
                                ·
                                <ULink
                                    :to="enlace(`/servicios/${factura.servicio_id}`)"
                                    class="text-primary underline"
                                >servicio {{ factura.servicio_id }}</ULink>
                            </template>
                            · {{ etiquetaPeriodo(factura.periodo) }} · emitida el {{ formatearFecha(factura.emitida_en) }} · {{ diasVencida > 0 ? 'venció' : 'vence' }} el {{ formatearFecha(factura.vence_en) }}
                            <template v-if="factura.factura_origen_id">
                                · {{ relacionOrigen(factura.tipo) }}
                                <ULink
                                    :to="`/facturas/${factura.factura_origen_id}`"
                                    class="text-primary underline"
                                >factura #{{ factura.factura_origen_id }}</ULink>
                            </template>
                        </p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-3 sm:justify-end">
                    <div
                        v-if="pendiente !== null"
                        class="flex flex-col items-end"
                    >
                        <span class="text-xs text-muted">Saldo de {{ formatearQuetzales(factura.total) }}</span>
                        <span
                            class="text-2xl font-bold tabular-nums"
                            :class="pendiente.gt(0) ? 'text-error' : 'text-success'"
                            data-prueba="factura-saldo"
                        >{{ formatearQuetzales(pendiente) }}</span>
                    </div>
                    <UButton
                        v-if="puedeCobrar"
                        :to="`/cobro?cliente=${factura.cliente_id}`"
                        label="Cobrar"
                        :icon="ICONOS.cobrar"
                        color="success"
                        size="lg"
                        class="px-5"
                    />
                    <UButton
                        v-if="puedeNotaCredito"
                        label="Nota de crédito"
                        icon="i-lucide-file-minus"
                        color="neutral"
                        variant="outline"
                        size="lg"
                        data-prueba="abrir-nota-credito"
                        @click="notaAbierta = true"
                    />
                    <UDropdownMenu
                        :items="masAcciones"
                        :content="{ align: 'end' }"
                    >
                        <UButton
                            icon="i-lucide-ellipsis"
                            color="neutral"
                            variant="ghost"
                            class="boton-flotante boton-circulo"
                            aria-label="Más acciones de la factura"
                            data-prueba="mas-acciones-factura"
                        />
                    </UDropdownMenu>
                </div>
            </header>

            <UAlert
                v-if="avisoNoFiscal"
                title="Factura acreditada"
                :description="avisoNoFiscal"
                icon="i-lucide-info"
                color="neutral"
                variant="subtle"
                data-prueba="factura-no-fiscal"
            />
            <UAlert
                v-if="porCertificar"
                color="neutral"
                variant="subtle"
                icon="i-lucide-file-clock"
                title="Por certificar: todavía no es deuda"
                description="La FEL de la empresa es obligatoria y esta factura se certifica al emitirse: no tiene asiento, no se cobra ni cuenta para el corte hasta que la SAT la autorice."
                data-prueba="factura-por-certificar"
            />
            <UAlert
                v-if="factura.sustituida_por"
                color="neutral"
                variant="subtle"
                icon="i-lucide-replace"
                :title="`Sustituida por la factura #${factura.sustituida_por}`"
                description="Esta factura se reemplazó por otra del mismo periodo (anulada o acreditada con una NCRE por su saldo)."
                :actions="[{ label: `Ver factura #${factura.sustituida_por}`, to: `/facturas/${factura.sustituida_por}`, color: 'neutral', variant: 'outline', icon: 'i-lucide-arrow-right' }]"
                data-prueba="factura-sustituida-por"
            />
            <UAlert
                v-if="factura.sustituye_a"
                color="info"
                variant="subtle"
                icon="i-lucide-replace"
                :title="`Sustituye a la factura #${factura.sustituye_a}`"
                :actions="[{ label: `Ver factura #${factura.sustituye_a}`, to: `/facturas/${factura.sustituye_a}`, color: 'neutral', variant: 'outline', icon: 'i-lucide-arrow-left' }]"
                data-prueba="factura-sustituye-a"
            />
            <UAlert
                v-if="anulacionPendiente"
                color="warning"
                variant="subtle"
                icon="i-lucide-hourglass"
                title="Anulación pendiente con el certificador"
                description="La factura se anula cuando la SAT lo confirme. Mientras tanto no recibe pagos ni notas de crédito."
                data-prueba="factura-anulacion-pendiente"
            />
            <UAlert
                v-for="evaluado in evaluadosNota.filter(e => e.cambiado)"
                :key="`nc${evaluado.servicio_id}`"
                color="success"
                variant="subtle"
                icon="i-lucide-wifi"
                :title="`Servicio #${evaluado.servicio_id}: ${evaluado.de} → ${evaluado.estado}`"
                :description="evaluado.motivo"
                data-prueba="nota-reactivacion"
            />

            <div class="grid gap-4 lg:min-h-0 lg:flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
                <section class="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.375rem]">
                    <div class="flex items-center justify-between gap-2 border-b border-(--ax-borde) p-3 sm:p-4">
                        <OperPestanas
                            v-model="pestana"
                            :items="pestanas"
                            etiqueta="Secciones de la factura"
                        />
                        <AyudaBoton solo-icono />
                    </div>

                    <!-- Líneas, totales, pagos y notas de crédito. -->
                    <div
                        v-show="pestana === 'lineas'"
                        class="flex flex-col"
                    >
                        <UTable
                            :data="factura.lineas"
                            :columns="columnasLineas"
                            :ui="{ root: 'rounded-none bg-transparent ring-0 shadow-none dark:shadow-none' }"
                        >
                            <template #concepto-cell="{ row }">
                                <div class="flex flex-col">
                                    <span class="text-sm font-semibold text-highlighted">{{ row.original.concepto }}</span>
                                    <span class="text-xs text-muted sm:hidden">
                                        {{ cantidad(row.original.cantidad) }} × {{ formatearQuetzales(row.original.precio_unitario) }}
                                    </span>
                                    <span
                                        v-if="!row.original.gravable"
                                        class="text-xs text-muted"
                                    >Exenta</span>
                                </div>
                            </template>
                            <template #cantidad-cell="{ row }">
                                <span class="tabular-nums">{{ cantidad(row.original.cantidad) }}</span>
                            </template>
                            <template #precio_unitario-cell="{ row }">
                                <span class="tabular-nums">{{ formatearQuetzales(row.original.precio_unitario) }}</span>
                            </template>
                            <template #total-cell="{ row }">
                                <span class="tabular-nums">{{ formatearQuetzales(row.original.total) }}</span>
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-list"
                                    title="Sin líneas"
                                    variant="naked"
                                />
                            </template>
                        </UTable>

                        <dl
                            class="ms-auto flex w-full max-w-xs flex-col divide-y divide-(--ax-borde) px-4 py-2 text-sm"
                            data-prueba="totales-factura"
                        >
                            <div class="flex justify-between py-2">
                                <dt class="text-muted">
                                    Subtotal sin IVA
                                </dt>
                                <dd class="tabular-nums">
                                    {{ formatearQuetzales(factura.subtotal) }}
                                </dd>
                            </div>
                            <div class="flex justify-between py-2">
                                <dt class="text-muted">
                                    IVA
                                </dt>
                                <dd class="tabular-nums">
                                    {{ formatearQuetzales(factura.iva) }}
                                </dd>
                            </div>
                            <div class="flex justify-between py-2">
                                <dt class="font-semibold text-highlighted">
                                    Total
                                </dt>
                                <dd class="text-lg font-bold tabular-nums text-highlighted">
                                    {{ formatearQuetzales(factura.total) }}
                                </dd>
                            </div>
                            <div class="flex justify-between py-2">
                                <dt class="text-muted">
                                    Pagado
                                </dt>
                                <dd class="tabular-nums">
                                    − {{ formatearQuetzales(factura.pagado) }}
                                </dd>
                            </div>
                            <div
                                v-if="factura.acreditado && factura.acreditado !== '0.00'"
                                class="flex justify-between py-2"
                                data-prueba="factura-acreditado"
                            >
                                <dt class="text-muted">
                                    De lo pagado, notas de crédito
                                </dt>
                                <dd class="tabular-nums">
                                    {{ formatearQuetzales(factura.acreditado) }}
                                </dd>
                            </div>
                            <div class="flex justify-between py-2">
                                <dt class="font-semibold text-error">
                                    Saldo
                                </dt>
                                <dd class="text-lg font-bold tabular-nums text-error">
                                    {{ pendiente ? formatearQuetzales(pendiente) : (porCertificar ? 'Por certificar' : 'Anulada') }}
                                </dd>
                            </div>
                        </dl>

                        <section
                            v-if="puede('pagos.ver')"
                            class="flex flex-col gap-1 px-4 pb-4"
                            aria-labelledby="titulo-pagos"
                        >
                            <h3
                                id="titulo-pagos"
                                class="border-b border-(--ax-borde) pb-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase"
                            >
                                Pagos aplicados
                            </h3>
                            <ProblemaAlerta
                                v-if="problemaPagos"
                                :problema="problemaPagos"
                                :reintentar="reintentarPagos"
                                :reintentando="cargandoPagos"
                            />
                            <USkeleton
                                v-else-if="cargandoPagos && !pagosAplicados.length"
                                class="h-12 w-full"
                            />
                            <p
                                v-else-if="!pagosAplicados.length"
                                class="py-2 text-sm text-muted"
                            >
                                Sin pagos aplicados.
                            </p>
                            <ul
                                v-else
                                class="flex flex-col divide-y divide-(--ax-borde)"
                            >
                                <li
                                    v-for="aplicado in pagosAplicados"
                                    :key="aplicado.pago.id"
                                    class="flex items-center gap-3 py-2.5"
                                >
                                    <span class="pastilla-icono pastilla-tono tono-exito size-9 shrink-0 rounded-xl">
                                        <UIcon
                                            :name="ICONOS.cobrar"
                                            class="size-4"
                                        />
                                    </span>
                                    <div class="flex min-w-0 flex-1 flex-col">
                                        <ULink
                                            :to="`/pagos/${aplicado.pago.id}`"
                                            class="text-sm font-semibold text-highlighted hover:text-primary"
                                        >
                                            Pago #{{ aplicado.pago.id }} · {{ ETIQUETAS_METODO[aplicado.pago.metodo].toLowerCase() }}
                                        </ULink>
                                        <span class="text-xs text-muted">{{ formatearFechaHora(aplicado.pago.created_at) }}</span>
                                    </div>
                                    <EstadoPagoBadge
                                        :estado="aplicado.pago.estado"
                                        size="sm"
                                    />
                                    <span class="font-semibold tabular-nums">{{ formatearQuetzales(aplicado.aplicado) }}</span>
                                </li>
                            </ul>
                        </section>

                        <section
                            class="flex flex-col gap-1 px-4 pb-4"
                            aria-labelledby="titulo-notas"
                            data-prueba="notas-credito"
                        >
                            <h3
                                id="titulo-notas"
                                class="border-b border-(--ax-borde) pb-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase"
                            >
                                Notas de crédito
                            </h3>
                            <p
                                v-if="!factura.notas_credito?.length"
                                class="py-2 text-sm text-muted"
                            >
                                Ninguna. Una nota de crédito baja el saldo sin que entre dinero (descuento, días sin servicio, error).
                            </p>
                            <ul
                                v-else
                                class="flex flex-col divide-y divide-(--ax-borde)"
                            >
                                <li
                                    v-for="nota in factura.notas_credito"
                                    :key="nota.id"
                                    class="flex flex-wrap items-start justify-between gap-2 py-2"
                                >
                                    <div class="flex min-w-0 flex-col">
                                        <div class="flex flex-wrap items-center gap-2">
                                            <ULink
                                                :to="`/notas-credito/${nota.id}`"
                                                class="text-sm font-semibold text-highlighted hover:text-primary"
                                            >
                                                Nota #{{ nota.id }} · {{ formatearFecha(nota.fecha) }}
                                            </ULink>
                                            <UBadge
                                                v-if="nota.anulada_en"
                                                label="Anulada"
                                                icon="i-lucide-ban"
                                                color="neutral"
                                                variant="subtle"
                                                size="sm"
                                            />
                                        </div>
                                        <span class="text-xs text-muted">{{ nota.motivo }}<template v-if="nota.created_by_nombre"> · {{ nota.created_by_nombre }}</template></span>
                                    </div>
                                    <div class="flex flex-col items-end">
                                        <span class="font-semibold tabular-nums">{{ formatearQuetzales(nota.monto) }}</span>
                                        <span class="text-xs tabular-nums text-muted">IVA {{ formatearQuetzales(nota.iva) }}</span>
                                    </div>
                                </li>
                            </ul>
                        </section>
                    </div>

                    <!-- Factura electrónica. -->
                    <div
                        v-if="puede('fel.ver')"
                        v-show="pestana === 'fel'"
                        class="p-4"
                        data-prueba="factura-fel"
                    >
                        <DteDocumento
                            tipo="factura"
                            :documento-id="factura.id"
                            :dte-id="factura.dte_id ?? null"
                            :certificable="factura.estado !== 'anulada' && factura.estado !== 'acreditada'"
                            :sin-certificar="factura.estado === 'acreditada' ? 'Sin DTE: acreditada por notas de crédito internas, no es una venta y no se certifica.' : null"
                            :refrescar="`${factura.version}-${factura.estado}-${factura.fel_estado ?? ''}`"
                            :accion="factura.fel_accion ?? null"
                            :modo="factura.fel_modo ?? null"
                            @cambiado="alCambiarDte"
                        />
                    </div>

                    <!-- Historial: fechas, clave y asientos del libro. -->
                    <div
                        v-show="pestana === 'historial'"
                        class="flex flex-col gap-4 p-4"
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
                                v-if="factura.certificar_al"
                                etiqueta="Certificar"
                                :valor="CERTIFICAR_AL[factura.certificar_al].etiqueta"
                            />
                            <DatoFicha
                                v-if="factura.origen"
                                etiqueta="Importada de"
                                :valor="`${factura.origen}${factura.id_externo ? ` · ${factura.id_externo}` : ''}`"
                                mono
                            />
                            <DatoFicha
                                etiqueta="Clave"
                                :valor="`${factura.clave_unica} · versión ${factura.version}`"
                                mono
                            />
                        </dl>

                        <section
                            v-if="puede('libro.ver')"
                            class="flex flex-col gap-2"
                        >
                            <h3 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                                Asientos del libro
                            </h3>
                            <ProblemaAlerta
                                v-if="problemaAsientos"
                                :problema="problemaAsientos"
                                :reintentar="reintentarAsientos"
                                :reintentando="cargandoAsientos"
                            />
                            <USkeleton
                                v-else-if="cargandoAsientos && !asientos.length"
                                class="h-24 w-full"
                            />
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
                    </div>
                </section>

                <FacturaImpresion :factura-id="factura.id" />
            </div>

            <NotaCreditoModal
                v-if="puedeNotaCredito"
                v-model:open="notaAbierta"
                :factura="factura"
                @hecho="alEmitirNota"
            />

            <SustituirFacturaModal
                v-if="puedeSustituir"
                v-model:open="sustituirAbierto"
                :factura="factura"
                @hecho="alSustituir"
            />

            <AnularFacturaModal
                v-if="conDteCertificado"
                v-model:open="anularAbierto"
                :factura="factura"
                @hecho="alAnular"
                @nota-credito="notaAbierta = true"
            />

            <AccionMotivoModal
                v-else
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
