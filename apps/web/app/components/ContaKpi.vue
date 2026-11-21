<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Indicador de Finanzas (tableros ContaPanel, ContaFiscal, ContaCartera): ícono en pastilla con su
 * tono, título, filete, la cifra grande y abajo una pastilla de variación y su contexto.
 * - `valor` null mientras carga (esqueleto);
 * - `problema`: «No se pudo leer» con «Reintentar», nunca una cifra inventada;
 * - `sinApi`: el diseño lo pide y la API aún no lo da; se dice qué falta.
 */
withDefaults(defineProps<{
    titulo: string
    icono: string
    tono?: string
    valor: string | null
    /** Pastilla bajo la cifra (variación o porcentaje). */
    variacion?: string
    tonoVariacion?: 'exito' | 'error' | 'neutral'
    detalle?: string
    /** Insignia junto al título (p. ej. «82 % del límite»). */
    insignia?: string
    problema?: Problem | null
    sinApi?: string
    ayuda?: string
}>(), {
    tono: 'tono-marca',
    variacion: undefined,
    tonoVariacion: 'neutral',
    detalle: undefined,
    insignia: undefined,
    problema: null,
    sinApi: undefined,
    ayuda: undefined,
})

const emit = defineEmits<{
    reintentar: []
}>()

const COLOR_VARIACION = {
    exito: 'success',
    error: 'error',
    neutral: 'neutral',
} as const
</script>

<template>
    <div
        class="surface-card flex min-w-0 flex-col gap-2 rounded-2xl p-4"
        data-prueba="kpi-conta"
    >
        <div class="flex min-w-0 items-center gap-2 border-b border-(--ax-borde) pb-2.5">
            <span
                class="pastilla-icono pastilla-tono size-7 shrink-0 rounded-lg"
                :class="tono"
            >
                <UIcon
                    :name="icono"
                    class="size-4"
                />
            </span>
            <span class="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-default">{{ titulo }}</span>
            <UTooltip
                v-if="ayuda"
                :text="ayuda"
            >
                <UButton
                    icon="i-lucide-circle-help"
                    color="neutral"
                    variant="link"
                    size="xs"
                    class="p-0"
                    data-ayuda
                    :aria-label="`Qué es ${titulo}`"
                />
            </UTooltip>
            <UBadge
                v-if="insignia"
                :label="insignia"
                color="warning"
                variant="soft"
                size="sm"
            />
        </div>
        <template v-if="problema">
            <span class="text-base font-semibold text-highlighted">No se pudo leer</span>
            <UButton
                label="Reintentar"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="link"
                size="xs"
                class="self-start px-0"
                @click="emit('reintentar')"
            />
        </template>
        <template v-else-if="sinApi">
            <span class="text-base font-semibold text-muted">Sin datos todavía</span>
            <span
                class="text-xs text-muted"
                data-prueba="kpi-sin-api"
            >{{ sinApi }}</span>
        </template>
        <USkeleton
            v-else-if="valor === null"
            class="h-8 w-32"
        />
        <template v-else>
            <span class="text-[1.625rem] leading-tight font-bold tracking-[-0.02em] text-highlighted tabular-nums">{{ valor }}</span>
            <span
                v-if="variacion || detalle"
                class="flex min-w-0 items-center gap-2 text-xs text-muted"
            >
                <UBadge
                    v-if="variacion"
                    :label="variacion"
                    :color="COLOR_VARIACION[tonoVariacion]"
                    variant="soft"
                    size="sm"
                    class="tabular-nums"
                />
                <span class="truncate">{{ detalle }}</span>
            </span>
        </template>
    </div>
</template>
