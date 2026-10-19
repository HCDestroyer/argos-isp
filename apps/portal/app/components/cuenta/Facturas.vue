<script setup lang="ts">
import Decimal from 'decimal.js'

/**
 * Facturas del cliente: concepto, estado, total, saldo, vencimiento, el PDF y, con FEL, su DTE.
 *
 * - Un aviso de cobro se llama «Factura» (o «Nota de débito» en la mora) solo cuando su DTE está
 *   certificado: la API lo dice en `documento` y trae la autorización, serie y número en `dte`.
 * - Una factura sustituida dice «Sustituida» y a cuál la reemplaza; la nueva dice a cuál sustituye.
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
</script>

<template>
    <CuentaEstadoLista
        :cargando="cargando"
        :cargado="cargado"
        :problema="problema"
        :vacia="filas.length === 0"
        :hay-mas="hayMasFilas"
        texto-vacio="Todavía no tienes facturas"
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
        <template
            v-for="{ clave, factura, bonificacion } in filas"
            :key="clave"
        >
            <CuentaBonificacion
                v-if="bonificacion"
                :bonificacion="bonificacion"
            />
            <UCard
                v-else-if="factura"
                data-testid="factura"
                :ui="{ body: 'p-4 sm:p-4' }"
            >
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="font-medium text-highlighted">
                            {{ conceptoFactura(factura) }}
                        </p>
                        <p
                            class="text-xs text-muted break-words"
                            data-testid="documento"
                        >
                            {{ nombreDocumento(factura) }} · vence {{ formatearFecha(factura.vence_en) }}
                        </p>
                    </div>
                    <UBadge
                        :label="presentacionFactura(factura).etiqueta"
                        :color="presentacionFactura(factura).color"
                        :icon="presentacionFactura(factura).icono"
                        variant="subtle"
                        class="shrink-0"
                        data-testid="estado-factura"
                    />
                </div>

                <div class="mt-3 flex items-end justify-between gap-3">
                    <div>
                        <p class="text-xs text-muted">
                            Total
                        </p>
                        <p class="tabular-nums text-default">
                            {{ formatearQuetzales(factura.total) }}
                        </p>
                    </div>
                    <div
                        v-if="factura.estado !== 'anulada' && factura.estado !== 'pagada'"
                        class="text-right"
                    >
                        <p class="text-xs text-muted">
                            Saldo
                        </p>
                        <p class="font-semibold tabular-nums text-highlighted">
                            {{ formatearQuetzales(factura.saldo) }}
                        </p>
                    </div>
                </div>

                <p
                    v-if="conCredito(factura)"
                    class="mt-2 text-xs text-muted"
                    data-testid="acreditado"
                >
                    Notas de crédito: −{{ formatearQuetzales(factura.acreditado) }}
                </p>

                <p
                    v-if="factura.sustituida"
                    class="mt-2 text-sm text-default"
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
                    class="mt-2 text-sm text-default"
                    data-testid="sustituye"
                >
                    Reemplaza a la factura {{ factura.sustituye_a.numero }}.
                </p>

                <div
                    v-if="factura.dte"
                    class="mt-3 rounded-md bg-elevated/60 px-3 py-2 text-xs text-muted"
                    data-testid="dte"
                >
                    <p>
                        Factura electrónica (FEL)<template v-if="factura.dte.certificado_en">
                            · certificada el {{ formatearFecha(factura.dte.certificado_en) }}
                        </template>
                    </p>
                    <p class="break-all">
                        Autorización <span class="font-mono text-default">{{ factura.dte.autorizacion }}</span>
                    </p>
                    <p
                        v-if="factura.dte.estado === 'anulacion_pendiente'"
                        class="mt-1 text-warning"
                    >
                        Anulación en trámite ante la SAT.
                    </p>
                    <p
                        v-else-if="factura.dte.estado === 'anulado'"
                        class="mt-1"
                    >
                        Anulada ante la SAT.
                    </p>
                </div>

                <div class="mt-3 flex flex-wrap gap-2">
                    <UButton
                        data-testid="descargar-pdf"
                        :label="etiquetaPdf(factura)"
                        icon="i-lucide-file-down"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        :to="urlPdf(factura.id)"
                        target="_blank"
                        external
                    />
                    <UButton
                        v-if="factura.dte?.xml_disponible"
                        data-testid="descargar-xml"
                        label="Descargar XML"
                        icon="i-lucide-file-code"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :to="urlXml(factura.id)"
                        external
                        download
                    />
                </div>
            </UCard>
        </template>
    </CuentaEstadoLista>
</template>
