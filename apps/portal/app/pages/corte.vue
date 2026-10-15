<script setup lang="ts">
/**
 * Página de corte (estructura del día 1). A5 la completa el día 2: identificación por IP,
 * datos de depósito, comprobante, promesa y estado en vivo.
 */
const { empresa } = useRuntimeConfig().public
const { data: corte, status } = useCorte()

useHead({ title: `Estado del servicio · ${empresa.nombre}` })

const cargando = computed(() => status.value === 'idle' || status.value === 'pending')

const acciones = [
    { label: 'Pagar en línea', icon: 'i-lucide-credit-card', color: 'primary', variant: 'solid' },
    { label: 'Ver datos de depósito', icon: 'i-lucide-landmark', color: 'neutral', variant: 'outline' },
    { label: 'Subir comprobante', icon: 'i-lucide-upload', color: 'neutral', variant: 'outline' },
    { label: 'Solicitar promesa de pago', icon: 'i-lucide-hand-coins', color: 'neutral', variant: 'outline' },
] as const
</script>

<template>
    <div class="flex flex-col gap-4">
        <template v-if="cargando">
            <USkeleton class="h-8 w-2/3" />
            <USkeleton class="h-40 w-full" />
            <USkeleton class="h-24 w-full" />
        </template>

        <UAlert
            v-else-if="!corte"
            color="neutral"
            variant="subtle"
            icon="i-lucide-wifi-off"
            title="No pudimos identificar tu servicio"
            description="Conéctate desde la red de tu servicio de internet o comunícate con soporte."
        />

        <template v-else>
            <div>
                <p class="text-sm text-muted">
                    Hola, {{ corte.cliente.nombreParcial }}
                </p>
                <h1 class="mt-1 text-2xl font-semibold text-highlighted">
                    Tu servicio está {{ ESTADOS_SERVICIO[corte.servicio.estado].etiqueta.toLowerCase() }}
                </h1>
            </div>

            <UCard>
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-sm text-muted">
                            Monto pendiente
                        </p>
                        <p class="mt-1 text-3xl font-bold tabular-nums text-highlighted">
                            {{ formatearQuetzales(corte.montoAdeudado) }}
                        </p>
                        <p class="mt-1 truncate text-sm text-muted">
                            Plan {{ corte.servicio.plan }}
                        </p>
                    </div>
                    <EstadoServicioBadge
                        :estado="corte.servicio.estado"
                        size="lg"
                    />
                </div>

                <template #footer>
                    <p class="mb-2 text-sm font-medium text-highlighted">
                        Facturas vencidas ({{ corte.facturasVencidas.length }})
                    </p>
                    <ul class="divide-y divide-default">
                        <li
                            v-for="factura in corte.facturasVencidas"
                            :key="factura.numero"
                            class="flex items-center justify-between gap-3 py-2 text-sm"
                        >
                            <div class="min-w-0">
                                <p class="font-medium text-default">
                                    {{ factura.numero }}
                                </p>
                                <p class="text-xs text-muted">
                                    Venció el {{ formatearFecha(factura.venceEn) }}
                                </p>
                            </div>
                            <span class="shrink-0 tabular-nums text-default">{{ formatearQuetzales(factura.total) }}</span>
                        </li>
                    </ul>
                </template>
            </UCard>

            <div class="flex flex-col gap-2">
                <UButton
                    v-for="accion in acciones"
                    :key="accion.label"
                    :label="accion.label"
                    :icon="accion.icon"
                    :color="accion.color"
                    :variant="accion.variant"
                    size="xl"
                    block
                    disabled
                />
                <p class="text-center text-xs text-muted">
                    Estas opciones se activan en los próximos días.
                </p>
            </div>

            <UButton
                :label="empresa.telefono ? `Llamar a soporte: ${empresa.telefono}` : 'Contactar a soporte'"
                icon="i-lucide-phone"
                color="neutral"
                variant="ghost"
                size="lg"
                block
                :to="empresa.telefono ? `tel:${empresa.telefono}` : undefined"
                :disabled="!empresa.telefono"
            />
        </template>
    </div>
</template>
