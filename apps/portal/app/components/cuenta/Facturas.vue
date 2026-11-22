<script setup lang="ts">
import Decimal from 'decimal.js'

/**
 * Facturas del cliente: concepto, estado, total, saldo, vencimiento, el PDF y, con FEL, su DTE.
 *
 * - Un aviso de cobro se llama «Factura» (o «Nota de débito» en la mora) solo cuando su DTE está
 *   certificado: la API lo dice en `documento` y trae la autorización, serie y número en `dte`.
 * - Una factura sustituida dice «Sustituida» y a cuál la reemplaza; la nueva dice a cuál sustituye.
 * - «Saldo» solo en las pendientes (emitida, parcial, vencida): una castigada («Dada de baja») o
 *   acreditada («Cubierta por crédito») no es deuda, aunque su `pagado` no llegue al total.
 * - Sistema visual: una lista (tabla en escritorio) con filtros en la cabecera; cada fila con su PDF y
 *   un menú de tres puntos; el detalle (DTE, XML, montos) en un drawer sin salir de la lista.
 * - El PDF y el XML se abren directo de `/api/v1/portal/facturas/:id/pdf|xml` en este mismo origen
 *   (la cookie de la sesión viaja sola). El XML solo existe con el DTE certificado.
 * - Un periodo bonificado (mes gratis, canje, cargo sin costo; decisión del PM: nunca una factura de
 *   Q0) va en la misma lista, en su lugar por periodo: «Mes bonificado: <concepto>», sin monto ni PDF.
 *   Solo se intercalan las bonificaciones hasta el periodo de la factura más vieja ya leída, para no
 *   ponerlas fuera de orden mientras faltan páginas; si no se pueden leer, se avisa aparte.
 */
const { items, cargando, cargado, problema, hayMas, recargar, cargarMas, urlPdf, urlXml } = useFacturas()
const bonificaciones = useBonificaciones()

onMounted(() => {
    void recargar()
    void bonificaciones.recargar()
})

interface Fila {
    clave: string
    periodo: string
    orden: number
    factura: FacturaPortal | null
    bonificacion: BonificacionPortal | null
}

const filas = computed<Fila[]>(() => {
    const masVieja = hayMas.value ? items.value.at(-1)?.periodo ?? null : null
    const visibles = bonificaciones.items.value.filter(b => masVieja === null || b.periodo >= masVieja)
    return [
        ...items.value.map((factura, orden) => ({ clave: `f-${factura.id}`, periodo: factura.periodo, orden, factura, bonificacion: null })),
        ...visibles.map((bonificacion, orden) => ({ clave: `b-${bonificacion.id}`, periodo: bonificacion.periodo, orden, factura: null, bonificacion })),
    ].sort((a, b) => b.periodo.localeCompare(a.periodo) || a.orden - b.orden)
})

const hayMasFilas = computed(() => hayMas.value || bonificaciones.hayMas.value)
function cargarMasFilas() {
    if (hayMas.value) {
        void cargarMas()
    }
    if (bonificaciones.hayMas.value) {
        void bonificaciones.cargarMas()
    }
}

function conCredito(factura: FacturaPortal): boolean {
    return new Decimal(factura.acreditado).greaterThan(0)
}

/*
 * Filtros de la cabecera: todas, por pagar (con saldo) y pagadas. Los meses bonificados solo en
 * «Todas»: no son deuda ni pago.
 */
type Filtro = 'todas' | 'por_pagar' | 'pagadas'
const filtro = ref<Filtro>('todas')
const filtros = [
    { label: 'Todas', value: 'todas', icon: 'i-lucide-list' },
    { label: 'Por pagar', value: 'por_pagar', icon: 'i-lucide-clock' },
    { label: 'Pagadas', value: 'pagadas', icon: 'i-lucide-circle-check' },
]
const filasVisibles = computed(() => filtro.value === 'todas'
    ? filas.value
    : filas.value.filter(({ factura }) => factura !== null && (filtro.value === 'por_pagar'
            ? facturaConSaldo(factura)
            : factura.estado === 'pagada')))

/** Detalle en un drawer, sin salir de la lista (con el DTE, el XML y las notas). */
const detalle = ref<FacturaPortal | null>(null)
const verDetalle = ref(false)
function abrir(factura: FacturaPortal) {
    detalle.value = factura
    verDetalle.value = true
}

function datosDetalle(factura: FacturaPortal) {
    return [
        { etiqueta: 'Documento', valor: nombreDocumento(factura) },
        { etiqueta: 'Emitida', valor: formatearFecha(factura.emitida_en) },
        { etiqueta: 'Vence', valor: formatearFecha(factura.vence_en) },
        { etiqueta: 'Total', valor: formatearQuetzales(factura.total) },
        { etiqueta: 'Cubierto', valor: formatearQuetzales(factura.pagado) },
        ...(conCredito(factura) ? [{ etiqueta: 'Notas de crédito', valor: `−${formatearQuetzales(factura.acreditado)}` }] : []),
        ...(facturaConSaldo(factura) ? [{ etiqueta: 'Saldo', valor: formatearQuetzales(factura.saldo) }] : []),
    ]
}

/** Menú de tres puntos: acciones secundarias de la fila, agrupadas (ver; descargar). */
function menu(factura: FacturaPortal) {
    return [[
        { label: 'Ver detalle', icon: 'i-lucide-panel-right-open', onSelect: () => abrir(factura) },
    ], [
        { label: etiquetaPdf(factura), icon: 'i-lucide-file-down', to: urlPdf(factura.id), target: '_blank', external: true },
        ...(factura.dte?.xml_disponible
            ? [{ label: 'Descargar XML', icon: 'i-lucide-file-code', to: urlXml(factura.id), external: true, download: true }]
            : []),
    ]]
}
</script>

<template>
    <CuentaEstadoLista
        :cargando="cargando"
        :cargado="cargado"
        :problema="problema"
        :vacia="filas.length === 0"
        :hay-mas="hayMasFilas"
        texto-vacio="No tienes facturas"
        icono-vacio="i-lucide-receipt"
        @reintentar="recargar"
        @cargar-mas="cargarMasFilas"
    >
        <UAlert
            v-if="bonificaciones.problema.value"
            color="neutral"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos cargar tus meses bonificados"
            :description="mensajeProblema(bonificaciones.problema.value)"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => bonificaciones.recargar() }]"
            data-testid="bonificaciones-error"
        />
        <PortalLista :columnas="{ concepto: 'Documento', monto: 'Total', estado: 'Estado' }">
            <template #filtros>
                <UTabs
                    v-model="filtro"
                    :items="filtros"
                    :content="false"
                    color="neutral"
                    variant="pill"
                    size="sm"
                    class="w-full sm:w-auto"
                    aria-label="Filtrar facturas"
                    data-testid="filtro-facturas"
                />
            </template>
            <template
                v-for="{ clave, factura, bonificacion } in filasVisibles"
                :key="clave"
            >
                <CuentaBonificacion
                    v-if="bonificacion"
                    :bonificacion="bonificacion"
                />
                <PortalFila
                    v-else-if="factura"
                    :titulo="conceptoFactura(factura)"
                    :icono="factura.tipo === 'mora' ? 'i-lucide-receipt-text' : 'i-lucide-receipt'"
                    :tono="tonoDeColor(presentacionFactura(factura).color)"
                    :monto="formatearQuetzales(factura.total)"
                    :detalle-monto="facturaConSaldo(factura) ? `Saldo ${formatearQuetzales(factura.saldo)}` : undefined"
                    :estado="presentacionFactura(factura)"
                    testid-estado="estado-factura"
                    interactiva
                    data-testid="factura"
                    @abrir="abrir(factura)"
                >
                    <template #subtitulo>
                        <span data-testid="documento">{{ nombreDocumento(factura) }} · vence {{ formatearFecha(factura.vence_en) }}</span>
                    </template>
                    <template #acciones>
                        <UButton
                            data-testid="descargar-pdf"
                            :label="etiquetaPdf(factura)"
                            icon="i-lucide-file-down"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :to="urlPdf(factura.id)"
                            target="_blank"
                            external
                            class="ax-pista"
                            data-pista="Ver PDF"
                            :ui="{ label: 'sr-only' }"
                        />
                        <UDropdownMenu
                            :items="menu(factura)"
                            :content="{ align: 'end' }"
                        >
                            <UButton
                                icon="i-lucide-ellipsis-vertical"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Más acciones de ${nombreDocumento(factura)}`"
                                class="ax-pista"
                                data-pista="Más acciones"
                                data-testid="menu-factura"
                            />
                        </UDropdownMenu>
                    </template>
                    <p
                        v-if="factura.estado === 'castigada'"
                        class="text-xs text-muted"
                        data-testid="castigada"
                    >
                        Esta factura ya no tiene saldo por cobrar.
                    </p>
                    <p
                        v-if="conCredito(factura)"
                        class="text-xs text-muted"
                        data-testid="acreditado"
                    >
                        Notas de crédito: −{{ formatearQuetzales(factura.acreditado) }}
                    </p>
                    <p
                        v-if="factura.sustituida"
                        class="text-xs text-default"
                        data-testid="sustituida"
                    >
                        <template v-if="factura.sustituida_por">
                            Reemplazada por la factura {{ factura.sustituida_por.numero }}.
                        </template>
                        <template v-else>
                            Esta factura se reemplazó por otra; la verás aquí en cuanto esté lista.
                        </template>
                    </p>
                    <p
                        v-if="factura.sustituye_a"
                        class="text-xs text-default"
                        data-testid="sustituye"
                    >
                        Reemplaza a la factura {{ factura.sustituye_a.numero }}.
                    </p>
                </PortalFila>
            </template>
            <li
                v-if="filasVisibles.length === 0"
                class="px-4 py-8 text-center text-sm text-muted"
                data-testid="facturas-filtro-vacio"
            >
                {{ filtro === 'por_pagar' ? 'No tienes facturas por pagar.' : 'No tienes facturas pagadas.' }}
            </li>
        </PortalLista>

        <PortalDetalle
            v-if="detalle"
            v-model:open="verDetalle"
            :titulo="conceptoFactura(detalle)"
            :descripcion="`${nombreDocumento(detalle)} · ${presentacionFactura(detalle).etiqueta}`"
            :icono="detalle.tipo === 'mora' ? 'i-lucide-receipt-text' : 'i-lucide-receipt'"
            :tono="tonoDeColor(presentacionFactura(detalle).color)"
            :datos="datosDetalle(detalle)"
        >
            <div
                v-if="detalle.dte"
                class="ax-lista flex flex-col gap-1 px-4 py-3 text-xs text-muted"
                data-testid="dte"
            >
                <p class="font-medium text-highlighted">
                    Factura electrónica (FEL)<template v-if="detalle.dte.certificado_en">
                        · certificada el {{ formatearFecha(detalle.dte.certificado_en) }}
                    </template>
                </p>
                <p class="break-all">
                    Autorización <span
                        class="font-mono text-default"
                        data-cursor="copy"
                    >{{ detalle.dte.autorizacion }}</span>
                </p>
                <p
                    v-if="detalle.dte.estado === 'anulacion_pendiente'"
                    class="text-warning"
                >
                    Anulación en trámite ante la SAT.
                </p>
                <p v-else-if="detalle.dte.estado === 'anulado'">
                    Anulada ante la SAT.
                </p>
            </div>
            <template #pie>
                <UButton
                    v-if="detalle.dte?.xml_disponible"
                    data-testid="detalle-xml"
                    label="Descargar XML"
                    icon="i-lucide-file-code"
                    color="neutral"
                    variant="outline"
                    :to="urlXml(detalle.id)"
                    external
                    download
                />
                <UButton
                    data-testid="detalle-pdf"
                    :label="etiquetaPdf(detalle)"
                    icon="i-lucide-file-down"
                    :to="urlPdf(detalle.id)"
                    target="_blank"
                    external
                />
            </template>
        </PortalDetalle>
    </CuentaEstadoLista>
</template>
