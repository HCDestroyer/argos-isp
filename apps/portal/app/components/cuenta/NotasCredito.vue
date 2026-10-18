<script setup lang="ts">
/**
 * Notas de crédito del cliente (estado de cuenta): lo que se le acreditó a cada factura.
 *
 * - Con FEL, la nota certificada es una NCRE con su autorización y su XML.
 * - Una nota anulada (la SAT rechazó su NCRE) se muestra como tal: su monto volvió al saldo.
 */
const { items, cargando, cargado, problema, hayMas, recargar, cargarMas, urlXml } = useNotasCredito()

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
        <UCard
            v-for="nota in items"
            :key="nota.id"
            data-testid="nota-credito"
            :ui="{ body: 'p-4 sm:p-4' }"
        >
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="font-medium text-highlighted break-words">
                        {{ nombreNotaCredito(nota) }}
                    </p>
                    <p class="text-xs text-muted break-words">
                        {{ formatearFecha(nota.fecha) }} · a la factura {{ nota.factura_numero }}
                    </p>
                </div>
                <UBadge
                    :label="ESTADOS_NOTA_CREDITO[nota.estado].etiqueta"
                    :color="ESTADOS_NOTA_CREDITO[nota.estado].color"
                    :icon="ESTADOS_NOTA_CREDITO[nota.estado].icono"
                    variant="subtle"
                    class="shrink-0"
                />
            </div>

            <div class="mt-3 flex items-end justify-between gap-3">
                <p class="min-w-0 text-xs text-muted">
                    {{ nota.motivo }}
                </p>
                <p
                    class="shrink-0 font-semibold tabular-nums"
                    :class="nota.estado === 'anulada' ? 'text-muted line-through' : 'text-highlighted'"
                >
                    −{{ formatearQuetzales(nota.monto) }}
                </p>
            </div>

            <p
                v-if="nota.estado === 'anulada'"
                class="mt-2 text-xs text-muted"
            >
                La SAT no aceptó esta nota: el monto volvió al saldo de la factura.
            </p>

            <div
                v-if="nota.dte"
                class="mt-3 rounded-md bg-elevated/60 px-3 py-2 text-xs text-muted"
                data-testid="dte"
            >
                <p class="break-all">
                    Autorización <span class="font-mono text-default">{{ nota.dte.autorizacion }}</span>
                </p>
            </div>

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
                class="mt-3"
            />
        </UCard>
    </CuentaEstadoLista>
</template>
