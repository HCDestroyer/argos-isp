<script setup lang="ts">
/**
 * Saldo de puntos de una empresa, con el número que sube hasta el saldo al aparecer y al cambiar
 * (tras un canje baja). Con `prefers-reduced-motion` se muestra el número directo. Debajo, el aviso
 * de los puntos que vencen pronto (fecha por fecha) y el mínimo para canjear.
 *
 * Lectores de pantalla: el número animado es `aria-hidden`; el saldo real va en texto aparte.
 */
const props = defineProps<{
    puntos: PuntosEmpresa
}>()

const reducido = useMovimientoReducido()
const mostrado = ref(0)
let cuadro: number | null = null

function animarHasta(destino: number) {
    if (cuadro !== null) {
        cancelAnimationFrame(cuadro)
        cuadro = null
    }
    if (reducido.value || typeof requestAnimationFrame !== 'function') {
        mostrado.value = destino
        return
    }
    const desde = mostrado.value
    const duracion = 900
    const inicio = performance.now()
    const paso = (ahora: number) => {
        const t = Math.min(1, (ahora - inicio) / duracion)
        // desacelera al final (ease-out cúbico)
        const curva = 1 - (1 - t) ** 3
        mostrado.value = Math.round(desde + (destino - desde) * curva)
        cuadro = t < 1 ? requestAnimationFrame(paso) : null
    }
    cuadro = requestAnimationFrame(paso)
}

onMounted(() => animarHasta(props.puntos.saldo))
watch(() => props.puntos.saldo, animarHasta)
watch(reducido, (r) => {
    if (r) {
        animarHasta(props.puntos.saldo)
    }
})
onBeforeUnmount(() => {
    if (cuadro !== null) {
        cancelAnimationFrame(cuadro)
    }
})

const negativo = computed(() => props.puntos.saldo < 0)
</script>

<template>
    <UCard
        :ui="{ body: 'p-4 sm:p-5' }"
        data-testid="puntos-saldo"
    >
        <div class="flex items-center gap-4">
            <div class="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UIcon
                    name="i-lucide-sparkles"
                    class="size-7"
                />
            </div>
            <div class="min-w-0">
                <p class="text-sm text-muted">
                    {{ props.puntos.programa.nombre }}
                </p>
                <p class="flex items-baseline gap-2">
                    <span
                        class="text-4xl font-semibold tabular-nums text-highlighted"
                        aria-hidden="true"
                        data-testid="saldo-animado"
                    >{{ formatearPuntos(mostrado) }}</span>
                    <span
                        class="text-sm text-muted"
                        aria-hidden="true"
                    >puntos</span>
                    <span
                        class="sr-only"
                        data-testid="saldo-puntos"
                    >Tienes {{ puntosEnTexto(props.puntos.saldo) }}</span>
                </p>
            </div>
        </div>

        <p
            v-if="negativo"
            class="mt-3 text-sm text-error"
        >
            Tu saldo quedó en negativo por una corrección; con saldo negativo no se puede canjear.
        </p>
        <p
            v-else-if="props.puntos.saldo < props.puntos.programa.minimo_canje"
            class="mt-3 text-sm text-muted"
            data-testid="minimo-canje"
        >
            Puedes canjear desde {{ puntosEnTexto(props.puntos.programa.minimo_canje) }}.
        </p>

        <UAlert
            v-if="props.puntos.vencen_pronto.length > 0"
            class="mt-4"
            color="warning"
            variant="subtle"
            icon="i-lucide-hourglass"
            :title="`${puntosEnTexto(props.puntos.por_vencer)} vencen pronto`"
            data-testid="puntos-por-vencer"
        >
            <template #description>
                <ul class="mt-1 space-y-0.5">
                    <li
                        v-for="lote in props.puntos.vencen_pronto"
                        :key="lote.vence_en"
                        class="tabular-nums"
                    >
                        {{ puntosEnTexto(lote.puntos) }} el {{ formatearFecha(lote.vence_en) }}
                    </li>
                </ul>
                <p class="mt-1">
                    Canjéalos antes para no perderlos.
                </p>
            </template>
        </UAlert>
    </UCard>
</template>
