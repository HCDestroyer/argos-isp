<script setup lang="ts">
/**
 * Notas de crédito del cliente (estado de cuenta): lo que se le acreditó a cada factura.
 *
 * - Con FEL, la nota certificada es una NCRE con su autorización y su XML.
 * - El PDF (marca de la empresa, datos de la NCRE y la factura de origen) lo genera la API.
 * - Una nota anulada (la SAT rechazó su NCRE) se muestra como tal: su monto volvió al saldo.
 */
const { items, cargando, cargado, problema, hayMas, recargar, cargarMas, urlXml, urlPdf } = useNotasCredito()

onMounted(recargar)
</script>

<template>
    <CuentaEstadoLista
        :cargando="cargando"
        :cargado="cargado"
        :problema="problema"
        :vacia="items.length === 0"
        :hay-mas="hayMas"
        texto-vacio="No tienes notas de crédito"
        icono-vacio="i-lucide-receipt-text"
        @reintentar="recargar"
        @cargar-mas="cargarMas"
    >
        <PortalLista :columnas="{ concepto: 'Nota de crédito', monto: 'Monto', estado: 'Estado' }">
            <PortalFila
                v-for="nota in items"
                :key="nota.id"
                :titulo="nombreNotaCredito(nota)"
                :subtitulo="`${formatearFecha(nota.fecha)} · a la factura ${nota.factura_numero}`"
                icono="i-lucide-receipt-text"
                :tono="tonoDeColor(ESTADOS_NOTA_CREDITO[nota.estado].color)"
                :estado="ESTADOS_NOTA_CREDITO[nota.estado]"
                data-testid="nota-credito"
            >
                <template #acciones>
                    <UButton
                        data-testid="descargar-pdf"
                        label="Ver nota de crédito (PDF)"
                        icon="i-lucide-file-down"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :to="urlPdf(nota.id)"
                        target="_blank"
                        external
                        class="ax-pista"
                        data-pista="Ver PDF"
                        :ui="{ label: 'sr-only' }"
                    />
                    <UButton
                        v-if="nota.dte?.xml_disponible"
                        data-testid="descargar-xml"
                        label="Descargar XML"
                        icon="i-lucide-file-code"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :to="urlXml(nota.id)"
                        external
                        download
                        class="ax-pista"
                        data-pista="Descargar XML"
                        :ui="{ label: 'sr-only' }"
                    />
                </template>
                <p class="text-xs text-muted">
                    {{ nota.motivo }}
                    <span
                        class="ms-1 font-semibold whitespace-nowrap tabular-nums"
                        :class="nota.estado === 'anulada' ? 'text-muted line-through' : 'text-highlighted'"
                    >−{{ formatearQuetzales(nota.monto) }}</span>
                </p>
                <p
                    v-if="nota.estado === 'anulada'"
                    class="text-xs text-muted"
                >
                    La SAT no aceptó esta nota: el monto volvió al saldo de la factura.
                </p>
                <p
                    v-if="nota.dte"
                    class="text-xs break-all text-muted"
                    data-testid="dte"
                >
                    Autorización <span
                        class="font-mono text-default"
                        data-cursor="copy"
                    >{{ nota.dte.autorizacion }}</span>
                </p>
            </PortalFila>
        </PortalLista>
    </CuentaEstadoLista>
</template>
