<script setup lang="ts">
/**
 * Un lugar donde puede estar el efectivo en el camino del efectivo (tablero PlanCajas): ícono,
 * nombre, el monto y una línea de quién lo tiene. `aviso` (ámbar) o `bien` (verde) agregan su
 * pastilla con ícono y texto.
 */
withDefaults(defineProps<{
    icono: string
    tono: string
    titulo: string
    valor: string
    detalle: string
    aviso?: string
    bien?: string
}>(), {
    aviso: undefined,
    bien: undefined,
})
</script>

<template>
    <div
        class="flex min-w-0 flex-1 flex-col gap-0.5 rounded-2xl border-[1.5px] border-(--ax-borde) bg-(--ax-tarjeta) px-3.5 py-3"
        data-prueba="nodo-efectivo"
    >
        <div class="flex items-center gap-2">
            <span
                class="pastilla-icono pastilla-tono size-7.5 shrink-0 rounded-lg"
                :class="tono"
            >
                <UIcon
                    :name="icono"
                    class="size-4"
                />
            </span>
            <span class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted">{{ titulo }}</span>
            <UBadge
                v-if="aviso"
                :label="aviso"
                icon="i-lucide-clock"
                color="warning"
                variant="soft"
                size="sm"
                class="rounded-full"
            />
            <UBadge
                v-else-if="bien"
                :label="bien"
                icon="i-lucide-check"
                color="success"
                variant="soft"
                size="sm"
                class="rounded-full"
            />
        </div>
        <span class="text-xl font-bold tabular-nums text-highlighted">{{ valor }}</span>
        <span class="line-clamp-2 text-xs text-muted">{{ detalle }}</span>
    </div>
</template>
