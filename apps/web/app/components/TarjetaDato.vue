<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Contador de una ficha (tablero NuevoClienteFicha): pastilla con ícono y tono, etiqueta, valor y
 * contexto. `valor` null mientras carga (esqueleto) o si falló (`problema`: «No se pudo leer» con
 * «Reintentar»): nunca un cero inventado.
 */
withDefaults(defineProps<{
    etiqueta: string
    icono: string
    /** `tono-marca`, `tono-exito`, `tono-aviso` o `tono-error`. */
    tono?: string
    valor: string | null
    detalle?: string
    peligro?: boolean
    problema?: Problem | null
}>(), {
    tono: 'tono-marca',
    detalle: undefined,
    peligro: false,
    problema: null,
})

const emit = defineEmits<{
    reintentar: []
}>()
</script>

<template>
    <div class="surface-card flex min-w-0 items-center gap-3 rounded-2xl p-3 sm:p-4">
        <span class="hidden shrink-0 sm:block">
            <span
                class="pastilla-icono pastilla-tono size-10 shrink-0 rounded-xl"
                :class="tono"
            >
                <UIcon
                    :name="icono"
                    class="size-5"
                />
            </span>
        </span>
        <div class="flex min-w-0 flex-col">
            <span class="truncate text-[0.8125rem] text-muted">{{ etiqueta }}</span>
            <template v-if="problema">
                <span class="text-sm font-semibold text-highlighted">No se pudo leer</span>
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
            <USkeleton
                v-else-if="valor === null"
                class="mt-1 h-6 w-24"
            />
            <template v-else>
                <span
                    class="truncate text-lg font-bold tabular-nums sm:text-[1.375rem]"
                    :class="peligro ? 'text-error' : 'text-highlighted'"
                >{{ valor }}</span>
                <span
                    v-if="detalle"
                    class="truncate text-xs text-muted"
                >{{ detalle }}</span>
            </template>
        </div>
    </div>
</template>
