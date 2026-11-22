<script setup lang="ts">
/**
 * Una fila de la lista de tickets: ícono del estado, asunto (o el número si la sesión es por la IP
 * de `/corte`, que no ve el asunto), número, cuándo cambió y la etiqueta del estado. Con `to` se
 * abre el detalle.
 */
const props = defineProps<{
    ticket: TicketSoporte
    to?: string
}>()

const estado = computed(() => ESTADOS_TICKET[props.ticket.estado])
</script>

<template>
    <ULink
        :to="props.to"
        :disabled="!props.to"
        class="flex min-h-14 items-center gap-3 py-3"
        :class="props.to ? 'rounded-lg hover:bg-elevated/60' : ''"
        data-testid="ticket"
    >
        <span
            class="flex size-8 shrink-0 items-center justify-center rounded-lg"
            :class="{
                'bg-info/10 text-info': estado.color === 'info',
                'bg-warning/10 text-warning': estado.color === 'warning',
                'bg-success/10 text-success': estado.color === 'success',
                'bg-elevated text-muted': estado.color === 'neutral',
            }"
        >
            <UIcon
                :name="estado.icono"
                class="size-4"
            />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate font-medium text-highlighted">
                {{ props.ticket.asunto ?? `Ticket ${props.ticket.numero}` }}
            </span>
            <span class="truncate text-xs text-muted">
                {{ props.ticket.numero }} · {{ haceCuanto(props.ticket.actualizado_en) }}
                <template v-if="props.ticket.afectado_por_incidente"> · Falla en tu zona</template>
            </span>
        </span>
        <UBadge
            :label="estado.etiqueta"
            :color="estado.color"
            variant="subtle"
            class="shrink-0"
        />
        <UIcon
            v-if="props.to"
            name="i-lucide-chevron-right"
            class="size-4 shrink-0 text-dimmed"
        />
    </ULink>
</template>
