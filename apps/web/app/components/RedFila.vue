<script setup lang="ts">
/**
 * Fila «dato: valor» de las tarjetas de Red y del servicio, con línea fina arriba (tableros
 * RedRouterFicha, RedPlanes, RedSesiones, OperServicioFicha). `mono` para IPs y prefijos; el
 * valor puede venir por el slot (con badges o enlaces).
 */
withDefaults(defineProps<{
    etiqueta: string
    valor?: string | null
    mono?: boolean
}>(), {
    valor: undefined,
    mono: false,
})
</script>

<template>
    <div class="flex min-w-0 items-center justify-between gap-3 border-t border-(--ax-borde) py-2 text-sm first:border-t-0">
        <dt class="shrink-0 text-muted">
            {{ etiqueta }}
        </dt>
        <dd
            class="min-w-0 truncate text-end font-medium text-highlighted"
            :class="mono ? 'font-mono text-[0.8125rem]' : ''"
        >
            <slot>{{ valor ?? '—' }}</slot>
        </dd>
    </div>
</template>
