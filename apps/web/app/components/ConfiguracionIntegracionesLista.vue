<script setup lang="ts">
/**
 * Lista de integraciones (tablero OperConfigIntegraciones, columna izquierda): cada sistema con su
 * frase y su estado; la elegida queda marcada. El estado lo pasa la pantalla (lo que leyó de la
 * API); sin estado leído no se pinta ninguno.
 */

const props = defineProps<{
    items: IntegracionItem[]
    activa: string | null
}>()
</script>

<template>
    <nav
        class="surface-card flex min-w-0 flex-col overflow-hidden rounded-2xl lg:min-h-0"
        aria-label="Integraciones"
        data-prueba="lista-integraciones"
    >
        <ULink
            v-for="item in props.items"
            :key="item.id"
            :to="item.to"
            class="flex items-center gap-3 border-b border-s-4 border-b-(--ax-borde) px-4 py-3 transition-colors hover:bg-(--ax-fila-hover)"
            :class="props.activa === item.id ? 'border-s-primary bg-primary/5' : 'border-s-transparent'"
            :aria-current="props.activa === item.id ? 'page' : undefined"
            :data-integracion="item.id"
        >
            <span
                class="pastilla-icono pastilla-tono"
                :class="item.tono"
            >
                <UIcon
                    :name="item.icono"
                    class="size-5"
                />
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-sm font-semibold text-highlighted">{{ item.nombre }}</span>
                <span class="text-xs text-muted">{{ item.frase }}</span>
            </span>
            <UBadge
                v-if="item.estado"
                :label="item.estado.etiqueta"
                :icon="item.estado.icono"
                :color="item.estado.color"
                variant="subtle"
                size="sm"
                class="shrink-0"
                :data-prueba="item.estado.prueba"
            />
        </ULink>
    </nav>
</template>
