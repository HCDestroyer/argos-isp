<script setup lang="ts">
import type { Schema } from '@argosisp/contracts'

/**
 * Monto adeudado, estado y facturas vencidas (cantidad y total) del servicio identificado por IP.
 *
 * Pendiente de instalación (`contratos/instalacion.md` §3): solo sus cargos únicos. Sin facturas
 * vencidas en rojo ni promesa: no hay corte que evitar.
 */
const props = defineProps<{
    corte: Schema<'QuienSoy'>
}>()

const pendiente = computed(() => esPendienteInstalacion(props.corte.estado))

const vencidas = computed(() => props.corte.facturas_vencidas)
const tieneVencidas = computed(() => !pendiente.value && (vencidas.value?.cantidad ?? 0) > 0)
const etiquetaVencidas = computed(() => {
    const cantidad = vencidas.value?.cantidad ?? 0
    return cantidad === 1 ? '1 factura vencida' : `${cantidad} facturas vencidas`
})
</script>

<template>
    <UCard>
        <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
                <p class="text-sm text-muted">
                    {{ pendiente ? 'Cargos pendientes' : 'Monto pendiente' }}
                </p>
                <p
                    class="mt-1 text-3xl font-bold tabular-nums text-highlighted"
                    data-testid="monto-adeudado"
                >
                    {{ corte.monto_adeudado === null ? 'No disponible' : formatearQuetzales(corte.monto_adeudado) }}
                </p>
            </div>
            <EstadoServicioBadge
                v-if="corte.estado"
                :estado="corte.estado"
                size="lg"
            />
        </div>

        <template #footer>
            <p
                v-if="pendiente"
                class="flex items-center gap-2 text-sm text-muted"
                data-testid="instalacion-pendiente"
            >
                <UIcon
                    name="i-lucide-calendar-clock"
                    class="size-4 shrink-0"
                />
                Tu mensualidad empieza a cobrarse el día de la instalación.
            </p>
            <div
                v-else-if="tieneVencidas"
                class="flex items-center justify-between gap-3 text-sm"
                data-testid="facturas-vencidas"
            >
                <span class="flex min-w-0 items-center gap-2 font-medium text-error">
                    <UIcon
                        name="i-lucide-calendar-x"
                        class="size-4 shrink-0"
                    />
                    <span class="truncate">{{ etiquetaVencidas }}</span>
                </span>
                <span class="shrink-0 font-medium tabular-nums text-highlighted">
                    {{ formatearQuetzales(vencidas?.total) }}
                </span>
            </div>
            <!-- Sin el dato de vencidas no se afirma "Sin facturas vencidas". -->
            <p
                v-else-if="vencidas"
                class="flex items-center gap-2 text-sm text-muted"
            >
                <UIcon
                    name="i-lucide-calendar-check"
                    class="size-4 shrink-0"
                />
                Sin facturas vencidas
            </p>

            <UAlert
                v-if="corte.promesa_activa && !pendiente"
                class="mt-3"
                color="info"
                variant="subtle"
                icon="i-lucide-hand-coins"
                title="Tienes una promesa de pago activa"
            />
        </template>
    </UCard>
</template>
