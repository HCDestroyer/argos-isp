<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Tarjeta KPI del sistema visual Argos: cabecera con el icono en pastilla del tono de la métrica,
 * título y menú de tres puntos; cuerpo en un panel interno con la mini gráfica, la cifra (número
 * vivo) y la tendencia en el tono de la métrica. Cada métrica lleva una ranura de la paleta
 * categórica (nunca un color de estado). `destacada` agrega el tinte suave del degradado de marca.
 */
const props = withDefaults(defineProps<{
    etiqueta: string
    valor: string
    icono: string
    tono?: 1 | 2 | 3 | 4 | 5
    /** Serie de la mini gráfica (el último valor es el actual). */
    serie?: readonly (number | string)[]
    /** Texto junto a la tendencia («vs. mes anterior»). */
    comparacion?: string
    detalle?: string
    to?: string
    etiquetaEnlace?: string
    acciones?: DropdownMenuItem[]
    destacada?: boolean
}>(), {
    tono: 1,
    serie: undefined,
    comparacion: 'vs. mes anterior',
    detalle: undefined,
    to: undefined,
    etiquetaEnlace: 'Ver detalle',
    acciones: undefined,
    destacada: false,
})

/** La mini gráfica muestra los últimos 8 meses; la tendencia compara los dos últimos. */
const ultimos = computed(() => props.serie?.slice(-8) ?? [])
const tendencia = computed(() => (props.serie && props.serie.length > 1 ? tendenciaDe(props.serie) : null))
const iconoTendencia = computed(() => ({
    sube: 'i-lucide-trending-up',
    baja: 'i-lucide-trending-down',
    igual: 'i-lucide-minus',
})[tendencia.value?.direccion ?? 'igual'])

const menu = computed<DropdownMenuItem[]>(() => [
    ...(props.to ? [{ label: props.etiquetaEnlace, icon: 'i-lucide-arrow-up-right', to: props.to }] : []),
    ...(props.acciones ?? []),
])
</script>

<template>
    <article
        class="flex min-w-0 flex-col gap-3 surface-card p-4"
        :class="[`tono-${tono}`, destacada ? 'tarjeta-destacada filete-marca' : '']"
    >
        <header class="flex items-center gap-3">
            <span class="pastilla-icono pastilla-tono">
                <UIcon
                    :name="icono"
                    class="size-5"
                />
            </span>
            <h3 class="min-w-0 flex-1 text-sm leading-tight font-semibold text-highlighted">
                {{ etiqueta }}
            </h3>
            <UDropdownMenu
                v-if="menu.length"
                :items="menu"
                :content="{ align: 'end' }"
            >
                <UButton
                    icon="i-lucide-ellipsis-vertical"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :aria-label="`Más opciones de ${etiqueta}`"
                    class="-my-1 -me-1.5"
                />
            </UDropdownMenu>
        </header>

        <div class="flex flex-col gap-2 rounded-lg bg-(--ax-panel) p-3">
            <p
                class="truncate text-2xl font-bold tracking-[-0.02em] tabular-nums text-highlighted"
                data-prueba="valor"
            >
                <NumeroVivo :valor="valor" />
            </p>
            <div
                v-if="ultimos.length || tendencia"
                class="flex items-end justify-between gap-3"
            >
                <p
                    v-if="tendencia"
                    class="flex flex-wrap items-center gap-x-1 text-xs font-semibold texto-tono"
                    data-prueba="tendencia"
                >
                    <UIcon
                        :name="iconoTendencia"
                        class="size-3.5"
                    />
                    <span>{{ tendencia.texto }}</span>
                    <span class="font-normal text-muted">{{ comparacion }}</span>
                </p>
                <MiniBarras
                    v-if="ultimos.length"
                    :valores="ultimos"
                    class="ms-auto"
                />
            </div>
        </div>

        <div
            v-if="detalle || $slots.default"
            class="text-xs text-muted"
        >
            <slot>{{ detalle }}</slot>
        </div>
    </article>
</template>
