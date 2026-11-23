<script setup lang="ts">
/**
 * Contar el efectivo por billete y moneda (tablero NuevoCierreCaja, paso «Contar», y «Contar
 * billetes y monedas» al abrir la caja): ficha de color de cada denominación, menos y más, la
 * cantidad (se puede escribir) y su subtotal. Billetes y monedas en dos grupos.
 */
withDefaults(defineProps<{
    /** Columnas en pantallas anchas (2 en el cierre, 1 en ventanas angostas y el teléfono). */
    columnas?: 1 | 2
}>(), {
    columnas: 2,
})

const conteo = defineModel<ConteoEfectivo>({ required: true })

const GRUPOS = [
    { tipo: 'billete' as const, titulo: 'Billetes' },
    { tipo: 'moneda' as const, titulo: 'Monedas' },
]

function cantidad(clave: string): number {
    return conteo.value[clave] ?? 0
}

function poner(clave: string, valor: number | null | undefined) {
    conteo.value = { ...conteo.value, [clave]: Math.max(0, Math.trunc(Number(valor) || 0)) }
}

function subtotal(clave: string): string {
    return formatearQuetzales(totalConteo({ [clave]: cantidad(clave) }))
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <section
            v-for="grupo in GRUPOS"
            :key="grupo.tipo"
            class="flex flex-col gap-2"
            :aria-label="grupo.titulo"
        >
            <h3 class="text-[0.6875rem] font-semibold tracking-wider text-muted uppercase">
                {{ grupo.titulo }}
            </h3>
            <div
                class="grid gap-2"
                :class="columnas === 2 ? 'sm:grid-cols-2' : ''"
            >
                <div
                    v-for="d in DENOMINACIONES_CONTEO.filter(x => x.tipo === grupo.tipo)"
                    :key="d.clave"
                    class="flex items-center gap-2 rounded-xl border border-(--ax-borde) bg-(--ax-tarjeta) p-2"
                    :data-denominacion="d.clave"
                >
                    <span
                        class="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular-nums"
                        :class="d.tono"
                    >{{ d.etiqueta }}</span>
                    <span class="flex-1" />
                    <UButton
                        icon="i-lucide-minus"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        class="rounded-full"
                        :aria-label="`Uno menos de ${d.etiqueta}`"
                        :disabled="!cantidad(d.clave)"
                        @click="poner(d.clave, cantidad(d.clave) - 1)"
                    />
                    <UInput
                        :model-value="String(cantidad(d.clave))"
                        inputmode="numeric"
                        :aria-label="`Cantidad de ${d.etiqueta} (${d.tipo})`"
                        class="w-14"
                        :ui="{ base: 'text-center text-base font-bold tabular-nums' }"
                        @update:model-value="poner(d.clave, Number($event))"
                        @focus="($event.target as HTMLInputElement).select()"
                    />
                    <UButton
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        class="rounded-full"
                        :aria-label="`Uno más de ${d.etiqueta}`"
                        @click="poner(d.clave, cantidad(d.clave) + 1)"
                    />
                    <span class="w-20 shrink-0 text-end text-xs tabular-nums text-muted">{{ subtotal(d.clave) }}</span>
                </div>
            </div>
        </section>
    </div>
</template>
