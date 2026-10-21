<script setup lang="ts">
/**
 * Ganadores por seudónimo (nunca nombres). Con `miCodigo`, el del cliente se marca: «¡Eres tú!».
 */
const props = defineProps<{
    ganadores: Array<{ posicion: number, tipo: 'titular' | 'suplente', codigo: string, premio_posicion: number | null }>
    premios: Array<{ posicion: number, nombre: string }>
    miCodigo?: string | null
}>()

const nombrePremio = (posicion: number | null) => props.premios.find(p => p.posicion === posicion)?.nombre ?? null
</script>

<template>
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <ul
            class="divide-y divide-default"
            data-testid="ganadores"
        >
            <li
                v-for="ganador in props.ganadores"
                :key="`${ganador.tipo}-${ganador.posicion}`"
                class="flex items-center justify-between gap-3 px-4 py-3"
                :class="props.miCodigo && ganador.codigo === props.miCodigo ? 'bg-primary/10' : ''"
                data-testid="ganador"
            >
                <div class="min-w-0">
                    <p class="font-mono text-sm font-medium text-highlighted">
                        {{ ganador.codigo }}
                    </p>
                    <p class="text-xs text-muted">
                        {{ ganador.tipo === 'titular' ? (nombrePremio(ganador.premio_posicion) ?? 'Premio') : `Suplente ${ganador.posicion}` }}
                    </p>
                </div>
                <UBadge
                    v-if="props.miCodigo && ganador.codigo === props.miCodigo"
                    label="¡Eres tú!"
                    icon="i-lucide-party-popper"
                    color="primary"
                    variant="solid"
                    data-testid="gane"
                />
                <UIcon
                    v-else-if="ganador.tipo === 'titular'"
                    name="i-lucide-trophy"
                    class="size-5 shrink-0 text-warning"
                />
            </li>
        </ul>
    </UCard>
</template>
