<script setup lang="ts">
import type { Schema } from '@argosisp/contracts'

/**
 * Monto adeudado y facturas vencidas (cantidad y total) del servicio identificado por IP, como el
 * recuadro «Total vencido» de la tarjeta de `/corte` (tablero `Portal`). El estado lo pone la tarjeta.
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
    <div
        class="flex flex-col gap-3 rounded-xl bg-elevated px-4 py-3.5"
        data-testid="resumen-deuda"
    >
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p class="text-sm text-muted">
                {{ pendiente ? 'Cargos pendientes' : 'Monto pendiente' }}
            </p>
            <p
                class="text-3xl font-bold tracking-[-0.02em] tabular-nums text-highlighted"
                data-testid="monto-adeudado"
            >
                {{ corte.monto_adeudado === null ? 'No disponible' : formatearQuetzales(corte.monto_adeudado) }}
            </p>
        </div>

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
            class="flex items-center justify-between gap-3 border-t border-default pt-3 text-sm"
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
            class="flex items-center gap-2 border-t border-default pt-3 text-sm text-muted"
        >
            <UIcon
                name="i-lucide-circle-check"
                class="size-4 shrink-0 text-success"
            />
            Sin facturas vencidas
        </p>

        <UAlert
            v-if="corte.promesa_activa && !pendiente"
            color="info"
            variant="subtle"
            icon="i-lucide-calendar-check"
            title="Tienes una promesa de pago activa"
        />
    </div>
</template>
