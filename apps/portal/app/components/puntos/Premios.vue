<script setup lang="ts">
/**
 * Catálogo de premios como tarjetas. Cada una dice qué es, cuánto cuesta y cuánto le falta al
 * cliente (barra de avance). «Canjear» está apagado mientras no se pueda, con el porqué en texto:
 * nunca un botón que respondería un error ya sabido.
 */
const props = defineProps<{
    premios: PremioPortal[]
}>()

const emit = defineEmits<{
    canjear: [premio: PremioPortal]
}>()
</script>

<template>
    <ul
        class="grid grid-cols-1 gap-3 sm:grid-cols-2"
        data-testid="premios"
    >
        <li
            v-for="premio in props.premios"
            :key="premio.id"
        >
            <UCard
                class="h-full"
                :ui="{ body: 'flex h-full flex-col gap-3 p-4 sm:p-4' }"
                :data-testid="`premio-${premio.id}`"
            >
                <div class="flex items-start gap-3">
                    <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <UIcon
                            :name="ICONOS_PREMIO[premio.tipo]"
                            class="size-5"
                        />
                    </div>
                    <div class="min-w-0 flex-1 space-y-1">
                        <p class="font-medium text-highlighted">
                            {{ premio.nombre }}
                        </p>
                        <p class="text-sm text-muted">
                            {{ descripcionPremio(premio) }}
                        </p>
                        <UBadge
                            :label="puntosEnTexto(premio.costo_puntos)"
                            color="primary"
                            variant="subtle"
                            class="tabular-nums"
                            data-testid="costo-premio"
                        />
                    </div>
                </div>

                <UProgress
                    v-if="premio.motivo_no_canjeable === 'puntos_insuficientes'"
                    :model-value="avanceHacia(premio)"
                    size="sm"
                    :aria-label="`Avance hacia ${premio.nombre}`"
                />

                <div class="mt-auto flex flex-wrap items-center justify-between gap-2">
                    <p
                        v-if="!premio.canjeable"
                        class="text-sm text-muted"
                        data-testid="por-que-no"
                    >
                        {{ textoNoCanjeable(premio) }}
                    </p>
                    <span v-else />
                    <UButton
                        label="Canjear"
                        icon="i-lucide-gift"
                        :disabled="!premio.canjeable"
                        :variant="premio.canjeable ? 'solid' : 'soft'"
                        :color="premio.canjeable ? 'primary' : 'neutral'"
                        data-testid="canjear"
                        @click="emit('canjear', premio)"
                    />
                </div>
            </UCard>
        </li>
    </ul>
</template>
