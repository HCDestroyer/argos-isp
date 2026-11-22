<script setup lang="ts">
/**
 * Ajuste que el PM ya decidió y cuya API todavía se construye en otra rama: se muestra qué se
 * ajustará y el valor de fábrica de la decisión, nunca un valor «actual» inventado. El pedido queda
 * en `.claude/integration/a4.md`.
 */
const props = defineProps<{
    etiqueta: string
    /** Qué hace el ajuste, en una línea. */
    ayuda: string
    /** Valor de fábrica y rango de la decisión del PM («15 min de fábrica · de 5 a 60»). */
    fabrica: string
    /** Número de la decisión del PM (`decisiones-pm.md`); sin él, un ajuste del diseño que espera su API. */
    decision?: number
}>()
</script>

<template>
    <div
        class="flex min-w-0 flex-col gap-2 border-(--ax-borde) py-2.5 sm:flex-row sm:items-center sm:justify-between [&:not(:first-child)]:border-t"
        data-fila-config
        :data-pendiente="props.decision"
    >
        <div class="flex min-w-0 flex-col">
            <span class="text-sm font-semibold text-highlighted">{{ props.etiqueta }}</span>
            <span class="text-xs text-muted">{{ props.ayuda }}</span>
        </div>
        <div class="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            <span class="text-sm text-muted">{{ props.fabrica }}</span>
            <UBadge
                label="Próximamente"
                icon="i-lucide-construction"
                color="neutral"
                variant="subtle"
                size="sm"
                title="Este ajuste se podrá cambiar en una próxima versión."
            />
        </div>
    </div>
</template>
