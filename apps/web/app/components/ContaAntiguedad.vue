<script setup lang="ts">
import Decimal from 'decimal.js'

/**
 * Antigüedad de un saldo (cartera de clientes o cuentas por pagar; tableros ContaPanel, ContaCartera
 * y ContaCompras): barra apilada de «por vencer» al más viejo y, debajo, una fila por tramo con su
 * monto y su parte. Los colores van del gris al café (secuencia de urgencia, igual en claro y
 * oscuro) y cada tramo lleva su texto: el color nunca es lo único que lo dice.
 */
const props = withDefaults(defineProps<{
    tramos: TramoAntiguedad[]
    /** `lista`: barra y filas; `barra`: la barra con la leyenda en línea (cartera); `solo`: la barra. */
    modo?: 'lista' | 'barra' | 'solo'
    etiqueta: string
    /** Ancho de la barra en % (para comparar grupos en la misma escala, visor de cartera). */
    escala?: number
}>(), {
    modo: 'lista',
    escala: 100,
})

const COLORES: Record<string, string> = {
    por_vencer: 'bg-slate-300 dark:bg-slate-500',
    dias_0_30: 'bg-orange-300',
    dias_31_60: 'bg-orange-500',
    dias_61_90: 'bg-orange-700',
    dias_mas_90: 'bg-orange-900 dark:bg-orange-950',
}

const total = computed(() => props.tramos.reduce((suma, t) => suma.plus(t.monto), new Decimal(0)))

function parte(monto: string): number {
    return total.value.isZero() ? 0 : new Decimal(monto).div(total.value).times(100).toNumber()
}
</script>

<template>
    <div
        class="flex min-w-0 flex-col gap-2"
        data-prueba="antiguedad"
    >
        <div
            class="flex h-5 gap-0.5 overflow-hidden rounded-md"
            :class="modo === 'solo' ? '' : 'bg-(--ax-panel)'"
            :style="{ width: `${Math.max(escala, 2)}%` }"
            role="img"
            :aria-label="`${etiqueta}: ${tramos.map(t => `${t.etiqueta} ${formatearQuetzales(t.monto)}`).join(', ')}`"
        >
            <span
                v-for="tramo in tramos.filter(t => parte(t.monto) > 0)"
                :key="tramo.clave"
                class="h-full"
                :class="COLORES[tramo.clave] ?? 'bg-slate-400'"
                :style="{ width: `${parte(tramo.monto)}%` }"
            />
        </div>
        <div
            v-if="modo === 'barra'"
            class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
        >
            <span
                v-for="tramo in tramos"
                :key="tramo.clave"
                class="flex items-center gap-1.5"
            >
                <span
                    class="size-2.5 rounded-sm"
                    :class="COLORES[tramo.clave]"
                />
                {{ tramo.etiqueta }}
                <strong class="text-highlighted tabular-nums">{{ formatearQuetzales(tramo.monto) }}</strong>
            </span>
        </div>
        <ul
            v-else-if="modo === 'lista'"
            class="divide-y divide-(--ax-borde)"
        >
            <li
                v-for="tramo in tramos"
                :key="tramo.clave"
                class="flex items-center gap-2.5 py-2 text-sm"
            >
                <span
                    class="size-2.5 shrink-0 rounded-sm"
                    :class="COLORES[tramo.clave]"
                />
                <span class="min-w-0 flex-1 truncate">{{ tramo.etiqueta }}</span>
                <span class="tabular-nums">{{ formatearQuetzales(tramo.monto) }}</span>
                <span class="w-12 text-right text-muted tabular-nums">{{ Math.round(parte(tramo.monto)) }} %</span>
            </li>
        </ul>
    </div>
</template>
