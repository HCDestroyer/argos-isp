<script setup lang="ts">
/** Historial de puntos: lo ganado en verde con «+», lo que salió (canjes, vencidos) en neutro. */
const props = defineProps<{
    movimientos: MovimientoPuntos[]
}>()
</script>

<template>
    <p
        v-if="props.movimientos.length === 0"
        class="text-sm text-muted"
    >
        Aún no tienes movimientos de puntos.
    </p>
    <UCard
        v-else
        :ui="{ body: 'p-0 sm:p-0' }"
    >
        <ul
            class="divide-y divide-default"
            data-testid="movimientos-puntos"
        >
            <li
                v-for="movimiento in props.movimientos"
                :key="movimiento.id"
                class="flex items-center justify-between gap-3 px-4 py-3"
                data-testid="movimiento-puntos"
            >
                <div class="min-w-0">
                    <p class="truncate text-sm text-default">
                        {{ conceptoMovimiento(movimiento) }}
                    </p>
                    <p class="text-xs text-muted">
                        {{ formatearFecha(movimiento.created_at) }}<template v-if="movimiento.puntos > 0 && movimiento.vence_en">
                            · vencen el {{ formatearFecha(movimiento.vence_en) }}
                        </template>
                    </p>
                </div>
                <p
                    class="shrink-0 font-semibold tabular-nums"
                    :class="movimiento.puntos > 0 ? 'text-success' : 'text-muted'"
                >
                    {{ movimiento.puntos > 0 ? '+' : '' }}{{ formatearPuntos(movimiento.puntos) }}
                </p>
            </li>
        </ul>
    </UCard>
</template>
